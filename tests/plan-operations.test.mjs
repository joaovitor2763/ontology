import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { issueIntegrationCredential, integrationScopes } from '../src/server/operations/credentials.ts';
import { resolveOperationPrincipal } from '../src/server/operations/principal.ts';
import { executeCommercialCommand } from '../src/server/operations/commercial.ts';
import { executePlanCommand } from '../src/server/operations/plans.ts';
import { changePlanSchedule } from '../src/modules/delivery/application/plan-schedule.ts';
import { partitionClientDelivery, deliveryMapOrder } from '../src/server/delivery-client-slices.ts';
import { projectClients } from '../src/modules/clients/infrastructure/snapshot.ts';
import { projectDelivery } from '../src/modules/delivery/infrastructure/snapshot.ts';
import { getDoc } from '../src/server/db.ts';
async function fixture(){
 const f=sqliteD1();
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify({extraMembers:[{id:'admin',email:'admin@example.com',access:'admin'}]}));
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.catalog.v2',1,?)").run(JSON.stringify({extraProducts:[{id:'product',name:'Produto',description:'',version:1,cycles:[{id:'cycle',name:'Ciclo',goal:'Resultado',durationDays:14,acceptance:['Aceito'],deliveries:[{id:'task',title:'Tarefa',description:'',day:3,hours:1}]}]}]}));
 const issued=await issueIntegrationCredential(f.db,'default','admin@example.com',{name:'Plan',ownerEmail:'admin@example.com',scopes:[...integrationScopes],expiresAt:new Date(Date.now()+3600000).toISOString()});
 const env={DB:f.db},principal=await resolveOperationPrincipal(new Request('https://delivery.test',{headers:{authorization:`Bearer ${issued.token}`}}),env);
 const first=await executeCommercialCommand(f.db,'default',principal,'clients.create',{client:{slug:'client',name:'Cliente',startedAt:'2026-01-01',leadId:'admin',csId:'admin',journeyId:''},config:{productIds:['product']}},'create');
 const second=await executeCommercialCommand(f.db,'default',principal,'enrollments.create',{company:'client',productId:'product',startsAt:'2026-05-01'},'second');
 return {...f,env,principal,first:first.data.enrollments[0],second:second.data.enrollment,read:()=>JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get().body)};
}
function activateClientShadow(f) {
 const delivery=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.delivery.v2'").get();
 const clients=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get();
 const raw=JSON.parse(delivery.body);
 const partition=partitionClientDelivery(raw,projectClients(JSON.parse(clients.body)).enrollments);
 assert.equal(partition.slices.length,1);
 assert.equal(partition.unassigned.length,0);
 const slice=partition.slices[0],body=JSON.stringify(slice.snapshot),generation='plan-test';
 f.sql.prepare(`INSERT INTO delivery_client_snapshots
   (workspace_id,generation,company,revision,body,body_sha256,incarnation)
   VALUES('default',?,?,1,?,?,?)`)
   .run(generation,slice.company,body,createHash('sha256').update(body).digest('hex'),crypto.randomUUID());
 const effective=projectDelivery(raw);
 const owners=[...effective.tasks.map(row=>['task',row]),...effective.cycles.map(row=>['cycle',row])];
 for(const [kind,row] of owners) f.sql.prepare(`INSERT INTO delivery_entity_owners
   (workspace_id,generation,kind,id,company) VALUES('default',?,?,?,?)`)
   .run(generation,kind,row.id,row.company);
 for(const kind of ['extraTasks','extraCycles']) for(const [ordinal,row] of (raw[kind]??[]).entries())
   f.sql.prepare(`INSERT INTO delivery_client_array_order
     (workspace_id,generation,kind,id,ordinal,company) VALUES('default',?,?,?,?,?)`)
     .run(generation,kind,row.id,ordinal,row.company);
 const maps=deliveryMapOrder(raw);
 for(const [identity,ordinal] of maps){const [kind,id]=identity.split('\u0000');
   f.sql.prepare(`INSERT INTO delivery_client_map_order
     (workspace_id,generation,kind,id,ordinal) VALUES('default',?,?,?,?)`)
     .run(generation,kind,id,ordinal);}
 f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
   (workspace_id,generation,mode,source_delivery_version,source_clients_version,
    compatibility_version,expected_clients,expected_owners,expected_orphans,
    expected_array_order,expected_map_order,updated_at)
   VALUES('default',?,'active',?,?,?,1,?,0,?,?,'2026-09-27')`)
   .run(generation,delivery.version,clients.version,delivery.version+1,owners.length,
     (raw.extraTasks??[]).length+(raw.extraCycles??[]).length,maps.size);
 return delivery;
}
test('active plan scheduling updates one client slice while the global document stays frozen',async()=>{
 const f=await fixture();try{
  const before=f.read(),cycle=before.extraCycles.find(c=>c.enrollmentId===f.first.id);
  const frozen=activateClientShadow(f);
  const input={company:'client',planId:f.first.planId,enrollmentId:f.first.id,
    cycles:[{id:cycle.id,startsAt:'2026-02-01',endsAt:'2026-02-14'}],tasks:[]};
  const result=await executePlanCommand(f.env,f.principal,'plans.schedule',input,'active-plan-dates');
  assert.equal(result.data.company,'client');
  assert.deepEqual(await executePlanCommand(f.env,f.principal,'plans.schedule',input,'active-plan-dates'),result);
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.delivery.v2'").get(),frozen);
  assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='client'").get().revision,2);
  assert.equal((await getDoc(f.db,'default','ontology.delivery.v2')).value.extraCycles.find(c=>c.id===cycle.id).startsAt,'2026-02-01');
 }finally{f.sql.close();}
});
test('browser plan scheduling uses the active client slice and returns no global document',async()=>{
 const f=await fixture();try{
  const before=f.read(),cycle=before.extraCycles.find(c=>c.enrollmentId===f.first.id);
  const frozen=activateClientShadow(f),session={...f.principal,kind:'session'};
  const input={company:'client',planId:f.first.planId,enrollmentId:f.first.id,
    cycles:[{id:cycle.id,startsAt:'2026-02-01',endsAt:'2026-02-14'}],tasks:[]};
  const result=await executePlanCommand(f.env,session,'plans.schedule',input,'browser-plan-dates');
  assert.deepEqual(result.documents,[]);
  assert.ok(result.clientSnapshot);
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.delivery.v2'").get(),frozen);
  assert.equal((await getDoc(f.db,'default','ontology.delivery.v2')).value.extraCycles.find(c=>c.id===cycle.id).startsAt,'2026-02-01');
  assert.deepEqual(await executePlanCommand(f.env,session,'plans.schedule',input,'browser-plan-dates'),result);
 }finally{f.sql.close();}
});
test('client plan scheduling freezes its slice revision and rejects stale form dates',async()=>{
 const f=await fixture();try{
  const before=f.read(),cycle=before.extraCycles.find(c=>c.enrollmentId===f.first.id);
  activateClientShadow(f);
  const session={...f.principal,kind:'session'};
  const marker=f.sql.prepare("SELECT generation,incarnation,revision FROM delivery_client_snapshots WHERE company='client'").get();
  const expected=`${marker.generation}:${marker.incarnation}:${marker.revision}`;
  const input={company:'client',planId:f.first.planId,enrollmentId:f.first.id,
    cycles:[{id:cycle.id,startsAt:'2026-02-01',endsAt:'2026-02-14'}],tasks:[]};
  const result=await executePlanCommand(f.env,session,'plans.schedule',input,'scoped-plan-dates',{},false,expected);
  assert.deepEqual(result.documents,[]);
  assert.equal(result.clientSnapshot,expected.replace(/:1$/,':2'));
  await assert.rejects(executePlanCommand(f.env,session,'plans.schedule',
    {...input,cycles:[{...input.cycles[0],startsAt:'2026-02-02'}]},'stale-scoped-dates',{},false,expected),
  {code:'snapshot_changed'});
 }finally{f.sql.close();}
});
test('plan dates change only selected enrollment atomically, with history and idempotent retry',async()=>{
 const f=await fixture(),before=f.read(),cycle=before.extraCycles.find(c=>c.enrollmentId===f.first.id),task=before.extraTasks.find(t=>t.enrollmentId===f.first.id);
 const input={company:'client',planId:f.first.planId,cycles:[{id:cycle.id,startsAt:'2026-02-01',endsAt:'2026-02-14'}],tasks:[{id:task.id,startsAt:'2026-02-01',endsAt:'2026-02-03'}]};
 const result=await executePlanCommand(f.env,f.principal,'plans.schedule',input,'dates');
 assert.deepEqual(result.documents,[]);
 assert.deepEqual(await executePlanCommand(f.env,f.principal,'plans.schedule',input,'dates'),result);
 const after=f.read();assert.equal(after.extraCycles.find(c=>c.id===cycle.id).startsAt,'2026-02-01');assert.equal(after.taskPatches[task.id].dueAt,'2026-02-03');assert.ok(after.taskPatches[task.id].history.some(h=>h.by==='admin'));
 assert.deepEqual(after.extraCycles.filter(c=>c.enrollmentId===f.second.id),before.extraCycles.filter(c=>c.enrollmentId===f.second.id));
 for(const t of before.extraTasks.filter(t=>t.enrollmentId===f.second.id)) assert.deepEqual(after.taskPatches[t.id],before.taskPatches[t.id]);
 assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_events WHERE type='plan.schedule.updated'").get().n,1);f.sql.close();
});
test('another enrollment, stale versions and invalid graph roll back the whole date operation',async()=>{
 const f=await fixture(),before=f.read(),other=before.extraCycles.find(c=>c.enrollmentId===f.second.id);
 const input={company:'client',planId:f.first.planId,cycles:[{id:other.id,startsAt:'2026-02-01',endsAt:'2026-02-14'}],tasks:[]};
 await assert.rejects(executePlanCommand(f.env,f.principal,'plans.schedule',input,'cross'),{code:'invalid_schedule'});
 await assert.rejects(executePlanCommand(f.env,f.principal,'plans.schedule',{...input,cycles:[]},'stale',{'ontology.delivery.v2':0}),{code:'version_conflict'});
 assert.deepEqual(f.read(),before);assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_receipts WHERE idempotency_key IN ('cross','stale')").get().n,0);f.sql.close();
});
test('local and server schedule policy protects completed dates and preserves prior history',()=>{
 const task={id:'t',company:'c',status:'entregue',startsAt:'2026-01-01',dueAt:'2026-01-02',history:[{field:'status',by:'old'}]};
 const state={extraCycles:[],cycleEdits:{},taskPatches:{}};
 assert.throws(()=>changePlanSchedule(state,{cycles:[],tasks:[task]},{cycles:[],tasks:[{id:'t',startsAt:'2026-02-01',endsAt:'2026-02-02'}]},'new','now'),/concluídas/);
 const next=changePlanSchedule(state,{cycles:[],tasks:[{...task,status:'fila'}]},{cycles:[],tasks:[{id:'t',startsAt:'2026-02-01',endsAt:'2026-02-02'}]},'new','now');assert.equal(next.taskPatches.t.history[0].by,'old');
});
test('minimal plan assignment preserves current allocations instead of stale client lead fields',async()=>{
 const f=await fixture();
 f.sql.prepare("UPDATE state_documents SET version=version+1,body=? WHERE key='ontology.workspace.v3'").run(JSON.stringify({extraMembers:[{id:'admin',email:'admin@example.com',access:'admin'},{id:'other',email:'other@example.com',access:'admin'}]}));
 const clients=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body);
 clients.allocations=clients.allocations.map(a=>a.company==='client'?{...a,memberId:'other'}:a);
 f.sql.prepare("UPDATE state_documents SET version=version+1,body=? WHERE key='ontology.clients.v3'").run(JSON.stringify(clients));
 await executeCommercialCommand(f.db,'default',f.principal,'clients.configure',{client:{slug:'client'},journeyId:f.first.planId},'assign-plan');
 const next=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body);
 assert.ok(next.allocations.filter(a=>a.company==='client').every(a=>a.memberId==='other'));
 assert.equal(next.clientEdits.client.leadId,'other');assert.equal(next.enrollments.length,2);f.sql.close();
});
test('an open historical task in a concluded cycle also keeps its dates',()=>{
 const task={id:'t',company:'c',status:'fila',startsAt:'2026-01-01',dueAt:'2026-01-02'};
 const cycle={id:'cycle',company:'c',status:'concluido',taskIds:['t']};
 assert.throws(()=>changePlanSchedule({extraCycles:[],cycleEdits:{},taskPatches:{}},{cycles:[cycle],tasks:[task]},{cycles:[],tasks:[{id:'t',startsAt:'2026-02-01',endsAt:'2026-02-02'}]},'member','now'),/concluídas/);
});
test('shared historical plan IDs require explicit enrollment instead of silently selecting the first',async()=>{
 const f=await fixture(),before=f.read();
 const clients=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body);
 clients.enrollments=clients.enrollments.map(e=>e.id===f.second.id?{...e,planId:f.first.planId}:e);
 f.sql.prepare("UPDATE state_documents SET version=version+1,body=? WHERE key='ontology.clients.v3'").run(JSON.stringify(clients));
 const secondCycle=before.extraCycles.find(c=>c.enrollmentId===f.second.id);
 const input={company:'client',planId:f.first.planId,cycles:[{id:secondCycle.id,startsAt:'2026-06-01',endsAt:'2026-06-14'}],tasks:[]};
 await assert.rejects(executePlanCommand(f.env,f.principal,'plans.schedule',input,'ambiguous'),{code:'invalid_input'});
 await executePlanCommand(f.env,f.principal,'plans.schedule',{...input,enrollmentId:f.second.id},'explicit');
 const after=f.read();assert.equal(after.extraCycles.find(c=>c.id===secondCycle.id).startsAt,'2026-06-01');assert.deepEqual(after.extraCycles.find(c=>c.enrollmentId===f.first.id),before.extraCycles.find(c=>c.enrollmentId===f.first.id));f.sql.close();
});
test('legacy plan scheduling excludes another plan even when its product matches',async()=>{
 const f=await fixture(),state=f.read();
 state.productPlans={'legacy-a':{id:'legacy-a',name:'Plano A',productId:'product',milestones:[]},'legacy-b':{id:'legacy-b',name:'Plano B',productId:'product',milestones:[]}};state.companyJourney.client='legacy-a';
 state.extraTasks=state.extraTasks.map(t=>({...t,enrollmentId:undefined,journeyId:t.enrollmentId===f.first.id?'legacy-a':'legacy-b'}));
 state.extraCycles=state.extraCycles.map(c=>({...c,enrollmentId:undefined}));
 f.sql.prepare("UPDATE state_documents SET version=version+1,body=? WHERE key='ontology.delivery.v2'").run(JSON.stringify(state));
 const clients=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body);clients.enrollments=[];
 f.sql.prepare("UPDATE state_documents SET version=version+1,body=? WHERE key='ontology.clients.v3'").run(JSON.stringify(clients));
 const second=state.extraCycles[1],change={id:second.id,startsAt:'2026-06-01',endsAt:'2026-06-14'};
 await assert.rejects(executePlanCommand(f.env,f.principal,'plans.schedule',{company:'client',planId:'legacy-a',cycles:[change],tasks:[]},'wrong-plan-boundary'),{code:'invalid_schedule'});
 await assert.rejects(executePlanCommand(f.env,f.principal,'plans.schedule',{company:'client',planId:'legacy-b',cycles:[change],tasks:[]},'unassigned'),{code:'invalid_input'});
 assert.deepEqual(f.read(),JSON.parse(JSON.stringify(state)));f.sql.close();
});

test('legacy execution and one purchase remain independently addressable with explicit null or enrollment ID',async()=>{
 const f=await fixture();try{
  const state=f.read();
  const purchasedCycle=state.extraCycles.find(c=>c.enrollmentId===f.first.id);
  const legacyCycle=state.extraCycles.find(c=>c.enrollmentId===f.second.id);
  state.companyJourney.client=f.first.planId;
  state.extraCycles=state.extraCycles.map(c=>c.id===legacyCycle.id?{...c,enrollmentId:undefined}:c);
  state.extraTasks=state.extraTasks.map(t=>t.enrollmentId===f.second.id?{...t,enrollmentId:undefined,journeyId:f.first.planId}:t);
  f.sql.prepare("UPDATE state_documents SET version=version+1,body=? WHERE key='ontology.delivery.v2'").run(JSON.stringify(state));
  const clients=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body);
  clients.enrollments=clients.enrollments.filter(e=>e.id!==f.second.id);
  f.sql.prepare("UPDATE state_documents SET version=version+1,body=? WHERE key='ontology.clients.v3'").run(JSON.stringify(clients));
  const input={company:'client',planId:f.first.planId,cycles:[{id:legacyCycle.id,startsAt:'2026-06-01',endsAt:'2026-06-14'}],tasks:[]};
  await assert.rejects(executePlanCommand(f.env,f.principal,'plans.schedule',input,'ambiguous-mixed'),{code:'invalid_input'});
  const result=await executePlanCommand(f.env,f.principal,'plans.schedule',{...input,enrollmentId:null},'legacy-explicit');
  assert.equal(result.data.enrollmentId,null);
  assert.deepEqual(await executePlanCommand(f.env,f.principal,'plans.schedule',{...input,enrollmentId:null},'legacy-explicit'),result);
  assert.equal(f.read().extraCycles.find(c=>c.id===legacyCycle.id).startsAt,'2026-06-01');
  assert.deepEqual(f.read().extraCycles.find(c=>c.id===purchasedCycle.id),purchasedCycle);
  await assert.rejects(executePlanCommand(f.env,f.principal,'plans.schedule',{...input,enrollmentId:f.first.id},'purchase-cannot-change-legacy'),{code:'invalid_schedule'});
  await assert.rejects(executePlanCommand(f.env,f.principal,'plans.schedule',{...input,enrollmentId:null,cycles:[{id:purchasedCycle.id,startsAt:'2026-06-01',endsAt:'2026-06-14'}]},'legacy-cannot-change-purchase'),{code:'invalid_schedule'});
  await assert.rejects(executePlanCommand(f.env,f.principal,'plans.schedule',{...input,enrollmentId:f.second.id},'removed-purchase'),{code:'invalid_input'});
  await assert.rejects(executePlanCommand(f.env,f.principal,'plans.schedule',{...input,enrollmentId:null,planId:f.second.planId},'legacy-unassigned'),{code:'invalid_input'});
  await executePlanCommand(f.env,f.principal,'plans.schedule',{...input,enrollmentId:f.first.id,cycles:[{id:purchasedCycle.id,startsAt:'2026-02-01',endsAt:'2026-02-14'}]},'purchase-explicit');
  assert.equal(f.read().extraCycles.find(c=>c.id===purchasedCycle.id).startsAt,'2026-02-01');
  assert.equal(f.read().extraCycles.find(c=>c.id===legacyCycle.id).startsAt,'2026-06-01');
 }finally{f.sql.close();}
});

function allowNextMilestone(f) {
 const state=f.read(),plan=state.productPlans[f.first.planId];
 plan.milestones=[{...plan.milestones[0],n:1},{...plan.milestones[0],n:2,id:'next',name:'Próximo marco',tasks:[]}];
 state.companyMilestone.client=1;
 f.sql.prepare("UPDATE state_documents SET version=version+1,body=? WHERE key='ontology.delivery.v2'").run(JSON.stringify(state));
 return {company:'client',planId:f.first.planId,enrollmentId:f.first.id,currentMilestone:1};
}
test('active legacy milestone advance changes only its client slice',async()=>{
 const f=await fixture();try{
  const input=allowNextMilestone(f),state=f.read();
  const reference=state.extraTasks.find(t=>t.enrollmentId===f.first.id);
  state.companyJourney.client=f.first.planId;
  state.extraTasks.push({...reference,id:'legacy-active-task',enrollmentId:undefined,journeyId:f.first.planId});
  f.sql.prepare("UPDATE state_documents SET version=version+1,body=? WHERE key='ontology.delivery.v2'")
    .run(JSON.stringify(state));
  const frozen=activateClientShadow(f);
  const result=await executePlanCommand(f.env,f.principal,'plans.advance',
    {...input,enrollmentId:null,justification:'Decisão registrada com o cliente'},'active-legacy-advance');
  assert.equal(result.data.to,2);
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.delivery.v2'").get(),frozen);
  assert.equal((await getDoc(f.db,'default','ontology.delivery.v2')).value.companyMilestone.client,2);
  assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='client'").get().revision,2);
 }finally{f.sql.close();}
});
test('active purchased milestone advance keeps the combined clients transaction',async()=>{
 const f=await fixture();try{
  const input=allowNextMilestone(f),frozen=activateClientShadow(f);
  const marker=f.sql.prepare("SELECT generation,incarnation,revision FROM delivery_client_snapshots WHERE company='client'").get();
  const expected=`${marker.generation}:${marker.incarnation}:${marker.revision}`;
  const session={...f.principal,kind:'session'};
  const result=await executePlanCommand(f.env,session,'plans.advance',
    {...input,justification:'Decisão acordada com o cliente'},'active-purchased-advance',{},false,expected);
  assert.equal(result.data.to,2);
  assert.equal(result.clientSnapshot,expected);
  assert.equal(result.documents[0].key,'ontology.clients.v3');
  assert.equal(result.documents[0].value.enrollments.find(row=>row.id===f.first.id).milestone,2);
  assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='client'").get().revision,1);
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.delivery.v2'").get(),frozen);
  const clients=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body);
  assert.equal(clients.enrollments.find(row=>row.id===f.first.id).milestone,2);
  assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version,frozen.version+2);
 }finally{f.sql.close();}
});
test('active purchased milestone advance rolls back when its client slice changes before commit',async()=>{
 const f=await fixture();try{
  const input=allowNextMilestone(f),frozen=activateClientShadow(f);
  const before=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get();
  const batch=f.db.batch.bind(f.db);
  f.db.batch=async statements=>{
   f.sql.prepare("UPDATE delivery_client_snapshots SET revision=revision+1 WHERE company='client'").run();
   return batch(statements);
  };
  await assert.rejects(executePlanCommand(f.env,f.principal,'plans.advance',
   {...input,justification:'Decisão acordada com o cliente'},'active-purchased-race'),
  {code:'version_conflict'});
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get(),before);
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.delivery.v2'").get(),frozen);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_receipts WHERE idempotency_key='active-purchased-race'").get().n,0);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_events WHERE type='plan.milestone.advanced'").get().n,0);
 }finally{f.sql.close();}
});
test('milestone advance isolates purchase, records pending justification and replays once',async()=>{
 const f=await fixture();try{
  const input=allowNextMilestone(f),before=f.read();
  await assert.rejects(executePlanCommand(f.env,f.principal,'plans.advance',input,'missing-reason'),{code:'milestone_pending'});
  const intent={...input,justification:'Decisão acordada com patrocinador'};
  const result=await executePlanCommand(f.env,f.principal,'plans.advance',intent,'advance');
  assert.equal(result.data.to,2);assert.ok(result.data.pendingTaskIds.length);
  assert.deepEqual(await executePlanCommand(f.env,f.principal,'plans.advance',intent,'advance'),result);
  const saved=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body);
  assert.equal(saved.enrollments.find(e=>e.id===f.first.id).milestone,2);
  assert.equal(saved.enrollments.find(e=>e.id===f.first.id).milestoneHistory[0].by,'admin');
  assert.equal(saved.enrollments.find(e=>e.id===f.second.id).milestone,undefined);
  assert.deepEqual(f.read(),before);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_events WHERE type='plan.milestone.advanced'").get().n,1);
  await assert.rejects(executePlanCommand(f.env,f.principal,'plans.advance',intent,'different-attempt'),{code:'milestone_conflict'});
 }finally{f.sql.close();}
});
test('ready milestone needs no override, validates identity and current version before writing',async()=>{
 const f=await fixture();try{
  const input=allowNextMilestone(f),state=f.read();
  for(const task of state.extraTasks.filter(t=>t.enrollmentId===f.first.id)) state.statusMap[task.id]='entregue';
  f.sql.prepare("UPDATE state_documents SET version=version+1,body=? WHERE key='ontology.delivery.v2'").run(JSON.stringify(state));
  await assert.rejects(executePlanCommand(f.env,f.principal,'plans.advance',{...input,enrollmentId:undefined},'implicit'),{code:'invalid_input'});
  await assert.rejects(executePlanCommand(f.env,f.principal,'plans.advance',{...input,enrollmentId:'unknown'},'unknown'),{code:'invalid_input'});
  await assert.rejects(executePlanCommand(f.env,f.principal,'plans.advance',input,'stale',{'ontology.delivery.v2':0}),{code:'version_conflict'});
  const result=await executePlanCommand(f.env,f.principal,'plans.advance',input,'ready');assert.equal(result.data.to,2);assert.deepEqual(result.data.pendingTaskIds,[]);
  f.sql.prepare("UPDATE state_documents SET body=? WHERE key='ontology.workspace.v3'").run(JSON.stringify({extraMembers:[{id:'admin',email:'admin@example.com',access:'leitor'}]}));
  await assert.rejects(executePlanCommand(f.env,f.principal,'plans.advance',input,'ready'),{code:'permission_denied'});
 }finally{f.sql.close();}
});

test('explicit legacy advance preserves purchase progress and records its justification',async()=>{
 const f=await fixture();try{
  const input=allowNextMilestone(f),state=f.read(),task=state.extraTasks.find(t=>t.enrollmentId===f.first.id);
  state.companyJourney.client=f.first.planId;
  state.extraTasks.push({...task,id:'legacy-task',enrollmentId:undefined,journeyId:f.first.planId});
  f.sql.prepare("UPDATE state_documents SET version=version+1,body=? WHERE key='ontology.delivery.v2'").run(JSON.stringify(state));
  const before=f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body;
  const result=await executePlanCommand(f.env,f.principal,'plans.advance',{...input,enrollmentId:null,justification:'Decisão sobre execução histórica do cliente'},'legacy-advance');
  assert.equal(result.data.enrollmentId,null);assert.equal(f.read().companyMilestone.client,2);
  assert.equal(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body,before);
  const event=JSON.parse(f.sql.prepare("SELECT data FROM operation_events WHERE type='plan.milestone.advanced'").get().data);
  assert.equal(event.justification,'Decisão sobre execução histórica do cliente');assert.deepEqual(event.pendingTaskIds,['legacy-task']);
 }finally{f.sql.close();}
});

test('historical enrollment metadata can be completed without rewriting execution or replacing recorded values',async()=>{
 const f=await fixture(),before=f.read();
 const row=f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get();
 const clients=JSON.parse(row.body),enrollment=clients.enrollments.find(e=>e.id===f.first.id);
 delete enrollment.startsAt;delete enrollment.productVersion;
 f.sql.prepare("UPDATE state_documents SET body=? WHERE key='ontology.clients.v3'").run(JSON.stringify(clients));
 const result=await executeCommercialCommand(f.db,'default',f.principal,'enrollments.update',{company:'client',enrollmentId:f.first.id,startsAt:'2026-01-01',productVersion:1},'fill-metadata');
 assert.equal(result.data.enrollment.startsAt,'2026-01-01');assert.equal(result.data.enrollment.productVersion,1);
 assert.deepEqual(f.read(),before);
 await assert.rejects(executeCommercialCommand(f.db,'default',f.principal,'enrollments.update',{company:'client',enrollmentId:f.first.id,startsAt:'2026-02-01'},'replace-start'));
 await assert.rejects(executeCommercialCommand(f.db,'default',f.principal,'enrollments.update',{company:'client',enrollmentId:f.first.id,productVersion:999},'unknown-version'));
 assert.deepEqual(f.read(),before);f.sql.close();
});
