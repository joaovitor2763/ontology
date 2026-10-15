import test from "node:test";
import assert from "node:assert/strict";
import { versionProduct } from "../src/modules/catalog/domain/product-versions.ts";
import { migrateProductVersions } from "../src/shared/infrastructure/migration.ts";
import {
  prepareProduct,
  applyProduct,
} from "../src/modules/delivery/application/product-execution.ts";
import {
  previewProduct,
  applyProductImpact,
  rolloutFingerprint,
} from "../src/modules/delivery/application/product-rollout.ts";
const product = {
  id: "p",
  name: "P",
  description: "",
  cycles: [
    {
      id: "c",
      name: "Ciclo",
      goal: "Resultado",
      durationDays: 10,
      acceptance: ["Aceite"],
      deliveries: [
        {
          id: "a",
          title: "Entrega",
          description: "Antes",
          day: 5,
          hours: 2,
          completion: "checklist",
          checklistItems: ["Item"],
        },
      ],
    },
  ],
};
function setup() {
  const draft = prepareProduct(
    product,
    { slug: "client", startedAt: "2027-01-01", leadId: "lead" },
    "now",
  );
  const state = applyProduct(
    {
      cycleEdits: {},
      extraCycles: [],
      extraTasks: [],
      taskPatches: {},
      statusMap: {},
      companyJourney: {},
      companyMilestone: {},
    },
    draft,
  );
  const updated = structuredClone(product);
  updated.cycles[0].deliveries[0].description = "Depois";
  updated.cycles[0].deliveries[0].day = 7;
  updated.cycles[0].deliveries[0].checklistItems.push("Novo");
  const v = versionProduct(product, updated, [], "admin", "now");
  return { state, draft, v };
}
const preview = ({ state, v }) =>
  previewProduct(
    v.product,
    v.versions,
    state.extraCycles,
    state.extraTasks,
    "2026-12-01",
  );
