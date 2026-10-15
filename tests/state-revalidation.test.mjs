import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchDoc,
  patchSyncStatus,
} from "../src/shared/infrastructure/persistence.ts";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { readStateBatch } from "../src/server/operations/state-batch.ts";
test("state revalidation reuses unchanged documents without exposing a mutable cache or sharing it across users", async () => {
  const original = fetch;
  let call = 0;
  patchSyncStatus({ user: { email: "a@example.test", name: "A" } });
  globalThis.fetch = async (_url, init) => {
    call++;
    if (call === 1) {
      assert.equal(init.headers["if-none-match"], undefined);
      return Response.json(
        { version: 2, value: { name: "saved" } },
        { headers: { etag: '"workspace:key-2"' } },
      );
    }
    if (call === 2) {
      assert.equal(init.headers["if-none-match"], '"workspace:key-2"');
      return new Response(null, { status: 304 });
    }
    assert.equal(init.headers["if-none-match"], undefined);
    return Response.json({ version: 3, value: { name: "other" } });
  };
  try {
    const first = await fetchDoc("ontology.clients.v3");
    first.value.name = "local edit";
    assert.equal((await fetchDoc("ontology.clients.v3")).value.name, "saved");
    patchSyncStatus({ user: { email: "b@example.test", name: "B" } });
    assert.equal((await fetchDoc("ontology.clients.v3")).value.name, "other");
  } finally {
    globalThis.fetch = original;
    patchSyncStatus({ user: null });
  }
});

test("the batch state route authorizes each key, reads them in one round trip and omits unchanged bodies", async () => {
  const f = sqliteD1();
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',3,?)")
    .run(JSON.stringify({ extraMembers: [{ id: "admin", email: "admin@example.test", access: "admin" }, { id: "gone", email: "gone@example.test", access: "membro" }], deactivatedIds: ["gone"] }));
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',7,?)")
    .run(JSON.stringify({ extraClients: [{ slug: "c" }] }));
  let signedIn = "admin@example.test";
  const call = (query) =>
    readStateBatch(new Request(`https://delivery.test/api/state?${query}`),
      { DB: f.db, AUTH_MODE: "dev", DEV_USER_EMAIL: signedIn });
  try {
    const keys = "ontology.clients.v3,ontology.workspace.v3,ontology.knowledge.v2";
    const all = await call(`keys=${keys}`);
    assert.equal(all.status, 200);
    const body = await all.json();
    assert.deepEqual(body.documents.map((d) => [d.key, d.version]),
      [["ontology.clients.v3", 7], ["ontology.workspace.v3", 3], ["ontology.knowledge.v2", 0]]);
    assert.deepEqual(body.unchanged, []);
    assert.deepEqual(body.denied, []);

    const partial = await (await call(`keys=${keys}&versions=ontology.clients.v3:7`)).json();
    assert.deepEqual(partial.unchanged, ["ontology.clients.v3"]);
    assert.equal(partial.documents.some((d) => d.key === "ontology.clients.v3"), false,
      "um documento na versão conhecida não volta com corpo");
    const absent = await (await call(`keys=ontology.knowledge.v2&versions=ontology.knowledge.v2:0`)).json();
    assert.deepEqual(absent.unchanged, ["ontology.knowledge.v2"]);
    assert.deepEqual(absent.documents, []);

    signedIn = "gone@example.test";
    const refused = await (await call(`keys=${keys}`)).json();
    assert.deepEqual(refused.denied.map((d) => d.key), ["ontology.clients.v3", "ontology.knowledge.v2"]);
    assert.deepEqual(refused.documents.map((d) => d.key), ["ontology.workspace.v3"],
      "o cadastro do workspace continua legível para quem entrou");

    signedIn = "admin@example.test";
    assert.equal((await call("keys=ontology.private.v1")).status, 400);
    assert.equal((await call("keys=")).status, 400);
    assert.equal((await call(`keys=${keys}&versions=ontology.clients.v3:x`)).status, 400);
  } finally {
    f.sql.close();
  }
});
