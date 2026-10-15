import test from "node:test";
import assert from "node:assert/strict";
import { deriveAlerts } from "../src/modules/workspace/domain/derived-alerts.ts";

const today = "2026-09-12T12:00:00";
const clients = [{ slug: "acme", name: "Acme" }];
const delivery = (id, over = {}) => ({
  id,
  company: "acme",
  title: id,
  description: "",
  status: "fila",
  ownerId: "m",
  dueAt: "2026-09-20",
  hours: 4,
  workstream: "Entrega",
  milestone: 0,
  completion: "deliverable",
  kind: "journey",
  ...over,
});
const cycle = (id, over = {}) => ({
  id,
  company: "acme",
  name: id,
  goal: "g",
  startsAt: "2026-08-01",
  endsAt: "2026-08-20",
  ownerId: "m",
  status: "em-curso",
  taskIds: [],
  acceptance: [],
  ...over,
});
const meeting = (startsAt) => ({
  id: `m-${startsAt}`,
  company: "acme",
  title: "Reunião",
  kind: "alinhamento",
  startsAt,
  durationMin: 30,
  attendeeIds: [],
  summary: "",
  notes: "",
  decisions: [],
  actions: [],
});

test("late, blocked and requested work become alerts with escalating severity", () => {
  const out = deriveAlerts({
    today,
    clients,
    deliveries: [
      delivery("ok"),
      delivery("late-2", { dueAt: "2026-09-10" }),
      delivery("late-10", { dueAt: "2026-09-01" }),
      delivery("blocked", { status: "bloqueado", blockers: "Sem acesso", dueAt: "2026-09-15" }),
      delivery("done-late", { status: "entregue", dueAt: "2026-09-01" }),
      delivery("req", { kind: "request", dueAt: "2026-09-05" }),
    ],
    cycles: [],
    meetings: [meeting("2026-09-10T10:00:00")],
  });
  const byId = Object.fromEntries(out.map((a) => [a.id, a]));
  assert.equal(byId["derived-entrega-atrasada-late-2"].severity, "atencao");
  assert.equal(byId["derived-entrega-atrasada-late-10"].severity, "critico");
  assert.equal(byId["derived-entrega-bloqueada-blocked"].severity, "critico");
  assert.equal(byId["derived-entrega-bloqueada-blocked"].detail, "Sem acesso");
  assert.equal(byId["derived-solicitacao-req"].severity, "atencao");
  assert.equal("derived-entrega-atrasada-ok" in byId, false);
  assert.equal("derived-entrega-atrasada-done-late" in byId, false);
  assert.equal(out[0].severity, "critico");
});

test("cycles waiting for acceptance or past their end date and silent clients are flagged", () => {
  const out = deriveAlerts({
    today,
    clients: [...clients, { slug: "quiet", name: "Quiet" }],
    deliveries: [],
    cycles: [
      cycle("waiting", { status: "em-aceite", endsAt: "2026-09-01" }),
      cycle("fresh", { status: "em-aceite", endsAt: "2026-09-10" }),
      cycle("late", { status: "em-curso", endsAt: "2026-08-20" }),
      cycle("done", { status: "concluido", endsAt: "2026-08-01" }),
    ],
    meetings: [meeting("2026-09-10T10:00:00")],
  });
  const ids = out.map((a) => a.id);
  assert.ok(ids.includes("derived-aceite-pendente-waiting"));
  assert.ok(!ids.includes("derived-aceite-pendente-fresh"));
  assert.equal(out.find((a) => a.id === "derived-ciclo-atrasado-late")?.severity, "critico");
  assert.ok(!ids.includes("derived-ciclo-atrasado-done"));
  assert.ok(ids.includes("derived-sem-reuniao-quiet"));
  assert.ok(!ids.includes("derived-sem-reuniao-acme"));
  assert.equal(out.find((a) => a.id === "derived-sem-reuniao-quiet")?.severity, "info");
});

import { primaryAlertFor, precedenceRank } from "../src/modules/workspace/domain/derived-alerts.ts";