test("product saves immutable ordered snapshots without changing execution", () => {
  const { state, v } = setup();
  assert.equal(v.product.version, 2);
  assert.equal(v.versions[0].version, 1);
  v.product.cycles[0].name = "Mutated";
  assert.equal(v.versions[1].snapshot.cycles[0].name, "Ciclo");
  assert.equal(state.extraCycles[0].productVersion, 1);
  assert.equal(state.extraTasks[0].description, "Antes");
  const next = versionProduct(
    v.product,
    { ...v.product, name: "New" },
    v.versions,
    "b",
    "later",
  );
  assert.equal(next.product.version, 3);
  assert.equal(v.versions.length, 2);
});
test("migration adds empty product history without touching legacy data and is idempotent", () => {
  const old = { extraProducts: [product], custom: 42 };
  const next = migrateProductVersions(old);
  assert.deepEqual(next.productVersions, {});
  assert.deepEqual(next.extraProducts, old.extraProducts);
  assert.deepEqual(migrateProductVersions(next), next);
});
test("preview shows dates and checklist then applies selected cycle atomically with provenance", () => {
  const x = setup();
  const impacts = preview(x);
  assert.match(impacts[0].changes.join(" "), /2027-01-05 → 2027-01-07/);
  const next = applyProductImpact(
    x.state,
    impacts,
    x.state.extraCycles,
    x.state.extraTasks,
    rolloutFingerprint(x.state.extraCycles, x.state.extraTasks),
    "admin",
    "now",
  );
  const patch = next.taskPatches[x.state.extraTasks[0].id];
  assert.equal(patch.description, "Depois");
  assert.equal(patch.checklist.length, 2);
  assert.equal(next.extraCycles[0].productVersion, 2);
  assert.equal(next.extraCycles[0].productUpdates[0].by, "admin");
  assert.equal(x.state.extraCycles[0].productVersion, 1);
});
test("client custom fields and checklist survive template update", () => {
  const x = setup();
  x.state.extraTasks[0].description = "Custom";
  x.state.extraTasks[0].dueAt = "2027-01-08";
  x.state.extraTasks[0].checklist.push({
    id: "custom",
    title: "Custom",
    done: false,
  });
  const i = preview(x)[0];
  assert.equal(i.tasks[0].description, "Custom");
  assert.equal(i.tasks[0].dueAt, "2027-01-08");
  assert.equal(i.tasks[0].checklist[1].title, "Custom");
  assert.equal(i.preserved.length, 3);
});
test("closed cycles, started cycles and any recorded work remain entirely untouched", () => {
  for (const edit of [
    (x) => (x.state.extraCycles[0].status = "concluido"),
    (x) => (x.state.extraCycles[0].status = "em-curso"),
    (x) => (x.state.extraTasks[0].status = "entregue"),
    (x) => (x.state.extraTasks[0].checklist[0].done = true),
    (x) => (x.state.extraTasks[0].comments = [{ id: "comment", text: "hi" }]),
    (x) => (x.state.extraCycles[0].acceptance[0].done = true),
  ]) {
    const x = setup();
    edit(x);
    const i = preview(x)[0];
    assert.ok(i.blocked);
    assert.deepEqual(i.next, i.cycle);
    assert.equal(i.tasks.length, 0);
  }
});
test("stale preview cannot overwrite a changed deadline or a newly completed delivery", () => {
  const x = setup(),
    i = preview(x),
    fingerprint = rolloutFingerprint(x.state.extraCycles, x.state.extraTasks);
  x.state.extraTasks[0].status = "entregue";
  assert.throws(
    () =>
      applyProductImpact(
        x.state,
        i,
        x.state.extraCycles,
        x.state.extraTasks,
        fingerprint,
        "a",
        "now",
      ),
    /nova prévia/,
  );
});
test("new deliveries are added once and removed templates preserve client work", () => {
  const x = setup();
  x.v.product.cycles[0].deliveries.push({
    id: "b",
    title: "New",
    description: "",
    day: 9,
    hours: 1,
  });
  let i = preview(x)[0];
  assert.equal(i.added.length, 1);
  const next = applyProductImpact(
    x.state,
    [i],
    x.state.extraCycles,
    x.state.extraTasks,
    rolloutFingerprint(x.state.extraCycles, x.state.extraTasks),
    "a",
    "now",
  );
  assert.equal(
    previewProduct(
      x.v.product,
      x.v.versions,
      next.extraCycles,
      next.extraTasks,
      "2026-12-01",
    )[0].added.length,
    0,
  );
  x.v.product.cycles[0].deliveries = [];
  i = preview(x)[0];
  assert.equal(i.next.taskIds.length, 1);
  assert.match(i.preserved.join(""), /mantida no cliente/);
});
test("duration overlaps and shortened cycles with preserved deadlines are blocked", () => {
  const x = setup();
  x.v.product.cycles[0].durationDays = 12;
  x.state.extraCycles.push({
    ...x.state.extraCycles[0],
    id: "later",
    startsAt: "2027-01-11",
    endsAt: "2027-01-20",
    templateId: "other",
    taskIds: [],
  });
  assert.match(preview(x)[0].blocked, /sobrepõe/);
  x.v.product.cycles[0].durationDays = 3;
  assert.match(preview(x)[0].blocked, /não cabem/);
});
test("unknown legacy origins are not guessed and calendar-month duration overrides survive", () => {
  const x = setup();
  delete x.state.extraCycles[0].productBaseline;
  delete x.state.extraCycles[0].productVersion;
  assert.ok(
    previewProduct(
      x.v.product,
      [],
      x.state.extraCycles,
      x.state.extraTasks,
      "2026-12-01",
    )[0].blocked,
  );
  x.state.extraCycles[0].productBaseline = product.cycles[0];
  x.state.extraCycles[0].endsAt = "2027-01-31";
  x.v.product.cycles[0].durationDays = 12;
  assert.equal(preview(x)[0].next.endsAt, "2027-01-31");
});
test("legacy plan delivery aliases use unambiguous original names without creating duplicates", () => {
  const x = setup();
  x.state.extraTasks[0].baseDeliveryId = "old-plan-id";
  x.state.extraTasks[0].cycleTemplateId = "c";
  const i = preview(x)[0];
  assert.equal(i.tasks.length, 1);
  assert.equal(i.added.length, 0);
  assert.equal(i.tasks[0].description, "Depois");
  assert.equal(i.tasks[0].baseDeliveryId, "a");
});

