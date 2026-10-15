import test from "node:test";
import assert from "node:assert/strict";
import {
  g4OsMilestones,
  g4OsPlan,
  g4OsProduct,
} from "../src/modules/catalog/infrastructure/g4-os-founding-companies.ts";
import { g4OsMessages } from "../src/modules/engagement/infrastructure/g4-os-messages.ts";
import {
  resolveAllDueDates,
  resolveDueDate,
  scheduleSummary,
  validateSchedules,
} from "../src/modules/catalog/domain/schedule.ts";
import {
  diffJourneys,
  fingerprint,
  hasUnpublishedChanges,
  pinnedJourney,
  publishSnapshot,
} from "../src/modules/catalog/domain/publication.ts";
import { foundingMilestones } from "../src/modules/catalog/infrastructure/founding-journey.ts";

const task = (id, title, schedule) => ({
  id,
  title,
  description: "",
  hours: 2,
  completion: "checklist",
  schedule,
});

test("schedules read as sentences and resolve from the cycle start or a predecessor", () => {
  const tasks = [
    task("a", "Agendar entrevistas", {
      mode: "date",
      base: "inicio",
      offsetDays: 2,
    }),
    task("b", "Realizar entrevistas", {
      mode: "task",
      predecessorId: "a",
      offsetDays: 3,
    }),
    task("c", "Sem prazo"),
    task("d", "Venda", { mode: "date", base: "venda", offsetDays: 0 }),
  ];
  assert.equal(scheduleSummary(undefined), "Sem prazo automático");
  assert.equal(
    scheduleSummary(tasks[0].schedule, tasks),
    "2 dias após o início do ciclo",
  );
  assert.equal(
    scheduleSummary(tasks[1].schedule, tasks),
    "3 dias após 'Agendar entrevistas'",
  );
  assert.equal(scheduleSummary(tasks[3].schedule, tasks), "No dia da venda");
  assert.equal(
    resolveDueDate(tasks[0].schedule, { startsAt: "2026-09-01", tasksDue: {} }),
    "2026-09-03",
  );
  const all = resolveAllDueDates(tasks, {
    startsAt: "2026-09-01",
    saleAt: "2026-08-20",
  });
  assert.deepEqual(all, {
    a: "2026-09-03",
    b: "2026-09-06",
    c: null,
    d: "2026-08-20",
  });
});

test("schedule validation rejects missing, later and circular predecessors", () => {
  assert.equal(
    validateSchedules([
      task("a", "A"),
      task("b", "B", { mode: "task", predecessorId: "a", offsetDays: 1 }),
    ]),
    null,
  );
  assert.match(
    validateSchedules([
      task("a", "A", { mode: "task", predecessorId: "zz", offsetDays: 1 }),
    ]),
    /não existe/,
  );
  assert.match(
    validateSchedules([
      task("a", "A", { mode: "task", predecessorId: "b", offsetDays: 1 }),
      task("b", "B"),
    ]),
    /vem depois/,
  );
  assert.match(
    validateSchedules([
      task("a", "A", { mode: "task", predecessorId: "a", offsetDays: 1 }),
    ]),
    /si mesma/,
  );
});

const plan = (milestones) => ({
  id: "p",
  name: "Plano",
  description: "",
  milestones,
});
const m = (n, name, tasks = []) => ({ n, stage: "E", name, owner: "R", tasks });

