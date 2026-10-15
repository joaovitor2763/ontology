import { selectDeliveries } from "../src/modules/delivery/application/deliveries.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mergeLegacy } from "../src/shared/infrastructure/migration.ts";
import { normalizeDeliverySnapshot } from "../src/modules/delivery/infrastructure/snapshot.ts";
import { HISTORY_LIMIT, historyCount } from "../src/modules/delivery/domain/history.ts";
import { saveCycleAggregate } from "../src/modules/delivery/application/cycles.ts";
import { changedScheduleError, deliveryPatchError, directDueDatePatch, directStartDatePatch, validTaskDate } from "../src/modules/delivery/domain/delivery-policy.ts";
import { applyTaskOverride } from "../src/modules/delivery/domain/task-overrides.ts";
import { projectDelivery } from "../src/modules/delivery/infrastructure/snapshot.ts";
import { attachDocument } from "../src/modules/documents/application/attachments.ts";
import { agendaEntries } from "../src/modules/engagement/application/agenda.ts";
const initial = () => ({
  cycleEdits: {},
  extraCycles: [],
  extraTasks: [],
  taskPatches: {},
  statusMap: {},
  companyJourney: {},
});
const task = {
  id: "task-a",
  company: "client-a",
  productId: "product-a",
  title: "Entrega",
  description: "",
  status: "fila",
  ownerId: "member-a",
  dueAt: "2026-09-20",
  hours: 3,
  workstream: "Serviço",
  milestone: 0,
  completion: "deliverable",
};
const cycle = {
  id: "cycle-a",
  company: "client-a",
  productId: "product-a",
  name: "Piloto",
  goal: "Validar resultado",
  startsAt: "2026-09-12",
  endsAt: "2026-09-20",
  ownerId: "member-a",
  status: "em-curso",
  taskIds: [task.id],
  acceptance: [{ id: "accept-a", text: "Resultado validado", done: false }],
};
const reference = { cycles: [], deliveries: [] };
test("bringing a deadline forward adjusts the planned start in the same patch", () => {
  const earlier = directDueDatePatch({ startsAt: "2026-11-10" }, "2026-09-28");
  assert.deepEqual(earlier, { dueAt: "2026-09-28", startsAt: "2026-09-28" });
  assert.equal(deliveryPatchError(earlier, undefined, { current: { startsAt: "2026-11-10", dueAt: "2026-11-20" } }), null);
  assert.deepEqual(directDueDatePatch({ startsAt: "2026-09-01" }, "2026-09-28"),
    { dueAt: "2026-09-28" });
});
test("a start after the deadline carries the deadline; a typed date on a relative rule turns it fixed", () => {
  assert.deepEqual(directStartDatePatch({ dueAt: "2026-09-28" }, "2026-10-05"), { startsAt: "2026-10-05", dueAt: "2026-10-05" });
  assert.deepEqual(directStartDatePatch({ dueAt: "2026-09-28" }, "2026-09-01"), { startsAt: "2026-09-01" });
  assert.deepEqual(directStartDatePatch({ dueAt: "2026-09-28" }, undefined), { startsAt: undefined });
  assert.deepEqual(directStartDatePatch({ dueAt: "2026-09-28", deadline: { mode: "cycle", offsetDays: 3 } }, "2026-10-05"),
    { startsAt: "2026-10-05", dueAt: "2026-10-05", deadline: { mode: "fixed" } });
  assert.deepEqual(directDueDatePatch({ startsAt: "2026-11-10", deadline: { mode: "client", offsetDays: 300 } }, "2026-09-28"),
    { dueAt: "2026-09-28", startsAt: "2026-09-28", deadline: { mode: "fixed" } });
});
test("a deadline edit also replaces an invalid stored start", () => {
  assert.deepEqual(directDueDatePatch({ startsAt: "0002-03-04" }, "2026-10-01"), { dueAt: "2026-10-01", startsAt: "2026-10-01" });
  assert.deepEqual(directStartDatePatch({ dueAt: "0002-03-04" }, "2026-10-01"), { startsAt: "2026-10-01", dueAt: "2026-10-01" });
  assert.equal(deliveryPatchError({ status: "em-curso" }, undefined, { current: { startsAt: "0002-03-04", dueAt: "0002-03-04" } }), null);
});
test("task dates must be complete calendar dates between 2000 and 2100", () => {
  for (const bad of ["0002-09-28", "1999-12-31", "2101-01-01", "2026-02-30", "2026-9-28", ""]) assert.equal(validTaskDate(bad), false, bad);
  assert.equal(validTaskDate("2026-09-28"), true);
  assert.equal(deliveryPatchError({ dueAt: "0002-09-28" }), "Informe um prazo válido.");
  assert.equal(deliveryPatchError({ startsAt: "0020-01-01" }, undefined, { current: { dueAt: "2026-09-28" } }), "Informe uma data de início válida.");
});
test("stored starts after the deadline are repaired on read without changing the document shape", () => {
  assert.equal(applyTaskOverride({ id: "x", startsAt: "2026-11-10", dueAt: "2026-09-28" }).startsAt, "2026-09-28");
  assert.equal(applyTaskOverride({ id: "x", startsAt: "2026-09-01" }, { dueAt: "2026-08-20" }).startsAt, "2026-08-20");
  assert.equal(applyTaskOverride({ id: "x", startsAt: "2026-09-01", dueAt: "2026-09-28" }).startsAt, "2026-09-01");
  assert.equal(applyTaskOverride({ id: "x", startsAt: "2026-09-01", dueAt: "" }).startsAt, "2026-09-01");
  const raw = { extraTasks: [{ id: "legacy", company: "legacy-client", title: "Legada", status: "fila", ownerId: "a", startsAt: "2026-11-10", dueAt: "2026-09-28", hours: 0, workstream: "", milestone: 1, completion: "checklist", description: "" }] };
  assert.equal(projectDelivery(raw).tasks.find(t => t.id === "legacy").startsAt, "2026-09-28");
  assert.equal(normalizeDeliverySnapshot(raw).extraTasks[0].startsAt, "2026-11-10", "the stored record is untouched");
});
test("only tasks whose interval changed are checked after a command", () => {
  const broken = { id: "old", startsAt: "2026-11-10", dueAt: "2026-09-28" };
  assert.equal(changedScheduleError([broken, { id: "a", dueAt: "2026-09-01" }], [broken, { id: "a", dueAt: "2026-09-10" }]), null);
  assert.match(changedScheduleError([{ id: "a", dueAt: "2026-09-10" }], [{ id: "a", startsAt: "2026-09-20", dueAt: "2026-09-10" }]), /posterior/);
  assert.match(changedScheduleError([], [broken]), /posterior/, "a new task is always checked");
});
test("legacy migration preserves owned edits from both old stores without mutating the originals", () => {
  const praxis = {
    extraTasks: [task],
    statusMap: { "task-a": "revisao" },
    notes: { a: "Ata original" },
  };
  const services = {
    extraCycles: [cycle],
    configs: { "client-a": { name: "Contrato" } },
  };
  const before = structuredClone([praxis, services]);
  const migrated = mergeLegacy(initial(), [praxis, services]);
  assert.deepEqual(migrated.extraTasks, [task]);
  assert.deepEqual(migrated.extraCycles, [cycle]);
  assert.equal(migrated.statusMap[task.id], "revisao");
  assert.equal("notes" in migrated, false);
  assert.equal("configs" in migrated, false);
  assert.deepEqual([praxis, services], before);
  assert.deepEqual(mergeLegacy(initial(), [migrated]), migrated);
  assert.deepEqual(
    mergeLegacy(initial(), [
      null,
      [],
      { extraTasks: "invalid", statusMap: [] },
    ]),
    initial(),
  );
});
test("cycle creation produces one immutable aggregate snapshot containing delivery copies", () => {
  const before = initial();
  const result = saveCycleAggregate(before, cycle, [task], reference);
  assert.deepEqual(before, initial());
  assert.deepEqual(result.extraCycles, [cycle]);
  assert.deepEqual(result.extraTasks, [task]);
  assert.throws(() =>
    saveCycleAggregate(
      before,
      { ...cycle, endsAt: "2026-01-01" },
      [task],
      reference,
    ),
  );
  assert.deepEqual(before, initial());
});
test("delivery ownership prevents linking a second cycle, crossing clients or mixing products", () => {
  const state = saveCycleAggregate(initial(), cycle, [task], reference);
  assert.throws(
    () => saveCycleAggregate(state, { ...cycle, id: "cycle-b" }, [], reference),
    /outro ciclo/,
  );
  assert.throws(
    () =>
      saveCycleAggregate(
        initial(),
        { ...cycle, company: "client-b" },
        [task],
        reference,
      ),
    /desta conta/,
  );
  assert.throws(
    () =>
      saveCycleAggregate(
        initial(),
        { ...cycle, productId: "product-b" },
        [task],
        reference,
      ),
    /mesmo produto/,
  );
  assert.deepEqual(state.extraCycles, [cycle]);
});
test("completion requires current delivery status and acceptance; concluded work must be explicitly reopened", () => {
  const state = saveCycleAggregate(initial(), cycle, [task], reference);
  const completed = {
    ...cycle,
    status: "concluido",
    acceptance: [
      { ...cycle.acceptance[0], done: true, approvedBy: "sponsor-a" },
    ],
  };
  assert.throws(
    () => saveCycleAggregate(state, completed, [], reference),
    /Conclua/,
  );
  const next = saveCycleAggregate(
    { ...state, statusMap: { [task.id]: "entregue" } },
    completed,
    [],
    reference,
  );
  assert.equal(next.extraCycles[0].status, "concluido");
  assert.match(deliveryPatchError({ status: "fila" }, completed), /Reabra/);
  assert.equal(deliveryPatchError({ status: "entregue" }, completed), null);
  for (const patch of [
    { title: " " },
    { hours: -1 },
    { hours: NaN },
    { dueAt: "2026-02-30" },
  ])
    assert.ok(deliveryPatchError(patch));
});
test("metadata is never registered after a failed attachment write", async () => {
  const records = [];
  const bytes = new Blob(["original content"]);
  const failing = {
    put: async () => {
      throw Error("quota");
    },
    get: async () => undefined,
    remove: async () => {},
  };
  await assert.rejects(
    () =>
      attachDocument(failing, { id: "doc-a" }, bytes, (d) => records.push(d)),
    /quota/,
  );
  assert.deepEqual(records, []);
  const content = new Map();
  const repo = {
    ...failing,
    put: async (id, blob) => content.set(id, blob),
    get: async (id) => content.get(id),
  };
  await attachDocument(repo, { id: "doc-a" }, bytes, (d) => records.push(d));
  assert.deepEqual(records, [{ id: "doc-a" }]);
  assert.equal(await (await repo.get("doc-a")).text(), "original content");
});
test("agenda combines meetings and events with distinct identities and chronological order", () => {
  const events = [
    {
      id: "same-id",
      company: "a",
      title: "Workshop",
      kind: "Workshop",
      startsAt: "2026-09-20T14:00:00",
      place: "Sala",
      detail: "",
    },
  ];
  const meetings = [
    {
      id: "same-id",
      company: "a",
      title: "Reunião",
      startsAt: "2026-09-18T10:00:00",
      durationMin: 30,
      attendeeIds: ["a"],
      summary: "Decisão",
      notes: "",
    },
  ];
  const result = agendaEntries(events, meetings);
  assert.equal(result.length, 2);
  assert.equal(result[0].meetingId, "same-id");
  assert.notEqual(result[0].id, result[1].id);
  assert.equal(events[0].id, "same-id");
});

