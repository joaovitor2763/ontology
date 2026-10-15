import test from "node:test";
import assert from "node:assert/strict";
import {
  clientProgress,
  milestoneDeliveries,
} from "../src/modules/delivery/application/progress.ts";
import { milestoneProgress } from "../src/modules/catalog/domain/journey-progress.ts";
import { milestoneError, journeyError } from "../src/modules/catalog/domain/models.ts";
import { blockerPatch, recordHistory } from "../src/modules/delivery/domain/history.ts";
import { operationalHealth } from "../src/modules/clients/domain/health.ts";

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
  startsAt: "2026-09-01",
  endsAt: "2026-09-15",
  ownerId: "m",
  status: "em-curso",
  taskIds: [],
  acceptance: [],
  ...over,
});

test("one client projection reconciles planned work, requests, cycles and overdue items", () => {
  const rows = [
    delivery("a", { status: "entregue", milestone: 2 }),
    delivery("b", { milestone: 2, dueAt: "2026-09-01" }),
    delivery("c", { status: "bloqueado" }),
    delivery("r", { kind: "request" }),
  ];
  const cycles = [
    cycle("c1", { taskIds: ["c"], milestone: 2 }),
    cycle("c0", { status: "concluido", startsAt: "2026-08-01", endsAt: "2026-08-15" }),
  ];
  const p = clientProgress(rows, cycles, "2026-09-12T12:00:00");
  assert.equal(p.planned.length, 3);
  assert.equal(p.requests.length, 1);
  assert.equal(p.done.length, 1);
  assert.equal(p.percent, 33);
  assert.deepEqual(p.overdue.map((d) => d.id), ["b"]);
  assert.deepEqual(p.blocked.map((d) => d.id), ["c"]);
  assert.equal(p.hoursOpen, 8);
  assert.equal(p.currentCycle?.id, "c1");
  assert.deepEqual(p.byCycle.c1.map((d) => d.id), ["c"]);
});

test("current work prefers the cycle in its window over historical acceptance and future work", () => {
  const cycles = [
    cycle("kickoff", { status: "em-aceite", startsAt: "2026-08-26", endsAt: "2026-09-07" }),
    cycle("older", { startsAt: "2026-09-08", endsAt: "2026-09-23" }),
    cycle("mapping", { startsAt: "2026-09-24", endsAt: "2026-10-28" }),
    cycle("development", { startsAt: "2026-10-29", endsAt: "2027-01-13" }),
  ];
  assert.equal(clientProgress([], cycles, "2026-10-05").currentCycle.id, "mapping");
  assert.equal(clientProgress([], [cycles[0]], "2026-10-05").currentCycle.id, "kickoff");
});

test("archived and canceled purchases do not penalize current work; legacy and unknown purchases stay visible", () => {
  const tasks = [
    delivery("old-blocker", { enrollmentId: "canceled", status: "bloqueado", dueAt: "2026-01-01" }),
    delivery("old-overdue", { enrollmentId: "archived", dueAt: "2026-01-01" }),
    delivery("active", { enrollmentId: "active" }),
    delivery("paused", { enrollmentId: "paused" }),
    delivery("legacy"),
    delivery("unknown", { enrollmentId: "unknown" }),
    delivery("foreign", { enrollmentId: "foreign" }),
  ];
  const cycles = [cycle("old", { enrollmentId: "canceled", taskIds: ["old-blocker"], endsAt: "2026-01-01" }),
    cycle("archived", { enrollmentId: "archived", endsAt: "2026-01-01" }),
    cycle("current", { enrollmentId: "active", endsAt: "2026-09-20" })];
  const enrollments = [
    { id: "canceled", company: "acme", status: "cancelada" },
    { id: "archived", company: "acme", status: "ativa", archivedAt: "2026-09-01" },
    { id: "active", company: "acme", status: "ativa" },
    { id: "paused", company: "acme", status: "pausada" },
    { id: "foreign", company: "another-client", status: "cancelada" },
  ];
  const progress = clientProgress(tasks, cycles, "2026-09-12", enrollments);
  assert.deepEqual(progress.all.map(task => task.id), ["active", "paused", "legacy", "unknown", "foreign"]);
  assert.deepEqual(progress.cycles.map(cycle => cycle.id), ["current"]);
  assert.equal(progress.currentCycle.id, "current");
  assert.equal(operationalHealth({ today: "2026-09-12", openDeliveries: progress.all, cycles: progress.cycles }).score, 100);
  assert.equal(tasks.length, 7);
  assert.equal(cycles.length, 3);
});

