import test from "node:test";
import assert from "node:assert/strict";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { readStateBatch } from "../src/server/operations/state-batch.ts";

function fixture() {
  const f = sqliteD1();
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',3,?)")
    .run(JSON.stringify({ extraMembers: [{ id: "admin", email: "admin@example.test", access: "admin" }, { id: "second", email: "second@example.test", access: "admin" }], hidden: [] }));
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',7,?)")
    .run(JSON.stringify({ extraClients: [{ slug: "c" }] }));
  return f;
}
const call = (f, query, email = "admin@example.test", extra = {}) =>
  readStateBatch(new Request(`https://delivery.test/api/state?${query}`), { DB: f.db, AUTH_MODE: "dev", DEV_USER_EMAIL: email, ...extra });

test("the page bootstrap answers session, google and alert count in the same response as the documents", async () => {
  const f = fixture();
  try {
    const response = await call(f, "keys=ontology.clients.v3,ontology.workspace.v3&with=session,google,alerts");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.documents.map((d) => [d.key, d.version]), [["ontology.clients.v3", 7], ["ontology.workspace.v3", 3]]);
    assert.equal(body.session.mode, "remote");
    assert.equal(body.session.user.email, "admin@example.test");
    assert.equal(body.session.authMode, "dev");
    assert.equal(body.google.enabled, false);
    assert.equal(typeof body.alerts.count, "number");
    // Sem o bloco, a resposta é a de sempre.
    const plain = await (await call(f, "keys=ontology.clients.v3")).json();
    assert.equal("session" in plain, false);
    assert.equal("alerts" in plain, false);
    // Bloco desconhecido é recusado.
    assert.equal((await call(f, "keys=ontology.clients.v3&with=tudo")).status, 400);
  } finally {
    f.sql.close();
  }
});

test("with the session block the bootstrap never needs keys and answers 200 to a person without access", async () => {
  const f = fixture();
  try {
    const empty = await (await call(f, "with=session")).json();
    assert.deepEqual(empty.documents, []);
    assert.equal(empty.session.user.email, "admin@example.test");
    // Sem chaves e sem o bloco de sessão continua sendo um pedido inválido.
    assert.equal((await call(f, "keys=")).status, 400);
    // Sem banco, o bloco diz o modo, como /api/health.
    const local = await (await readStateBatch(new Request("https://delivery.test/api/state?with=session"), { AUTH_MODE: "dev" })).json();
    assert.equal(local.session.mode, "local");
    assert.equal(local.session.user, null);
  } finally {
    f.sql.close();
  }
});

test("a read never writes: the bootstrap records presence at most once per hour, and the alert count is null without permission to see clients", async () => {
  const f = fixture();
  try {
    // A aceleração é por isolate (processo): uma pessoa que nenhum teste tocou.
    await call(f, "with=session,alerts", "second@example.test");
    const first = f.sql.prepare("SELECT last_seen_at FROM users WHERE email='second@example.test'").get()?.last_seen_at;
    assert.ok(first, "a primeira requisição registra a presença");
    await new Promise((r) => setTimeout(r, 5));
    await call(f, "with=session,alerts", "second@example.test");
    const again = f.sql.prepare("SELECT last_seen_at FROM users WHERE email='second@example.test'").get()?.last_seen_at;
    assert.equal(again, first, "a segunda requisição não grava de novo");
    // Quem entrou mas não é membro recebe a sessão, nenhum documento e nenhum contador.
    const stranger = await (await call(f, "keys=ontology.clients.v3&with=session,alerts", "nobody@example.test")).json();
    assert.equal(stranger.session.user.email, "nobody@example.test");
    assert.deepEqual(stranger.documents.map((d) => d.key), []);
    assert.equal(stranger.alerts, null);
  } finally {
    f.sql.close();
  }
});

test("in google mode the bootstrap reads the session once, writes nothing and bounds the alert mode check", async () => {
  const { tokenHash } = await import("../src/server/google-login.ts");
  const f = sqliteD1();
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',3,?)")
    .run(JSON.stringify({ extraMembers: [{ id: "joao", email: "joao@example.com", access: "admin" }], hidden: [] }));
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',7,?)")
    .run(JSON.stringify({ extraClients: [] }));
  const token = "c".repeat(64);
  f.sql.prepare("INSERT INTO login_sessions VALUES (?, ?, ?, ?, ?)").run(await tokenHash(token), "default", "joao@example.com", "João", Math.floor(Date.now() / 1000) + 100);
  const env = { DB: f.db, AUTH_MODE: "google", AUTH_ORIGIN: "https://delivery.test", AUTH_GOOGLE_DOMAIN: "example.com", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "placeholder", WORKSPACE_ID: "default" };
  try {
    const response = await readStateBatch(new Request("https://delivery.test/api/state?keys=ontology.clients.v3,ontology.workspace.v3&with=session,google,alerts", { headers: { cookie: `__Host-g4_session=${token}` } }), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.session.user.email, "joao@example.com");
    assert.equal(body.session.user.approved, true);
    assert.equal(body.documents.length, 2);
    assert.equal(typeof body.alerts?.count, "number");
    // Nenhuma presença gravada por uma leitura.
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM users").get().n, 0);
    // A fila consulta o modo da execução e, em shadow, lê o documento global.
    // O limite continua fixo, independentemente da quantidade de clientes; a
    // ciência da pessoa é uma leitura a mais, em paralelo com os documentos.
    const trips = Number(/(\d+) idas/.exec(response.headers.get("server-timing") ?? "")?.[1]);
    assert.ok(trips <= 7, `esperava até 7 idas, veio ${trips}`);
  } finally {
    f.sql.close();
  }
});
