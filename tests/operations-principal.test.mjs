import test from "node:test";
import assert from "node:assert/strict";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { issueIntegrationCredential, revokeIntegrationCredential, listIntegrationCredentials } from "../src/server/operations/credentials.ts";
import { resolveOperationPrincipal, authorizeOperation } from "../src/server/operations/principal.ts";
import { commitOperation } from "../src/server/operations/transaction.ts";
function fixture() {
  const f = sqliteD1();
  const roster = { extraMembers: [{ id: "admin", email: "admin@example.com", access: "admin" }, { id: "master", email: "master@example.com", access: "ai_master" }], deactivatedIds: [] };
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify(roster));
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,?)").run(JSON.stringify({ allocationsMigrated: true, allocations: [{ company: "alpha", memberId: "master" }] }));
  return { ...f, roster };
}
const issue = db => issueIntegrationCredential(db, "default", "admin@example.com", { name: "CRM", ownerEmail: "master@example.com", scopes: ["stakeholders:write"], companies: ["alpha"], expiresAt: new Date(Date.now() + 3600000).toISOString() });
const resolve = (db, token) => resolveOperationPrincipal(new Request("https://delivery.example/api/v1", { headers: { authorization: `Bearer ${token}` } }), { DB: db });
test("integration tokens store only a hash and enforce scopes, client grants and current membership", async () => {
  const { db, sql, roster } = fixture();
  const issued = await issue(db);
  assert.notEqual(sql.prepare("SELECT token_hash FROM integration_credentials").get().token_hash, issued.token);
  assert.equal(JSON.stringify(await listIntegrationCredentials(db, "default", "admin@example.com")).includes(issued.token), false);
  const principal = await resolve(db, issued.token);
  assert.equal((await authorizeOperation(db, "default", principal, { action: "stakeholders.editar", scope: "stakeholders:write", company: "alpha" })).length, 3);
  await assert.rejects(authorizeOperation(db, "default", principal, { action: "stakeholders.editar", scope: "stakeholders:write", company: "beta" }), { code: "client_not_allowed" });
  await assert.rejects(authorizeOperation(db, "default", principal, { action: "ciclos.editar", scope: "delivery:write", company: "alpha" }), { code: "insufficient_scope" });
  sql.exec("UPDATE state_documents SET body='{}',version=2 WHERE key='ontology.clients.v3'");
  await assert.rejects(authorizeOperation(db, "default", principal, { action: "stakeholders.editar", scope: "stakeholders:write", company: "alpha" }), { code: "permission_denied" });
  roster.deactivatedIds = ["master"];
  sql.prepare("UPDATE state_documents SET body=?,version=2 WHERE key='ontology.workspace.v3'").run(JSON.stringify(roster));
  await assert.rejects(resolve(db, issued.token), { code: "inactive_member" });
  sql.close();
});
test("expiration, revocation and cross-workspace tokens fail closed", async () => {
  const { db, sql } = fixture();
  const issued = await issue(db);
  await assert.rejects(resolveOperationPrincipal(new Request("https://x", { headers: { authorization: `Bearer ${issued.token}` } }), { DB: db, WORKSPACE_ID: "other" }), { code: "invalid_token" });
  await revokeIntegrationCredential(db, "default", "admin@example.com", issued.id);
  await assert.rejects(resolve(db, issued.token), { code: "invalid_token" });
  const second = await issue(db);
  sql.prepare("UPDATE integration_credentials SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(second.id);
  await assert.rejects(resolve(db, second.token), { code: "invalid_token" });
  sql.close();
});
test("concurrent revocation invalidates authorization commit guard", async () => {
  const { db, sql } = fixture();
  const issued = await issue(db), principal = await resolve(db, issued.token);
  const guards = await authorizeOperation(db, "default", principal, { action: "stakeholders.editar", scope: "stakeholders:write", company: "alpha" });
  await revokeIntegrationCredential(db, "default", "admin@example.com", issued.id);
  await assert.rejects(commitOperation(db, { workspace: "default", principal: principal.id, application: principal.application, actor: principal, key: "k", command: "test", hash: "h", id: crypto.randomUUID(), guards, writes: [], events: [], result: {} }), { code: "version_conflict" });
  assert.equal(sql.prepare("SELECT count(*) n FROM operation_receipts").get().n, 0);
  sql.close();
});
test("bootstrap never grants credential administration and malformed Bearer never falls back", async () => {
  const { db, sql } = sqliteD1();
  await assert.rejects(issue(db), { code: "permission_denied" });
  await assert.rejects(resolve(db, "wrong"), { code: "invalid_token" });
  sql.close();
});
test("token scope cannot elevate a reader, reassigned email, or expired allocation", async () => {
  const { db, sql, roster } = fixture();
  const issued = await issue(db), principal = await resolve(db, issued.token);
  roster.extraMembers[1].access = "leitor";
  sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.workspace.v3'").run(JSON.stringify(roster));
  await assert.rejects(authorizeOperation(db, "default", principal, { action: "stakeholders.editar", scope: "stakeholders:write", company: "alpha" }), { code: "permission_denied" });
  roster.extraMembers[1].access = "ai_master";
  sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.workspace.v3'").run(JSON.stringify(roster));
  sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.clients.v3'").run(JSON.stringify({ allocationsMigrated: true, allocations: [{ company: "alpha", memberId: "master", to: "2000-01-01" }] }));
  await assert.rejects(authorizeOperation(db, "default", principal, { action: "stakeholders.editar", scope: "stakeholders:write", company: "alpha" }), { code: "permission_denied" });
  roster.extraMembers[1].id = "another-person";
  sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.workspace.v3'").run(JSON.stringify(roster));
  await assert.rejects(resolve(db, issued.token), { code: "inactive_member" });
  sql.close();
});
test("credential issue and revocation abort if the admin is demoted before commit", async () => {
  const { db, sql, roster } = fixture();
  const issued = await issue(db);
  const originalBatch = db.batch;
  db.batch = async statements => {
    roster.extraMembers[0].access = "leitor";
    sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.workspace.v3'").run(JSON.stringify(roster));
    return originalBatch(statements);
  };
  await assert.rejects(revokeIntegrationCredential(db, "default", "admin@example.com", issued.id), { code: "version_conflict" });
  assert.equal(sql.prepare("SELECT revoked_at FROM integration_credentials").get().revoked_at, null);
  roster.extraMembers[0].access = "admin";
  sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.workspace.v3'").run(JSON.stringify(roster));
  await assert.rejects(issue(db), { code: "version_conflict" });
  assert.equal(sql.prepare("SELECT count(*) n FROM integration_credentials").get().n, 1);
  sql.close();
});
