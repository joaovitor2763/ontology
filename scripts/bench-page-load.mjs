// Régua das duas leituras da carga de `/` e `/clientes` (bootstrap e carteira)
// no caminho de produção — sessão Google, roster, autorização, fatias ativas —
// num D1 em memória (node:sqlite) com cada ida atrasada como no Worker.
// Não toca banco real.
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/bench-page-load.mjs \
//     [--latency 45] [--clients 131] [--archived 34] [--rounds 7] [--root <árvore a medir>]
// `--root` mede outra árvore (por exemplo `origin/main` extraído com `git archive`), com
// o mesmo exemplo e a mesma régua. `idas` é exato; `série` é a maior cadeia de idas que
// esperaram umas pelas outras (cada ida = 1 + a maior já terminada quando ela começou).
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const latency = Number(arg("latency", 45));
const total = Number(arg("clients", 131));
const archivedCount = Number(arg("archived", 34));
const rounds = Number(arg("rounds", 7));
const root = resolve(arg("root", "."));
const load = (path) => import(pathToFileURL(resolve(root, path)).href);

const { activeWorkspace, writeSummaries, MEMBERS } = await load("tests/helpers/active-workspace.mjs");
const { readStateBatch } = await load("src/server/operations/state-batch.ts");
const { resolveOperationPrincipal } = await load("src/server/operations/principal.ts");
const portfolio = await load("src/server/operations/portfolio.ts");
const { instrumentQueries } = await load("src/server/timing.ts");

process.env.CHECK_CLIENT_SUMMARY = "0";
const f = activeWorkspace({ now: new Date(), extraClients: total - 5 });
const clients = JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body);
clients.archivedClients = clients.extraClients.slice(-archivedCount).map((c) => c.slug);
f.sql.prepare("UPDATE state_documents SET body=? WHERE key='ontology.clients.v3'").run(JSON.stringify(clients));
// Documentos com o peso medido em produção (06/10): o bootstrap antigo os levava sem uso.
const pad = (bytes) => "x".repeat(bytes);
const put = f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,?,?)");
put.run("ontology.documents.v3", 3, JSON.stringify({ extraDocs: [], removedDocIds: [], docEdits: {}, pad: pad(227_000) }));
put.run("ontology.stakeholders.v1", 2, JSON.stringify({ contacts: [], pad: pad(62_000) }));
writeSummaries(f);
const token = "a".repeat(64);
const hash = createHash("sha256").update(token).digest("base64url");
f.sql.prepare("INSERT INTO login_sessions(token_hash,workspace_id,email,name,expires_at) VALUES(?,?,?,?,?)")
  .run(hash, "default", MEMBERS[0].email, "Admin", 4_102_444_800);

// Cada ida espera `latency` ms; a série é medida pelo mesmo critério do Server-Timing.
let finished = 0, depth = 0, trips = 0;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const trace = async (work) => {
  const level = finished + 1;
  trips += 1;
  try { await sleep(latency); return await work(); }
  finally { finished = Math.max(finished, level); depth = Math.max(depth, level); }
};
const delayed = {
  prepare(query) {
    const wrap = (statement) => ({ __inner: statement, bind: (...v) => wrap(statement.bind(...v)),
      first: (...a) => trace(() => statement.first(...a)), all: () => trace(() => statement.all()),
      run: () => trace(() => statement.run()), raw: (...a) => trace(() => statement.raw(...a)) });
    return wrap(f.db.prepare(query));
  },
  batch: (statements) => trace(() => f.db.batch(statements.map((s) => s.__inner ?? s))),
  exec: (query) => trace(() => f.db.exec(query)),
  withSession: () => { throw new Error("sem sessão no exemplo"); },
};
const env = {
  DB: delayed, WORKSPACE_ID: "default", AUTH_MODE: "google", AUTH_ORIGIN: "https://delivery.test",
  AUTH_GOOGLE_DOMAIN: "example.test", GOOGLE_CLIENT_ID: "bench", GOOGLE_CLIENT_SECRET: "bench",
  GOOGLE_ENABLED: "true", AUTH_BOOTSTRAP_EMAIL: MEMBERS[0].email,
};
const headers = { cookie: `__Host-g4_session=${token}`, "x-perf-timing": "1" };
const K = { w: "ontology.workspace.v3", c: "ontology.clients.v3", e: "ontology.engagement.v2",
  d: "ontology.documents.v3", k: "ontology.catalog.v2", s: "ontology.stakeholders.v1" };
const bootstrap = (keys) => () => readStateBatch(new Request(`https://delivery.test/api/state?${new URLSearchParams({
  keys: keys.join(","), with: "session,google,alerts" })}`, { headers }), env);
// A rota `/api/portfolio` como no Worker: invólucro da requisição, pré-leitura (quando existe), principal e leitura.
const portfolioRoute = async () => {
  const request = new Request("https://delivery.test/api/portfolio", { headers });
  const { env: scoped } = instrumentQueries(env, request);
  portfolio.warmPortfolioRead?.(request, scoped);
  const principal = await resolveOperationPrincipal(request, scoped);
  const body = await portfolio.readPortfolioSummary(scoped, principal);
  return new Response(JSON.stringify(body));
};
const rows = [];
async function measure(name, run) {
  const walls = [];
  let size = 0;
  for (let i = 0; i < rounds + 1; i++) {
    finished = 0; depth = 0; trips = 0;
    const started = performance.now();
    const response = await run();
    const text = await response.text();
    if (i === 0) continue; // aquece caches do isolate (roster, fila do contador)
    walls.push(performance.now() - started);
    size = Buffer.byteLength(text);
  }
  walls.sort((a, b) => a - b);
  rows.push({ leitura: name, idas: trips, série: depth, "ms (mediana)": Math.round(walls[walls.length >> 1]),
    "KB corpo": +(size / 1024).toFixed(1) });
}
await measure("bootstrap de / e /clientes (lista anterior)", bootstrap([K.w, K.c, K.e, K.d, K.k, K.s]));
await measure("bootstrap de / (lista nova)", bootstrap([K.w, K.c, K.e]));
await measure("bootstrap de /clientes (lista nova)", bootstrap([K.w, K.c, K.s, K.k]));
await measure("GET /api/portfolio", portfolioRoute);
console.log(`\n${root} — ${total} clientes (${archivedCount} arquivados), ${latency} ms por ida, mediana de ${rounds}\n`);
console.table(rows);
f.sql.close();
