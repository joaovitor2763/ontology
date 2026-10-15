import test from "node:test";
import assert from "node:assert/strict";
import {
  deadlineGraphError,
  resolveTaskDeadlines,
} from "../src/modules/catalog/domain/task-deadlines.ts";
import {
  instantiateDeliveries,
  templateError,
} from "../src/modules/catalog/domain/products.ts";
import { resolveExecutionDeadlines, scheduledExecution } from "../src/modules/delivery/application/task-deadlines.ts";
import { migrateTaskDeadlines } from "../src/shared/infrastructure/migration.ts";
const t = (id, deadline, company = "client") => ({
  id,
  company,
  title: id,
  dueAt: "2026-09-20",
  status: "fila",
  deadline,
});
const chain = () => [
  t("a", { mode: "cycle", offsetDays: 2 }),
  t("b", { mode: "task", taskId: "a", offsetDays: 3 }),
  t("c", { mode: "task", taskId: "b", offsetDays: -1 }),
  t("client", { mode: "client", offsetDays: 10 }),
];
const context = () =>
  Object.fromEntries(
    chain().map((t) => [
      t.id,
      { cycleStart: "2026-10-01", clientStart: "2026-09-01" },
    ]),
  );
test("dates resolve in dependency order, with signed offsets and independent client/cycle anchors", () => {
  assert.deepEqual(resolveTaskDeadlines(chain().reverse(), context()), {
    a: "2026-10-03",
    b: "2026-10-06",
    c: "2026-10-05",
    client: "2026-09-11",
  });
  const ctx = context();
  ctx.a.cycleStart = "2026-10-10";
  const dates = resolveTaskDeadlines(chain(), ctx);
  assert.equal(dates.c, "2026-10-14");
  assert.equal(dates.client, "2026-09-11");
});
test("self references, indirect cycles, missing and cross-client dependencies are rejected", () => {
  assert.match(
    deadlineGraphError([t("a", { mode: "task", taskId: "a", offsetDays: 0 })]),
    /ciclo/,
  );
  assert.match(
    deadlineGraphError([
      t("a", { mode: "task", taskId: "b", offsetDays: 0 }),
      t("b", { mode: "task", taskId: "a", offsetDays: 0 }),
    ]),
    /ciclo/,
  );
  assert.match(
    deadlineGraphError([
      t("a", { mode: "task", taskId: "missing", offsetDays: 0 }),
    ]),
    /referência/,
  );
  assert.match(
    deadlineGraphError([
      t("a", { mode: "task", taskId: "b", offsetDays: 0 }),
      t("b", undefined, "other"),
    ]),
    /mesmo cliente/,
  );
  assert.match(
    deadlineGraphError([t("a", { mode: "cycle", offsetDays: 0.5 })]),
    /inteiro/,
  );
});
test("missing anchors and invalid dates never silently fall back to another date", () => {
  assert.throws(
    () => resolveTaskDeadlines([t("a", { mode: "client", offsetDays: 0 })], {}),
    /início do cliente/,
  );
  assert.throws(
    () =>
      resolveTaskDeadlines([t("a", { mode: "cycle", offsetDays: 0 })], {
        a: { cycleStart: "2026-02-30" },
      }),
    /início do ciclo/,
  );
});
test("completed tasks freeze dates and later dependencies use that preserved deadline", () => {
  const tasks = chain();
  tasks[1].frozen = true;
  const dates = resolveTaskDeadlines(tasks, context());
  assert.equal(dates.b, "2026-09-20");
  assert.equal(dates.c, "2026-09-19");
});
test("template references are remapped to unique execution ids when instantiated", () => {
  const rows = [
    {
      id: "a",
      title: "A",
      description: "",
      day: 1,
      hours: 1,
      deadline: { mode: "client", offsetDays: 2 },
    },
    {
      id: "b",
      title: "B",
      description: "",
      day: 2,
      hours: 1,
      deadline: { mode: "task", taskId: "a", offsetDays: 3 },
    },
  ];
  const tasks = instantiateDeliveries(rows, {
    cycleId: "cycle",
    company: "client",
    productId: "p",
    templateId: "t",
    startsAt: "2026-09-01",
    clientStartsAt: "2026-09-01",
    ownerId: "u",
  });
  assert.equal(tasks[0].dueAt, "2026-09-03");
  assert.equal(tasks[1].dueAt, "2026-09-06");
  assert.equal(tasks[1].deadline.taskId, "cycle-a");
  rows[0].deadline = { mode: "task", taskId: "b", offsetDays: 0 };
  assert.match(
    templateError({
      name: "T",
      goal: "G",
      durationDays: 10,
      deliveries: rows,
      acceptance: ["ok"],
    }),
    /ciclo/,
  );
});
test("projection recalculates open work without mutating records, preserving closed cycles", () => {
  const tasks = chain();
  const state = {
    extraTasks: tasks,
    extraCycles: [],
    cycleEdits: {},
    taskPatches: {},
    statusMap: {},
  };
  const cycles = [
    {
      id: "cy",
      company: "client",
      startsAt: "2026-10-01",
      status: "planejado",
      taskIds: ["a", "b", "c"],
    },
  ];
  const next = scheduledExecution(state, tasks, cycles, {
    client: "2026-09-01",
  });
  assert.equal(next.taskPatches.c.dueAt, "2026-10-05");
  assert.deepEqual(state.taskPatches, {});
  cycles[0].status = "concluido";
  const closed = scheduledExecution(state, tasks, cycles, {
    client: "2026-09-01",
  });
  assert.equal(closed.taskPatches.a, undefined);
  assert.equal(closed.taskPatches.b, undefined);
});
test("migration keeps old absolute dates, metadata and explicit rules and is idempotent", () => {
  const old = {
    extraTasks: [t("a"), t("b", { mode: "client", offsetDays: 1 })],
    untouched: 42,
  };
  const migrated = migrateTaskDeadlines(old);
  assert.deepEqual(migrated.extraTasks[0].deadline, { mode: "fixed" });
  assert.equal(migrated.extraTasks[0].dueAt, "2026-09-20");
  assert.equal(migrated.extraTasks[1].deadline.mode, "client");
  assert.deepEqual(migrateTaskDeadlines(migrated), migrated);
});
test('version rollout remaps new dependent tasks and adopts rules from fixed legacy tasks', async () => {
  const { prepareProduct } = await import('../src/modules/delivery/application/product-execution.ts');
  const { previewProduct } = await import('../src/modules/delivery/application/product-rollout.ts');
  const base={id:'p',version:1,name:'P',description:'',cycles:[{id:'t',name:'T',goal:'G',durationDays:20,acceptance:['ok'],deliveries:[{id:'a',title:'A',description:'',day:1,hours:1}]}]};
  const draft=prepareProduct(base,{slug:'client',startedAt:'2027-01-01',leadId:'u'},'now');draft.tasks[0].deadline={mode:'fixed'};
  const next=structuredClone(base);next.version=2;next.cycles[0].deliveries[0].deadline={mode:'client',offsetDays:2};next.cycles[0].deliveries.push({id:'b',title:'B',description:'',day:5,hours:1,deadline:{mode:'task',taskId:'a',offsetDays:2}});
  const impact=previewProduct(next,[],draft.cycles,draft.tasks,'2026-12-01',{client:'2027-01-01'})[0];
  assert.equal(impact.blocked,undefined);assert.equal(impact.tasks[0].deadline.mode,'client');assert.equal(impact.added[0].deadline.taskId,draft.tasks[0].id);
  const result=resolveTaskDeadlines([...impact.tasks,...impact.added],{[draft.tasks[0].id]:{clientStart:'2027-01-01'}});assert.equal(result[impact.added[0].id],'2027-01-05');
});
test('removing a predecessor is refused and fixed dates can explicitly detach from the chain',()=>{
 const tasks=chain().filter(t=>t.id!=='a');assert.throws(()=>resolveTaskDeadlines(tasks,context()),/referência/);
 tasks.find(t=>t.id==='b').deadline={mode:'fixed'};assert.equal(resolveTaskDeadlines(tasks,context()).c,'2026-09-19');
});