test("publication snapshots are immutable, fingerprinted and pin clients", () => {
  const head = plan([m(1, "Um", [task("t1", "A")]), m(2, "Dois")]);
  const fp = fingerprint(head);
  assert.equal(fp, fingerprint(structuredClone(head)));
  assert.notEqual(fp, fingerprint(plan([m(1, "Um"), m(2, "Dois")])));
  const first = publishSnapshot(head, undefined, "ana", "2026-09-14T10:00:00Z");
  assert.equal(first.version.version, 1);
  assert.equal(first.head.version, 1);
  const versions = [first.version];
  const edited = {
    ...first.head,
    milestones: [...head.milestones, m(3, "Três")],
  };
  assert.equal(hasUnpublishedChanges(first.head, versions), false);
  assert.equal(hasUnpublishedChanges(edited, versions), true);
  const diff = diffJourneys(first.version.snapshot, edited);
  assert.deepEqual(
    diff.added.map((x) => x.n),
    [3],
  );
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.tasksBefore, 1);
  const second = publishSnapshot(
    edited,
    versions,
    "ana",
    "2026-09-15T10:00:00Z",
  );
  assert.equal(second.version.version, 2);
  const all = [...versions, second.version];
  // Unpinned clients follow the latest published snapshot; pinned ones keep theirs.
  assert.equal(pinnedJourney(edited, all).milestones.length, 3);
  assert.equal(pinnedJourney(edited, all, 1).milestones.length, 2);
  // Never-published plans fall back to the draft.
  assert.equal(pinnedJourney(edited, undefined).milestones.length, 3);
  // Snapshots do not change when the head is edited afterwards.
  first.head.milestones.push(m(9, "X"));
  assert.equal(first.version.snapshot.milestones.length, 2);
});

test("the 12-month program carries every reference task with policy and neutral wording", () => {
  assert.equal(foundingMilestones.length, 12);
  const tasks = foundingMilestones.flatMap((x) => x.tasks ?? []);
  assert.ok(tasks.length >= 120);
  assert.ok(tasks.every((t) => t.ownerRole && t.party));
  assert.ok(
    tasks
      .filter((t) => t.completion === "deliverable")
      .every((t) => t.deliverableTemplateId && t.requiresEvidence),
  );
  const text = JSON.stringify(foundingMilestones);
  assert.doesNotMatch(text, /G4|AI Master|Founding|Tallis|João/);
  assert.equal(new Set(tasks.map((t) => t.id)).size, tasks.length);
  for (const milestone of foundingMilestones)
    assert.equal(
      validateSchedules(milestone.tasks ?? []),
      null,
      milestone.name,
    );
});

test("plataforma de IA creates a complete twelve-month program and preserves onboarding checklists", () => {
  assert.equal(g4OsPlan.autoCreateCycles, true);
  assert.equal(g4OsProduct.serviceModel, "implementacao");
  assert.deepEqual(
    g4OsMilestones.map((m) => m.name),
    ["Kickoff", "Implementação", "Handover", "Sustentação"],
  );
  assert.deepEqual(
    g4OsMilestones.map((m) => m.period),
    [
      { startMonth: 1, endMonth: 1 },
      { startMonth: 2, endMonth: 3 },
      { startMonth: 4, endMonth: 4 },
      { startMonth: 5, endMonth: 12 },
    ],
  );
  const tasks = g4OsMilestones.flatMap((m) => m.tasks ?? []);
  assert.equal(tasks.length, 37);
  assert.equal(new Set(tasks.map((t) => t.id)).size, tasks.length);
  assert.equal(
    tasks.find((t) => t.title === "Configuração do plataforma de IA").checklistItems
      .length,
    7,
  );
  assert.equal(
    tasks.find((t) => t.title === "Alinhamento inicial").checklistItems.length,
    7,
  );
  assert.deepEqual(
    tasks
      .filter((t) => t.id.startsWith("g4os-monthly-"))
      .map((t) => t.period.startMonth),
    [4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.equal(tasks.find((t) => t.id === "g4os-visit-2").period.startMonth, 2);
  assert.equal(tasks.find((t) => t.id === "g4os-visit-6").period.startMonth, 6);
  for (const milestone of g4OsMilestones)
    assert.equal(validateSchedules(milestone.tasks ?? []), null);
  assert.equal(g4OsProduct.cycles.length, 4);
  assert.deepEqual(
    g4OsProduct.cycles.flatMap((c) => c.deliveries).map((t) => t.title),
    tasks.map((t) => t.title),
  );
  assert.equal(g4OsMessages.length, 14);
  assert.ok(g4OsMessages.every((m) => m.milestone === 1));
});