test('rollout isolates repeated purchases, keeps enrollment dates and marks new task ownership', () => {
  const original=structuredClone(product);
  original.cycles[0].deliveries[0].deadline={mode:'client',offsetDays:4};
  const company={slug:'client',startedAt:'2020-01-01',leadId:'lead'};
  const a=prepareProduct(original,company,'now',{id:'a',startsAt:'2027-01-01'});
  const b=prepareProduct(original,company,'now',{id:'b',startsAt:'2027-01-12'});
  const updated=structuredClone(original);updated.version=2;updated.cycles[0].durationDays=15;
  updated.cycles[0].deliveries[0].deadline.offsetDays=6;
  updated.cycles[0].deliveries.push({...updated.cycles[0].deliveries[0],id:'new',title:'Nova',deadline:{mode:'task',taskId:'a',offsetDays:1}});
  const cycles=[...a.cycles,...b.cycles],tasks=[...a.tasks,...b.tasks];
  const options={scope:{company:'client',enrollmentId:'a'},enrollmentStarts:{a:'2027-01-01',b:'2027-01-12'}};
  const impacts=previewProduct(updated,[],cycles,tasks,'2026-12-01',{client:'2020-01-01'},options);
  assert.equal(impacts.length,1);assert.equal(impacts[0].blocked,undefined);assert.equal(impacts[0].tasks[0].dueAt,'2027-01-07');
  assert.equal(impacts[0].added[0].dueAt,'2027-01-08');assert.equal(impacts[0].added[0].enrollmentId,'a');assert.equal(impacts[0].added[0].deadline.taskId,a.tasks[0].id);
  const state={extraCycles:cycles,extraTasks:tasks,cycleEdits:{},taskPatches:{},statusMap:{}};
  const applied=applyProductImpact(state,impacts,cycles,tasks,rolloutFingerprint(cycles,tasks),'admin','now');
  assert.deepEqual(applied.extraCycles.find(c=>c.enrollmentId==='b'),b.cycles[0]);assert.equal(applied.taskPatches[b.tasks[0].id],undefined);
  const missing=previewProduct(updated,[],cycles,tasks,'2026-12-01',{client:'2020-01-01'},{scope:options.scope});assert.ok(missing[0].blocked);
  const samePurchase={...b.cycles[0],enrollmentId:'a'};
  const overlap=previewProduct(updated,[],[...a.cycles,samePurchase],a.tasks,'2026-12-01',{},options);assert.match(overlap[0].blocked,/sobrepõe/);
});

test('explicit legacy selection and unknown historical origins never adopt another purchase or infer a version',()=>{
  const x=setup();const legacy=x.state.extraCycles[0];const purchased={...legacy,id:'purchase',enrollmentId:'purchase',taskIds:[]};
  const scoped=previewProduct(x.v.product,x.v.versions,[legacy,purchased],x.state.extraTasks,'2026-12-01',{}, {scope:{company:'client',enrollmentId:null}});
  assert.equal(scoped.length,1);assert.equal(scoped[0].cycle.id,legacy.id);
  const unknown={...legacy,productBaseline:undefined,productVersion:undefined};
  assert.match(previewProduct(x.v.product,x.v.versions,[unknown],x.state.extraTasks,'2026-12-01')[0].blocked,/Sem versão de origem/);
  const known={...unknown,productVersion:1};assert.equal(previewProduct(x.v.product,x.v.versions,[known],x.state.extraTasks,'2026-12-01')[0].blocked,undefined);
  const wrong=x.state.extraTasks.map(t=>({...t,enrollmentId:'purchase'}));assert.match(previewProduct(x.v.product,x.v.versions,[legacy],wrong,'2026-12-01')[0].blocked,/vínculos/);
});

test('rollout persists explicit clear markers through JSON and removes markers when value is restored',()=>{
 const x=setup(),id=x.state.extraTasks[0].id;
 x.state.extraTasks[0]={...x.state.extraTasks[0],startsAt:undefined,deliverable:undefined,effortActual:undefined};
 const applied=applyProductImpact(x.state,preview(x),x.state.extraCycles,x.state.extraTasks,rolloutFingerprint(x.state.extraCycles,x.state.extraTasks),'admin','now');
 assert.deepEqual(new Set(JSON.parse(JSON.stringify(applied)).taskPatches[id].clearedFields),new Set(['startsAt','deliverable','effortActual']));
 const restored=setup();restored.state.taskPatches[id]={clearedFields:['startsAt']};
 const next=applyProductImpact(restored.state,preview(restored),restored.state.extraCycles,restored.state.extraTasks,rolloutFingerprint(restored.state.extraCycles,restored.state.extraTasks),'admin','now');
 assert.ok(!next.taskPatches[id].clearedFields?.includes('startsAt'));assert.equal(next.taskPatches[id].startsAt,'2027-01-01');
});
