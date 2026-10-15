import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultInfluence,
  lastInteractionOf,
  stakeholderCoverage,
  upsertStakeholder,
} from "../src/modules/clients/domain/stakeholders.ts";

const person = (id, overrides = {}) => ({
  id,
  name: id,
  role: "Cargo",
  org: "client",
  initials: "XX",
  company: "acme",
  area: "",
  email: "",
  phone: "",
  accountRole: "usuario",
  primary: false,
  active: true,
  notes: "",
  ...overrides,
});

const meeting = (startsAt, attendeeIds) => ({ startsAt, attendeeIds });

test("last interaction is the latest past meeting the person attended", () => {
  const meetings = [
    meeting("2026-09-01T10:00:00", ["ana"]),
    meeting("2026-09-08T10:00:00", ["ana", "bia"]),
    meeting("2026-09-20T10:00:00", ["ana"]),
  ];
  assert.equal(lastInteractionOf("ana", meetings, "2026-09-14"), "2026-09-08T10:00:00");
  assert.equal(lastInteractionOf("bia", meetings, "2026-09-14"), "2026-09-08T10:00:00");
  assert.equal(lastInteractionOf("caio", meetings, "2026-09-14"), null);
});

test("coverage flags decision-makers and high-influence people who were never heard", () => {
  const stakeholders = [
    person("sponsor", { accountRole: "patrocinador" }),
    person("ceo", { influence: "alta" }),
    person("user", { accountRole: "usuario" }),
    person("gone", { accountRole: "decisor", active: false }),
    person("met", { accountRole: "decisor" }),
  ];
  const meetings = [meeting("2026-09-04T09:00:00", ["met", "user"])];
  const rows = stakeholderCoverage(stakeholders, meetings, "2026-09-14");
  const byId = Object.fromEntries(rows.map((r) => [r.stakeholder.id, r]));
  assert.equal(rows.length, 4, "inactive contacts are left out");
  assert.equal(byId.sponsor.keyButUnmet, true);
  assert.equal(byId.ceo.keyButUnmet, true);
  assert.equal(byId.user.keyButUnmet, false);
  assert.equal(byId.user.gapDays, 10);
  assert.equal(byId.met.neverMet, false);
  assert.equal(byId.met.keyButUnmet, false);
  assert.equal(byId.sponsor.gapDays, null);
});

test("influence defaults follow the role and stance survives upsert", () => {
  assert.equal(defaultInfluence("patrocinador"), "alta");
  assert.equal(defaultInfluence("decisor"), "alta");
  assert.equal(defaultInfluence("ponto-focal"), "media");
  assert.equal(defaultInfluence("tecnico"), "media");
  assert.equal(defaultInfluence("usuario"), "baixa");
  const saved = upsertStakeholder([], person("ana", { stance: "cetico", helpOffered: "benchmark" }));
  assert.equal(saved[0].stance, "cetico");
  assert.equal(saved[0].helpOffered, "benchmark");
});
