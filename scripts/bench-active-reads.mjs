// Mede idas ao D1 (e tempo local) das leituras globais em modo `active`, num
// D1 em memória (node:sqlite) com ~100 clientes. Não toca nenhum banco real.
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/bench-active-reads.mjs \
//     [--clients 100] [--summaries] [--deferred] [--dump arquivo.json]
// `trips` é exato (o mesmo contador do Server-Timing); `depth` é uma estimativa
// da cadeia em série (o SQLite em memória responde na hora, então pode sobrar).
// Quadro e ciclos também medem o corpo da resposta: `kb` (JSON), `gzipKb` e
// `brKb` (brotli 4, perto do que a Cloudflare usa na compressão dinâmica); o
// `ms` deles inclui o `JSON.stringify`, que a rota paga ao responder.
import { writeFileSync } from "node:fs";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
const FIXED = Date.parse("2026-10-06T15:20:00.000Z");
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [FIXED])); }
  static now() { return FIXED; }
};
const { activeWorkspace, session } = await import("../tests/helpers/active-workspace.mjs");
const { instrumentQueries } = await import("../src/server/timing.ts");
const { readPortfolioSummary } = await import("../src/server/operations/portfolio.ts");
const { readAlertQueue } = await import("../src/server/operations/alert-queue.ts");
const { countAlerts } = await import("../src/server/operations/alerts-count.ts");
const boardModule = await import("../src/server/operations/execution-board.ts");
const { readExecutionBoard } = boardModule;
// O quadro tem cache no isolate (`forgetExecutionBoards` só existe a partir dele); a rota manda o JSON pronto.
const forget = boardModule.forgetExecutionBoards ?? (() => {});
const boardJson = boardModule.readExecutionBoardJson ?? (async (env, principal, tag, wire) => {
  const result = await readExecutionBoard(env, principal, tag, wire);
  return result.notModified ? result : { body: JSON.stringify(result), etag: result.etag };
});
const { readExecutionCycles } = await import("../src/server/operations/execution-cycles.ts");
const { searchTasks } = await import("../src/server/operations/search-tasks.ts");
const { readStateBatch } = await import("../src/server/operations/state-batch.ts");

const clientsArg = process.argv.indexOf("--clients");
// `--production`: fatias com o volume medido em produção (~19 tarefas, ~5 ciclos por cliente).
const f = activeWorkspace({ now: new Date(), profile: process.argv.includes("--production") ? "production" : "simple",
  extraClients: clientsArg > 0 ? Number(process.argv[clientsArg + 1]) - 5 : 95 });
// `--summaries`: resumos por cliente (0042) gravados como o backfill gravaria; sem a
// flag, a tabela fica vazia e as leituras projetam as fatias, como antes da fase C.
if (process.argv.includes("--summaries")) {
  const { writeSummaries } = await import("../tests/helpers/active-workspace.mjs");
  writeSummaries(f);
}
// Profundidade: cada ida tem nível 1 + o maior nível entre as idas já
// terminadas quando ela começou; o maior nível é a cadeia em série.
let finished = 0, depth = 0;
// `d1Kb`: bytes que o D1 devolveria (texto das linhas), contados numa rodada à parte.
let counting = false, bytes = 0;
const count = (result) => { if (counting) for (const one of [result].flat()) for (const row of one?.results ?? [one])
  for (const value of Object.values(row ?? {})) bytes += typeof value === "string" ? value.length : 8; return result; };
const trace = (work) => { const level = finished + 1; return work().then(count).finally(() => {
  finished = Math.max(finished, level); depth = Math.max(depth, level); }); };
