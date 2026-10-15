import test from "node:test";
import assert from "node:assert/strict";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { apiResponse } from "../src/server/operations/http.ts";

test("the OpenAPI document carries an ETag, revalidates with 304 and is the same document for the same origin", async () => {
  const f = sqliteD1();
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)")
    .run(JSON.stringify({ extraMembers: [{ id: "admin", email: "admin@example.test", access: "admin" }] }));
  const env = { DB: f.db, AUTH_MODE: "dev", DEV_USER_EMAIL: "admin@example.test" };
  const call = (headers = {}) => apiResponse(new Request("https://delivery.test/api/v1/openapi.json", { headers }), env, ["openapi.json"]);
  try {
    const first = await call();
    assert.equal(first.status, 200);
    const etag = first.headers.get("etag");
    assert.match(etag ?? "", /^"[0-9a-f]{32}"$/);
    assert.match(first.headers.get("cache-control") ?? "", /max-age=/);
    const body = await first.json();
    assert.equal(body.openapi?.startsWith("3"), true);
    const again = await call({ "if-none-match": etag });
    assert.equal(again.status, 304);
    assert.equal(await again.text(), "");
    const other = await apiResponse(new Request("https://outra.test/api/v1/openapi.json"), env, ["openapi.json"]);
    assert.notEqual(other.headers.get("etag"), etag, "a origem entra no documento, então o ETag muda com ela");
  } finally {
    f.sql.close();
  }
});
