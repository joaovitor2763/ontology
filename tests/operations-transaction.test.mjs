import test from "node:test";
import assert from "node:assert/strict";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { commitOperation, requestHash } from "../src/server/operations/transaction.ts";
const command = (key = "request-1") => ({
  workspace: "default", principal: "member:actor", application: "test", actor: { memberId: "actor", email: "actor@example.test", kind: "session" }, key,
  command: "client.create", hash: "hash", id: crypto.randomUUID(),
  guards: [{ key: "ontology.clients.v3", version: 0 }, { key: "ontology.stakeholders.v1", version: 0 }],
  writes: [{ key: "ontology.clients.v3", value: { client: "a" } }, { key: "ontology.stakeholders.v1", value: { contacts: ["a"] } }],
  events: [{ type: "client.created", subject: "a", company: "a" }], result: { clientId: "a" },
});
test("business data, history, receipt and outbox commit together and retries do not duplicate", async () => {
  const { db, sql } = sqliteD1();
  const input = command();
  assert.deepEqual(await commitOperation(db, input), input.result);
  assert.deepEqual(await commitOperation(db, input), input.result);
  assert.equal(sql.prepare("SELECT count(*) n FROM state_documents").get().n, 2);
  assert.equal(sql.prepare("SELECT count(*) n FROM state_history").get().n, 2);
  assert.equal(sql.prepare("SELECT count(*) n FROM operation_events").get().n, 1);
  const audit=sql.prepare("SELECT * FROM client_audit_log").get();
  assert.equal(audit.actor_id,"actor");assert.equal(audit.actor_email,"actor@example.test");assert.equal(audit.source,"interface");assert.equal(audit.command,"client.create");
  assert.equal(sql.prepare("SELECT count(*) n FROM operation_guards").get().n, 0);
  await assert.rejects(commitOperation(db, { ...input, hash: "changed" }), { code: "idempotency_conflict" });
  sql.close();
});
test("receipts keep document references instead of duplicating state snapshots", async () => {
  for(const explicit of [false,true]) {
    const { db, sql } = sqliteD1();
    const input=command(explicit?'explicit':'implicit');
    input.result={data:{saved:true},documents:[{key:'ontology.clients.v3',value:{payload:'x'.repeat(100_000)},version:1,updatedAt:'old',updatedBy:'old',future:'snapshot'}]};
    if(explicit) input.receiptResult=input.result;
    await commitOperation(db,input);
    const saved=JSON.parse(sql.prepare('SELECT result FROM operation_receipts').get().result);
    assert.deepEqual(saved,{data:{saved:true},documents:[{key:'ontology.clients.v3',version:1,updatedAt:'old',updatedBy:'old'}]});
    sql.close();
  }
});
test("a stale second document aborts the whole batch even when history was pruned", async () => {
  const { db, sql } = sqliteD1();
  await commitOperation(db, command());
  sql.exec("UPDATE state_documents SET version=100 WHERE key='ontology.stakeholders.v1'; DELETE FROM state_history;");
  const next = command("request-2");
  next.guards = next.guards.map(g => ({ ...g, version: 1 }));
  next.writes[0].value = { client: "changed" };
  await assert.rejects(commitOperation(db, next), { code: "version_conflict" });
  assert.equal(JSON.parse(sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body).client, "a");
  assert.equal(sql.prepare("SELECT count(*) n FROM operation_receipts").get().n, 1);
  assert.equal(sql.prepare("SELECT count(*) n FROM operation_events").get().n, 1);
  assert.equal(sql.prepare("SELECT count(*) n FROM client_audit_log").get().n, 1);
  sql.close();
});
test("a late external-reference collision rolls back earlier document writes and receipt", async () => {
  const { db, sql } = sqliteD1();
  sql.exec("INSERT INTO external_references(workspace_id,system,kind,external_id,entity_id) VALUES('default','crm','client','42','existing')");
  const input = command();
  input.references = [{ system: "crm", kind: "client", externalId: "42", entityId: "a" }];
  await assert.rejects(commitOperation(db, input), { code: "external_reference_conflict" });
  assert.equal(sql.prepare("SELECT count(*) n FROM state_documents").get().n, 0);
  assert.equal(sql.prepare("SELECT count(*) n FROM operation_receipts").get().n, 0);
  assert.equal(sql.prepare("SELECT count(*) n FROM operation_events").get().n, 0);
  assert.equal(sql.prepare("SELECT count(*) n FROM client_audit_log").get().n, 0);
  sql.close();
});
test("an audit insertion failure rolls back business data, receipt and outbox", async () => {
  const { db, sql } = sqliteD1();
  sql.exec("CREATE TRIGGER reject_client_audit BEFORE INSERT ON client_audit_log BEGIN SELECT RAISE(ABORT, 'audit_failure'); END;");
  await assert.rejects(commitOperation(db, command()), /audit_failure/);
  for (const table of ["state_documents", "state_history", "operation_receipts", "operation_events", "client_audit_log"])
    assert.equal(sql.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0, table);
  sql.close();
});
test("authorization read dependencies are guarded although not written", async () => {
  const { db, sql } = sqliteD1();
  const input = command();
  input.guards.push({ key: "ontology.workspace.v3", version: 0 });
  sql.exec("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,'{}')");
  await assert.rejects(commitOperation(db, input), { code: "version_conflict" });
  assert.equal(sql.prepare("SELECT count(*) n FROM operation_receipts").get().n, 0);
  sql.close();
});
test("global events enter the permanent workspace audit without a client", async () => {
  const { db, sql } = sqliteD1();
  const input = command("workspace-change");
  input.command = "workspace.settings.update";
  input.guards = [];
  input.writes = [];
  input.events = [{ type: "workspace.settings.update", subject: "default" }];
  input.result = { updated: true };
  await commitOperation(db, input);
  const row = sql.prepare("SELECT area,company,source FROM client_audit_log WHERE action='workspace.settings.update'").get();
  assert.deepEqual({ ...row }, { area: "workspace", company: "", source: "interface" });
  sql.close();
});
test("request identity is independent of JSON object key order", async () => {
  assert.equal(await requestHash("create", { a: 1, b: 2 }), await requestHash("create", { b: 2, a: 1 }));
});