test("editor preview uses the purchase anchor and preserves dates from completed cycles", async () => {
  const { recordHistory } = await import("../src/modules/delivery/domain/history.ts");
  const original = { ...t("renewal", { mode: "client", offsetDays: 5 }), enrollmentId: "purchase-2", status: "fila", dueAt: "2026-10-06" };
  const edited = { ...original, title: "Only title changed" };
  const context = { client: "2026-01-01" }, purchases = { "purchase-2": "2026-10-01" };
  const due = resolveExecutionDeadlines([edited], [], context, purchases);
  assert.equal(due.renewal, original.dueAt);
  assert.deepEqual(recordHistory(original, { title: edited.title, dueAt: due.renewal }, "actor", "now"), []);
  const closed = { id: "cycle", company: "client", status: "concluido", taskIds: [original.id], startsAt: "2026-10-01" };
  assert.equal(resolveExecutionDeadlines([edited], [closed], context, { "purchase-2": "2027-01-01" }).renewal, original.dueAt);
  assert.equal(resolveExecutionDeadlines([edited], [{ ...closed, company: "other" }], context, { "purchase-2": "2027-01-01" }).renewal, "2027-01-06");
  const completed = { ...edited, status: "entregue" };
  assert.equal(resolveExecutionDeadlines([completed], [], context, { "purchase-2": "2027-01-01" }).renewal, original.dueAt);
  assert.throws(() => resolveExecutionDeadlines([edited], [], context), /início/);
});

test("a recalculated deadline before the planned start carries the start with it", () => {
  const tasks = [{ ...t("early", { mode: "client", offsetDays: 5 }), startsAt: "2026-02-01", dueAt: "2026-03-01" }, { ...t("later", { mode: "client", offsetDays: 60 }), startsAt: "2026-01-10" }];
  const next = scheduledExecution({ taskPatches: {} }, tasks, [], { client: "2026-01-01" });
  assert.deepEqual(next.taskPatches.early, { dueAt: "2026-01-06", startsAt: "2026-01-06" });
  assert.deepEqual(next.taskPatches.later, { dueAt: "2026-03-02" });
});

test("recalculation carries an invalid legacy start and never fills an empty fixed deadline", () => {
  const state = { taskPatches: {} };
  const tasks = [
    { ...t("base", { mode: "fixed" }), dueAt: "2026-10-01" },
    { ...t("legacy", { mode: "task", taskId: "base", offsetDays: 2 }), startsAt: "0002-01-01" },
    { ...t("backlog", { mode: "fixed" }), dueAt: "" },
  ];
  const next = scheduledExecution(state, tasks, [], { client: "2026-09-01" });
  assert.deepEqual(next.taskPatches.legacy, { dueAt: "2026-10-03", startsAt: "2026-10-03" });
  assert.equal(next.taskPatches.backlog, undefined);
});
test("lazy start migration leaves a Backlog task without deadline untouched", async () => {
  const { migrateDeliveryDates } = await import("../src/shared/infrastructure/migration.ts");
  const state = { extraTasks: [{ id: "backlog", dueAt: "" }], extraCycles: [{ taskIds: ["backlog"], startsAt: "2026-09-01" }], taskPatches: {} };
  assert.equal(migrateDeliveryDates(state), state);
});
