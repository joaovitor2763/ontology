import test from "node:test";
import assert from "node:assert/strict";
import {
  isBlocked,
  journeyDate,
  milestoneAdvance,
  milestoneProgress,
} from "../src/modules/catalog/domain/journey-progress.ts";

const journey = {
  id: "custom",
  name: "Ciclo",
  description: "",
  milestones: [
    { n: 2, name: "Descoberta", stage: "Entrada", owner: "CS" },
    { n: 5, name: "Piloto", stage: "Execução", owner: "AI Master" },
    { n: 9, name: "Entrega", stage: "Conclusão", owner: "AI Master" },
  ],
};
const task = (id, milestone, status, extra = {}) => ({
  id,
  company: "client",
  title: id,
  description: "",
  milestone,
  status,
  dueAt: "2026-09-20",
  ownerId: "owner",
  hours: 2,
  completion: "checklist",
  kind: "journey",
  workstream: "",
  ...extra,
});

test("progress prioritizes active blockers, overdue tasks and reviews without mutating task data", () => {
  const tasks = [
    task("done", 5, "entregue", { blockers: "Historical blocker" }),
    task("review", 5, "revisao"),
    task("late", 5, "fila", { dueAt: "2026-09-11" }),
    task("blocked", 5, "em-curso", { blockers: "Needs access" }),
    task("other", 9, "fila"),
    task("request", 5, "fila", { kind: "request" }),
  ];
  const original = structuredClone(tasks);
  const summary = milestoneProgress(tasks, 5, "2026-09-13");
  assert.deepEqual(
    summary.ordered.map((task) => task.id),
    ["blocked", "late", "review", "done"],
  );
  assert.equal(summary.percent, 25);
  assert.equal(summary.remainingHours, 6);
  assert.equal(summary.overdue.length, 1);
  assert.equal(summary.blocked.length, 1);
  assert.equal(isBlocked(tasks[0]), false);
  assert.deepEqual(tasks, original);
});

test("advancement waits for current and reopened earlier tasks; future tasks do not block it", () => {
  const tasks = [
    task("earlier", 2, "fila"),
    task("now", 5, "entregue"),
    task("future", 9, "fila"),
  ];
  const result = milestoneAdvance(journey, tasks, 5, 5);
  assert.equal(result.ready, false);
  assert.deepEqual(
    result.pending.map((task) => task.id),
    ["earlier"],
  );
  assert.equal(result.next.n, 9);
  assert.equal(
    milestoneAdvance(
      journey,
      tasks.map((task) => ({
        ...task,
        status: task.id === "earlier" ? "entregue" : task.status,
      })),
      5,
      5,
    ).ready,
    true,
  );
  assert.equal(tasks[0].status, "fila");
});

test("empty, unknown and non-current milestones cannot advance", () => {
  assert.equal(milestoneAdvance(journey, [], 5, 5).ready, false);
  assert.equal(
    milestoneAdvance(journey, [task("future", 9, "entregue")], 9, 5).ready,
    false,
  );
  assert.equal(
    milestoneAdvance(journey, [task("unknown", 6, "entregue")], 6, 6).ready,
    false,
  );
  assert.equal(milestoneProgress([], 5, "2026-09-13").complete, false);
});

test("last milestone completes without inventing a next milestone", () => {
  const tasks = journey.milestones.map((milestone) =>
    task(String(milestone.n), milestone.n, "entregue"),
  );
  const result = milestoneAdvance(journey, tasks, 9, 9);
  assert.equal(result.ready, true);
  assert.equal(result.next, undefined);
  assert.equal(milestoneProgress(tasks, 9, "2026-09-13").percent, 100);
});

test("calendar dates retain their day independent of timezone", () => {
  assert.match(journeyDate("2026-09-18"), /^18/);
  assert.equal(journeyDate(""), "Sem prazo");
});
