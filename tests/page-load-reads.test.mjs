import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { activeWorkspace, writeSummaries, MEMBERS } from "./helpers/active-workspace.mjs";
import { readStateBatch } from "../src/server/operations/state-batch.ts";
import { resolveOperationPrincipal } from "../src/server/operations/principal.ts";
import { readPortfolioSummary, warmPortfolioRead } from "../src/server/operations/portfolio.ts";
import { authenticate } from "../src/server/auth.ts";
import { instrumentQueries, markAuthenticated, withQueryTiming } from "../src/server/timing.ts";

/**
 * Carga de `/` e `/clientes` no caminho de produção (sessão Google): quantas
 * idas ao D1 e quantas delas em série. Cada ida espera um pouco, para a
 * profundidade medida (`d1serie` do Server-Timing) ser a cadeia real.
 */
const TOKEN = "b".repeat(64);
const google = (db) => ({
  DB: db, WORKSPACE_ID: "default", AUTH_MODE: "google", AUTH_ORIGIN: "https://delivery.test",
  AUTH_GOOGLE_DOMAIN: "example.test", GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test",
});
const headers = { cookie: `__Host-g4_session=${TOKEN}` };

function slowWorkspace(clients = 131) {
  const f = activeWorkspace({ extraClients: clients - 5 });
  writeSummaries(f);
  const hash = createHash("sha256").update(TOKEN).digest("base64url");
  f.sql.prepare("INSERT INTO login_sessions(token_hash,workspace_id,email,name,expires_at) VALUES(?,?,?,?,?)")
    .run(hash, "default", MEMBERS[0].email, "Admin", 4_102_444_800);
  const wait = () => new Promise((done) => setTimeout(done, 40));
  const slow = (statement) => ({ __inner: statement.__inner ?? statement, bind: (...v) => slow(statement.bind(...v)),
    first: async (...a) => { await wait(); return statement.first(...a); },
    all: async () => { await wait(); return statement.all(); },
    run: async () => { await wait(); return statement.run(); } });
  const db = { prepare: (query) => { if (process.env.TRACE) console.log("Q", query.replace(/\s+/g, " ").slice(0, 90)); return slow(f.db.prepare(query)); },
    batch: async (statements) => { await wait(); return f.db.batch(statements.map((s) => s.__inner ?? s)); } };
  return { ...f, slow: db };
}

const serie = (response) => Number(/d1serie;desc="(\d+) em serie"/.exec(response.headers.get("server-timing") ?? "")?.[1]);
const idas = (response) => Number(/(\d+) idas/.exec(response.headers.get("server-timing") ?? "")?.[1]);

async function portfolioRoute(env, { warm = true } = {}) {
  const request = new Request("https://delivery.test/api/portfolio", { headers });
  const { env: scoped, meter } = instrumentQueries(env, request);
  if (warm) warmPortfolioRead(request, scoped);
  const principal = await resolveOperationPrincipal(request, scoped);
  const body = await readPortfolioSummary(scoped, principal);
  return { body, meter, response: await withQueryTiming(new Response("{}"), meter) };
}

test("portfolio reads session, roster, documents and access together, then one batch: two trips in series", async () => {
  const f = slowWorkspace();
  try {
    const env = google(f.slow);
    // A série é medida por tempo; com a máquina sobrecarregada (suíte inteira em paralelo)
    // uma ida pode parecer esperar outra. A estrutura é determinística: vale a menor de três.
    let body, response, depth = Infinity;
    for (let i = 0; i < 3 && depth > 2; i++) {
      ({ body, response } = await portfolioRoute(env));
      depth = Math.min(depth, serie(response));
    }
    assert.equal(depth, 2, "antes: sessão → roster → documentos/acesso → lote → página 2 (5 em série)");
    assert.equal(idas(response), 5, "antes: 6 (a página 2 das fatias era outra ida)");
    // Mesma resposta que o caminho sem pré-leitura, no banco direto.
    const { body: plain } = await portfolioRoute(google(f.db), { warm: false });
    assert.deepEqual(body, plain);
  } finally {
    f.sql.close();
  }
});

test("the page bootstrap reads the session and the roster in parallel: two trips in series", async () => {
  const f = slowWorkspace();
  try {
    const request = new Request(`https://delivery.test/api/state?${new URLSearchParams({
      keys: "ontology.workspace.v3,ontology.clients.v3,ontology.engagement.v2", with: "session,google,alerts" })}`,
    { headers: { ...headers, "x-perf-timing": "1" } });
    // Como no Worker: o contador que ainda não está pronto segue depois da resposta.
    const deferred = [];
    const response = await readStateBatch(request, google(f.slow), { waitUntil: (work) => deferred.push(work) });
    await Promise.all(deferred);
    assert.equal(response.status, 200);
    assert.equal(serie(response), 2, "antes: sessão → roster → documentos (3 em série)");
    const body = await response.json();
    assert.equal(body.session.user.email, MEMBERS[0].email);
    assert.deepEqual(body.documents.map((d) => d.key).sort(),
      ["ontology.clients.v3", "ontology.engagement.v2", "ontology.workspace.v3"]);
  } finally {
    f.sql.close();
  }
});

