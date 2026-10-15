/**
 * Medição de idas ao banco por requisição.
 *
 * `instrumentQueries(env, request)` devolve o mesmo ambiente com o binding D1
 * envolvido por um contador dedicado àquela requisição (nada global, então
 * requisições concorrentes não se misturam). Sem medição devolve o ambiente
 * intacto e o medidor nulo: nenhum invólucro, nenhum custo.
 *
 * Quando medir:
 * - em desenvolvimento, sempre (é a régua do `npm run perf` e do `perf:api`);
 * - em qualquer ambiente, quando a requisição traz `x-perf-timing: 1`.
 *
 * O cabeçalho é só um pedido de medição — não é segredo nem credencial. Por
 * isso o resultado **só sai** para quem a requisição identificou: `withQueryTiming`
 * publica o `Server-Timing` em desenvolvimento ou depois de `markAuthenticated`,
 * que `authenticate` e o adaptador `/api/v1` chamam ao reconhecer a pessoa. Uma
 * requisição anônima com o cabeçalho continua medida e a resposta sai sem
 * medição, como a de qualquer outro anônimo.
 *
 * O resultado sai no cabeçalho `Server-Timing`, que o navegador e os scripts de
 * `scripts/perf-*.mjs` leem. É a métrica de "idas ao D1" do plano de otimização
 * (`docs/plano-de-otimizacao-desempenho.md`).
 */
import { requestDatabase } from "./operations/request-context.ts";
import { BOOKMARK_HEADER, primaryBookmark, readReplicasEnabled, replicaPlan, sessionDatabase } from "./d1-replicas.ts";

export type QueryMeter = {
  trips: number; statements: number; ms: number; authenticated: boolean;
  /** Profundidade: a maior cadeia de idas em série (cada ida = 1 + a maior já terminada quando começou). */
  depth?: number; done?: number;
  /** Onde o D1 respondeu (`meta.served_by_*`), quando a resposta traz. */
  primary?: number; replica?: number; regions?: Set<string>;
  /** A medição foi pedida; sem isso o medidor só existe para as réplicas e não sai no cabeçalho. */
  publish?: boolean;
  /** Réplicas ligadas: sessão de leitura (bookmark sai na resposta) ou escrita (bookmark do primário depois). */
  session?: D1DatabaseSession; write?: boolean; primaryOrigin?: D1Database;
};

/** Pedido explícito de medição; nunca carrega valor, só liga o contador. */
export const PERF_TIMING_HEADER = "x-perf-timing";

/** Em desenvolvimento a medição é aberta; publicado, exige identidade. */
export function openMetering() {
  return process.env.NODE_ENV !== "production";
}

export function queryMeteringEnabled(request?: Request) {
  return openMetering() || request?.headers.get(PERF_TIMING_HEADER) === "1";
}

const INNER = Symbol("d1-statement");

/** Medidor da requisição, alcançável pelo binding que `instrumentQueries` devolveu. */
const meters = new WeakMap<D1Database, QueryMeter>();

/** A requisição identificou a pessoa: a medição pode sair na resposta. */
export function markAuthenticated(db: D1Database | undefined) {
  if (db) {
    const meter = meters.get(db);
    if (meter) meter.authenticated = true;
  }
}

type ServedMeta = { served_by_primary?: boolean; served_by_region?: string };
function noteServed(meter: QueryMeter, result: unknown) {
  const metas = (Array.isArray(result) ? result : [result])
    .map(item => (item && typeof item === "object" ? (item as { meta?: ServedMeta }).meta : undefined))
    .filter((meta): meta is ServedMeta => !!meta && (meta.served_by_primary !== undefined || !!meta.served_by_region));
  for (const meta of metas.slice(0, 1)) {
    if (meta.served_by_primary === true) meter.primary = (meter.primary ?? 0) + 1;
    else if (meta.served_by_primary === false) meter.replica = (meter.replica ?? 0) + 1;
    if (meta.served_by_region) (meter.regions ??= new Set()).add(meta.served_by_region);
  }
}

async function track<T>(meter: QueryMeter, statements: number, work: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const level = (meter.done ?? 0) + 1;
  try {
    const result = await work();
    noteServed(meter, result);
    return result;
  } finally {
    meter.trips += 1;
    meter.statements += statements;
    meter.ms += Date.now() - start;
    meter.done = Math.max(meter.done ?? 0, level);
    meter.depth = Math.max(meter.depth ?? 0, level);
  }
}

type Wrapped = D1PreparedStatement & { [INNER]?: D1PreparedStatement };

function unwrap(statement: D1PreparedStatement): D1PreparedStatement {
  return (statement as Wrapped)[INNER] ?? statement;
}