test("a milestone counts its own deliveries plus those of cycles linked to it, without duplicates", () => {
  const rows = [
    delivery("own", { milestone: 2 }),
    delivery("both", { milestone: 2 }),
    delivery("fromCycle", { milestone: 0, status: "entregue" }),
  ];
  const cycles = [cycle("c1", { taskIds: ["both", "fromCycle"], milestone: 2 })];
  const p = clientProgress(rows, cycles, "2026-09-12T12:00:00");
  const scope = milestoneDeliveries(p, 2);
  assert.equal(scope.cycles.length, 1);
  assert.deepEqual(scope.items.map((d) => d.id).sort(), ["both", "fromCycle", "own"]);
  const progress = milestoneProgress(rows, 2, "2026-09-12", scope.items);
  assert.equal(progress.items.length, 3);
  assert.equal(progress.done, 1);
  assert.equal(progress.percent, 33);
});

test("detailed milestones validate duration and reference deliveries", () => {
  const ok = {
    n: 1,
    stage: "Diagnóstico",
    name: "Situação mapeada",
    owner: "Responsável",
    goal: "Entender a operação",
    durationWeeks: 2,
    exitCriteria: ["Mapa validado"],
    tasks: [
      { id: "m1-t1", title: "Entrevistas", description: "", hours: 6, completion: "checklist" },
    ],
  };
  assert.equal(milestoneError(ok), null);
  assert.equal(milestoneError({ ...ok, durationWeeks: 0 }), "A duração do marco deve ser de 1 a 52 semanas.");
  assert.equal(
    milestoneError({ ...ok, tasks: [{ ...ok.tasks[0], title: " " }] }),
    "Revise o título e o esforço das tarefas de referência.",
  );
  assert.equal(
    journeyError({ id: "p", name: "Plano", description: "", milestones: [{ ...ok, name: "" }] }),
    "Marco 1: Dê um nome ao marco.",
  );
});

test("delivery history records only tracked fields that changed, with author and time", () => {
  const previous = { status: "fila", ownerId: "m", dueAt: "2026-09-20", priority: "media", title: "x" };
  const entries = recordHistory(
    previous,
    { status: "em-curso", ownerId: "m", dueAt: "2026-09-25", title: "y" },
    "marina",
    "2026-09-14T09:00:00",
  );
  assert.deepEqual(
    entries.map((e) => [e.field, e.from, e.to]),
    [
      ["status", "fila", "em-curso"],
      ["dueAt", "2026-09-20", "2026-09-25"],
    ],
  );
  assert.ok(entries.every((e) => e.by === "marina" && e.at === "2026-09-14T09:00:00"));
});

test("a structured blocker marks the delivery as blocked and resolving it restores the flow", () => {
  const blocked = blockerPatch(
    { status: "em-curso", blockers: "" },
    { reason: "Sem acesso ao TMS", ownerId: "omar", since: "2026-09-10" },
    "2026-09-10",
  );
  assert.equal(blocked.status, "bloqueado");
  assert.equal(blocked.blockers, "Sem acesso ao TMS");
  assert.equal(blocked.blocker.resolvedAt, undefined);
  const resolved = blockerPatch(
    { status: "bloqueado", blocker: blocked.blocker, blockers: blocked.blockers },
    null,
    "2026-09-12",
  );
  assert.equal(resolved.status, "em-curso");
  assert.equal(resolved.blockers, "");
  assert.equal(resolved.blocker.resolvedAt, "2026-09-12");
  const legacy = blockerPatch({ status: "bloqueado", blockers: "texto antigo" }, null, "2026-09-12");
  assert.equal(legacy.blocker.reason, "texto antigo");
  assert.equal(legacy.status, "em-curso");
});