const traced = {
  prepare(query) {
    const wrap = (statement) => ({ __inner: statement, bind: (...v) => wrap(statement.bind(...v)),
      first: (...a) => trace(() => statement.first(...a)), all: () => trace(() => statement.all()),
      run: () => trace(() => statement.run()) });
    return wrap(f.db.prepare(query));
  },
  batch: (statements) => trace(() => f.db.batch(statements.map(s => s.__inner ?? s))),
};
const reset = () => { finished = 0; depth = 0; };
const base = { DB: traced };
const results = {};
const rows = [];
async function measure(name, run, repeat = 5, body = false) {
  let last, trips = 0, ms = 0;
  for (let i = 0; i < repeat; i++) {
    reset();
    const { env, meter } = instrumentQueries(base);
    const started = performance.now();
    last = await run(env);
    if (body) JSON.stringify(last);
    ms += performance.now() - started;
    trips = meter.trips;
  }
  const levels = depth;
  counting = true; bytes = 0;
  await run(instrumentQueries(base).env);
  counting = false;
  const row = { name, trips, depth: levels, ms: +(ms / repeat).toFixed(1), d1Kb: +(bytes / 1024).toFixed(0) };
  if (body) {
    const raw = Buffer.from(JSON.stringify(last)), kb = (bytes) => +(bytes / 1024).toFixed(1);
    Object.assign(row, { kb: kb(raw.length), gzipKb: kb(gzipSync(raw).length),
      brKb: kb(brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }).length) });
  }
  rows.push(row);
  return last;
}
const admin = session("admin"), operator = session("operator"), reader = session("reader");
results.portfolio = await measure("GET /api/portfolio", env => readPortfolioSummary(env, admin));
results.portfolioMember = await measure("GET /api/portfolio?member=operator", env => readPortfolioSummary(env, admin, "operator"));
results.queueAdmin = await measure("GET /api/alerts (admin)", env => readAlertQueue(env, admin));
results.queueOperator = await measure("GET /api/alerts (ai_master)", env => readAlertQueue(env, operator));
results.queueCompany = await measure("GET /api/alerts?company", env => readAlertQueue(env, admin, f.clients[1].slug));
results.countAdmin = await measure("alerts/count admin (1ª = falha, depois acerto)", env => countAlerts(env, admin), 1);
results.countAdminWarm = await measure("alerts/count admin (acerto)", env => countAlerts(env, admin));
results.countOperator = await measure("alerts/count ai_master (outra pessoa)", env => countAlerts(env, operator), 1);
results.countReader = await measure("alerts/count leitor (outra pessoa)", env => countAlerts(env, reader), 1);
const board = results.board = await measure("GET /api/execution/board (falha)",
  env => (forget(), readExecutionBoard(env, admin)), 5, true);
results.boardTable = await measure("GET /api/execution/board?formato=tabela (falha, com JSON)",
  env => (forget(), boardJson(env, admin, null, "table")));
const lastTable = JSON.parse((await boardJson({ DB: traced }, admin, null, "table")).body);
rows.at(-1).kb = +(Buffer.byteLength(JSON.stringify(lastTable)) / 1024).toFixed(1);
Object.assign(rows.at(-1), { gzipKb: +(gzipSync(JSON.stringify(lastTable)).length / 1024).toFixed(1),
  brKb: +(brotliCompressSync(JSON.stringify(lastTable), { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }).length / 1024).toFixed(1) });
results.boardHit = await measure("GET /api/execution/board?formato=tabela (acerto, outra pessoa)",
  env => boardJson(env, operator, null, "table"));
results.boardTag = await measure("GET /api/execution/board (ETag)", env => readExecutionBoard(env, admin, board.etag));
const cycles = results.cycles = await measure("GET /api/execution/cycles", env => readExecutionCycles(env, admin), 5, true);
results.cyclesTag = await measure("GET /api/execution/cycles (ETag)", env => readExecutionCycles(env, admin, cycles.etag));
results.search = await measure("GET /api/search/tasks?q=Atrasada 1", env => searchTasks(env, admin, "Atrasada 1"));
const keys = "ontology.workspace.v3,ontology.clients.v3,ontology.catalog.v2";
async function batch(name, query, options = {}, repeat = 5) {
  let body, trips, ms = 0;
  for (let i = 0; i < repeat; i++) {
    reset();
    const started = performance.now();
    const response = await readStateBatch(new Request(`https://delivery.test/api/state?${query}`),
      { DB: traced, AUTH_MODE: "dev", DEV_USER_EMAIL: admin.email }, options);
    ms += performance.now() - started;
    trips = Number(/(\d+) idas/.exec(response.headers.get("server-timing") ?? "")?.[1]);
    body = await response.json();
  }
  rows.push({ name, trips, depth, ms: +(ms / repeat).toFixed(1) });
  return body;
}
const boot = results.bootstrap = await batch("bootstrap with=session,google,alerts", `keys=${keys}&with=session,google,alerts`);
const versions = boot.documents.map(doc => `${doc.key}:${doc.version}`).join(",");
results.polling = await batch("polling with=alerts (nada mudou)", `keys=${keys}&versions=${versions}&with=alerts`);
results.pollingChanged = await batch("polling with=alerts (clientes mudou)", `keys=${keys}&versions=${versions.replace("clients.v3:9", "clients.v3:8")}&with=alerts`);
if (process.argv.includes("--deferred")) {
  // O bootstrap no Worker: com waitUntil, a falha do contador não segura a resposta.
  const { touchSlice } = await import("../tests/helpers/active-workspace.mjs");
  touchSlice(f, f.clients[2].slug, (value) => value.extraTasks[0].status = "bloqueado");
  const deferred = [];
  results.bootstrapDeferred = await batch("bootstrap (Worker) logo após uma escrita", `keys=${keys}&with=session,google,alerts`,
    { waitUntil: (work) => deferred.push(work) }, 1);
  rows.at(-1).alerts = results.bootstrapDeferred.alerts === undefined ? "ausente (calcula depois)" : "no corpo";
  await Promise.all(deferred);
}
console.table(rows);
const dump = process.argv.indexOf("--dump");
if (dump > 0) writeFileSync(process.argv[dump + 1],
  JSON.stringify(results, (key, value) => key === "updatedAt" ? undefined : value, 1));
f.sql.close();