function meteredStatement(statement: D1PreparedStatement, meter: QueryMeter): D1PreparedStatement {
  const wrapper = {
    [INNER]: statement,
    bind: (...values: unknown[]) => meteredStatement(statement.bind(...values), meter),
    first: (column?: string) =>
      track(meter, 1, () => (column === undefined ? statement.first() : statement.first(column))),
    run: () => track(meter, 1, () => statement.run()),
    all: () => track(meter, 1, () => statement.all()),
    raw: (options?: { columnNames?: boolean }) =>
      track(meter, 1, () => (statement.raw as (o?: unknown) => Promise<unknown>)(options)),
  };
  return wrapper as unknown as D1PreparedStatement;
}

function meteredDatabase(db: D1Database, meter: QueryMeter): D1Database {
  const wrapper = {
    prepare: (query: string) => meteredStatement(db.prepare(query), meter),
    batch: (statements: D1PreparedStatement[]) =>
      track(meter, statements.length, () => db.batch(statements.map(unwrap))),
    exec: (query: string) => track(meter, 1, () => db.exec(query)),
    dump: () => db.dump(),
    withSession: (constraint?: string) => db.withSession(constraint),
  };
  return wrapper as unknown as D1Database;
}

/**
 * Prepara o ambiente da requisição: memória de leitura de documentos sempre e,
 * quando a medição está ligada, a contagem de idas ao D1 por baixo dela. Com
 * `D1_READ_REPLICAS=1` (desligado por padrão), as leituras da lista de
 * `d1-replicas.ts` usam uma sessão do D1 e as escritas pedem o bookmark do
 * primário no fim; sem a variável, nada disso existe.
 */
export function instrumentQueries<T extends { DB?: D1Database; D1_READ_REPLICAS?: string }>(
  env: T,
  request?: Request,
): { env: T; meter: QueryMeter | null } {
  if (!env.DB) return { env, meter: null };
  const metering = queryMeteringEnabled(request);
  const plan = request && readReplicasEnabled(env) && typeof env.DB.withSession === "function"
    ? replicaPlan(request) : null;
  const meter: QueryMeter | null = metering || plan
    ? { trips: 0, statements: 0, ms: 0, authenticated: false, publish: metering }
    : null;
  let source = env.DB;
  if (plan?.kind === "read") {
    meter!.session = env.DB.withSession(plan.constraint);
    source = sessionDatabase(env.DB, meter!.session);
  } else if (plan?.kind === "write") {
    meter!.write = true;
    meter!.primaryOrigin = env.DB;
  }
  const db = requestDatabase(meter ? meteredDatabase(source, meter) : source, env.DB);
  if (meter) meters.set(db, meter);
  return { env: { ...env, DB: db }, meter };
}

/**
 * Acrescenta `Server-Timing` à resposta. Sem medidor — ou com uma requisição que
 * não se identificou num ambiente publicado — devolve a resposta como está.
 * Com réplicas ligadas, acrescenta `x-d1-bookmark` (por isso pode ser assíncrona:
 * a escrita pergunta ao primário o bookmark depois de gravar).
 */
export function withQueryTiming(response: Response, meter: QueryMeter | null, startedAt?: number): Response | Promise<Response> {
  if (meter?.write && meter.authenticated && meter.primaryOrigin) {
    const origin = meter.primaryOrigin;
    meter.primaryOrigin = undefined;
    return primaryBookmark(origin).then(bookmark => {
      if (bookmark) setHeader(response, BOOKMARK_HEADER, bookmark);
      return publishTiming(response, meter, startedAt);
    });
  }
  const bookmark = meter?.session?.getBookmark();
  if (bookmark && meter?.authenticated) setHeader(response, BOOKMARK_HEADER, bookmark);
  return publishTiming(response, meter, startedAt);
}

function setHeader(response: Response, name: string, value: string) {
  try { response.headers.set(name, value); } catch { /* resposta imutável */ }
}

function publishTiming(response: Response, meter: QueryMeter | null, startedAt?: number): Response {
  if (!meter || meter.publish === false || (!meter.authenticated && !openMetering())) return response;
  const parts = [`d1;dur=${meter.ms};desc="${meter.trips} idas, ${meter.statements} comandos"`,
    `d1serie;desc="${meter.depth ?? 0} em serie"`];
  if (meter.primary || meter.replica || meter.regions?.size)
    parts.push(`d1replica;desc="primario=${meter.primary ?? 0} replica=${meter.replica ?? 0} regiao=${[...meter.regions ?? []].join("/") || "?"}"`);
  if (meter.session) parts.push(`d1session;desc="${meter.session.getBookmark() ? "bookmark" : "sem-bookmark"}"`);
  if (startedAt !== undefined) parts.push(`total;dur=${Date.now() - startedAt}`);
  try {
    response.headers.append("Server-Timing", parts.join(", "));
    return response;
  } catch {
    // Respostas imutáveis (por exemplo vindas de cache) seguem sem a medição.
    return response;
  }
}
