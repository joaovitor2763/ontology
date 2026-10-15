import test from "node:test";
import assert from "node:assert/strict";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { executeMeetingCommand } from "../src/server/operations/meetings.ts";
import { seal } from "../src/server/google.ts";
import { issueIntegrationCredential } from "../src/server/operations/credentials.ts";
import { resolveOperationPrincipal } from "../src/server/operations/principal.ts";
const person = { id: "admin", email: "admin@example.com", access: "admin", org: "praxis", name: "Admin" };
const principal = { id: "member:admin", kind: "session", email: person.email, memberId: "admin", access: "admin", application: "web", scopes: null, companies: null, guards: [] };
const meeting = { company: "santa-clara", title: "Kickoff", startsAt: "2026-10-01T12:00:00-03:00", durationMin: 45, attendeeIds: ["admin"], guests: ["guest@example.com", "guest@example.com"], modality: "presencial" };
async function setup() {
  const f = sqliteD1();
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify({ extraMembers: [person] }));
  f.sql.prepare("INSERT INTO google_connections(workspace_id,user_email,account_email,scopes,refresh_token_enc,created_at,updated_at) VALUES('default',?,?,?,?,?,?)").run(person.email, person.email, "calendar", await seal("test-secret", "test-refresh"), "now", "now");
  return { ...f, env: { DB: f.db, GOOGLE_ENABLED: "true", GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test", GOOGLE_TOKEN_KEY: "test-secret" } };
}
function mockGoogle(t, { failOnce = false } = {}) {
  const original = globalThis.fetch, events = new Map();
  let invitations = 0, updates = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "fake-access" });
    assert.match(String(url), /^https:\/\/www.googleapis.com\/calendar\/v3\//);
    if (init?.method === "POST") {
      const body = JSON.parse(init.body);
      if (events.has(body.id)) return Response.json({ error: { message: "already exists 409" } }, { status: 409 });
      const event = { ...body, etag: '"v1"', organizer: { email: person.email }, htmlLink: "https://calendar.google.com/test" };
      events.set(body.id, event); invitations++;
      if (failOnce) { failOnce = false; throw new Error("connection interrupted after send"); }
      return Response.json(event);
    }
    const id = String(url).split("/events/")[1]?.split("?")[0], event = events.get(id);
    assert.ok(event);
    if (init?.method === "PATCH") {
      assert.equal(init.headers["if-match"], event.etag);
      Object.assign(event, JSON.parse(init.body), { etag: '"v2"' }); updates++;
    }
    return Response.json(event);
  };
  t.after(() => { globalThis.fetch = original; });
  return { events, invitations: () => invitations, updates: () => updates };
}
test("local meetings persist with authoritative organizer, versions and events", async () => {
  const { db, sql, env } = await setup();
  const input = { meeting: { ...meeting, organizerEmail: "attacker@example.com" } };
  const result = await executeMeetingCommand(env, principal, "meetings.create", input, "local");
  assert.equal(result.data.meeting.organizerEmail, person.email);
  assert.equal(result.data.meeting.schedulingStatus, "complete");
  assert.equal(result.documents.length, 1);
  assert.equal((await executeMeetingCommand(env, principal, "meetings.create", input, "local")).data.meeting.id, result.data.meeting.id);
  assert.equal(sql.prepare("SELECT count(*) n FROM operation_events").get().n, 1);
  await assert.rejects(executeMeetingCommand(env, principal, "meetings.create", { meeting: { ...meeting, title: "Versioned" } }, "delivery-stale", { "ontology.delivery.v2": 7 }), { status: 412 });
  await assert.rejects(executeMeetingCommand(env, principal, "meetings.update", { meetingId: result.data.meeting.id, patch: { title: "Updated" } }, "stale", { "ontology.engagement.v2": 0 }), { status: 412 });
  void db; sql.close();
});
test("Google creation survives an uncertain response without duplicate invitations", async t => {
  const { sql, env } = await setup(), google = mockGoogle(t, { failOnce: true });
  const input = { meeting, sendInvites: true };
  const first = await executeMeetingCommand(env, principal, "meetings.create", input, "google");
  assert.equal(first.data.operation.status, "uncertain");
  assert.equal(google.invitations(), 1);
  const retry = await executeMeetingCommand(env, { ...principal, channel: "mcp" }, "meetings.create", input, "google");
  assert.equal(retry.data.operation.status, "complete");
  assert.equal(retry.data.meeting.google.etag, '"v1"');
  assert.match(retry.data.meeting.google.eventId, /^[a-f0-9]{64}$/);
  assert.equal(google.invitations(), 1);
  assert.equal([...google.events.values()][0].attendees.length, 1);
  assert.equal(sql.prepare("SELECT count(*) n FROM operation_events WHERE type='meeting.scheduled'").get().n, 1);
  const audit = sql.prepare("SELECT actor_id,actor_email,source,application FROM client_audit_log WHERE action='meeting.scheduled'").get();
  assert.deepEqual({ ...audit }, { actor_id: "admin", actor_email: person.email, source: "interface", application: "web" });
  sql.close();
});
test("rescheduling and cancellation update the same event once and reject external edits", async t => {
  const { sql, env } = await setup(), google = mockGoogle(t);
  const created = await executeMeetingCommand(env, principal, "meetings.create", { meeting, sendInvites: true }, "create");
  assert.equal(created.data.operation.status, "complete");
  const id = created.data.meeting.id;
  const input = { meetingId: id, patch: { startsAt: "2026-10-02T15:00:00Z" } };
  const changed = await executeMeetingCommand(env, principal, "meetings.reschedule", input, "move");
  assert.equal(changed.data.operation.status, "complete");
  await executeMeetingCommand(env, principal, "meetings.reschedule", input, "move");
  assert.equal(google.updates(), 1);
  const cancelled = await executeMeetingCommand(env, principal, "meetings.cancel", { meetingId: id }, "cancel");
  assert.equal(cancelled.data.operation.status, "complete");
  assert.ok(cancelled.data.meeting.cancelledAt);
  assert.equal(cancelled.data.meeting.google.cancelled, true);
  assert.equal(google.invitations(), 1);
  assert.equal(google.updates(), 2);
  sql.close();
});
test("system credentials cannot borrow personal Google tokens and participants stay client-scoped", async () => {
  const { db, sql, env } = await setup();
  const credential = await issueIntegrationCredential(db, "default", person.email, { name: "CRM", ownerEmail: person.email, scopes: ["meetings:write"], expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const system = await resolveOperationPrincipal(new Request("https://example.com", { headers: { authorization: `Bearer ${credential.token}` } }), env);
  await assert.rejects(executeMeetingCommand(env, system, "meetings.create", { meeting, sendInvites: true }, "system"), { code: "organizer_delegation_required" });
  await assert.rejects(executeMeetingCommand(env, principal, "meetings.create", { meeting: { ...meeting, attendeeIds: ["missing"] } }, "person"), { code: "invalid_meeting" });
  const created = await executeMeetingCommand(env, principal, "meetings.create", { meeting }, "owner");
  sql.exec("UPDATE state_documents SET body=json_set(body,'$.deactivatedIds',json('[\"admin\"]')),version=2 WHERE key='ontology.workspace.v3'");
  await assert.rejects(executeMeetingCommand(env, principal, "meetings.create", { meeting }, "owner"), { code: "inactive_member" });
  assert.ok(created.data.meeting.id);
  sql.close();
});
test("external edits cause reconciliation without overwriting Google or the confirmed local schedule", async t => {
  const { sql, env } = await setup(), google = mockGoogle(t);
  const created = await executeMeetingCommand(env, principal, "meetings.create", { meeting, sendInvites: true }, "create-conflict");
  google.events.get(created.data.meeting.google.eventId).etag = '"external-change"';
  const changed = await executeMeetingCommand(env, principal, "meetings.reschedule", { meetingId: created.data.meeting.id, patch: { startsAt: "2026-10-03T15:00:00Z" } }, "move-conflict");
  assert.equal(changed.data.operation.status, "uncertain");
  assert.equal(changed.data.meeting.startsAt, created.data.meeting.startsAt);
  assert.equal(google.updates(), 0);
  assert.equal(sql.prepare("SELECT count(*) n FROM operation_events WHERE type='meeting.rescheduled'").get().n, 0);
  sql.close();
});
test("concurrent replay sees a pending journal without starting a second invitation request", async t => {
  const { sql, env } = await setup();
  const original = globalThis.fetch;
  let release, entered, posts = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { entered = resolve; });
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "test" });
    posts++; entered(); await pending;
    return Response.json({ ...JSON.parse(init.body), etag: "v1", organizer: { email: person.email } });
  };
  t.after(() => { globalThis.fetch = original; });
  const input = { meeting, sendInvites: true };
  const first = executeMeetingCommand(env, principal, "meetings.create", input, "concurrent");
  await waiting;
  const second = await executeMeetingCommand(env, principal, "meetings.create", input, "concurrent");
  assert.equal(second.data.operation.status, "pending");
  assert.equal(posts, 1);
  release();
  assert.equal((await first).data.operation.status, "complete");
  sql.close();
});
test("readers cannot create meetings even with a live Google connection", async t => {
  const { sql, env } = await setup(), google = mockGoogle(t);
  sql.exec("UPDATE state_documents SET body=json_set(body,'$.extraMembers[0].access','leitor'),version=2 WHERE key='ontology.workspace.v3'");
  await assert.rejects(executeMeetingCommand(env, principal, "meetings.create", { meeting, sendInvites: true }, "reader"), { code: "permission_denied" });
  assert.equal(google.invitations(), 0);
  assert.equal(sql.prepare("SELECT count(*) n FROM meeting_operations").get().n, 0);
  sql.close();
});
