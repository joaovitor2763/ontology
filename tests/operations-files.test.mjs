import test from "node:test";
import assert from "node:assert/strict";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { issueIntegrationCredential } from "../src/server/operations/credentials.ts";
import { fileResponse } from "../src/server/operations/files.ts";
import { saveLegacyState } from "../src/server/operations/legacy-authorization.ts";
async function setup() {
  const f = sqliteD1();
  const roster = { extraMembers: [{ id: "admin", email: "admin@example.com", access: "admin" }, { id: "master", email: "master@example.com", access: "ai_master" }, { id: "reader", email: "reader@example.com", access: "leitor" }] };
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify(roster));
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,?)").run(JSON.stringify({ allocationsMigrated: true, allocations: [{ id: "a", company: "santa-clara", memberId: "master" }] }));
  const token = async (ownerEmail, companies) => (await issueIntegrationCredential(f.db, "default", "admin@example.com", { name: "Files", ownerEmail, scopes: ["documents:read", "documents:write"], ...(companies ? { companies } : {}), expiresAt: new Date(Date.now() + 3600000).toISOString() })).token;
  const objects = new Map();
  let uploads = 0, deletes = 0;
  const bucket = { async put(key, bytes) { uploads++; objects.set(key, bytes); }, async get(key) { return objects.has(key) ? { body: new Uint8Array(objects.get(key)) } : null; }, async delete(key) { deletes++; objects.delete(key); } };
  return { ...f, token, objects, uploads: () => uploads, deletes: () => deletes, env: { DB: f.db, FILES: bucket } };
}
function request(token, method, company, body) {
  return new Request("https://delivery.example/api/files/up-test", { method, headers: { authorization: `Bearer ${token}`, ...(company ? { "x-client-company": company } : {}), "content-type": "text/plain" }, ...(body === undefined ? {} : { body }) });
}
test("uploads enforce current client allocation, reader denial and immutable content retry", async () => {
  const f = await setup(), master = await f.token("master@example.com"), reader = await f.token("reader@example.com");
  assert.equal((await fileResponse(request(master, "PUT", "banco-litoral", "secret"), f.env, "up-test")).status, 403);
  assert.equal((await fileResponse(request(reader, "PUT", "santa-clara", "secret"), f.env, "up-test")).status, 403);
  assert.equal(f.uploads(), 0);
  assert.equal((await fileResponse(request(master, "PUT", "santa-clara", "hello"), f.env, "up-test")).status, 200);
  assert.equal((await fileResponse(request(master, "PUT", "santa-clara", "hello"), f.env, "up-test")).status, 200);
  assert.equal(f.uploads(), 1);
  assert.equal((await fileResponse(request(master, "PUT", "santa-clara", "changed"), f.env, "up-test")).status, 409);
  assert.equal(await (await fileResponse(request(master, "GET"), f.env, "up-test")).text(), "hello");
  assert.equal((await fileResponse(request(reader, "GET"), f.env, "up-test")).status, 403);
  f.sql.close();
});
test("legacy files bind only an unambiguous document client and scoped tokens cannot download another client", async () => {
  const f = await setup(), scoped = await f.token("admin@example.com", ["santa-clara"]);
  f.sql.exec("INSERT INTO files(id,workspace_id,r2_key,name,mime,size,created_by) VALUES('legacy','default','legacy','legacy.txt','text/plain',3,'admin@example.com')");
  f.objects.set("legacy", new TextEncoder().encode("old").buffer);
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.documents.v3',1,?)").run(JSON.stringify({ extraDocs: [{ id: "legacy", company: "banco-litoral" }] }));
  assert.equal((await fileResponse(request(scoped, "GET"), f.env, "legacy")).status, 403);
  const all = await f.token("admin@example.com");
  assert.equal(await (await fileResponse(request(all, "GET"), f.env, "legacy")).text(), "old");
  assert.equal(f.sql.prepare("SELECT company FROM files WHERE id='legacy'").get().company, "banco-litoral");
  f.sql.close();
});
test("cross-client references cannot delete shared bytes and new metadata cannot attach another client's file", async () => {
  const f = await setup(), token = await f.token("admin@example.com");
  await fileResponse(request(token, "PUT", "santa-clara", "shared"), f.env, "up-test");
  await assert.rejects(saveLegacyState(f.db, "default", "admin@example.com", "ontology.documents.v3", { extraDocs: [{ id: "up-test", company: "banco-litoral", uploadedBy: "admin" }] }, 0), { code: "operation_required" });
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.documents.v3',1,?)").run(JSON.stringify({ extraDocs: [{ id: "up-test", company: "santa-clara" }] }));
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.relationship.v1',1,?)").run(JSON.stringify({ spaces: [{ id: "other", company: "banco-litoral", messages: [{ files: [{ id: "up-test" }] }] }] }));
  assert.equal((await fileResponse(request(token, "DELETE"), f.env, "up-test")).status, 409);
  assert.equal(f.deletes(), 0);
  f.sql.close();
});
test("owned unlinked upload can be deleted and emits its committed event", async () => {
  const f = await setup(), token = await f.token("master@example.com");
  await fileResponse(request(token, "PUT", "santa-clara", "file"), f.env, "up-test");
  const removed = await fileResponse(request(token, "DELETE"), f.env, "up-test");
  assert.equal(removed.status, 200);
  assert.equal(f.deletes(), 1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM files").get().n, 0);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_events WHERE type='file.deleted'").get().n, 1);
  f.sql.close();
});
test("upload finalization cannot report success after a concurrent deletion claim", async () => {
  const f = await setup(), token = await f.token("master@example.com");
  const put = f.env.FILES.put;
  f.env.FILES.put = async (key, body) => {
    await put(key, body);
    f.sql.exec("UPDATE files SET status='deleting' WHERE id='up-test'");
  };
  const result = await fileResponse(request(token, "PUT", "santa-clara", "concurrent"), f.env, "up-test");
  assert.equal(result.status, 409);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_events WHERE type='file.uploaded'").get().n, 0);
  f.sql.close();
});

