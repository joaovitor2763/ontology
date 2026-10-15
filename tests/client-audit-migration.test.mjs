import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

test("audit migration backfills retained client events without inventing historical source", () => {
  const sql = new DatabaseSync(":memory:");
  const migrations = readdirSync("migrations").filter(file => file.endsWith(".sql")).sort();
  for (const file of migrations.filter(file => file < "0024_client_audit_log.sql"))
    sql.exec(readFileSync(`migrations/${file}`, "utf8"));
  sql.prepare("INSERT INTO integration_credentials(id,workspace_id,name,token_hash,owner_member_id,owner_email,scopes,created_by,created_at,expires_at) VALUES('credential','default','CRM','hash','admin','admin@example.test','[]','admin','2026-01-01','2027-01-01')").run();
  sql.prepare("INSERT INTO operation_receipts(workspace_id,principal_id,idempotency_key,id,command,request_hash,result,created_at) VALUES('default','integration:credential','key','operation','enrollments.archive','hash','{}','2026-09-01')").run();
  sql.prepare("INSERT INTO operation_events(id,workspace_id,operation_id,type,company,subject,actor,application,data,created_at) VALUES('event','default','operation','enrollment.archived','cliente','purchase','integration:credential','credential','{}','2026-09-01')").run();
  const migration = readFileSync("migrations/0024_client_audit_log.sql", "utf8");
  assert.match(migration, /ORDER BY e\.sequence ASC/);
  sql.exec(migration);
  const meetingColumns = sql.prepare("PRAGMA table_info(meeting_operations)").all().map(column => column.name);
  for (const column of ["actor_id", "actor_email", "actor_source", "actor_application"])
    assert.ok(meetingColumns.includes(column), column);
  const row = sql.prepare("SELECT * FROM client_audit_log").get();
  assert.equal(row.command, "enrollments.archive");
  assert.equal(row.actor_id, "admin");
  assert.equal(row.actor_email, "admin@example.test");
  assert.equal(row.source, "api");
  assert.equal(row.action, "enrollment.archived");
  sql.prepare("INSERT INTO operation_events(id,workspace_id,operation_id,type,company,subject,actor,application,data,created_at) VALUES('global-event','default','global-operation','workspace.settings.update',NULL,'default','member:admin','web','{}','2026-09-02')").run();
  sql.exec(readFileSync("migrations/0025_platform_audit_log.sql", "utf8"));
  const client = sql.prepare("SELECT area,company FROM client_audit_log WHERE id='event'").get();
  assert.deepEqual({ ...client }, { area: "enrollment", company: "cliente" });
  const global = sql.prepare("SELECT area,company,source FROM client_audit_log WHERE id='global-event'").get();
  assert.deepEqual({ ...global }, { area: "workspace", company: "", source: "interface" });
  const indexes = sql.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='client_audit_log'").all().map(index => index.name);
  for (const name of ["client_audit_log_workspace", "client_audit_log_company_time", "client_audit_log_area", "client_audit_log_actor", "client_audit_log_source"])
    assert.ok(indexes.includes(name), name);
  sql.close();
});
