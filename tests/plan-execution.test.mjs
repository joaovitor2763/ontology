import test from "node:test";
import assert from "node:assert/strict";
import {
  provisionPlan,
  planReferenceForDelivery,
  addMonths,
  updatePlanDates,
} from "../src/modules/delivery/application/plan-execution.ts";
import { migrateDeliveryDates } from "../src/shared/infrastructure/migration.ts";
import { g4OsPlan } from "../src/modules/catalog/infrastructure/g4-os-founding-companies.ts";
const empty = () => ({
  extraTasks: [],
  extraCycles: [],
  cycleEdits: {},
  taskPatches: {},
  statusMap: {},
  companyJourney: {},
  companyMilestone: {},
});
const company = {
  slug: "test",
  startedAt: "2026-09-15",
  leadId: "lead",
  csId: "cs",
};
const at = "2026-09-15T12:00:00Z";
test("assignment materializes four cycles, all deliveries and monthly recurrence exactly once", () => {
  const s = provisionPlan(empty(), g4OsPlan, company, at);
  assert.equal(s.extraCycles.length, 4);
  assert.equal(s.extraTasks.length, 37);
  assert.deepEqual(
    s.extraCycles.map((c) => [c.startsAt, c.endsAt]),
    [
      ["2026-09-15", "2026-10-14"],
      ["2026-10-15", "2026-12-14"],
      ["2026-12-15", "2027-01-14"],
      ["2027-01-15", "2027-09-14"],
    ],
  );
  assert.equal(new Set(s.extraCycles.flatMap((c) => c.taskIds)).size, 37);
  assert.ok(
    s.extraTasks.every((t) => t.status === "fila" && t.startsAt <= t.dueAt),
  );
  assert.equal(
    s.extraTasks.find((t) => t.baseDeliveryId === "g4os-monthly-6").startsAt,
    "2027-02-15",
  );
  assert.deepEqual(provisionPlan(s, g4OsPlan, company, at), s);
});
test("existing kickoff and completed/customized work survive completion of the plan", () => {
  const s = empty();
  s.extraTasks.push({
    id: "old-task",
    company: "test",
    productId: g4OsPlan.productId,
    title: "Criar grupo no WhatsApp",
    status: "entregue",
    dueAt: "2026-09-17",
    checklist: [{ id: "old-check", title: "Preservar", done: true }],
    evidence: "Existing proof",
  });
  s.extraCycles.push({
    id: "old-cycle",
    company: "test",
    productId: g4OsPlan.productId,
    templateId: "g4os-onboarding",
    milestone: 1,
    startsAt: "2026-09-15",
    endsAt: "2026-09-28",
    status: "em-curso",
    taskIds: ["old-task"],
    acceptance: [],
  });
  s.taskPatches["old-task"] = { evidence: "Edited proof" };
  s.statusMap["old-task"] = "entregue";
  const result = provisionPlan(s, g4OsPlan, company, at);
  assert.equal(result.extraCycles.length, 4);
  assert.equal(result.extraTasks.length, 37);
  assert.deepEqual(
    result.extraTasks.find((t) => t.id === "old-task"),
    s.extraTasks[0],
  );
  assert.equal(result.taskPatches["old-task"].evidence, "Edited proof");
  assert.equal(
    result.extraCycles.find((c) => c.id === "old-cycle").endsAt,
    "2026-09-28",
  );
  assert.equal(
    result.extraTasks.filter((t) => t.title === "Criar grupo no WhatsApp")
      .length,
    1,
  );
});
test("calendar months clamp leap days and month-end anchors", () => {
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonths("2025-01-31", 1), "2025-02-28");
  assert.equal(addMonths("2024-02-29", 12), "2025-02-28");
});
test("date editing is validated and isolated to the client, preserving completion data", () => {
  const s = provisionPlan(empty(), g4OsPlan, company, at),
    t = s.extraTasks[0];
  const changed = updatePlanDates(
    s,
    "test",
    [],
    [{ id: t.id, startsAt: "2026-09-20", endsAt: "2026-09-25" }],
  );
  assert.equal(changed.taskPatches[t.id].dueAt, "2026-09-25");
  assert.equal(changed.extraTasks[0].status, "fila");
  assert.throws(() =>
    updatePlanDates(
      s,
      "test",
      [],
      [{ id: t.id, startsAt: "2026-09-25", endsAt: "2026-09-20" }],
    ),
  );
  assert.throws(() =>
    updatePlanDates(
      s,
      "test",
      [],
      [{ id: t.id, startsAt: "2026-02-30", endsAt: "2026-09-20" }],
    ),
  );
  assert.deepEqual(
    updatePlanDates(
      s,
      "other",
      [],
      [{ id: t.id, startsAt: "2026-09-20", endsAt: "2026-09-25" }],
    ),
    s,
  );
});
test("legacy date migration is lazy and preserves user dates", () => {
  const s = empty();
  s.extraTasks = [
    { id: "old", dueAt: "2026-09-18" },
    { id: "custom", startsAt: "2026-09-16", dueAt: "2026-09-20" },
  ];
  s.extraCycles = [{ taskIds: ["old"], startsAt: "2026-09-15" }];
  const migrated = migrateDeliveryDates(s);
  assert.equal(migrated.extraTasks[0].startsAt, "2026-09-15");
  assert.equal(migrated.extraTasks[1].startsAt, "2026-09-16");
  assert.equal(migrateDeliveryDates(migrated), migrated);
  assert.equal(s.extraTasks[0].startsAt, undefined);
});

