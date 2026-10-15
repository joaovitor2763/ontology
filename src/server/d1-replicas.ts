/**
 * Réplicas de leitura do D1 (Sessions API), **desligadas por padrão**.
 *
 * Com `D1_READ_REPLICAS=1` no ambiente do Worker, as leituras GET da lista
 * `REPLICA_READS` (bootstrap, carteira, filas, quadro, ciclos, busca e as
 * coleções de um cliente) usam `env.DB.withSession(...)`: a primeira consulta
 * pode ir a uma réplica, e as seguintes da mesma requisição ficam numa réplica
 * pelo menos tão nova quanto ela. O resto continua no binding normal (primário).
 *
 * Consistência para a própria pessoa ("nunca ler antes do que eu gravei"):
 * - toda resposta com sessão traz `x-d1-bookmark`; a resposta de uma escrita
 *   (método diferente de GET/HEAD) traz o bookmark do primário **depois** da
 *   escrita (uma consulta a mais, só com a flag ligada);
 * - o navegador (`src/shared/infrastructure/d1-bookmark.ts`) guarda o maior
 *   bookmark visto no cookie `g4_d1_bookmark`, que vai em toda requisição,
 *   inclusive na carga antecipada de uma página nova e em outras abas;
 * - uma leitura com o cookie começa a sessão nele (réplica tão nova quanto a
 *   última escrita da pessoa); sem cookie, no primário (e a resposta já traz o
 *   bookmark); Bearer/OAuth/MCP sem bookmark explícito ficam no primário;
 * - o login Google liga `g4_d1_primary` por 30 s (a sessão foi gravada no primário);
 * - escrita que não devolveu bookmark (rota fora do invólucro) faz o navegador
 *   gravar `g4_d1_primary` por 30 s: as leituras desse intervalo vão ao primário.
 *
 * Bookmarks do D1 são comparáveis como texto (o mesmo formato do armazenamento
 * SQLite dos Durable Objects, "lexically comparable"); o maior é o mais novo.
 * Com a flag desligada nada aqui é chamado e os cookies são ignorados.
 */

export const BOOKMARK_COOKIE = "g4_d1_bookmark";
export const PRIMARY_COOKIE = "g4_d1_primary";
export const BOOKMARK_HEADER = "x-d1-bookmark";

/** Leituras que podem ir a uma réplica: só GET, só rotas que não gravam nada que o leitor relê. */
const REPLICA_READS: RegExp[] = [
  /^\/api\/state$/,
  /^\/api\/portfolio$/,
  /^\/api\/alerts$/,
  /^\/api\/search\/tasks$/,
  /^\/api\/execution\/(?:board|cycles)$/,
  /^\/api\/v1\/alerts\/count$/,
  /^\/api\/v1\/(?:tasks|cycles)$/,
  /^\/api\/v1\/clients\/[^/]+\/execution-snapshot$/,
];

export function readReplicasEnabled(env: { D1_READ_REPLICAS?: string }) {
  return env.D1_READ_REPLICAS === "1";
}

/** Formato de um bookmark do D1 (`0000007b-0000b26e-00001538-<hash>`); o resto é ignorado. */
export function validBookmark(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length <= 200 &&
    /^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{1,128}$/i.test(value);
}

/** O mais novo de dois bookmarks válidos (comparação de texto). */
export function newerBookmark(a: string | null | undefined, b: string | null | undefined): string | null {
  const left = validBookmark(a) ? a : null, right = validBookmark(b) ? b : null;
  if (!left) return right;
  if (!right) return left;
  return right > left ? right : left;
}

function cookieValue(request: Request, name: string) {
  const part = (request.headers.get("cookie") ?? "").split(";").map(p => p.trim())
    .find(p => p.startsWith(`${name}=`));
  if (!part) return null;
  try { return decodeURIComponent(part.slice(name.length + 1)); } catch { return null; }
}

export type ReplicaPlan =
  | { kind: "read"; constraint: string }
  | { kind: "write" }
  | null;

/**
 * O que fazer com esta requisição: `read` abre a sessão (no bookmark da pessoa,
 * ou no primário se ela acabou de gravar sem bookmark, ou em qualquer réplica);
 * `write` só pede o bookmark do primário depois da resposta; `null` não muda nada.
 */
export function replicaPlan(request: Request): ReplicaPlan {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return { kind: "write" };
  const path = new URL(request.url).pathname;
  if (!REPLICA_READS.some(pattern => pattern.test(path))) return null;
  const bookmark = newerBookmark(cookieValue(request, BOOKMARK_COOKIE), request.headers.get(BOOKMARK_HEADER));
  // Integrações (Bearer, OAuth, MCP) não guardam cookie: sem bookmark explícito, primário.
  if (request.headers.has("authorization") && !bookmark) return null;
  if (cookieValue(request, PRIMARY_COOKIE) === "1") return { kind: "read", constraint: "first-primary" };
  // Sem bookmark (navegador novo, cookie expirado) a primeira leitura vai ao primário:
  // a pessoa pode ter acabado de gravar por uma rota que não devolve bookmark.
  return { kind: "read", constraint: bookmark ?? "first-primary" };
}

/**
 * A sessão no papel de binding: `prepare` e `batch` vão pela sessão; `exec` e
 * `dump` (que a sessão não tem) vão ao binding original, no primário.
 */
export function sessionDatabase(db: D1Database, session: D1DatabaseSession): D1Database {
  return {
    prepare: (query: string) => session.prepare(query),
    batch: <T = unknown>(statements: D1PreparedStatement[]) => session.batch<T>(statements),
    exec: (query: string) => db.exec(query),
    dump: () => db.dump(),
    withSession: (constraint?: string) => db.withSession(constraint),
  } as unknown as D1Database;
}

/** Bookmark do primário agora: depois de uma escrita, é pelo menos o dela. */
export async function primaryBookmark(db: D1Database): Promise<string | null> {
  try {
    const session = db.withSession("first-primary");
    await session.prepare("SELECT 1").first();
    return session.getBookmark();
  } catch {
    return null;
  }
}