test("without a session cookie nothing is read ahead, and a pending person still gets no data", async () => {
  const f = slowWorkspace(10);
  try {
    const { env, meter } = instrumentQueries(google(f.db), new Request("https://delivery.test/api/portfolio"));
    warmPortfolioRead(new Request("https://delivery.test/api/portfolio"), env);
    assert.equal(await authenticate(new Request("https://delivery.test/api/portfolio"), env), null);
    assert.equal(meter.trips, 0);
    // Cookie bem formado de uma sessão que não existe: lê sessão e roster, e recusa.
    const scoped = instrumentQueries(google(f.db), new Request("https://delivery.test/api/state"));
    const stranger = new Request("https://delivery.test/api/state", { headers: { cookie: `__Host-g4_session=${"c".repeat(64)}` } });
    assert.equal(await authenticate(stranger, scoped.env), null);
    // Membro desativado: o roster lido em paralelo continua decidindo.
    const roster = JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.workspace.v3'").get().body);
    roster.deactivatedIds = [MEMBERS[0].id];
    f.sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.workspace.v3'").run(JSON.stringify(roster));
    const blocked = instrumentQueries(google(f.db), new Request("https://delivery.test/api/state"));
    assert.equal(await authenticate(new Request("https://delivery.test/api/state", { headers }), blocked.env), null);
    await assert.rejects(portfolioRoute(google(f.db)), (error) => error.status === 401 || error.status === 403);
  } finally {
    f.sql.close();
  }
});

/** D1 de mentira com Sessions API: registra as restrições e devolve bookmarks. */
function sessionDb() {
  const opened = [];
  const result = { results: [], meta: { served_by_primary: false, served_by_region: "ENAM" } };
  const statement = () => ({ bind: () => statement(), first: async () => null, all: async () => result, run: async () => result });
  const db = {
    prepare: () => statement(),
    batch: async (s) => s.map(() => result),
    exec: async () => ({}),
    withSession(constraint) {
      const session = { constraint, queries: 0,
        prepare: () => { session.queries += 1; return statement(); },
        batch: async (s) => { session.queries += 1; return s.map(() => result); },
        getBookmark: () => constraint === "first-primary" ? "00000001-00000002-00000099-ff" : "00000001-00000002-00000050-aa" };
      opened.push(session);
      return session;
    },
  };
  return { db, opened };
}
const bookmarkCookie = "g4_d1_bookmark=00000001-00000002-00000040-cc";

test("with the replica flag off nothing changes: no session, no bookmark, cookies ignored", async () => {
  const { db, opened } = sessionDb();
  const request = new Request("https://delivery.test/api/portfolio", { headers: { cookie: bookmarkCookie } });
  const { env, meter } = instrumentQueries({ DB: db }, request);
  await env.DB.prepare("SELECT 1").all();
  markAuthenticated(env.DB);
  const response = await withQueryTiming(new Response("{}"), meter);
  assert.equal(opened.length, 0);
  assert.equal(response.headers.get("x-d1-bookmark"), null);
  const write = instrumentQueries({ DB: db }, new Request("https://delivery.test/api/v1/commands", { method: "POST" }));
  markAuthenticated(write.env.DB);
  assert.equal((await withQueryTiming(new Response("{}"), write.meter)).headers.get("x-d1-bookmark"), null);
  assert.equal(opened.length, 0);
});

test("with the flag on, listed reads start at the person's bookmark and return the session's", async () => {
  const { db, opened } = sessionDb();
  const on = { DB: db, D1_READ_REPLICAS: "1" };
  const read = async (path, cookie, method = "GET") => {
    const request = new Request(`https://delivery.test${path}`, { method, headers: cookie ? { cookie, "x-perf-timing": "1" } : { "x-perf-timing": "1" } });
    const { env, meter } = instrumentQueries(on, request);
    await env.DB.prepare("SELECT 1").all();
    markAuthenticated(env.DB);
    return withQueryTiming(new Response("{}"), meter);
  };
  const withBookmark = await read("/api/portfolio", bookmarkCookie);
  assert.equal(opened.at(-1).constraint, "00000001-00000002-00000040-cc");
  assert.equal(opened.at(-1).queries, 1, "a consulta foi pela sessão");
  assert.equal(withBookmark.headers.get("x-d1-bookmark"), "00000001-00000002-00000050-aa");
  assert.match(withBookmark.headers.get("server-timing"), /d1replica;desc="primario=0 replica=1 regiao=ENAM"/);
  await read("/api/state", "");
  assert.equal(opened.at(-1).constraint, "first-primary", "sem bookmark (navegador novo) a primeira leitura vai ao primário");
  await read("/api/v1/clients/acme/execution-snapshot", "g4_d1_primary=1; " + bookmarkCookie);
  assert.equal(opened.at(-1).constraint, "first-primary", "logo depois de uma escrita sem bookmark");
  await read("/api/state", "g4_d1_bookmark=nao-e-bookmark");
  assert.equal(opened.at(-1).constraint, "first-primary", "valor inválido é ignorado");
  // Integração sem cookie: primário, sem sessão.
  const before0 = opened.length;
  const bearer = new Request("https://delivery.test/api/v1/tasks?company=acme", { headers: { authorization: "Bearer g4d_x" } });
  instrumentQueries(on, bearer);
  assert.equal(opened.length, before0, "Bearer sem bookmark explícito fica no primário");
  const count = opened.length;
  const other = await read("/api/me/preferences", bookmarkCookie);
  assert.equal(opened.length, count, "rota fora da lista continua no primário");
  assert.equal(other.headers.get("x-d1-bookmark"), null);
  // Escrita: as consultas vão ao binding (primário); no fim, o bookmark do primário.
  const write = await read("/api/v1/commands", bookmarkCookie, "POST");
  assert.equal(opened.at(-1).constraint, "first-primary");
  assert.equal(write.headers.get("x-d1-bookmark"), "00000001-00000002-00000099-ff");
  // Anônimo não recebe bookmark nem provoca consulta extra.
  const before = opened.length;
  const request = new Request("https://delivery.test/api/v1/commands", { method: "POST" });
  const anonymous = instrumentQueries(on, request);
  assert.equal((await withQueryTiming(new Response("{}"), anonymous.meter)).headers.get("x-d1-bookmark"), null);
  assert.equal(opened.length, before);
});
