import test from "node:test";
import assert from "node:assert/strict";
import { getDoc, putDoc, touchUser } from "../src/server/db.ts";

/** Minimal in-memory stand-in for the D1 binding used by the state API. */
function fakeD1() {
  const docs = new Map();
  const history = [];
  const users = new Map();
  const statement = (sql) => {
    let args = [];
    const key = (ws, k) => `${ws}::${k}`;
    const run = async () => {
      if (sql.startsWith("INSERT INTO state_documents")) {
        const [ws, k, body, at, by] = args;
        if (docs.has(key(ws, k))) throw new Error("UNIQUE constraint failed");
        docs.set(key(ws, k), { body, version: 1, updated_at: at, updated_by: by });
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("INSERT INTO state_history")) {
        history.push(args);
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("UPDATE state_documents")) {
        const [next, body, at, by, ws, k, base] = args;
        const row = docs.get(key(ws, k));
        if (!row || row.version !== base) return { meta: { changes: 0 } };
        docs.set(key(ws, k), { body, version: next, updated_at: at, updated_by: by });
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("DELETE FROM state_history")) return { meta: { changes: 0 } };
      if (sql.startsWith("INSERT OR IGNORE INTO workspaces")) return { meta: { changes: 1 } };
      if (sql.startsWith("INSERT INTO users")) {
        users.set(args[1], { id: args[0], email: args[1], name: args[2] });
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("INSERT OR IGNORE INTO memberships")) return { meta: { changes: 1 } };
      throw new Error(`unexpected sql: ${sql}`);
    };
    const first = async () => {
      if (sql.startsWith("SELECT body, version, updated_at FROM state_documents")) {
        const [ws, k] = args;
        return docs.get(key(ws, k)) ?? null;
      }
      if (sql.includes("LEFT JOIN delivery_client_shadow_meta")) {
        const [ws, k] = args;
        const row = docs.get(key(ws, k));
        return row ? { ...row, delivery_mode: null } : null;
      }
      throw new Error(`unexpected sql: ${sql}`);
    };
    const api = {
      bind: (...values) => {
        args = values;
        return api;
      },
      run,
      first,
    };
    return api;
  };
  return {
    prepare: statement,
    batch: async (statements) => {
      const results = [];
      for (const s of statements) results.push(await s.run());
      return results;
    },
    docs,
    history,
    users,
  };
}

test("state documents are created at version 1 and every save requires the version the caller saw", async () => {
  const db = fakeD1();
  assert.equal(await getDoc(db, "ws", "ontology.clients.v3"), null);
  const created = await putDoc(db, "ws", "ontology.clients.v3", { a: 1 }, 0, "ana@x.co");
  assert.deepEqual(created, { ok: true, version: 1 });
  const saved = await putDoc(db, "ws", "ontology.clients.v3", { a: 2 }, 1, "ana@x.co");
  assert.deepEqual(saved, { ok: true, version: 2 });
  const stale = await putDoc(db, "ws", "ontology.clients.v3", { a: 3 }, 1, "bia@x.co");
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict.version, 2);
  assert.deepEqual(stale.conflict.value, { a: 2 });
  const live = await getDoc(db, "ws", "ontology.clients.v3");
  assert.deepEqual(live.value, { a: 2 });
  assert.equal(db.history.length, 2);
});

test("creating a document that already exists reports the live copy instead of overwriting it", async () => {
  const db = fakeD1();
  await putDoc(db, "ws", "ontology.delivery.v2", { n: 1 }, 0, null);
  const again = await putDoc(db, "ws", "ontology.delivery.v2", { n: 9 }, 0, null);
  assert.equal(again.ok, false);
  assert.deepEqual(again.conflict.value, { n: 1 });
});

test("signed-in people are registered once by e-mail with a stable id", async () => {
  const db = fakeD1();
  const id = await touchUser(db, "ws", { email: "Ana@X.co", name: "Ana" });
  assert.equal(id, "user-ana@x.co");
  await touchUser(db, "ws", { email: "ana@x.co", name: "Ana Souza" });
  assert.equal(db.users.size, 1);
  assert.equal(db.users.get("ana@x.co").name, "Ana Souza");
});

/**
 * Medição em produção: só a pedido e só para quem a requisição identificou.
 * O cabeçalho `x-perf-timing` liga o contador; `markAuthenticated` libera a saída.
 */