test("the primary alert follows a fixed precedence: blocker, overdue next step, late cycle, red health, missing next step, overdue delivery, stalled acceptance, registered", () => {
  const derived = deriveAlerts({
    today,
    clients,
    deliveries: [
      delivery("late", { dueAt: "2026-09-01" }),
      delivery("blocked", { status: "bloqueado", blockers: "Sem acesso", dueAt: "2026-09-15" }),
    ],
    cycles: [cycle("waiting", { status: "em-aceite", endsAt: "2026-09-01" })],
    meetings: [meeting("2026-09-10T10:00:00")],
  });
  const registered = { id: "r1", company: "acme", severity: "critico", title: "Registrado", detail: "", openedAt: "2026-09-01T10:00:00", source: "registrado" };
  const all = [...derived, registered];
  const withBlocker = primaryAlertFor("acme", all, { today, health: { flag: "red", score: 20 }, nextStep: { text: "x", dueAt: "2026-09-01" } });
  assert.equal(withBlocker.kind, "bloqueio");
  assert.equal(withBlocker.action, "Resolver bloqueio");
  assert.deepEqual(withBlocker.target, { type: "delivery", id: "blocked" });
  const noBlocker = all.filter((a) => a.id !== "derived-entrega-bloqueada-blocked");
  const overdueStep = primaryAlertFor("acme", noBlocker, { today, health: { flag: "red", score: 20 }, nextStep: { text: "x", dueAt: "2026-09-01" } });
  assert.equal(overdueStep.kind, "saude-vermelha");
  assert.equal(overdueStep.target.type, "client");
  const red = primaryAlertFor("acme", noBlocker, { today, health: { flag: "red", score: 20 }, nextStep: { text: "x", dueAt: "2026-09-30" } });
  assert.equal(red.kind, "saude-vermelha");
  const missing = primaryAlertFor("acme", noBlocker, { today, health: { flag: "green", score: 90 }, nextStep: null });
  assert.equal(missing.kind, "entrega-vencida");
  const overdueDelivery = primaryAlertFor("acme", noBlocker, { today, health: { flag: "green", score: 90 }, nextStep: { text: "x", dueAt: "2026-09-30" } });
  assert.equal(overdueDelivery.kind, "entrega-vencida");
  const onlyAcceptance = noBlocker.filter((a) => !a.id.includes("entrega-atrasada"));
  assert.equal(primaryAlertFor("acme", onlyAcceptance, { today, nextStep: { text: "x", dueAt: "2026-09-30" } }).kind, "aceite-parado");
  const onlyRegistered = [registered];
  assert.equal(primaryAlertFor("acme", onlyRegistered, { today, nextStep: { text: "x", dueAt: "2026-09-30" } }).kind, "registrado");
  assert.equal(primaryAlertFor("acme", [], { today, nextStep: { text: "x", dueAt: "2026-09-30" } }), null);
  assert.ok(precedenceRank(derived.find((a) => a.kind === "sem-reuniao") ?? registered) >= precedenceRank(registered));
});

test("alert rules move the thresholds of acceptance, silence and critical delays", () => {
  const input = {
    today,
    clients,
    deliveries: [delivery("late-5", { dueAt: "2026-09-07" })],
    cycles: [cycle("waiting", { status: "em-aceite", endsAt: "2026-09-09" })],
    meetings: [meeting("2026-09-02T10:00:00")],
  };
  const strict = deriveAlerts({ ...input, rules: { acceptanceWaitDays: 2, silentClientDays: 7, lateDeliveryCriticalDays: 3 } });
  const lax = deriveAlerts({ ...input, rules: { acceptanceWaitDays: 10, silentClientDays: 30, lateDeliveryCriticalDays: 10 } });
  const ids = (out) => out.map((a) => a.id);
  assert.ok(ids(strict).includes("derived-aceite-pendente-waiting"));
  assert.ok(!ids(lax).includes("derived-aceite-pendente-waiting"));
  assert.ok(ids(strict).includes("derived-sem-reuniao-acme"));
  assert.ok(!ids(lax).includes("derived-sem-reuniao-acme"));
  assert.equal(strict.find((a) => a.id === "derived-entrega-atrasada-late-5").severity, "critico");
  assert.equal(lax.find((a) => a.id === "derived-entrega-atrasada-late-5").severity, "atencao");
});

