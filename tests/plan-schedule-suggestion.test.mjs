import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveAssignedMilestone,effectiveAssignedPlanId,effectiveAssignedPlanVersion,hasLegacyExecutionForClient,legacyExecutionProductIds,selectedExecutionId,selectedLegacyProduct,suggestPlanSchedule} from '../src/modules/delivery/application/plan-schedule.ts';

test('a standalone un-enrolled task keeps legacy execution selectable',()=>{
 const task={id:'legacy-task',company:'client',title:'Tarefa histórica',description:'',status:'fila',ownerId:'owner',dueAt:'2026-09-20',hours:1,workstream:'Execução',milestone:1,completion:'checklist'};
 assert.equal(hasLegacyExecutionForClient({cycles:[],tasks:[task]},'client',[],[]),true);
 assert.equal(hasLegacyExecutionForClient({cycles:[],tasks:[{...task,enrollmentId:'purchase'}]},'client',[],[]),false);
 assert.equal(hasLegacyExecutionForClient({cycles:[],tasks:[]},'client',['old-plan'],[]),true);
 assert.equal(hasLegacyExecutionForClient({cycles:[],tasks:[]},'client',['old-plan'],['private-plan']),false);
 assert.equal(hasLegacyExecutionForClient({cycles:[],tasks:[]},'client',['old-plan'],[undefined]),false);
});

test('a única contratação atual substitui marcador obsoleto somente sem trabalho legado',()=>{
 const task={id:'task',company:'client',status:'fila'};
 const purchase={company:'client',planId:'private-plan',status:'ativa'};
 assert.equal(effectiveAssignedPlanId({cycles:[],tasks:[]},'client','service-delivery',[purchase]),'private-plan');
 assert.equal(effectiveAssignedPlanId({cycles:[],tasks:[task]},'client','service-delivery',[purchase]),'service-delivery');
 assert.equal(effectiveAssignedPlanId({cycles:[],tasks:[]},'client','service-delivery',[purchase,{...purchase,planId:'renewal'}]),'service-delivery');
 assert.equal(effectiveAssignedPlanId({cycles:[],tasks:[]},'client','service-delivery',[purchase,{...purchase,planId:undefined}]),'service-delivery');
 assert.equal(effectiveAssignedPlanId({cycles:[],tasks:[]},'client','service-delivery',[{...purchase,status:'cancelada'}]),'service-delivery');
 assert.equal(effectiveAssignedPlanId({cycles:[],tasks:[]},'client','private-plan',[purchase]),'private-plan');
 assert.equal(effectiveAssignedPlanVersion('service-delivery','private-plan',2),undefined);
 assert.equal(effectiveAssignedPlanVersion('private-plan','private-plan',2),2);
 assert.equal(effectiveAssignedMilestone('service-delivery','private-plan',4),1);
 assert.equal(effectiveAssignedMilestone('private-plan','private-plan',4),4);
});

test('legacy product choices come only from historical work with that product',()=>{
 const task={id:'legacy-task',company:'client',title:'Tarefa histórica',description:'',status:'fila',ownerId:'owner',dueAt:'2026-09-20',hours:1,workstream:'Execução',milestone:1,completion:'checklist',productId:'with-work'};
 const purchased={...task,id:'purchased',productId:'purchased',enrollmentId:'purchase'};
 assert.deepEqual(legacyExecutionProductIds({cycles:[],tasks:[task,purchased]},'client'),['with-work']);
 assert.deepEqual(legacyExecutionProductIds({cycles:[],tasks:[task]},'other-client'),[]);
});

test('an explicit legacy selection wins over a stale product query parameter',()=>{
 assert.equal(selectedLegacyProduct('legacy:new-product','old-product'),'new-product');
 assert.equal(selectedLegacyProduct('__legacy__','old-product'),'old-product');
});

test('a stale enrollment selection falls back without hiding an available execution',()=>{
 assert.equal(selectedExecutionId('removed',['current'],'current',false),'current');
 assert.equal(selectedExecutionId('historical',['current','historical'],'current',false),'historical');
 assert.equal(selectedExecutionId('__legacy__',['current'],'current',true),'__legacy__');
 assert.equal(selectedExecutionId('__legacy__',['current'],'current',false),'current');
});

test('schedule suggestion shifts pending work together and preserves completed work in a partial cycle',()=>{
 const tasks=[{id:'done',status:'entregue',startsAt:'2026-01-01',dueAt:'2026-01-02'},{id:'pending',status:'fila',startsAt:'2026-01-03',dueAt:'2026-01-05'},{id:'later',status:'fila',startsAt:'2026-01-07',dueAt:'2026-01-09'}];
 const cycles=[{id:'partial',status:'em-curso',startsAt:'2026-01-01',endsAt:'2026-01-05',taskIds:['done','pending']},{id:'next',status:'planejado',startsAt:'2026-01-07',endsAt:'2026-01-09',taskIds:['later']}];
 const result=suggestPlanSchedule({tasks,cycles},'2026-09-17');
 assert.deepEqual(result.tasks,[{id:'done',startsAt:'2026-01-01',endsAt:'2026-01-02'},{id:'pending',startsAt:'2026-09-17',endsAt:'2026-09-19'},{id:'later',startsAt:'2026-09-21',endsAt:'2026-09-23'}]);
 assert.deepEqual(result.cycles[0],{id:'partial',startsAt:'2026-01-01',endsAt:'2026-09-19'});
 assert.equal(tasks[1].dueAt,'2026-01-05');
 const closed=suggestPlanSchedule({tasks,cycles:cycles.map(c=>({...c,status:'concluido'}))},'2026-09-17');
 assert.equal(closed.tasks[1].endsAt,'2026-01-05');
 assert.equal(closed.cycles[1].endsAt,'2026-01-09');
});