test("Server-Timing só sai a pedido e para requisição autenticada fora de desenvolvimento", async () => {
  const { instrumentQueries, withQueryTiming, markAuthenticated } = await import("../src/server/timing.ts");
  const binding = { prepare: () => ({}), batch: async () => [], exec: async () => ({}), dump: async () => ({}), withSession: () => ({}) };
  const ask = (headers) => new Request("https://exemplo.test/api/state", { headers });
  const timing = (response) => response.headers.get("Server-Timing");
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    // Sem o cabeçalho não há medidor: nenhum invólucro, nenhum custo.
    const quiet = instrumentQueries({ DB: binding }, ask({}));
    assert.equal(quiet.meter, null);
    assert.equal(timing(withQueryTiming(new Response("{}"), quiet.meter, Date.now())), null);

    // Com o cabeçalho, mede — mas só publica depois de reconhecer a pessoa.
    const anonymous = instrumentQueries({ DB: binding }, ask({ "x-perf-timing": "1" }));
    assert.ok(anonymous.meter);
    assert.equal(timing(withQueryTiming(new Response("{}"), anonymous.meter, Date.now())), null);

    const known = instrumentQueries({ DB: binding }, ask({ "x-perf-timing": "1" }));
    markAuthenticated(known.env.DB);
    assert.match(timing(withQueryTiming(new Response("{}"), known.meter, Date.now())) ?? "", /^d1;dur=/);
  } finally {
    process.env.NODE_ENV = original;
  }
  // Em desenvolvimento a régua continua aberta, sem cabeçalho nenhum.
  const dev = instrumentQueries({ DB: binding }, ask({}));
  assert.ok(dev.meter);
  assert.match(timing(withQueryTiming(new Response("{}"), dev.meter, Date.now())) ?? "", /^d1;dur=/);
});

/**
 * Cache do roster no isolate: a versão manda, a gravação invalida e um workspace
 * nunca enxerga o documento do outro.
 */
test("o roster é reaproveitado no isolate enquanto a versão do documento não muda", async () => {
  const { requestDatabase, workspaceDocument, rememberDocument, forgetDocuments } = await import(
    "../src/server/operations/request-context.ts"
  );
  const rows = new Map();
  const put = (ws, key, value, version) =>
    rows.set(`${ws}::${key}`, { key, body: JSON.stringify(value), version, updated_at: "2026-09-18T00:00:00.000Z" });
  put("a", "ontology.workspace.v3", { extraMembers: [{ id: "m1" }] }, 7);
  put("b", "ontology.workspace.v3", { extraMembers: [{ id: "m2" }] }, 3);
  const reads = { corpos: 0, versoes: 0 };
  const origin = {
    prepare(sql) {
      const statement = {
        bind: (...args) => ({
          all: async () => {
            const [ws, ...keys] = args;
            const found = keys.map((key) => rows.get(`${ws}::${key}`)).filter(Boolean);
            if (sql.startsWith("SELECT key, version")) {
              reads.versoes += 1;
              return { results: found.map(({ key, version }) => ({ key, version })) };
            }
            reads.corpos += 1;
            return { results: found };
          },
          first: async () => {
            reads.corpos += 1;
            return rows.get(`${args[0]}::${args[1]}`) ?? null;
          },
        }),
      };
      return statement;
    },
  };
  const request = () => requestDatabase(origin, origin);

  const first = await workspaceDocument(request(), "a");
  assert.deepEqual(first.doc.value, { extraMembers: [{ id: "m1" }] });
  assert.deepEqual(reads, { corpos: 1, versoes: 0 });

  // Segunda requisição: só a versão vai ao banco; o corpo vem do isolate.
  const second = await workspaceDocument(request(), "a");
  assert.deepEqual(second.doc, first.doc);
  assert.deepEqual(reads, { corpos: 1, versoes: 1 });
  // Cada requisição recebe a sua própria cópia: uma nunca altera o que a outra lê.
  assert.notEqual(second.doc.value, first.doc.value);

  // O outro workspace tem o seu próprio documento, não o do primeiro.
  const other = await workspaceDocument(request(), "b");
  assert.deepEqual(other.doc.value, { extraMembers: [{ id: "m2" }] });

  // Promoção em outro isolate: a versão mudou, então o corpo volta do banco.
  put("a", "ontology.workspace.v3", { extraMembers: [{ id: "m1", access: "admin" }] }, 8);
  const promoted = await workspaceDocument(request(), "a");
  assert.equal(promoted.doc.version, 8);
  assert.deepEqual(promoted.doc.value, { extraMembers: [{ id: "m1", access: "admin" }] });

  // Gravação neste isolate: o cache cai e é reposto com o valor exato gravado.
  const writer = request();
  forgetDocuments(writer);
  put("a", "ontology.workspace.v3", { extraMembers: [{ id: "m1" }, { id: "m3" }] }, 9);
  rememberDocument(writer, "a", "ontology.workspace.v3", {
    value: { extraMembers: [{ id: "m1" }, { id: "m3" }] },
    version: 9,
    updatedAt: "2026-09-18T00:00:00.000Z",
  });
  const after = await workspaceDocument(request(), "a");
  assert.equal(after.doc.version, 9);
  assert.deepEqual(after.doc.value, { extraMembers: [{ id: "m1" }, { id: "m3" }] });

  // Sem `requestDatabase` não há cache nem memória: as duas chaves voltam ao
  // banco em toda chamada.
  const before = reads.corpos;
  await workspaceDocument(origin, "a");
  await workspaceDocument(origin, "a");
  assert.equal(reads.corpos, before + 4);
});
