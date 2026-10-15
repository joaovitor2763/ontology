import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTaskOverride, applyTaskOverride } from '../src/modules/delivery/domain/task-overrides.ts';
import { selectDeliveries } from '../src/modules/delivery/application/deliveries.ts';
import { normalizeDeliverySnapshot, projectDelivery } from '../src/modules/delivery/infrastructure/snapshot.ts';
import { migrateTaskClears } from '../src/shared/infrastructure/migration.ts';
import { deliveryOperationPatch } from '../src/shared/infrastructure/operations.ts';
import { changePlanSchedule } from '../src/modules/delivery/application/plan-schedule.ts';
const roundtrip = value => JSON.parse(JSON.stringify(value));
const original = { id:'clear-fixture', company:'fixture', title:'Task', status:'pendente', ownerId:'admin', hours:1, dueAt:'2026-09-30', startsAt:'2026-09-01', effortActual:3, deliverable:'project_charter' };
test('explicit optional clears override immutable bases after JSON; concrete values remove markers',()=>{
 const patch=roundtrip(mergeTaskOverride({}, {effortActual:undefined,deliverable:undefined,startsAt:undefined}));
 const cleared=selectDeliveries([original],undefined,{}, {[original.id]:patch})[0];
 for(const field of ['effortActual','deliverable','startsAt']) assert.equal(cleared[field],undefined);
 assert.equal(cleared.clearedFields,undefined);
 const restored=roundtrip(mergeTaskOverride(patch,{effortActual:5,startsAt:'2026-09-02',deliverable:'action_plan'}));
 assert.equal(restored.clearedFields,undefined);
 assert.equal(applyTaskOverride(original,restored).effortActual,5);
});
test('lazy migration preserves old overrides, keeps explicit start empty and is idempotent',()=>{
 const legacy={taskPatches:{old:{title:'Old title'}}};
 const migrated=migrateTaskClears(legacy);assert.deepEqual(migrated.taskPatches.old,{title:'Old title'});assert.equal(migrateTaskClears(migrated),migrated);
 const patch=roundtrip(mergeTaskOverride({}, {effortActual:undefined,deliverable:undefined,startsAt:undefined}));
 const source={...original};delete source.startsAt;delete source.deliverable;delete source.effortActual;
 const state=normalizeDeliverySnapshot({extraTasks:[source],taskPatches:{[source.id]:patch}});
 assert.equal(state.extraTasks[0].startsAt,undefined);
 const task=projectDelivery(roundtrip(state),'fixture').tasks.find(t=>t.id===source.id);
 for(const field of ['effortActual','deliverable','startsAt']) assert.equal(task[field],undefined);
 assert.deepEqual(normalizeDeliverySnapshot(roundtrip(state)),state);
 const scheduled=changePlanSchedule(state,{cycles:[],tasks:[task]},{cycles:[],tasks:[{id:task.id,startsAt:'2026-09-03',endsAt:task.dueAt}]},'admin','2026-09-01');
 assert.equal(projectDelivery(roundtrip(scheduled),'fixture').tasks.find(t=>t.id===task.id).startsAt,'2026-09-03');
 assert.ok(!scheduled.taskPatches[task.id].clearedFields.includes('startsAt'));
});
test('editor converts only deliberate optional removals into explicit null',()=>{
 assert.deepEqual(deliveryOperationPatch({effortActual:undefined,deliverable:undefined,startsAt:undefined},original),{effortActual:null,deliverable:null,startsAt:null});
 assert.deepEqual(deliveryOperationPatch({title:'Edited',dueAt:undefined},{title:'Old',dueAt:original.dueAt}),{title:'Edited'});
 assert.deepEqual(deliveryOperationPatch({title:'New'}),{title:'New'});
});