test('referenced bytes survive removed documents, historical versions, hidden meetings and task records', async () => {
  for (const [key,value] of [
    ['ontology.documents.v3',{extraDocs:[{id:'up-test',company:'santa-clara'}],removedDocIds:['up-test']}],
    ['ontology.documents.v3',{extraDocs:[{id:'new',company:'santa-clara',supersedesId:'up-test'}]}],
    ['ontology.engagement.v2',{extraMeetings:[{id:'m',company:'santa-clara',google:{transcriptDocId:'up-test'}}],removedMeetings:['m']}],
    ['ontology.relationship.v1',{notes:{chat:[{files:[{id:'up-test'}]}]}}],
    ['ontology.delivery.v2',{removedTaskIds:['t'],taskPatches:{t:{files:[{id:'up-test'}]}}}],
  ]) {
    const f=await setup(),token=await f.token('master@example.com');
    await fileResponse(request(token,'PUT','santa-clara','keep'),f.env,'up-test');
    f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(key,JSON.stringify(value));
    const response=await fileResponse(request(token,'DELETE'),f.env,'up-test');
    assert.equal(response.status,409);assert.equal((await response.json()).code,'file_referenced');
    assert.equal(f.deletes(),0);assert.equal(f.sql.prepare("SELECT status FROM files WHERE id='up-test'").get().status,'ready');
    f.sql.close();
  }
});
test('reference added before deletion claim aborts atomically before touching R2',async()=>{
 const f=await setup(),token=await f.token('master@example.com');
 await fileResponse(request(token,'PUT','santa-clara','keep'),f.env,'up-test');
 const batch=f.db.batch;let raced=false;
 f.db.batch=async statements=>{if(!raced){raced=true;f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.documents.v3',1,?)").run(JSON.stringify({extraDocs:[{id:'up-test',company:'santa-clara'}]}));}return batch(statements);};
 assert.equal((await fileResponse(request(token,'DELETE'),f.env,'up-test')).status,409);
 assert.equal(f.deletes(),0);assert.equal(f.sql.prepare("SELECT status FROM files WHERE id='up-test'").get().status,'ready');f.sql.close();
});
