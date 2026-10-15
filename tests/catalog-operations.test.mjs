import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { executeCatalogCommand } from '../src/server/operations/catalog.ts';
import { partitionClientDelivery, deliveryMapOrder } from '../src/server/delivery-client-slices.ts';
import { projectClients } from '../src/modules/clients/infrastructure/snapshot.ts';
import { fingerprint,diffJourneys } from '../src/modules/catalog/domain/publication.ts';
import { issueIntegrationCredential,revokeIntegrationCredential } from '../src/server/operations/credentials.ts';
import { resolveOperationPrincipal } from '../src/server/operations/principal.ts';
import { deliveryPlanClaims } from '../src/server/operations/delivery-client-plan-claims.ts';
import { deliveryDeadlineDependencies } from '../src/server/operations/delivery-client-deadline-dependencies.ts';
import { effectiveDeliveryRows } from '../src/server/delivery-effective.ts';
import { reconstructDeliverySnapshot } from '../src/server/delivery-records.ts';
import { commitOperation } from '../src/server/operations/transaction.ts';
import { readActiveDeliveryCompatibility } from '../src/server/operations/delivery-compatibility-read.ts';
const PLAN={id:'plan-fixture',name:'Plano fixture',description:'',milestones:[{n:1,name:'Marco',stage:'Executar',owner:'Responsável',tasks:[{id:'task',title:'Tarefa',description:'',hours:1,completion:'checklist'}]}]};
const PRODUCT={id:'product-fixture',name:'Produto fixture',description:'',serviceModel:'implementacao',cycles:[{id:'cycle',name:'Ciclo',goal:'Resultado',durationDays:20,acceptance:['Aprovado'],deliveries:[{id:'task',title:'Tarefa',description:'',hours:1,day:3}]}]};
function fixture(){
 const f=sqliteD1(),env={DB:f.db};
 const put=(key,value)=>f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?) ON CONFLICT(workspace_id,key) DO UPDATE SET version=version+1,body=excluded.body").run(key,JSON.stringify(value));
 const workspace={extraMembers:[{id:'admin',email:'admin@example.test',access:'admin'},{id:'viewer',email:'viewer@example.test',access:'leitor'},{id:'master',email:'master@example.test',access:'ai_master'}]};put('ontology.workspace.v3',workspace);
 put('ontology.clients.v3',{extraClients:[{slug:'fixture',name:'Fixture',journeyId:PLAN.id},{slug:'private',name:'Private',journeyId:'private-plan'}],enrollments:[{id:'purchase',company:'private',productId:PRODUCT.id,planId:'private-plan'}]});
 put('ontology.delivery.v2',{productPlans:{'private-plan':{...PLAN,id:'private-plan'}},companyJourney:{fixture:PLAN.id,private:'private-plan'},companyJourneyVersion:{private:7}});
 const principal={id:'member:admin',kind:'session',email:'admin@example.test',memberId:'admin',access:'admin',application:'web',scopes:null,companies:null,guards:[]};
 return{...f,env,put,workspace,principal,run:(command,input,key=crypto.randomUUID(),versions={},actor=principal)=>executeCatalogCommand(env,actor,command,input,key,versions),read:key=>JSON.parse(f.sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body),count:table=>f.sql.prepare(`SELECT count(*) n FROM ${table}`).get().n};
}
function activatePlanProtection(f){
 const delivery=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.delivery.v2'").get();
 const clients=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get();
 const raw=JSON.parse(delivery.body),generation='catalog-test';
 const slices=partitionClientDelivery(raw,projectClients(JSON.parse(clients.body)).enrollments).slices;
 for(const slice of slices){
  const body=JSON.stringify(slice.snapshot);
  f.sql.prepare(`INSERT INTO delivery_client_snapshots
    (workspace_id,generation,company,revision,body,body_sha256,incarnation)
    VALUES('default',?,?,1,?,?,?)`).run(generation,slice.company,body,createHash('sha256').update(body).digest('hex'),crypto.randomUUID());
 }
 const order=deliveryMapOrder(raw);
 for(const [identity,ordinal] of order){const [kind,id]=identity.split('\u0000');
  f.sql.prepare(`INSERT INTO delivery_client_map_order
    (workspace_id,generation,kind,id,ordinal) VALUES('default',?,?,?,?)`)
    .run(generation,kind,id,ordinal);}
 f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
   (workspace_id,generation,mode,source_delivery_version,source_clients_version,
    compatibility_version,expected_clients,expected_owners,expected_orphans,
    expected_array_order,expected_map_order,updated_at)
   VALUES('default',?,'active',?,?,?,?,0,0,0,?,'2026-09-28')`)
  .run(generation,delivery.version,clients.version,delivery.version+1,slices.length,order.size);
 return delivery.version+1;
}
function certifyPlanClaims(f) {
 const projection='catalog-claims';
 const slices=f.sql.prepare("SELECT company,revision,incarnation,body FROM delivery_client_snapshots WHERE generation='catalog-test'").all();
 for(const slice of slices) {
  const claims=deliveryPlanClaims(JSON.parse(slice.body),slice.company);
  for(const id of claims) f.sql.prepare(`INSERT INTO delivery_client_plan_claims
    (workspace_id,projection_generation,company,plan_id) VALUES('default',?,?,?)`)
   .run(projection,slice.company,id);
  f.sql.prepare(`INSERT INTO delivery_client_plan_claim_heads
    (workspace_id,company,authority_generation,source_revision,source_incarnation,
     projection_generation,expected_claims,updated_at)
    VALUES('default',?,'catalog-test',?,?,?,?,'now')`)
   .run(slice.company,slice.revision,slice.incarnation,projection,claims.length);
 }
}
test('certified unused public plan removal does not reconstruct global execution',async()=>{
 const f=fixture();try{
  await f.run('plans.save',{plan:PLAN});
  await f.run('plans.save',{plan:{...PLAN,id:'unused-public'}});
  const version=activatePlanProtection(f);
  certifyPlanClaims(f);
  const frozen=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.delivery.v2'").get();
  const original=f.db.prepare.bind(f.db);
  f.db.prepare=sql=>{
   if(/SELECT company,body FROM delivery_client_snapshots\s+WHERE workspace_id=\? AND generation=\? ORDER BY company/.test(sql))
    throw new Error('Unexpected global execution reconstruction');
   return original(sql);
  };
  const removed=await f.run('plans.remove',{planId:'unused-public'},'certified-remove');
  assert.equal(removed.data.removed,true);
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.delivery.v2'").get(),frozen);
  assert.ok(f.read('ontology.catalog.v2').removedJourneys.includes('unused-public'));
  assert.deepEqual(await f.run('plans.remove',{planId:'unused-public'},'certified-remove'),JSON.parse(JSON.stringify(removed)));
  f.db.prepare=original;
  await assert.rejects(f.run('plans.remove',{planId:PLAN.id}),/vinculado/);
  await assert.rejects(f.run('plans.remove',{planId:'private-plan'}),/contratação/);
  assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version,version);
 }finally{f.sql.close();}
});
test('plan removal without certified claims uses the global compatibility path',async()=>{
 const f=fixture();try{
  await f.run('plans.save',{plan:{...PLAN,id:'uncertified-public'}});
  activatePlanProtection(f);
  const original=f.db.prepare.bind(f.db);
  let reconstructed=false;
  f.db.prepare=sql=>{
   if(/SELECT company,body FROM delivery_client_snapshots\s+WHERE workspace_id=\? AND generation=\? ORDER BY company/.test(sql)) reconstructed=true;
   return original(sql);
  };
  await f.run('plans.remove',{planId:'uncertified-public'});
  assert.equal(reconstructed,true);
  assert.ok(f.read('ontology.catalog.v2').removedJourneys.includes('uncertified-public'));
 }finally{f.sql.close();}
});
test('certified plan removal aborts with the catalogue intact when execution changes',async()=>{
 const f=fixture();try{
  await f.run('plans.save',{plan:{...PLAN,id:'raced-public'}});
  activatePlanProtection(f);
  certifyPlanClaims(f);
  const before=f.read('ontology.catalog.v2'),batch=f.db.batch.bind(f.db);
  f.db.batch=async statements=>{
   f.sql.prepare("UPDATE delivery_client_shadow_meta SET compatibility_version=compatibility_version+1 WHERE workspace_id='default'").run();
   return batch(statements);
  };
  await assert.rejects(f.run('plans.remove',{planId:'raced-public'},'raced-remove'),{code:'version_conflict'});
  assert.deepEqual(f.read('ontology.catalog.v2'),before);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_receipts WHERE idempotency_key='raced-remove'").get().n,0);
 }finally{f.sql.close();}
});
test('product edits and new plans avoid global execution reads, while explicit versions remain guarded',async()=>{
 const f=fixture();
 try{
  const original=f.db.prepare.bind(f.db);
  f.db.prepare=sql=>{
   assert.doesNotMatch(sql,/ontology\.delivery\.v2|delivery_client_shadow_meta/);
   return original(sql);
  };
  const product=await f.run('products.save',{product:PRODUCT});
  assert.equal(product.data.product.id,PRODUCT.id);
  const newPlan={...PLAN};delete newPlan.id;
  const created=await f.run('plans.save',{plan:newPlan});
  assert.match(created.data.plan.id,/^plan-/);
  f.db.prepare=original;
  await assert.rejects(f.run('products.save',{product:PRODUCT},crypto.randomUUID(),
   {'ontology.delivery.v2':0}),{code:'version_conflict'});
 }finally{f.sql.close();}
});
test('active public plan edits check private IDs without reconstructing delivery',async()=>{
 const f=fixture();try{
  const version=activatePlanProtection(f);
  const frozen=f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get().body;
  const original=f.db.prepare.bind(f.db);
  f.db.prepare=sql=>{
   if(/SELECT company,body FROM delivery_client_snapshots\s+WHERE workspace_id=\? AND generation=\? ORDER BY company/.test(sql))
    throw new Error('Unexpected global execution reconstruction');
   return original(sql);
  };
  const saved=await f.run('plans.save',{plan:PLAN});
  assert.equal(saved.data.plan.id,PLAN.id);
  assert.equal(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get().body,frozen);
  await assert.rejects(f.run('plans.save',{plan:{...PLAN,id:'private-plan'}}),/contratação/);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_receipts WHERE command='plans.save'").get().n,1);
  f.db.prepare=original;
  await assert.rejects(f.run('plans.save',{plan:PLAN},crypto.randomUUID(),{'ontology.delivery.v2':version-1}),{code:'version_conflict'});
  const before=f.read('ontology.catalog.v2'),batch=f.db.batch.bind(f.db);
  f.db.batch=async statements=>{
   f.sql.prepare("UPDATE delivery_client_shadow_meta SET compatibility_version=compatibility_version+1 WHERE workspace_id='default'").run();
   return batch(statements);
  };
  await assert.rejects(f.run('plans.save',{plan:{...PLAN,name:'Não salvo'}},'active-plan-race'),{code:'version_conflict'});
  assert.deepEqual(f.read('ontology.catalog.v2'),before);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_receipts WHERE idempotency_key='active-plan-race'").get().n,0);
 }finally{f.sql.close();}
});
test('products version server-owned snapshots and replay without modifying purchases',async()=>{
 const f=fixture();try{
 const original=f.read('ontology.delivery.v2');const one=await f.run('products.save',{product:{...PRODUCT,version:999}},'create');assert.equal(one.data.product.version,1);
 assert.equal(one.data.product.serviceModel,'implementacao');
 assert.deepEqual(await f.run('products.save',{product:{...PRODUCT,version:999}},'create'),JSON.parse(JSON.stringify(one)));
 const two=await f.run('products.save',{product:{...PRODUCT,name:'Alterado',version:444}});assert.equal(two.data.product.version,2);
 const versions=f.read('ontology.catalog.v2').productVersions[PRODUCT.id];assert.equal(versions[0].snapshot.name,PRODUCT.name);assert.equal(versions[1].by,'admin');assert.deepEqual(f.read('ontology.delivery.v2'),original);
 await assert.rejects(f.run('products.save',{product:{...PRODUCT,cycles:[{...PRODUCT.cycles[0],deliveries:[{...PRODUCT.cycles[0].deliveries[0],deadline:{mode:'task',taskId:'missing',offsetDays:0}}]}]}}),/referência|existente/);
 assert.equal(f.read('ontology.catalog.v2').productVersions[PRODUCT.id].length,2);
 }finally{f.sql.close();}
});
test('publication atomically pins old/current cohorts and never mutates private plans',async()=>{
 const f=fixture();try{
 const privateBefore=f.read('ontology.delivery.v2').productPlans;
 const first=(await f.run('plans.save',{plan:{...PLAN,version:555,publishedAt:'forged',createdAt:'forged'}})).data.plan;assert.equal(first.version,undefined);assert.notEqual(first.createdAt,'forged');
 const p1=await f.run('plans.publish',{planId:PLAN.id,scope:'todos',fingerprint:fingerprint(first)},'pub1');assert.equal(p1.data.version.version,1);assert.equal(p1.documents.length,2);
 assert.deepEqual(await f.run('plans.publish',{planId:PLAN.id,scope:'todos',fingerprint:fingerprint(first)},'pub1'),p1);
 const state=f.read('ontology.delivery.v2');delete state.companyJourneyVersion.fixture;f.put('ontology.delivery.v2',state);
 const second=(await f.run('plans.save',{plan:{...PLAN,name:'Rascunho novo'}})).data.plan;
 await assert.rejects(f.run('plans.publish',{planId:PLAN.id,scope:'todos',fingerprint:fingerprint(first)}),{code:'draft_changed'});
 const p2=await f.run('plans.publish',{planId:PLAN.id,scope:'novos',fingerprint:fingerprint(second)});assert.deepEqual(p2.data.pins,{fixture:1});assert.equal(p2.data.version.version,2);
 assert.equal(f.read('ontology.catalog.v2').journeyVersions[PLAN.id][0].snapshot.name,PLAN.name);
 await f.run('plans.publish',{planId:PLAN.id,scope:'todos',fingerprint:fingerprint(second)});assert.equal(f.read('ontology.delivery.v2').companyJourneyVersion.fixture,3);assert.equal(f.read('ontology.delivery.v2').companyJourneyVersion.private,7);assert.deepEqual(f.read('ontology.delivery.v2').productPlans,privateBefore);
 for(const command of ['plans.save','plans.remove','plans.publish'])await assert.rejects(f.run(command,command==='plans.save'?{plan:{...PLAN,id:'private-plan'}}:{planId:'private-plan',...(command==='plans.publish'?{scope:'todos',fingerprint:'x'}:{})}),/contratação/);
 await assert.rejects(f.run('plans.remove',{planId:PLAN.id}),/vinculado/);
 const unused=(await f.run('plans.save',{plan:{...PLAN,id:'unused'}})).data.plan;await f.run('plans.remove',{planId:unused.id});assert.ok(f.read('ontology.catalog.v2').removedJourneys.includes('unused'));
 }finally{f.sql.close();}
});
test('permissions, scoped credentials, stale versions and race guards cannot bypass publication',async()=>{
 const f=fixture();try{
 for(const role of ['viewer','master'])await assert.rejects(f.run('plans.save',{plan:PLAN},crypto.randomUUID(),{},{...f.principal,id:`member:${role}`,email:`${role}@example.test`,memberId:role}),{code:'permission_denied'});
 const token=await issueIntegrationCredential(f.db,'default',f.principal.email,{name:'Catalog fixture',ownerEmail:f.principal.email,scopes:['catalog:write'],expiresAt:new Date(Date.now()+3600000).toISOString()});const actor=await resolveOperationPrincipal(new Request('https://delivery.test',{headers:{authorization:`Bearer ${token.token}`}}),f.env);
 const saved=await f.run('plans.save',{plan:PLAN},'token-save',{},actor);assert.deepEqual(saved.documents,[]);
 await revokeIntegrationCredential(f.db,'default',f.principal.email,token.id);await assert.rejects(f.run('plans.save',{plan:PLAN},'token-save',{},actor));
 await assert.rejects(f.run('plans.save',{plan:PLAN},'stale',{'ontology.catalog.v2':0}),{code:'version_conflict'});
 const before=f.read('ontology.catalog.v2'),delivery=f.read('ontology.delivery.v2'),events=f.count('operation_events'),receipts=f.count('operation_receipts');const original=f.db.batch;f.db.batch=async statements=>{f.put('ontology.workspace.v3',{...f.workspace,extraMembers:f.workspace.extraMembers.map(m=>({...m,access:'leitor'}))});return original(statements);};
 await assert.rejects(f.run('plans.publish',{planId:PLAN.id,scope:'todos',fingerprint:fingerprint(PLAN)}),{code:'version_conflict'});
 assert.deepEqual(f.read('ontology.catalog.v2'),before);assert.deepEqual(f.read('ontology.delivery.v2'),delivery);assert.equal(f.count('operation_events'),events);assert.equal(f.count('operation_receipts'),receipts);
 }finally{f.sql.close();}
});
test('plan graph and period validation rejects malformed complete documents',async()=>{
 const f=fixture();try{
 for(const patch of [{milestones:[...PLAN.milestones,...PLAN.milestones]},{milestones:[{...PLAN.milestones[0],period:{startMonth:2,endMonth:1}}]},{milestones:[{...PLAN.milestones[0],tasks:[{...PLAN.milestones[0].tasks[0],schedule:{mode:'task',predecessorId:'missing',offsetDays:0}}]}]}])await assert.rejects(f.run('plans.save',{plan:{...PLAN,...patch}}),{code:'invalid_input'});
 assert.equal(f.count('operation_receipts'),0);
 }finally{f.sql.close();}
});
test('plan fingerprint includes all execution semantics and ignores publication bookkeeping/key order',()=>{
 const baseline=fingerprint(PLAN);
 const mutations=[p=>p.autoCreateCycles=true,p=>p.productId='product',p=>p.milestones[0].period={startMonth:1,endMonth:2},p=>p.milestones[0].cycleTemplateId='cycle',p=>p.milestones[0].tasks[0].period={startMonth:1,endMonth:2},p=>p.milestones[0].tasks[0].legacyBaseDeliveryIds=['old'],p=>p.milestones[0].tasks[0].approvalRequired=true];
 for(const mutate of mutations){const p=structuredClone(PLAN);mutate(p);assert.notEqual(fingerprint(p),baseline);assert.equal(diffJourneys(PLAN,p).unchanged,false);}
 assert.equal(fingerprint({...PLAN,version:2,publishedAt:'later',draftUpdatedAt:'later'}),baseline);
 const a=structuredClone(PLAN),b=structuredClone(PLAN);a.milestones[0].tasks[0].schedule={mode:'date',base:'inicio',offsetDays:2};b.milestones[0].tasks[0].schedule={offsetDays:2,base:'inicio',mode:'date'};assert.equal(fingerprint(a),fingerprint(b));
});

test('GET-shaped plans roundtrip their server-owned fingerprint and archived clients retain publication pins',async()=>{
 const f=fixture();try{
  const first=(await f.run('plans.save',{plan:PLAN})).data.plan;
  await f.run('plans.publish',{planId:PLAN.id,scope:'todos',fingerprint:fingerprint(first)});
  const clients=f.read('ontology.clients.v3');clients.archivedClients=['fixture'];f.put('ontology.clients.v3',clients);
  const delivery=f.read('ontology.delivery.v2');delete delivery.companyJourneyVersion.fixture;f.put('ontology.delivery.v2',delivery);
  const dto={...first,fingerprint:fingerprint(first),name:'Rascunho do GET'};
  const saved=(await f.run('plans.save',{plan:dto})).data.plan;
  assert.equal(saved.name,dto.name);assert.equal(saved.fingerprint,undefined,'fingerprint is derived, not persisted as user input');
  const newer=await f.run('plans.publish',{planId:PLAN.id,scope:'novos',fingerprint:fingerprint(saved)});
  assert.equal(newer.data.pins.fixture,1);assert.equal(f.read('ontology.delivery.v2').companyJourneyVersion.fixture,1);
  const everyone=await f.run('plans.publish',{planId:PLAN.id,scope:'todos',fingerprint:fingerprint(saved)});
  assert.equal(everyone.data.pins.fixture,3);assert.equal(f.read('ontology.delivery.v2').companyJourneyVersion.fixture,3);
  clients.archivedClients=[];f.put('ontology.clients.v3',clients);
  const {resolveClientJourney,normalizeCatalogSnapshot}=await import('../src/modules/catalog/infrastructure/snapshot.ts');
  const {normalizeDeliverySnapshot}=await import('../src/modules/delivery/infrastructure/snapshot.ts');
  assert.equal(resolveClientJourney(normalizeCatalogSnapshot(f.read('ontology.catalog.v2')),normalizeDeliverySnapshot(f.read('ontology.delivery.v2')),clients.extraClients[0]).version,3);
 }finally{f.sql.close();}
});

test('enrollment plan IDs remain reserved when their private snapshot is absent',async()=>{
 const f=fixture();try{
  const delivery=f.read('ontology.delivery.v2');delivery.productPlans={};f.put('ontology.delivery.v2',delivery);
  // Even a conflicting legacy catalog row cannot turn the reserved ID into a shared plan.
  const conflict={...PLAN,id:'private-plan'};f.put('ontology.catalog.v2',{extraJourneys:[conflict]});
  const beforeCatalog=f.read('ontology.catalog.v2'),beforeDelivery=f.read('ontology.delivery.v2'),events=f.count('operation_events'),receipts=f.count('operation_receipts');
  for(const [command,input] of [
   ['plans.save',{plan:{...conflict,name:'Attempted overwrite'}}],
   ['plans.remove',{planId:conflict.id}],
   ['plans.publish',{planId:conflict.id,scope:'todos',fingerprint:fingerprint(conflict)}],
  ])await assert.rejects(f.run(command,input),/contratação/);
  assert.deepEqual(f.read('ontology.catalog.v2'),beforeCatalog);assert.deepEqual(f.read('ontology.delivery.v2'),beforeDelivery);
  assert.equal(f.count('operation_events'),events);assert.equal(f.count('operation_receipts'),receipts);
  f.put('ontology.catalog.v2',{});
  await assert.rejects(f.run('plans.save',{plan:conflict}),/contratação/);
  assert.deepEqual(f.read('ontology.catalog.v2'),{});assert.equal(f.count('operation_receipts'),receipts);
 }finally{f.sql.close();}
});

const RECONSTRUCTION=/SELECT company,body FROM delivery_client_snapshots\s+WHERE workspace_id=\? AND generation=\? ORDER BY company/;
/** Many clients on the public plan, active authority and every head certified. */
async function manyClientsOnPlan(count,{effective=true,deadlines=true}={}){
 const f=fixture();
 await f.run('plans.save',{plan:PLAN});
 const clients=f.read('ontology.clients.v3');
 clients.extraClients.push(...Array.from({length:count},(_,i)=>({slug:`bulk-${String(i).padStart(3,'0')}`,name:`Bulk ${i}`,journeyId:PLAN.id})));
 f.put('ontology.clients.v3',clients);
 const version=activatePlanProtection(f);
 // Activation keeps one (possibly empty) slice per registered client.
 const empty=JSON.stringify(reconstructDeliverySnapshot([],{sparse:true}));
 for(const client of clients.extraClients)f.sql.prepare(`INSERT OR IGNORE INTO delivery_client_snapshots
   (workspace_id,generation,company,revision,body,body_sha256,incarnation) VALUES('default','catalog-test',?,1,?,?,?)`)
  .run(client.slug,empty,createHash('sha256').update(empty).digest('hex'),crypto.randomUUID());
 f.sql.prepare("UPDATE delivery_client_shadow_meta SET expected_clients=(SELECT COUNT(*) FROM delivery_client_snapshots WHERE generation='catalog-test')").run();
 certifyPlanClaims(f);
 const slices=f.sql.prepare("SELECT company,revision,incarnation,body FROM delivery_client_snapshots WHERE generation='catalog-test'").all();
 for(const slice of slices){
  const body=JSON.parse(slice.body);
  if(deadlines){
   const rows=deliveryDeadlineDependencies(body,slice.company);
   for(const row of rows)f.sql.prepare(`INSERT INTO delivery_client_deadline_dependencies
     (workspace_id,projection_generation,company,source_task_id,target_task_id) VALUES('default','catalog-deadlines',?,?,?)`)
    .run(slice.company,row.sourceTaskId,row.targetTaskId);
   f.sql.prepare(`INSERT INTO delivery_client_deadline_heads
     (workspace_id,company,authority_generation,source_revision,source_incarnation,
      projection_generation,expected_dependencies,updated_at)
     VALUES('default',?,'catalog-test',?,?,'catalog-deadlines',?,'now')`)
    .run(slice.company,slice.revision,slice.incarnation,rows.length);
  }
  if(effective){
   const page=`page-${slice.company}`,rows=effectiveDeliveryRows(body,slice.company);
   for(const row of rows.tasks)f.sql.prepare(`INSERT INTO delivery_effective_tasks
     (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,due_at,owner_id,milestone,kind,body)
     VALUES('default',?,?,?,?,?,?,?,?,?,?,?,?)`).run(page,slice.company,row.id,row.ordinal,row.enrollmentId,
     row.productId,row.status,row.dueAt,row.ownerId,row.milestone,row.kind,row.body);
   for(const row of rows.cycles)f.sql.prepare(`INSERT INTO delivery_effective_cycles
     (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,starts_at,ends_at,body)
     VALUES('default',?,?,?,?,?,?,?,?,?,?)`).run(page,slice.company,row.id,row.ordinal,row.enrollmentId,
     row.productId,row.status,row.startsAt,row.endsAt,row.body);
   f.sql.prepare(`INSERT INTO delivery_client_effective_heads
     (workspace_id,company,authority_generation,source_revision,source_incarnation,projection_generation,
      expected_tasks,expected_cycles,updated_at) VALUES('default',?,'catalog-test',?,?,?,?,?,'now')`)
    .run(slice.company,slice.revision,slice.incarnation,page,rows.tasks.length,rows.cycles.length);
  }
 }
 const heads=table=>Object.fromEntries(f.sql.prepare(`SELECT company,source_revision FROM ${table} WHERE authority_generation='catalog-test'`).all().map(r=>[r.company,r.source_revision]));
 const revisions=()=>Object.fromEntries(f.sql.prepare("SELECT company,revision FROM delivery_client_snapshots WHERE generation='catalog-test'").all().map(r=>[r.company,r.revision]));
 return{...f,version,heads,revisions};
}
test('active publication to many clients commits once, keeps claim/deadline heads and lists stale effective pages',async()=>{
 const f=await manyClientsOnPlan(14);try{
  const affected=['fixture',...Array.from({length:14},(_,i)=>`bulk-${String(i).padStart(3,'0')}`)].sort();
  const plan=projectCatalogPlan(f);
  const warn=console.warn;const warnings=[];console.warn=entry=>warnings.push(entry);
  const batch=f.db.batch,changes=()=>f.sql.prepare('SELECT total_changes() n').get().n;let writingBatches=0;
  f.db.batch=async statements=>{const before=changes(),result=await batch(statements);if(changes()!==before)writingBatches++;return result;};
  let published;try{published=await f.run('plans.publish',{planId:PLAN.id,scope:'todos',fingerprint:fingerprint(plan)},'bulk-publish');}finally{console.warn=warn;f.db.batch=batch;}
  assert.equal(writingBatches,1);
  assert.deepEqual(Object.keys(published.data.pins).sort(),affected);
  assert.deepEqual(published.data.staleHeads,affected);
  assert.deepEqual(warnings.map(w=>({event:w.event,clients:w.clients})),[{event:'delivery_effective_heads_stale',clients:affected.length}]);
  assert.ok(!JSON.stringify(warnings).includes('bulk-000'));
  assert.equal(f.sql.prepare('SELECT compatibility_version v FROM delivery_client_shadow_meta').get().v,f.version+1);
  const revisions=f.revisions(),claims=f.heads('delivery_client_plan_claim_heads'),deadlines=f.heads('delivery_client_deadline_heads'),pages=f.heads('delivery_client_effective_heads');
  for(const company of affected){
   assert.equal(revisions[company],2);assert.equal(claims[company],2);assert.equal(deadlines[company],2);
   assert.equal(pages[company],1,'effective page stays stale for the backfill');
  }
  assert.equal(revisions.private,1);assert.equal(pages.private,1);
  const delivery=(await readActiveDeliveryCompatibility(f.db,"default")).snapshot;
  for(const company of affected)assert.equal(delivery.companyJourneyVersion[company],1);
  assert.equal(delivery.companyJourneyVersion.private,7);
  const event=JSON.parse(f.sql.prepare("SELECT data FROM operation_events WHERE type='plan.published'").get().data);
  assert.deepEqual(event.staleHeads,affected);
  assert.deepEqual(await f.run('plans.publish',{planId:PLAN.id,scope:'todos',fingerprint:fingerprint(plan)},'bulk-publish'),JSON.parse(JSON.stringify(published)));
 }finally{f.sql.close();}
});
function projectCatalogPlan(f){return f.read('ontology.catalog.v2').extraJourneys.find(p=>p.id===PLAN.id);}
test('active publication to few clients advances effective pages and reports nothing stale',async()=>{
 const f=await manyClientsOnPlan(2);try{
  const published=await f.run('plans.publish',{planId:PLAN.id,scope:'todos',fingerprint:fingerprint(projectCatalogPlan(f))});
  assert.equal(published.data.staleHeads,undefined);
  const pages=f.heads('delivery_client_effective_heads');
  for(const company of ['fixture','bulk-000','bulk-001'])assert.equal(pages[company],2);
  assert.equal(JSON.parse(f.sql.prepare("SELECT data FROM operation_events WHERE type='plan.published'").get().data).staleHeads,undefined);
 }finally{f.sql.close();}
});
test('active publication that cannot fit one batch is refused before reconstructing execution',async()=>{
 const f=await manyClientsOnPlan(300,{effective:false,deadlines:false});try{
  const plan=projectCatalogPlan(f),catalog=f.read('ontology.catalog.v2'),receipts=f.count('operation_receipts');
  const original=f.db.prepare.bind(f.db);
  f.db.prepare=sql=>{if(RECONSTRUCTION.test(sql))throw new Error('Unexpected global execution reconstruction');return original(sql);};
  await assert.rejects(f.run('plans.publish',{planId:PLAN.id,scope:'todos',fingerprint:fingerprint(plan)}),{code:'execution_write_too_large'});
  // A stale fingerprint keeps its own answer.
  await assert.rejects(f.run('plans.publish',{planId:PLAN.id,scope:'todos',fingerprint:'stale'}),error=>error.code!=='execution_write_too_large');
  f.db.prepare=original;
  assert.deepEqual(f.read('ontology.catalog.v2'),catalog);assert.equal(f.count('operation_receipts'),receipts);
  assert.equal(f.sql.prepare('SELECT compatibility_version v FROM delivery_client_shadow_meta').get().v,f.version);
 }finally{f.sql.close();}
});
test('other bridge commits over many slices keep syncing effective pages within the budget',async()=>{
 const f=await manyClientsOnPlan(11);try{
  const current=(await readActiveDeliveryCompatibility(f.db,'default')).snapshot;
  const companies=['fixture',...Array.from({length:11},(_,i)=>`bulk-${String(i).padStart(3,'0')}`)];
  const next={...current,companyJourneyVersion:{...current.companyJourneyVersion,...Object.fromEntries(companies.map(c=>[c,9]))}};
  const warn=console.warn;const warnings=[];console.warn=entry=>warnings.push(entry);
  let result;try{result=await commitOperation(f.db,{workspace:'default',principal:'member:admin',application:'test',
   actor:{memberId:'admin',email:'admin@example.test',kind:'session'},key:'bridge-many',command:'tasks.update',hash:'bridge-many',
   id:crypto.randomUUID(),guards:[{key:'ontology.delivery.v2',version:f.version}],writes:[{key:'ontology.delivery.v2',value:next}],
   events:[{type:'tasks.updated',subject:'bulk'}],result:{data:{},documents:[]}});}finally{console.warn=warn;}
  assert.deepEqual(result,{data:{},documents:[]});assert.deepEqual(warnings,[]);
  const pages=f.heads('delivery_client_effective_heads'),revisions=f.revisions();
  for(const company of companies){assert.equal(revisions[company],2);assert.equal(pages[company],2);}
 }finally{f.sql.close();}
});