test("hypotheses without fresh evidence, unprepared interviews and presentations, unheard decision-makers and incomplete charters are flagged", () => {
  const now = "2026-09-12T12:00:00";
  const hypothesis = (id, over = {}) => ({
    id,
    company: "acme",
    statement: id,
    status: "em-teste",
    painIds: [],
    evidence: [],
    createdAt: "2026-08-01T10:00:00",
    ...over,
  });
  const out = deriveAlerts({
    today,
    now,
    clients: [
      { slug: "acme", name: "Acme", charter: { objective: "x", finishedLooksLike: "", keyQuestion: "" } },
      { slug: "idle", name: "Idle" },
    ],
    deliveries: [],
    cycles: [cycle("open", { status: "em-curso", endsAt: "2026-10-01" })],
    meetings: [
      { ...meeting("2026-09-01T10:00:00"), id: "past", attendeeIds: ["sponsor"] },
      { ...meeting("2026-09-13T10:00:00"), id: "talk-soon", kind: "apresentacao", title: "Recomendações" },
      { ...meeting("2026-09-13T15:00:00"), id: "talk-ready", kind: "apresentacao", prep: { rehearsed: true } },
      { ...meeting("2026-09-20T10:00:00"), id: "talk-far", kind: "apresentacao" },
      { ...meeting("2026-09-13T11:00:00"), id: "int-blank", kind: "entrevista" },
      { ...meeting("2026-09-13T12:00:00"), id: "int-ready", kind: "entrevista", prep: { hypothesisIds: ["h-stale"] } },
    ],
    hypotheses: [
      hypothesis("h-stale"),
      hypothesis("h-fresh", { evidence: [{ id: "e", at: "2026-09-10T10:00:00", kind: "confirma", note: "" }] }),
      hypothesis("h-old-evidence", { evidence: [{ id: "e", at: "2026-08-01T10:00:00", kind: "confirma", note: "" }] }),
      hypothesis("h-done", { status: "confirmada" }),
      hypothesis("h-other", { company: "nope" }),
    ],
    stakeholders: [
      { id: "sponsor", company: "acme", name: "Ana", active: true, accountRole: "patrocinador" },
      { id: "boss", company: "acme", name: "Bia", active: true, accountRole: "outro", influence: "alta" },
      { id: "gone", company: "acme", name: "Caio", active: false, accountRole: "decisor" },
      { id: "user", company: "acme", name: "Dan", active: true, accountRole: "usuario", influence: "baixa" },
    ],
  });
  const byId = Object.fromEntries(out.map((a) => [a.id, a]));
  assert.equal(byId["derived-hipotese-sem-evidencia-h-stale"].severity, "info");
  assert.ok("derived-hipotese-sem-evidencia-h-old-evidence" in byId);
  assert.ok(!("derived-hipotese-sem-evidencia-h-fresh" in byId));
  assert.ok(!("derived-hipotese-sem-evidencia-h-done" in byId));
  assert.ok(!("derived-hipotese-sem-evidencia-h-other" in byId));
  assert.equal(byId["derived-apresentacao-sem-ensaio-talk-soon"].severity, "atencao");
  assert.equal(byId["derived-apresentacao-sem-ensaio-talk-soon"].relatedMeetingId, "talk-soon");
  assert.ok(!("derived-apresentacao-sem-ensaio-talk-ready" in byId));
  assert.ok(!("derived-apresentacao-sem-ensaio-talk-far" in byId));
  assert.equal(byId["derived-entrevista-sem-hipotese-int-blank"].severity, "info");
  assert.ok(!("derived-entrevista-sem-hipotese-int-ready" in byId));
  assert.ok(!("derived-decisor-nao-ouvido-acme-sponsor" in byId));
  assert.equal(byId["derived-decisor-nao-ouvido-acme-boss"].severity, "atencao");
  assert.ok(!("derived-decisor-nao-ouvido-acme-gone" in byId));
  assert.ok(!("derived-decisor-nao-ouvido-acme-user" in byId));
  assert.equal(byId["derived-contrato-incompleto-acme"].severity, "info");
  assert.ok(!("derived-contrato-incompleto-idle" in byId));
  const wide = deriveAlerts({ today, now, clients, deliveries: [], cycles: [], meetings: [{ ...meeting("2026-09-13T10:00:00"), id: "talk", kind: "apresentacao" }], rules: { presentationRehearsalHours: 12 } });
  assert.ok(!wide.some((a) => a.kind === "apresentacao-sem-ensaio"));
  const primary = primaryAlertFor("acme", out, { today, nextStep: { text: "x", dueAt: "2026-09-30" } });
  assert.equal(primary.kind, "apresentacao-sem-ensaio");
  assert.equal(primary.action, "Preparar apresentação");
  assert.deepEqual(primary.target, { type: "meeting", id: "talk-soon" });
  const blocker = deriveAlerts({ today, clients, deliveries: [delivery("b", { status: "bloqueado", blockers: "x" })], cycles: [], meetings: [meeting("2026-09-10T10:00:00")] });
  assert.equal(primaryAlertFor("acme", [...out, ...blocker], { today, nextStep: { text: "x", dueAt: "2026-09-30" } }).kind, "bloqueio");
});