test("portfolio and client delivery projections partition the same records and preserve edits", () => {
  const records = [task, { ...task, id: "task-b", company: "client-b" }, task];
  const status = { "task-a": "revisao" };
  const patches = { "task-b": { hours: 8, title: "Atualizada" } };
  const all = selectDeliveries(records, undefined, status, patches);
  const scoped = [
    ...selectDeliveries(records, "client-a", status, patches),
    ...selectDeliveries(records, "client-b", status, patches),
  ];
  assert.deepEqual(scoped, all);
  assert.equal(all.length, 2);
  assert.equal(all[0].status, "revisao");
  assert.equal(all[1].hours, 8);
  assert.equal(records[1].hours, 3);
});

test("planned start dates reject blanks and inverted ranges", () => {
  assert.match(deliveryPatchError({startsAt: ""}), /início válida/);
  assert.match(deliveryPatchError({startsAt: "2026-09-20"}, undefined, {current:{dueAt:"2026-09-19"}}), /posterior/);
  assert.equal(deliveryPatchError({startsAt:"2026-09-18"}, undefined, {current:{dueAt:"2026-09-19"}}), null);
});

test("task history keeps the recent changes whole and condenses the older ones into a counted line", () => {
  const entries = (n, from = 0) =>
    Array.from({ length: n }, (_, i) => ({
      at: `2026-01-${String(from + i + 1).padStart(2, "0")}T10:00:00.000Z`,
      by: "member-a",
      field: "status",
      from: "fila",
      to: "em-curso",
    }));
  const state = normalizeDeliverySnapshot({
    extraTasks: [{ ...task, id: "task-h", dueAt: "2026-02-01", history: entries(60) }],
    taskPatches: { "task-b": { history: entries(41) } },
  });
  const kept = state.extraTasks[0].history;
  assert.equal(kept.length, HISTORY_LIMIT + 1);
  assert.equal(kept[0].field, "resumo");
  assert.equal(kept[0].count, 20);
  // O total de alterações continua o mesmo, e as recentes continuam inteiras.
  assert.equal(historyCount(kept), 60);
  assert.deepEqual(kept.slice(1), entries(60).slice(20));
  // Um resumo anterior não é recontado como uma alteração só.
  const again = normalizeDeliverySnapshot({ extraTasks: [{ ...task, id: "task-h", dueAt: "2026-02-01", history: [...kept, ...entries(10, 60)] }] });
  assert.equal(historyCount(again.extraTasks[0].history), 70);
  assert.equal(again.extraTasks[0].history[0].count, 30);
  // Abaixo do limite nada muda: nenhuma linha some e nenhum resumo aparece.
  assert.equal(state.taskPatches["task-b"].history.length, HISTORY_LIMIT + 1);
  const small = entries(5);
  assert.deepEqual(
    normalizeDeliverySnapshot({ taskPatches: { "task-c": { history: small } } }).taskPatches["task-c"].history,
    small,
  );
});

test("legacy task completion dates migrate from platform history without undoing an explicit clear", () => {
  const completion = { at: "2026-09-20T02:30:00.000Z", by: "member-a", field: "status", from: "revisao", to: "entregue" };
  const state = normalizeDeliverySnapshot({
    extraTasks: [{ ...task, id: "legacy-complete", status: "entregue", history: [completion] }],
    taskPatches: {
      "seed-complete": { status: "entregue", history: [completion] },
      "reopened": { status: "entregue", history: [completion], completedAt: undefined, clearedFields: ["completedAt"] },
    },
  });
  assert.equal(state.extraTasks[0].completedAt, "2026-09-19");
  assert.equal(state.taskPatches["seed-complete"].completedAt, "2026-09-19");
  assert.equal(state.taskPatches.reopened.completedAt, undefined);
  assert.deepEqual(normalizeDeliverySnapshot(structuredClone(state)), state);
});