test("recognized legacy generated cycles consolidate without losing completed work", () => {
  const s = empty();
  for (const [i, templateId] of [
    "g4os-pre-onboarding",
    "g4os-onboarding",
    "g4os-diagnostico",
  ].entries()) {
    const refs = g4OsPlan.milestones[0].tasks.filter((t) =>
      t.legacyBaseDeliveryIds.some((id) => id.startsWith(`${templateId}-d`)),
    );
    const tasks = refs.map((ref, n) => ({
      id: `legacy-${i}-${n}`,
      company: company.slug,
      productId: g4OsPlan.productId,
      baseDeliveryId: ref.legacyBaseDeliveryIds[0],
      title: `Custom title ${i}-${n}`,
      status: "entregue",
      dueAt: "2026-09-20",
      evidence: "Preserved",
    }));
    s.extraTasks.push(...tasks);
    s.extraCycles.push({
      id: `legacy-cycle-${i}`,
      company: company.slug,
      productId: g4OsPlan.productId,
      templateId,
      taskIds: tasks.map((t) => t.id),
      status: "concluido",
      startsAt: company.startedAt,
      endsAt: "2026-09-20",
      acceptance: [{ id: `accept-${i}`, text: "Approved", done: true }],
    });
  }
  const next = provisionPlan(s, g4OsPlan, company, at);
  assert.equal(next.extraCycles.filter((c) => !c.removed).length, 4);
  assert.equal(next.extraTasks.length, 37);
  const kickoff = next.extraCycles.find(
    (c) => c.templateId === "g4os-onboarding" && !c.removed,
  );
  assert.equal(kickoff.taskIds.length, 12);
  assert.equal(kickoff.status, "concluido");
  assert.equal(kickoff.acceptance.filter((a) => a.done).length, 3);
  for (const old of s.extraTasks)
    assert.deepEqual(
      next.extraTasks.find((t) => t.id === old.id),
      old,
    );
  assert.deepEqual(provisionPlan(next, g4OsPlan, company, at), next);
});

test("missing start date fails without mutating input", () => {
  const s = empty();
  assert.throws(
    () => provisionPlan(s, g4OsPlan, { ...company, startedAt: undefined }, at),
    /início válida/,
  );
  assert.deepEqual(s, empty());
});

test("date recalculation resolves renamed legacy deliveries through stable aliases", () => {
  const ref = planReferenceForDelivery(g4OsPlan, {
    baseDeliveryId: "g4os-onboarding-d4",
    title: "Custom configuration",
  });
  assert.equal(ref.id, "g4os-2-t4");
  const generated = provisionPlan(
    empty(),
    g4OsPlan,
    { ...company, startedAt: "2026-10-15" },
    at,
  );
  assert.equal(
    generated.extraTasks.find((t) => t.baseDeliveryId === ref.id).startsAt,
    "2026-10-15",
  );
});

test("manual ownership is preserved while its delivery still gates plan progress", () => {
  const s = empty();
  s.extraTasks.push({
    id: "manual-work",
    company: company.slug,
    productId: g4OsPlan.productId,
    baseDeliveryId: "g4os-onboarding-d4",
    title: "Custom configuration",
    milestone: 9,
    kind: "service",
    status: "fila",
    dueAt: "2026-09-20",
  });
  s.extraCycles.push({
    id: "manual-cycle",
    company: company.slug,
    productId: g4OsPlan.productId,
    taskIds: ["manual-work"],
    status: "em-curso",
    milestone: 9,
  });
  const next = provisionPlan(s, g4OsPlan, company, at);
  assert.equal(next.extraTasks.length, 37);
  assert.deepEqual(
    next.extraCycles
      .filter((c) => c.taskIds.includes("manual-work"))
      .map((c) => c.id),
    ["manual-cycle"],
  );
  assert.equal(next.taskPatches["manual-work"].milestone, 1);
  assert.equal(next.taskPatches["manual-work"].journeyId, g4OsPlan.id);
  assert.deepEqual(provisionPlan(next, g4OsPlan, company, at), next);
});

test("plan date edits are bounded to 2000–2100 only for values that change", () => {
  const state = { ...empty(), extraCycles: [{ id: "c", company: "x", startsAt: "0002-01-01", endsAt: "2026-01-31", taskIds: [] }] };
  assert.throws(() => updatePlanDates(state, "x", [{ id: "c", startsAt: "0002-01-01", endsAt: "0003-01-31" }], []), /entre 2000 e 2100/);
  assert.equal(updatePlanDates(state, "x", [{ id: "c", startsAt: "0002-01-01", endsAt: "2026-02-28" }], []).extraCycles[0].endsAt, "2026-02-28");
});

test('provisioning a plan never restores or relinks a removed model task', async () => {
  const { removeDeliveryTask } = await import('../src/modules/delivery/application/task-removal.ts');
  const initial = provisionPlan(empty(), g4OsPlan, company, at);
  const removedTask = initial.extraTasks[0];
  removedTask.comments = [{ id: 'note', text: 'Manter no histórico', by: 'lead', at }];
  const removed = removeDeliveryTask(initial, removedTask, initial.extraTasks, initial.extraCycles, 'lead', at);
  const repeated = provisionPlan(removed, g4OsPlan, company, at);
  assert.equal(repeated.extraTasks.length, initial.extraTasks.length);
  assert.ok(repeated.extraCycles.every(cycle => !cycle.taskIds.includes(removedTask.id)));
  assert.equal(repeated.taskPatches[removedTask.id].removed, true);
  assert.equal(repeated.taskPatches[removedTask.id].comments[0].text, 'Manter no histórico');
  const withoutStoredCopy = { ...empty(), taskPatches: removed.taskPatches };
  const firstAssignment = provisionPlan(withoutStoredCopy, g4OsPlan, company, at);
  assert.ok(!firstAssignment.extraTasks.some(task => task.id === removedTask.id));
  assert.ok(firstAssignment.extraCycles.every(cycle => !cycle.taskIds.includes(removedTask.id)));
});
