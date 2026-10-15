import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import {
  effectiveCurrentUserId,
  sessionBootStep,
  rosterMembers,
  sessionMemberOf,
} from "../src/modules/workspace/domain/session-identity.ts";
import { memberOfRoster } from "../src/server/authz.ts";
import { saveLegacyState } from "../src/server/operations/legacy-authorization.ts";

const alice = { id: "alice", email: "Alice@Example.test", access: "admin" };
const bob = { id: "bob", email: "bob@example.test", access: "ai_master" };

/** Mesma sequência do `SessionBoot`: o passo decide se o roster recebe gravação. */
function load(doc, email, writes) {
  const step = sessionBootStep(doc.extraMembers, email);
  if (step.kind === "none") return;
  writes.push({ key: "ontology.workspace.v3", step });
  if (step.kind === "promote")
    doc.extraMembers = doc.extraMembers.map((p) => (p.id === step.member.id ? { ...p, access: "admin" } : p));
  else doc.extraMembers = [...doc.extraMembers, { id: step.id, email, access: "admin" }];
}

test("dois membros abrindo a página alternadamente não gravam o documento do workspace", () => {
  const doc = { extraMembers: [alice, bob], currentUserId: "alice" };
  const writes = [];
  for (let i = 0; i < 6; i++) load(doc, i % 2 ? "bob@example.test" : "alice@example.test", writes);
  assert.deepEqual(writes, []);
  assert.equal(doc.currentUserId, "alice");
});

test("primeiro acesso: workspace vazio cria o admin, roster sem admin promove, recém-chegado espera aprovação", () => {
  assert.deepEqual(sessionBootStep([], "First.Person@Example.test"), { kind: "create", id: "member-first-person-example-test" });
  assert.deepEqual(sessionBootStep([{ ...bob }], "BOB@example.test"), { kind: "promote", member: bob });
  assert.deepEqual(sessionBootStep([alice, bob], "new@example.test"), { kind: "none" });
  // Um único boot de bootstrap e depois nenhuma gravação nas visitas seguintes.
  const doc = { extraMembers: [] }, writes = [];
  for (let i = 0; i < 4; i++) load(doc, "first@example.test", writes);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].step.kind, "create");
});

test("publicado, o autor é o membro da sessão mesmo com outro membro gravado no documento", () => {
  const members = [alice, bob];
  for (const [email, expected] of [["bob@example.test", "bob"], ["ALICE@example.test", "alice"]])
    assert.equal(effectiveCurrentUserId({ mode: "remote", sessionEmail: email, members, storedId: "alice", fallbackId: "marina" }), expected);
  assert.equal(sessionMemberOf(members, "BOB@EXAMPLE.TEST"), bob);
  // Roster ainda chegando ou pessoa fora do cadastro: ninguém, nunca o último gravado nem o admin de exemplo.
  assert.equal(effectiveCurrentUserId({ mode: "remote", sessionEmail: "bob@example.test", members: [], storedId: "alice", fallbackId: "marina" }), "");
  assert.equal(effectiveCurrentUserId({ mode: "remote", sessionEmail: null, members, storedId: "alice", fallbackId: "marina" }), "");
});

test("modo navegador mantém o \"ver como\" gravado", () => {
  const members = [alice, bob];
  assert.equal(effectiveCurrentUserId({ mode: "local", sessionEmail: "bob@example.test", members, storedId: "alice", fallbackId: "marina" }), "alice");
  assert.equal(effectiveCurrentUserId({ mode: "local", sessionEmail: undefined, members, storedId: "", fallbackId: "marina" }), "marina");
});

test("SessionBoot não grava o membro atual e setCurrentUser não grava publicado", () => {
  const boot = readFileSync(new URL("../src/modules/workspace/presentation/SessionBoot.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(boot, /setCurrentUser|currentUserId:/);
  const state = readFileSync(new URL("../src/modules/workspace/infrastructure/state.ts", import.meta.url), "utf8");
  assert.ok(state.includes('if (mode === "remote") return;'));
});

test("o servidor segue aceitando o roster com currentUserId antigo de outra pessoa e o bootstrap sem currentUserId", async () => {
  const f = sqliteD1();
  try {
    const first = { id: "member-first", name: "First", email: "first@example.com", access: "admin", org: "praxis", initials: "F", role: "Admin da plataforma", capacityHoursWeek: 40 };
    // O bootstrap novo não envia currentUserId.
    await saveLegacyState(f.db, "default", first.email, "ontology.workspace.v3", { extraMembers: [first], hidden: [], memberEdits: {}, deactivatedIds: [], alertRules: {} }, 0);
    const version = () => f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.workspace.v3'").get().version;
    const roster = { extraMembers: [alice, bob].map((m) => ({ ...m, email: m.email.toLowerCase() })), currentUserId: "alice" };
    f.sql.prepare("UPDATE state_documents SET body=?,version=1 WHERE key='ontology.workspace.v3'").run(JSON.stringify(roster));
    // Manter o valor antigo (de outra pessoa) não exige "ver-como"; trocar para outra pessoa continua exigindo.
    await saveLegacyState(f.db, "default", "bob@example.test", "ontology.workspace.v3", { ...roster }, 1);
    await assert.rejects(saveLegacyState(f.db, "default", "bob@example.test", "ontology.workspace.v3", { ...roster, currentUserId: "alice2" }, version()), { code: "permission_denied" });
    const saved = JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.workspace.v3'").get().body);
    assert.equal(saved.currentUserId, "alice");
  } finally {
    f.sql.close();
  }
});

test("o membro da sessão no navegador é o mesmo que o servidor resolve", () => {
  const doc = {
    extraMembers: [alice, bob, { id: "carla", email: "old@example.test", access: "gestor" }],
    memberEdits: { carla: { email: "carla@example.test", emails: ["carla@example.test", "outro@example.test"] } },
  };
  const members = rosterMembers(doc.extraMembers, doc.memberEdits, []);
  for (const email of ["alice@example.test", "BOB@example.test", "carla@example.test", "old@example.test", "outro@example.test", "ninguem@example.test"])
    assert.equal(sessionMemberOf(members, email)?.id, memberOfRoster(doc, email).member?.id, email);
});
