import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { executeCommercialCommand } from '../src/server/operations/commercial.ts';
import { issueIntegrationCredential, integrationScopes, revokeIntegrationCredential } from '../src/server/operations/credentials.ts';
import { resolveOperationPrincipal } from '../src/server/operations/principal.ts';
import { apiResponse } from '../src/server/operations/http.ts';
import { prepareProduct } from '../src/modules/delivery/application/product-execution.ts';
import { enrollmentBusinessDate } from '../src/modules/clients/domain/product-enrollments.ts';
import { partitionClientDelivery, deliveryMapOrder } from '../src/server/delivery-client-slices.ts';
import { reconstructDeliverySnapshot } from '../src/server/delivery-records.ts';
import { projectClients } from '../src/modules/clients/infrastructure/snapshot.ts';
import { projectDelivery } from '../src/modules/delivery/infrastructure/snapshot.ts';
import { getDoc } from '../src/server/db.ts';
import { deliveryPlanClaims } from '../src/server/operations/delivery-client-plan-claims.ts';
import { deliveryDeadlineDependencies } from '../src/server/operations/delivery-client-deadline-dependencies.ts';
import { readActiveNewClientAuthority } from '../src/server/operations/delivery-client-create.ts';
async function fixture() {
 const f=sqliteD1();
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify({extraMembers:[{id:'admin',email:'admin@example.com',access:'admin'}]}));
 const product={id:'product',name:'Produto',description:'',serviceModel:'implementacao',version:1,cycles:[{id:'cycle',name:'Ciclo',goal:'Resultado',durationDays:14,acceptance:['Aceito'],deliveries:[{id:'task',title:'Tarefa',description:'',day:3,hours:1}]}]};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.catalog.v2',1,?)").run(JSON.stringify({extraProducts:[product]}));
 const issued=await issueIntegrationCredential(f.db,'default','admin@example.com',{name:'CRM',ownerEmail:'admin@example.com',scopes:[...integrationScopes],expiresAt:new Date(Date.now()+3600000).toISOString()});
 const principal=await resolveOperationPrincipal(new Request('https://delivery.test',{headers:{authorization:`Bearer ${issued.token}`}}),{DB:f.db});
 return {...f,principal,issued,run:(command,input,key=crypto.randomUUID(),versions={})=>executeCommercialCommand(f.db,'default',principal,command,input,key,versions),read:key=>JSON.parse(f.sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body)};
}
const input={client:{slug:'new-client',name:'Cliente',startedAt:'2026-01-01',leadId:'admin',csId:'admin',journeyId:''},config:{productIds:['product']},stakeholders:[{name:'Patrocinador',role:'Diretor',email:'sponsor@example.com',primary:true}]};
function activateClientShadow(f,corruptGlobal=false) {
 const delivery=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.delivery.v2'").get();
 const clients=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get();
 const raw=JSON.parse(delivery.body),clientRaw=JSON.parse(clients.body);
 const partition=partitionClientDelivery(raw,projectClients(clientRaw).enrollments);
 assert.equal(partition.unassigned.length,0);
 const generation='commercial-test',byCompany=new Map(partition.slices.map(slice=>[slice.company,slice.snapshot]));
 const companies=clientRaw.extraClients.map(client=>client.slug);
 assert.equal(new Set(companies).size,companies.length);
 for(const company of companies){
  const snapshot=byCompany.get(company)??reconstructDeliverySnapshot([],{sparse:true});
  const body=JSON.stringify(snapshot);
  f.sql.prepare(`INSERT INTO delivery_client_snapshots
    (workspace_id,generation,company,revision,body,body_sha256,incarnation)
    VALUES('default',?,?,1,?,?,?)`)
    .run(generation,company,body,createHash('sha256').update(body).digest('hex'),crypto.randomUUID());
 }
 const projected=projectDelivery(raw),owners=[...projected.tasks.map(row=>['task',row]),...projected.cycles.map(row=>['cycle',row])];
 for(const [kind,row] of owners) f.sql.prepare(`INSERT INTO delivery_entity_owners
   (workspace_id,generation,kind,id,company) VALUES('default',?,?,?,?)`).run(generation,kind,row.id,row.company);
 for(const kind of ['extraTasks','extraCycles']) for(const [ordinal,row] of (raw[kind]??[]).entries())
   f.sql.prepare(`INSERT INTO delivery_client_array_order
     (workspace_id,generation,kind,id,ordinal,company) VALUES('default',?,?,?,?,?)`)
     .run(generation,kind,row.id,ordinal,row.company);
 const maps=deliveryMapOrder(raw);
 for(const [identity,ordinal] of maps){const [kind,id]=identity.split('\u0000');
   f.sql.prepare(`INSERT INTO delivery_client_map_order
     (workspace_id,generation,kind,id,ordinal) VALUES('default',?,?,?,?)`)
     .run(generation,kind,id,ordinal);}
 if(corruptGlobal) f.sql.prepare("UPDATE state_documents SET body='invalid-delivery-body' WHERE key='ontology.delivery.v2'").run();
 f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
   (workspace_id,generation,mode,source_delivery_version,source_clients_version,
    compatibility_version,expected_clients,expected_owners,expected_orphans,
    expected_array_order,expected_map_order,updated_at)
   VALUES('default',?,'active',?,?,?,?,?,0,?,?,'2026-09-27')`)
   .run(generation,delivery.version,clients.version,delivery.version+1,companies.length,owners.length,
     (raw.extraTasks??[]).length+(raw.extraCycles??[]).length,maps.size);
 return delivery;
}
function certifyActivePlanClaims(f) {
 const generation='commercial-test',projection='commercial-claims';
 const slices=f.sql.prepare(`SELECT company,revision,incarnation,body FROM delivery_client_snapshots
   WHERE generation=?`).all(generation);
 for(const slice of slices) {
  const claims=deliveryPlanClaims(JSON.parse(slice.body),slice.company);
  for(const planId of claims) f.sql.prepare(`INSERT INTO delivery_client_plan_claims
    (workspace_id,projection_generation,company,plan_id) VALUES('default',?,?,?)`)
    .run(projection,slice.company,planId);
  f.sql.prepare(`INSERT INTO delivery_client_plan_claim_heads
    (workspace_id,company,authority_generation,source_revision,source_incarnation,
     projection_generation,expected_claims,updated_at)
    VALUES('default',?,?,?,?,?,?,'now')`)
    .run(slice.company,generation,slice.revision,slice.incarnation,projection,claims.length);
 }
}
function certifyActiveDeadlines(f) {
 const generation='commercial-test',projection='commercial-deadlines';
 const slices=f.sql.prepare(`SELECT company,revision,incarnation,body FROM delivery_client_snapshots
   WHERE generation=?`).all(generation);
 for(const slice of slices) {
  const dependencies=deliveryDeadlineDependencies(JSON.parse(slice.body),slice.company);
  for(const row of dependencies) f.sql.prepare(`INSERT INTO delivery_client_deadline_dependencies
    (workspace_id,projection_generation,company,source_task_id,target_task_id)
    VALUES('default',?,?,?,?)`).run(projection,slice.company,row.sourceTaskId,row.targetTaskId);
  f.sql.prepare(`INSERT INTO delivery_client_deadline_heads
    (workspace_id,company,authority_generation,source_revision,source_incarnation,
     projection_generation,expected_dependencies,updated_at)
    VALUES('default',?,?,?,?,?,?,'now')`)
    .run(slice.company,generation,slice.revision,slice.incarnation,projection,dependencies.length);
 }
}
test('active client creation writes its first slice and certified projections without global reconstruction',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const frozen=activateClientShadow(f,true);
  certifyActivePlanClaims(f);
  const prepare=f.db.prepare.bind(f.db);
  f.db.prepare=query=>{
   if(/SELECT company,body FROM delivery_client_snapshots\s+WHERE workspace_id=\? AND generation=\? ORDER BY company/.test(query))
    throw new Error('Unexpected global execution reconstruction');
   return prepare(query);
  };
  const request={client:{...input.client,slug:'second-client',name:'Segundo'},
   config:{productIds:['product']},stakeholders:[]};
  const saved=await f.run('clients.create',request,'active-new-client');
  f.db.prepare=prepare;
  assert.equal(saved.data.enrollments.length,1);
  assert.equal(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get().body,
   'invalid-delivery-body');
  assert.equal(f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.delivery.v2'").get().version,
   frozen.version);
  const slice=f.sql.prepare("SELECT revision,incarnation FROM delivery_client_snapshots WHERE company='second-client'").get();
  assert.equal(slice.revision,1);
  assert.ok(slice.incarnation);
  const marker=f.sql.prepare('SELECT compatibility_version,expected_clients,source_clients_version FROM delivery_client_shadow_meta').get();
  assert.equal(marker.compatibility_version,frozen.version+2);
  assert.equal(marker.expected_clients,2);
  assert.equal(marker.source_clients_version,
   f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.clients.v3'").get().version);
  assert.equal(f.sql.prepare("SELECT source_revision FROM delivery_client_plan_claim_heads WHERE company='second-client'").get().source_revision,1);
  assert.equal(f.sql.prepare("SELECT source_revision FROM delivery_client_deadline_heads WHERE company='second-client'").get().source_revision,1);
  assert.equal(f.sql.prepare("SELECT source_revision FROM delivery_client_effective_heads WHERE company='second-client'").get().source_revision,1);
  assert.equal((await getDoc(f.db,'default','ontology.delivery.v2')).value.extraCycles.length,2);
  assert.deepEqual((await f.run('clients.create',request,'active-new-client')).data,
   JSON.parse(JSON.stringify(saved.data)));
 }finally{f.sql.close();}
});
test('an empty new client gets a revision-one slice and zero-count heads',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  activateClientShadow(f);
  certifyActivePlanClaims(f);
  const request={client:{...input.client,slug:'empty-client',name:'Vazio'},
   config:{productIds:[]},stakeholders:[]};
  const saved=await f.run('clients.create',request,'active-empty-client');
  assert.deepEqual(saved.data.enrollments,[]);
  assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='empty-client'").get().revision,1);
  assert.equal(f.sql.prepare("SELECT expected_claims FROM delivery_client_plan_claim_heads WHERE company='empty-client'").get().expected_claims,0);
  assert.equal(f.sql.prepare("SELECT expected_dependencies FROM delivery_client_deadline_heads WHERE company='empty-client'").get().expected_dependencies,0);
  assert.deepEqual({...f.sql.prepare("SELECT expected_tasks,expected_cycles FROM delivery_client_effective_heads WHERE company='empty-client'").get()},
   { expected_tasks: 0, expected_cycles: 0 });
 }finally{f.sql.close();}
});
test('a new-client sale commits two purchases and preserves cross-client order without the global body',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const frozen=activateClientShadow(f,true);
  certifyActivePlanClaims(f);
  const request={client:{create:{...input.client,slug:'sale-client',name:'Venda'}},
   enrollments:[
    {ref:'first',productId:'product',startsAt:'2026-04-01'},
    {ref:'second',productId:'product',startsAt:'2026-05-01'},
   ]};
  const saved=await f.run('sales.register',request,'active-new-sale');
  assert.equal(saved.data.enrollments.length,2);
  assert.equal(f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.delivery.v2'").get().version,frozen.version);
  assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='sale-client'").get().revision,1);
  const effective=(await getDoc(f.db,'default','ontology.delivery.v2')).value;
  assert.deepEqual(effective.extraCycles.map(cycle=>cycle.company),
   ['new-client','sale-client','sale-client']);
  assert.equal(f.sql.prepare("SELECT expected_claims FROM delivery_client_plan_claim_heads WHERE company='sale-client'").get().expected_claims,2);
  assert.equal(f.sql.prepare("SELECT source_revision FROM delivery_client_deadline_heads WHERE company='sale-client'").get().source_revision,1);
  assert.deepEqual((await f.run('sales.register',request,'active-new-sale')).data,
   JSON.parse(JSON.stringify(saved.data)));
 }finally{f.sql.close();}
});
test('new-client creation refuses a historical slice for the same slug',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  activateClientShadow(f);
  const body=JSON.stringify(reconstructDeliverySnapshot([],{sparse:true}));
  f.sql.prepare(`INSERT INTO delivery_client_snapshots
    (workspace_id,generation,company,revision,body,body_sha256,incarnation)
    VALUES('default','commercial-test','former-client',1,?,?,?)`)
   .run(body,createHash('sha256').update(body).digest('hex'),crypto.randomUUID());
  f.sql.prepare('UPDATE delivery_client_shadow_meta SET expected_clients=expected_clients+1').run();
  assert.equal(await readActiveNewClientAuthority(f.db,'default','former-client'),null);
 }finally{f.sql.close();}
});
test('new-client creation replaces stale heads from a previous generation',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  activateClientShadow(f);
  certifyActivePlanClaims(f);
  f.sql.prepare(`INSERT INTO delivery_client_plan_claim_heads
    (workspace_id,company,authority_generation,source_revision,source_incarnation,
     projection_generation,expected_claims,updated_at)
    VALUES('default','recreated-client','old-generation',4,'old-incarnation','old-claims',1,'old')`).run();
  f.sql.prepare(`INSERT INTO delivery_client_effective_heads
    (workspace_id,company,authority_generation,source_revision,source_incarnation,
     projection_generation,expected_tasks,expected_cycles,updated_at)
    VALUES('default','recreated-client','old-generation',4,'old-incarnation','old-page',7,3,'old')`).run();
  f.sql.prepare(`INSERT INTO delivery_client_deadline_heads
    (workspace_id,company,authority_generation,source_revision,source_incarnation,
     projection_generation,expected_dependencies,updated_at)
    VALUES('default','recreated-client','old-generation',4,'old-incarnation','old-deadlines',1,'old')`).run();
  await f.run('clients.create',{client:{...input.client,slug:'recreated-client',name:'Recriado'},
   config:{productIds:['product']},stakeholders:[]},'recreated-client');
  const slice=f.sql.prepare("SELECT revision,incarnation FROM delivery_client_snapshots WHERE company='recreated-client'").get();
  for(const table of ['delivery_client_plan_claim_heads','delivery_client_effective_heads',
    'delivery_client_deadline_heads']) {
   const head=f.sql.prepare(`SELECT authority_generation,source_revision,source_incarnation FROM ${table} WHERE company='recreated-client'`).get();
   assert.equal(head.authority_generation,'commercial-test');
   assert.equal(head.source_revision,slice.revision);
   assert.equal(head.source_incarnation,slice.incarnation);
  }
 }finally{f.sql.close();}
});
test('concurrent new-client creation keeps one slice and one receipt',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  activateClientShadow(f);
  certifyActivePlanClaims(f);
  const request={client:{...input.client,slug:'raced-client',name:'Concorrente'},
   config:{productIds:['product']},stakeholders:[]};
  const batch=f.db.batch.bind(f.db);
  let winner;
  f.db.batch=async statements=>{
   f.db.batch=batch;
   winner=await f.run('clients.create',request,'raced-winner');
   return batch(statements);
  };
  await assert.rejects(f.run('clients.create',request,'raced-loser'),{code:'version_conflict'});
  assert.equal(winner.data.client.slug,'raced-client');
  assert.equal(f.sql.prepare("SELECT count(*) n FROM delivery_client_snapshots WHERE company='raced-client'").get().n,1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_receipts WHERE idempotency_key='raced-loser'").get().n,0);
  assert.equal(f.sql.prepare('SELECT expected_clients FROM delivery_client_shadow_meta').get().expected_clients,2);
 }finally{f.sql.close();}
});
test('new-client creation rolls back every projection on a late reference collision',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  activateClientShadow(f);
  certifyActivePlanClaims(f);
  const before=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get();
  const marker=f.sql.prepare('SELECT compatibility_version,expected_clients FROM delivery_client_shadow_meta').get();
  const batch=f.db.batch.bind(f.db);
  f.db.batch=async statements=>{
   f.sql.prepare(`INSERT INTO external_references
     (workspace_id,system,kind,external_id,entity_id)
     VALUES('default','crm','client','late-new-client','elsewhere')`).run();
   return batch(statements);
  };
  await assert.rejects(f.run('clients.create',{
   client:{...input.client,slug:'late-client',name:'Tardio'},config:{productIds:['product']},
   externalReference:{system:'crm',kind:'client',externalId:'late-new-client'},
  },'active-late-client'),{code:'external_reference_conflict'});
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get(),before);
  assert.deepEqual(f.sql.prepare('SELECT compatibility_version,expected_clients FROM delivery_client_shadow_meta').get(),marker);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM delivery_client_snapshots WHERE company='late-client'").get().n,0);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_receipts WHERE idempotency_key='active-late-client'").get().n,0);
 }finally{f.sql.close();}
});
test('create commits client, allocation, stakeholder and purchased execution together; replay cannot duplicate',async()=>{
 const f=await fixture();
 const result=await f.run('clients.create',input,'create');
 assert.equal(result.data.enrollments.length,1);
 assert.deepEqual(result.documents,[],'scoped integrations never receive entire documents');
 const clients=f.read('ontology.clients.v3'),delivery=f.read('ontology.delivery.v2');
 assert.equal(clients.extraClients[0].createdBy,'admin');
 assert.equal(clients.configs['new-client'].model,'implementacao');
 assert.equal(clients.allocations.filter(a=>a.company==='new-client').length,2);
 assert.equal(delivery.extraCycles[0].enrollmentId,clients.enrollments[0].id);
 assert.equal(f.read('ontology.stakeholders.v1').contacts.filter(c=>c.company==='new-client').length,1);
 assert.deepEqual(await f.run('clients.create',input,'create'),JSON.parse(JSON.stringify(result)));
 assert.equal(f.read('ontology.delivery.v2').extraCycles.length,1);
 await assert.rejects(f.run('clients.create',{...input,client:{...input.client,name:'Different'}},'create'),{code:'idempotency_conflict'});
 await revokeIntegrationCredential(f.db,'default','admin@example.com',f.issued.id);
 await assert.rejects(f.run('clients.create',input,'create'),{code:'invalid_token'});
 f.sql.close();
});
test('stakeholder commands store multiple canonical contacts and enforce workspace-wide ownership',async()=>{
 const f=await fixture();
 await f.run('clients.create',input);
 const saved=await f.run('stakeholders.save',{company:'new-client',stakeholder:{name:'Financeiro',role:'Diretora',emails:['FINANCE@example.com','billing@example.com'],phones:['(31) 99999-8888','21987654321']}});
 assert.deepEqual(saved.data.stakeholder.emails,['finance@example.com','billing@example.com']);
 assert.deepEqual(saved.data.stakeholder.phones,['5531999998888','5521987654321']);
 assert.equal(saved.data.stakeholder.email,'finance@example.com');
 assert.equal(saved.data.stakeholder.phone,'5531999998888');
 await assert.rejects(f.run('stakeholders.save',{company:'new-client',stakeholder:{name:'Duplicado',role:'Compras',emails:['ADMIN@example.com']}}),/outra pessoa/);
 const clients=f.read('ontology.clients.v3');
 clients.extraClients.push({...clients.extraClients[0],slug:'second-client',name:'Segundo'});
 replaceDocument(f,'ontology.clients.v3',clients);
 await assert.rejects(f.run('stakeholders.save',{company:'second-client',stakeholder:{name:'Duplicado',role:'Compras',phones:['+55 21 98765-4321']}}),/outra pessoa/);
 f.sql.close();
});
test('stakeholder edits do not read the global execution document',async()=>{
 const f=await fixture();
 await f.run('clients.create',input);
 f.sql.prepare("UPDATE state_documents SET body='invalid-delivery-body' WHERE key='ontology.delivery.v2'").run();
 const saved=await f.run('stakeholders.save',{company:'new-client',stakeholder:{name:'Contato',role:'Diretor',email:'contact@example.com'}});
 assert.equal(saved.data.stakeholder.email,'contact@example.com');
 const removed=await f.run('stakeholders.remove',{company:'new-client',id:saved.data.stakeholder.id});
 assert.equal(removed.data.stakeholder.active,false);
 f.sql.close();
});
test('client archive and enrollment status edits do not read global execution',async()=>{
 const f=await fixture();
 const created=await f.run('clients.create',input);
 const enrollmentId=created.data.enrollments[0].id;
 f.sql.prepare("UPDATE state_documents SET body='invalid-delivery-body' WHERE key='ontology.delivery.v2'").run();
 const updated=await f.run('enrollments.update',{company:'new-client',enrollmentId,status:'pausada'});
 assert.equal(updated.data.enrollment.status,'pausada');
 await f.run('clients.archive',{company:'new-client'});
 assert.ok(f.read('ontology.clients.v3').archivedClients.includes('new-client'));
 await f.run('clients.restore',{company:'new-client'});
 assert.ok(!f.read('ontology.clients.v3').archivedClients.includes('new-client'));
 f.sql.close();
});
test('failed compound create saves no client or receipt; repeated purchase has separate dated execution',async()=>{
 const f=await fixture();
 await assert.rejects(f.run('clients.create',{...input,config:{productIds:['missing']}},'bad'),{code:'invalid_input'});
 assert.equal(f.sql.prepare("SELECT count(*) n FROM state_documents WHERE key='ontology.clients.v3'").get().n,0);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_receipts').get().n,0);
 await f.run('clients.create',input);
 const second=await f.run('enrollments.create',{company:'new-client',productId:'product',startsAt:'2026-04-01'});
 const delivery=f.read('ontology.delivery.v2');assert.equal(delivery.extraCycles.length,2);
 assert.equal(delivery.extraCycles[1].startsAt,'2026-04-01');
 assert.notEqual(delivery.extraCycles[0].id,delivery.extraCycles[1].id);
 assert.equal(delivery.extraCycles[1].enrollmentId,second.data.enrollment.id);
 f.sql.close();
});
test('first purchase selects its private plan only when no real legacy execution exists',async()=>{
 for(const hasLegacy of [false,true]) {
  const f=await fixture();
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,?)").run(JSON.stringify({extraClients:[{slug:'existing',name:'Existente',startedAt:'2026-01-01',leadId:'admin',csId:'admin',journeyId:'service-delivery'}],allocationsMigrated:true,allocations:[]}));
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.delivery.v2',1,?)").run(JSON.stringify({companyJourney:{existing:'service-delivery'},extraTasks:hasLegacy?[{id:'legacy',company:'existing',title:'Histórica',description:'',status:'fila',ownerId:'admin',dueAt:'2026-02-01',hours:1,workstream:'Execução',milestone:1,completion:'checklist'}]:[]}));
  const result=await f.run('enrollments.create',{company:'existing',productId:'product',startsAt:'2026-03-01'});
  assert.equal(f.read('ontology.delivery.v2').companyJourney.existing,hasLegacy?'service-delivery':result.data.enrollment.planId);
  assert.equal(f.read('ontology.clients.v3').configs.existing.model,hasLegacy?'consultoria':'implementacao');
  f.sql.close();
 }
});
test('session purchase keeps its receipt compact and rehydrates documents on replay',async()=>{
 const f=await fixture();await f.run('clients.create',input);
 const delivery=f.read('ontology.delivery.v2'),task=delivery.extraTasks[0];
 delivery.taskPatches[task.id]={evidence:'x'.repeat(100_000)};replaceDocument(f,'ontology.delivery.v2',delivery);
 const principal={id:'member:admin',memberId:'admin',email:'admin@example.com',kind:'session',application:'web',scopes:null,companies:null};
 const purchase={company:'new-client',productId:'product',startsAt:'2026-04-01'},key='session-purchase';
 const first=await executeCommercialCommand(f.db,'default',principal,'enrollments.create',purchase,key,{});
 assert.equal(first.documents.length,2);assert.ok(JSON.stringify(first.documents).length>100_000);
 const receipt=f.sql.prepare('SELECT result FROM operation_receipts WHERE principal_id=? AND idempotency_key=?').get(principal.id,key).result;
 assert.ok(receipt.length<5_000);assert.equal(JSON.parse(receipt).documents.every(document=>document.value===undefined),true);
 const replay=await executeCommercialCommand(f.db,'default',principal,'enrollments.create',purchase,key,{});
 assert.equal(replay.data.enrollment.id,first.data.enrollment.id);assert.equal(replay.documents.length,2);
 assert.ok(replay.documents.every(document=>document.value!==undefined));
 f.sql.close();
});
test('stale form and concurrent authorization change cannot partially save',async()=>{
 const f=await fixture();await f.run('clients.create',input);
 await assert.rejects(f.run('clients.configure',{...input,client:{...input.client,name:'Changed'}},'stale',{'ontology.clients.v3':0}),{code:'version_conflict'});
 assert.equal(f.read('ontology.clients.v3').extraClients[0].name,'Cliente');
 assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_receipts WHERE idempotency_key='stale'").get().n,0);
 f.sql.close();
});
test('active client settings save without reading or rewriting global execution',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const planId=f.read('ontology.delivery.v2').companyJourney['new-client'];
  const frozen=activateClientShadow(f,true);
  const prepare=f.db.prepare.bind(f.db);
  f.db.prepare=query=>{
   if(/SELECT company,body FROM delivery_client_snapshots\s+WHERE workspace_id=\? AND generation=\? ORDER BY company/.test(query))
    throw new Error('Unexpected global execution reconstruction');
   return prepare(query);
  };
  const session={id:'member:admin',memberId:'admin',email:'admin@example.com',kind:'session',application:'web',scopes:null,companies:null};
  const request={...input,client:{...input.client,name:'Nome atualizado'},stakeholders:undefined,journeyId:planId,milestone:1};
  const saved=await executeCommercialCommand(f.db,'default',session,'clients.configure',request,'active-settings');
  assert.equal(saved.data.client.name,'Nome atualizado');
  assert.deepEqual(saved.documents.map(doc=>doc.key),['ontology.clients.v3']);
  assert.equal(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get().body,'invalid-delivery-body');
  assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='new-client'").get().revision,1);
  const meta=f.sql.prepare('SELECT compatibility_version,source_clients_version FROM delivery_client_shadow_meta').get();
  assert.equal(meta.compatibility_version,frozen.version+2);
  assert.equal(meta.source_clients_version,f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.clients.v3'").get().version);
  assert.deepEqual((await executeCommercialCommand(f.db,'default',session,'clients.configure',request,'active-settings')).data,
    JSON.parse(JSON.stringify(saved.data)));
  await assert.rejects(executeCommercialCommand(f.db,'default',session,'clients.configure',
    {...request,client:{...request.client,name:'Não salvo'}},'active-settings-stale',
    {'ontology.delivery.v2':meta.compatibility_version-1}),{code:'version_conflict'});
 }finally{f.sql.close();}
});
test('active client settings abort atomically if their execution slice changes',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const planId=f.read('ontology.delivery.v2').companyJourney['new-client'];
  activateClientShadow(f);
  const before=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get();
  const batch=f.db.batch.bind(f.db);
  f.db.batch=async statements=>{
   f.sql.prepare("UPDATE delivery_client_snapshots SET revision=revision+1 WHERE company='new-client'").run();
   return batch(statements);
  };
  await assert.rejects(f.run('clients.configure',{
   ...input,client:{...input.client,name:'Não salvo'},stakeholders:undefined,journeyId:planId,milestone:1,
  },'active-settings-race'),{code:'version_conflict'});
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get(),before);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_receipts WHERE idempotency_key='active-settings-race'").get().n,0);
 }finally{f.sql.close();}
});
test('active repeat purchase updates one slice and clients without reconstructing delivery',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const selected=f.read('ontology.delivery.v2').companyJourney['new-client'];
  const frozen=activateClientShadow(f,true);
  const initialOwners=f.sql.prepare('SELECT expected_owners FROM delivery_client_shadow_meta').get().expected_owners;
  const prepare=f.db.prepare.bind(f.db);
  f.db.prepare=query=>{
   if(/SELECT company,body FROM delivery_client_snapshots\s+WHERE workspace_id=\? AND generation=\? ORDER BY company/.test(query))
    throw new Error('Unexpected global execution reconstruction');
   return prepare(query);
  };
  const session={id:'member:admin',memberId:'admin',email:'admin@example.com',kind:'session',application:'web',scopes:null,companies:null};
  const request={company:'new-client',productId:'product',startsAt:'2026-04-01'};
  const saved=await executeCommercialCommand(f.db,'default',session,'enrollments.create',request,'active-purchase');
  assert.equal(saved.data.enrollment.startsAt,'2026-04-01');
  assert.deepEqual(saved.documents.map(doc=>doc.key),['ontology.clients.v3']);
  assert.equal(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get().body,'invalid-delivery-body');
  assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='new-client'").get().revision,2);
  const marker=f.sql.prepare('SELECT compatibility_version,source_clients_version,expected_owners FROM delivery_client_shadow_meta').get();
  assert.equal(marker.compatibility_version,frozen.version+2);
  assert.equal(marker.source_clients_version,f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.clients.v3'").get().version);
  assert.equal(marker.expected_owners,initialOwners+2);
  assert.deepEqual((await executeCommercialCommand(f.db,'default',session,'enrollments.create',request,'active-purchase')).data,
    JSON.parse(JSON.stringify(saved.data)));
  f.db.prepare=prepare;
  const effective=(await getDoc(f.db,'default','ontology.delivery.v2')).value;
  assert.equal(effective.companyJourney['new-client'],selected);
  assert.equal(effective.extraCycles.length,2);
 }finally{f.sql.close();}
});
test('active existing-client sale composes contacts and multiple purchases without global execution',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const selected=f.read('ontology.delivery.v2').companyJourney['new-client'];
  const frozen=activateClientShadow(f,true);
  const prepare=f.db.prepare.bind(f.db);
  f.db.prepare=query=>{
   if(/SELECT company,body FROM delivery_client_snapshots\s+WHERE workspace_id=\? AND generation=\? ORDER BY company/.test(query))
    throw new Error('Unexpected global execution reconstruction');
   return prepare(query);
  };
  const session={id:'member:admin',memberId:'admin',email:'admin@example.com',kind:'session',application:'web',scopes:null,companies:null};
  const request={client:{id:'new-client'},externalReference:{system:'crm',externalId:'active-sale'},
   contacts:[{ref:'new-contact',stakeholder:{name:'Nova pessoa',role:'Diretora'}}],
   enrollments:[
    {ref:'first',productId:'product',startsAt:'2026-04-01',externalReference:{system:'crm',externalId:'active-first'},participants:[{stakeholderRef:'new-contact',accountRole:'tecnico'}]},
    {ref:'second',productId:'product',startsAt:'2026-05-01'},
   ]};
  const saved=await executeCommercialCommand(f.db,'default',session,'sales.register',request,'active-sale');
  assert.equal(saved.data.enrollments.length,2);
  assert.equal(saved.data.enrollments[0].participants[0].stakeholderId,saved.data.contacts[0].stakeholder.id);
  assert.deepEqual(saved.documents.map(doc=>doc.key).sort(),['ontology.clients.v3','ontology.stakeholders.v1']);
  assert.equal(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get().body,'invalid-delivery-body');
  assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='new-client'").get().revision,2);
  assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version,frozen.version+2);
  assert.deepEqual((await executeCommercialCommand(f.db,'default',session,'sales.register',request,'active-sale')).data,
   JSON.parse(JSON.stringify(saved.data)));
  assert.deepEqual((await executeCommercialCommand(f.db,'default',session,'sales.register',request,'active-sale-other-key')).data,
   JSON.parse(JSON.stringify(saved.data)));
  f.db.prepare=prepare;
  const effective=(await getDoc(f.db,'default','ontology.delivery.v2')).value;
  assert.equal(effective.companyJourney['new-client'],selected);
  assert.equal(effective.extraCycles.length,3);
 }finally{f.sql.close();}
});
test('active first existing-client sale selects only a single purchased plan',async()=>{
 for(const count of [1,2]){
  const f=await fixture();try{
   await f.run('clients.create',{...input,config:{productIds:[]},stakeholders:[]});
   f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.delivery.v2',1,'{}')").run();
   activateClientShadow(f);
   const request={client:{id:'new-client'},enrollments:Array.from({length:count},(_,index)=>({
    ref:`purchase-${index}`,productId:'product',startsAt:`2026-0${index+4}-01`,
   }))};
   const saved=await executeCommercialCommand(f.db,'default',f.principal,'sales.register',request,`active-first-sale-${count}`);
   const effective=(await getDoc(f.db,'default','ontology.delivery.v2')).value;
   assert.equal(effective.extraCycles.length,count);
   assert.equal(effective.companyJourney['new-client'],count===1?saved.data.enrollments[0].enrollment.planId:undefined);
   assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='new-client'").get().revision,2);
  }finally{f.sql.close();}
 }
});
test('active first purchase selects its private plan without global execution',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',{...input,config:{productIds:[]},stakeholders:[]});
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.delivery.v2',1,'{}')").run();
  activateClientShadow(f);
  const before=f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get().body;
  const saved=await f.run('enrollments.create',{company:'new-client',productId:'product',startsAt:'2026-04-01'},'active-first-purchase');
  assert.equal(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get().body,before);
  assert.equal((await getDoc(f.db,'default','ontology.delivery.v2')).value.companyJourney['new-client'],saved.data.enrollment.planId);
  assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='new-client'").get().revision,2);
 }finally{f.sql.close();}
});
test('active purchase aborts atomically when its execution revision changes',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  activateClientShadow(f);
  const before=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get();
  const batch=f.db.batch.bind(f.db);
  f.db.batch=async statements=>{
   f.sql.prepare("UPDATE delivery_client_snapshots SET revision=revision+1 WHERE company='new-client'").run();
   return batch(statements);
  };
  await assert.rejects(f.run('enrollments.create',
    {company:'new-client',productId:'product',startsAt:'2026-04-01'},'active-purchase-race'),
  {code:'version_conflict'});
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get(),before);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_receipts WHERE idempotency_key='active-purchase-race'").get().n,0);
 }finally{f.sql.close();}
});
test('active purchase reports authority switch as a recoverable conflict',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  activateClientShadow(f);
  const before=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get();
  const prepare=f.db.prepare.bind(f.db);
  f.db.prepare=query=>{
   if(/SELECT generation,mode,compatibility_version\s+FROM delivery_client_shadow_meta/.test(query))
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='shadow' WHERE workspace_id='default'").run();
   return prepare(query);
  };
  await assert.rejects(f.run('enrollments.create',
    {company:'new-client',productId:'product',startsAt:'2026-04-01'},'active-authority-race'),
  {code:'version_conflict'});
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get(),before);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_receipts WHERE idempotency_key='active-authority-race'").get().n,0);
 }finally{f.sql.close();}
});
test('two active client purchases preserve global order after a cross-client conflict',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  await f.run('clients.create',{...input,client:{...input.client,slug:'other-client',name:'Outro'},stakeholders:[]});
  activateClientShadow(f);
  const frozen=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.delivery.v2'").get();
  const before=f.sql.prepare('SELECT compatibility_version,expected_owners,expected_map_order FROM delivery_client_shadow_meta').get();
  const batch=f.db.batch.bind(f.db);
  const first={company:'new-client',productId:'product',startsAt:'2026-04-01'};
  const other={company:'other-client',productId:'product',startsAt:'2026-04-02'};
  let concurrent;
  f.db.batch=async statements=>{
   f.db.batch=batch;
   concurrent=await f.run('enrollments.create',other,'other-purchase');
   return batch(statements);
  };
  await assert.rejects(f.run('enrollments.create',first,'first-conflicted'),{code:'version_conflict'});
  assert.ok(concurrent.data.enrollment.id);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_receipts WHERE idempotency_key='first-conflicted'").get().n,0);
  assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='new-client'").get().revision,1);
  assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='other-client'").get().revision,2);
  const middle=f.sql.prepare('SELECT compatibility_version,expected_owners,expected_map_order FROM delivery_client_shadow_meta').get();
  assert.equal(middle.compatibility_version,before.compatibility_version+1);
  assert.equal(middle.expected_owners,before.expected_owners+2);
  assert.equal(middle.expected_map_order,before.expected_map_order+1);
  const retried=await f.run('enrollments.create',first,'first-retried');
  assert.ok(retried.data.enrollment.id);
  const final=(await getDoc(f.db,'default','ontology.delivery.v2')).value;
  assert.deepEqual(final.extraCycles.map(cycle=>cycle.company),
    ['new-client','other-client','other-client','new-client']);
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.delivery.v2'").get(),frozen);
 }finally{f.sql.close();}
});
test('active purchase rolls back client and slice if the final external reference collides',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  activateClientShadow(f);
  const beforeClient=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get();
  const beforeSlice=f.sql.prepare("SELECT revision,body FROM delivery_client_snapshots WHERE company='new-client'").get();
  const beforeMeta=f.sql.prepare('SELECT compatibility_version,source_clients_version,expected_owners,expected_map_order FROM delivery_client_shadow_meta').get();
  const batch=f.db.batch.bind(f.db);
  f.db.batch=async statements=>{
   f.sql.prepare(`INSERT INTO external_references
     (workspace_id,system,kind,external_id,entity_id)
     VALUES('default','crm','enrollment','late-collision','elsewhere')`).run();
   return batch(statements);
  };
  await assert.rejects(f.run('enrollments.create',{
   company:'new-client',productId:'product',startsAt:'2026-04-01',
   externalReference:{system:'crm',kind:'enrollment',externalId:'late-collision'},
  },'active-external-race'),{code:'external_reference_conflict'});
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get(),beforeClient);
  assert.deepEqual(f.sql.prepare("SELECT revision,body FROM delivery_client_snapshots WHERE company='new-client'").get(),beforeSlice);
  assert.deepEqual(f.sql.prepare('SELECT compatibility_version,source_clients_version,expected_owners,expected_map_order FROM delivery_client_shadow_meta').get(),beforeMeta);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_receipts WHERE idempotency_key='active-external-race'").get().n,0);
 }finally{f.sql.close();}
});
test('active client plan change writes its slice without reconstructing global execution',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const frozen=activateClientShadow(f,true);
  const prepare=f.db.prepare.bind(f.db);
  f.db.prepare=query=>{
   if(/SELECT company,body FROM delivery_client_snapshots\s+WHERE workspace_id=\? AND generation=\? ORDER BY company/.test(query))
    throw new Error('Unexpected global execution reconstruction');
   return prepare(query);
  };
  await f.run('clients.configure',{
   ...input,stakeholders:undefined,journeyId:'service-delivery',milestone:1,
  },'active-plan-change');
  f.db.prepare=prepare;
  assert.equal(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get().body,'invalid-delivery-body');
  assert.equal(f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.delivery.v2'").get().version,frozen.version);
  assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='new-client'").get().revision,2);
  assert.equal((await getDoc(f.db,'default','ontology.delivery.v2')).value.companyJourney['new-client'],'service-delivery');
  const meta=f.sql.prepare('SELECT compatibility_version,source_clients_version FROM delivery_client_shadow_meta').get();
  assert.equal(meta.compatibility_version,frozen.version+2);
  assert.equal(meta.source_clients_version,f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.clients.v3'").get().version);
 }finally{f.sql.close();}
});
test('active client configuration adds a new purchased product in one client batch',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const catalog=f.read('ontology.catalog.v2');
  catalog.extraProducts.push({id:'another',name:'Outro produto',description:'',version:1,
   cycles:[{id:'another-cycle',name:'Outro ciclo',goal:'Resultado',durationDays:14,
    acceptance:['Aceito'],deliveries:[{id:'another-task',title:'Outra tarefa',description:'',day:3,hours:1}]}]});
  replaceDocument(f,'ontology.catalog.v2',catalog);
  const selected=f.read('ontology.delivery.v2').companyJourney['new-client'];
  const frozen=activateClientShadow(f,true);
  const prepare=f.db.prepare.bind(f.db);
  f.db.prepare=query=>{
   if(/SELECT company,body FROM delivery_client_snapshots\s+WHERE workspace_id=\? AND generation=\? ORDER BY company/.test(query))
    throw new Error('Unexpected global execution reconstruction');
   return prepare(query);
  };
  const request={...input,stakeholders:undefined,config:{productIds:['product','another']}};
  const saved=await f.run('clients.configure',request,'active-config-purchase');
  f.db.prepare=prepare;
  assert.equal(saved.data.enrollments.length,1);
  assert.equal(saved.data.enrollments[0].productId,'another');
  assert.equal(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get().body,
   'invalid-delivery-body');
  assert.equal(f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.delivery.v2'").get().version,
   frozen.version);
  assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='new-client'").get().revision,2);
  const effective=(await getDoc(f.db,'default','ontology.delivery.v2')).value;
  assert.equal(effective.companyJourney['new-client'],selected);
  assert.equal(effective.extraCycles.length,2);
  const marker=f.sql.prepare('SELECT compatibility_version,source_clients_version FROM delivery_client_shadow_meta').get();
  assert.equal(marker.compatibility_version,frozen.version+2);
  assert.equal(marker.source_clients_version,
   f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.clients.v3'").get().version);
  assert.deepEqual((await f.run('clients.configure',request,'active-config-purchase')).data,
   JSON.parse(JSON.stringify(saved.data)));
 }finally{f.sql.close();}
});
test('active configuration adds two purchases and selects the newly purchased plan',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const catalog=f.read('ontology.catalog.v2');
  for(const id of ['second','third']) catalog.extraProducts.push({
   id,name:id,description:'',version:1,cycles:[{id:`${id}-cycle`,name:id,goal:'Resultado',
    durationDays:14,acceptance:['Aceito'],deliveries:[{id:`${id}-task`,
     title:id,description:'',day:3,hours:1}]}],
  });
  catalog.extraJourneys=[{id:'second-public-plan',productId:'second',name:'Plano segundo',
   description:'',milestones:[{n:1,name:'Início',stage:'Execução',owner:'Equipe'}]}];
  replaceDocument(f,'ontology.catalog.v2',catalog);
  const frozen=activateClientShadow(f,true);
  const request={...input,stakeholders:undefined,journeyId:'second-public-plan',
   config:{productIds:['product','second','third']}};
  const result=await f.run('clients.configure',request,'active-two-config-purchases');
  assert.deepEqual(result.data.enrollments.map(enrollment=>enrollment.productId),['second','third']);
  const selected=result.data.enrollments[0].planId;
  const effective=(await getDoc(f.db,'default','ontology.delivery.v2')).value;
  assert.equal(effective.companyJourney['new-client'],selected);
  assert.equal(effective.extraCycles.length,3);
  assert.equal(f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.delivery.v2'").get().version,
   frozen.version);
  assert.equal(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get().body,
   'invalid-delivery-body');
 }finally{f.sql.close();}
});
test('new product configuration rolls back clients and execution on a late slice conflict',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const catalog=f.read('ontology.catalog.v2');
  catalog.extraProducts.push({id:'second',name:'Segundo',description:'',version:1,
   cycles:[{id:'second-cycle',name:'Ciclo',goal:'Resultado',durationDays:14,
    acceptance:['Aceito'],deliveries:[{id:'second-task',title:'Tarefa',
     description:'',day:3,hours:1}]}]});
  replaceDocument(f,'ontology.catalog.v2',catalog);
  activateClientShadow(f);
  const beforeClient=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get();
  const beforeSlice=f.sql.prepare("SELECT revision,body FROM delivery_client_snapshots WHERE company='new-client'").get();
  const batch=f.db.batch.bind(f.db);
  f.db.batch=async statements=>{
   f.sql.prepare("UPDATE delivery_client_snapshots SET revision=revision+1 WHERE company='new-client'").run();
   return batch(statements);
  };
  await assert.rejects(f.run('clients.configure',{...input,stakeholders:undefined,
   config:{productIds:['product','second']}},'active-config-new-race'),{code:'version_conflict'});
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get(),
   beforeClient);
  assert.equal(f.sql.prepare("SELECT body FROM delivery_client_snapshots WHERE company='new-client'").get().body,
   beforeSlice.body);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_receipts WHERE idempotency_key='active-config-new-race'").get().n,0);
 }finally{f.sql.close();}
});
test('active client plan change rolls back when its slice changes concurrently',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  activateClientShadow(f);
  const before=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get();
  const batch=f.db.batch.bind(f.db);
  f.db.batch=async statements=>{
   f.sql.prepare("UPDATE delivery_client_snapshots SET revision=revision+1 WHERE company='new-client'").run();
   return batch(statements);
  };
  await assert.rejects(f.run('clients.configure',{
   ...input,client:{...input.client,name:'Não salvo'},stakeholders:undefined,
   journeyId:'service-delivery',milestone:1,
  },'active-plan-change-race'),{code:'version_conflict'});
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get(),before);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_receipts WHERE idempotency_key='active-plan-change-race'").get().n,0);
 }finally{f.sql.close();}
});
test('active public plan selection provisions its tasks in the client slice',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const catalog=f.read('ontology.catalog.v2');
  catalog.extraJourneys=[{id:'public-auto',name:'Plano automático',description:'',autoCreateCycles:true,
   milestones:[{n:1,name:'Início',stage:'Execução',owner:'Equipe',period:{startMonth:1,endMonth:1},
    tasks:[{id:'public-task',title:'Tarefa pública',hours:1}]}]}];
  replaceDocument(f,'ontology.catalog.v2',catalog);
  activateClientShadow(f,true);
  const prepare=f.db.prepare.bind(f.db);
  f.db.prepare=query=>{
   if(/SELECT company,body FROM delivery_client_snapshots\s+WHERE workspace_id=\? AND generation=\? ORDER BY company/.test(query))
    throw new Error('Unexpected global execution reconstruction');
   return prepare(query);
  };
  await f.run('clients.configure',{...input,stakeholders:undefined,journeyId:'public-auto',milestone:1},'active-auto-plan');
  f.db.prepare=prepare;
  const effective=(await getDoc(f.db,'default','ontology.delivery.v2')).value;
  assert.equal(effective.companyJourney['new-client'],'public-auto');
  assert.equal(projectDelivery(effective).tasks.some(task=>task.company==='new-client'&&task.journeyId==='public-auto'),true);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM delivery_entity_owners WHERE company='new-client' AND kind='task'").get().n,
   projectDelivery(effective).tasks.filter(task=>task.company==='new-client').length);
 }finally{f.sql.close();}
});
test('active plan change refuses to orphan a private plan claimed only by selection',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const delivery=f.read('ontology.delivery.v2');
  delivery.productPlans['selection-only']={id:'selection-only',name:'Plano privado',description:'',milestones:[
   {n:1,name:'Início',stage:'Execução',owner:'Equipe'},
  ]};
  delivery.companyJourney['new-client']='selection-only';
  replaceDocument(f,'ontology.delivery.v2',delivery);
  activateClientShadow(f);
  const beforeClient=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get();
  const beforeSlice=f.sql.prepare("SELECT revision,body FROM delivery_client_snapshots WHERE company='new-client'").get();
  await assert.rejects(f.run('clients.configure',{
   ...input,stakeholders:undefined,journeyId:'service-delivery',milestone:1,
  },'orphan-plan-change'),{code:'execution_ownership_ambiguous'});
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.clients.v3'").get(),beforeClient);
  assert.deepEqual(f.sql.prepare("SELECT revision,body FROM delivery_client_snapshots WHERE company='new-client'").get(),beforeSlice);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_receipts WHERE idempotency_key='orphan-plan-change'").get().n,0);
 }finally{f.sql.close();}
});
test('REST enforces client grants and never reads nested enrollment with clients scope only',async()=>{
 const f=await fixture();await f.run('clients.create',input);
 const token=await issueIntegrationCredential(f.db,'default','admin@example.com',{name:'Limited',ownerEmail:'admin@example.com',scopes:['clients:read'],companies:['new-client'],expiresAt:new Date(Date.now()+3600000).toISOString()});
 const request=(path)=>new Request(`https://delivery.test/api/v1/${path}`,{headers:{authorization:`Bearer ${token.token}`}});
 const allowed=await apiResponse(request('clients'),{DB:f.db},['clients']);
 assert.equal(allowed.status,200);assert.equal((await allowed.json()).data.length,1);
 const denied=await apiResponse(request('clients/santa-clara'),{DB:f.db},['clients','santa-clara']);assert.equal(denied.status,403);
 const nested=await apiResponse(request('clients/new-client/enrollments'),{DB:f.db},['clients','new-client','enrollments']);assert.equal(nested.status,403);
 f.sql.close();
});

function replaceDocument(f,key,value) {
 f.sql.prepare('UPDATE state_documents SET body=?,version=version+1 WHERE key=?').run(JSON.stringify(value),key);
}
test('configure preserves product plan selection, explicit milestone and existing publication pin',async()=>{
 const f=await fixture();await f.run('clients.create',input);
 const catalog=f.read('ontology.catalog.v2');
 const plan={id:'product-plan',productId:'product',name:'Plano',description:'',milestones:[{n:1,name:'Primeiro',stage:'A',owner:'Equipe'},{n:2,name:'Segundo',stage:'B',owner:'Equipe'}]};
 catalog.extraJourneys=[plan];catalog.journeyVersions={'product-plan':[{version:1,snapshot:plan},{version:2,snapshot:{...plan,name:'Nova publicação'}}]};
 replaceDocument(f,'ontology.catalog.v2',catalog);
 const execution=f.read('ontology.delivery.v2');execution.companyJourney['new-client']=plan.id;execution.companyJourneyVersion['new-client']=1;execution.companyMilestone['new-client']=2;
 replaceDocument(f,'ontology.delivery.v2',execution);
 await f.run('clients.configure',{...input,stakeholders:undefined,journeyId:plan.id,milestone:2});
 const saved=f.read('ontology.delivery.v2');
 assert.equal(saved.companyJourney['new-client'],plan.id);assert.equal(saved.companyMilestone['new-client'],2);assert.equal(saved.companyJourneyVersion['new-client'],1);
 assert.deepEqual(saved.extraCycles,execution.extraCycles,'editing settings must not recreate or reset work');
 const privateId=f.read('ontology.clients.v3').enrollments[0].planId;
 await f.run('clients.configure',{...input,stakeholders:undefined,journeyId:privateId,milestone:1});
 assert.equal(f.read('ontology.delivery.v2').companyJourney['new-client'],privateId);
 assert.equal(f.read('ontology.delivery.v2').companyJourneyVersion['new-client'],undefined,'switching plan clears an unrelated pin');
 f.sql.close();
});

test('configure adopts one legacy execution without changing IDs, history, dates or inventing its version',async()=>{
 const f=await fixture();await f.run('clients.create',input);
 const clients=f.read('ontology.clients.v3'),catalog=f.read('ontology.catalog.v2');clients.enrollments=[];
 replaceDocument(f,'ontology.clients.v3',clients);
 const draft=prepareProduct(catalog.extraProducts[0],clients.extraClients[0],'2026-01-01T00:00:00Z');
 delete draft.cycles[0].productVersion;
 draft.tasks[0].deadline={mode:'fixed'};draft.tasks[0].history=[{at:'2026-01-02',by:'admin',field:'status',to:'em-curso'}];draft.tasks[0].status='em-curso';
 const execution=f.read('ontology.delivery.v2');Object.assign(execution,{extraCycles:draft.cycles,extraTasks:draft.tasks,taskPatches:{},productPlans:{[draft.plan.id]:draft.plan},companyJourney:{'new-client':draft.plan.id}});
 replaceDocument(f,'ontology.delivery.v2',execution);
 await f.run('clients.configure',{...input,stakeholders:undefined,journeyId:draft.plan.id,prepared:[draft]});
 const saved=f.read('ontology.delivery.v2'),enrollment=f.read('ontology.clients.v3').enrollments[0];
 assert.equal(enrollment.legacy,true);assert.equal(enrollment.productVersion,undefined);assert.equal(enrollment.startsAt,undefined);
 assert.deepEqual(saved.extraCycles.map(c=>{const copy={...c};delete copy.enrollmentId;return copy;}),draft.cycles);
 assert.deepEqual(saved.extraTasks.map(t=>{const copy={...t};delete copy.enrollmentId;return copy;}),draft.tasks);
 await f.run('enrollments.create',{company:'new-client',productId:'product',startsAt:'2027-01-01'});
 const repeated=f.read('ontology.delivery.v2');assert.equal(repeated.extraCycles.length,2);assert.notEqual(repeated.extraCycles[0].id,repeated.extraCycles[1].id);
 f.sql.close();
});
test('active configuration preserves legacy plan execution on the guarded bridge',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const clients=f.read('ontology.clients.v3'),catalog=f.read('ontology.catalog.v2');
  clients.enrollments=[];
  replaceDocument(f,'ontology.clients.v3',clients);
  const draft=prepareProduct(catalog.extraProducts[0],clients.extraClients[0],'2026-01-01T00:00:00Z');
  const execution=f.read('ontology.delivery.v2');
  Object.assign(execution,{extraCycles:draft.cycles,extraTasks:draft.tasks,
   taskPatches:{},productPlans:{[draft.plan.id]:draft.plan},
   companyJourney:{'new-client':draft.plan.id}});
  replaceDocument(f,'ontology.delivery.v2',execution);
  const frozen=activateClientShadow(f);
  const result=await f.run('clients.configure',{...input,stakeholders:undefined,
   journeyId:draft.plan.id,prepared:[draft]},'active-legacy-execution');
  assert.equal(result.data.enrollments[0].legacy,true);
  const current=(await getDoc(f.db,'default','ontology.delivery.v2')).value;
  assert.deepEqual(current.extraTasks.map(task=>task.id),draft.tasks.map(task=>task.id));
  assert.deepEqual(current.extraCycles.map(cycle=>cycle.id),draft.cycles.map(cycle=>cycle.id));
  assert.equal(f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.delivery.v2'").get().version,
   frozen.version);
 }finally{f.sql.close();}
});

test('the purchased product version is copied even when a stale automatic plan exists',async()=>{
 const f=await fixture();await f.run('clients.create',input);
 const catalog=f.read('ontology.catalog.v2'),base=catalog.extraProducts[0];
 const product=(version,cycleCount,taskCount,first)=>({...base,version,cycles:Array.from({length:cycleCount},(_,cycle)=>({id:`v${version}-cycle-${cycle}`,name:cycle===0?first:`Ciclo ${cycle+1}`,goal:'Resultado',durationDays:14,acceptance:['Aceito'],deliveries:Array.from({length:Math.floor(taskCount/cycleCount)+(cycle<taskCount%cycleCount?1:0)},(_,task)=>({id:`v${version}-task-${cycle}-${task}`,title:`Tarefa ${task+1}`,description:'',day:Math.min(task+1,14),hours:1}))}))});
 const v1=product(1,4,37,'Kickoff · Mês 1'),v2=product(2,6,20,'Setup do projeto');
 catalog.extraProducts=[v2];catalog.productVersions={product:[{version:1,snapshot:v1}]};
 catalog.extraJourneys=[{id:'automatic-v1',productId:'product',name:'Plano antigo',description:'',autoCreateCycles:true,milestones:[{n:1,name:'Kickoff · Mês 1',stage:'Início',owner:'Equipe',tasks:Array.from({length:37},(_,i)=>({id:`legacy-${i}`,title:`Legada ${i}`,hours:1}))}]}];
 replaceDocument(f,'ontology.catalog.v2',catalog);
 const created=await f.run('enrollments.create',{company:'new-client',productId:'product',productVersion:2,startsAt:'2027-01-01'});
 const execution=f.read('ontology.delivery.v2'),cycles=execution.extraCycles.filter(c=>c.enrollmentId===created.data.enrollment.id),tasks=execution.extraTasks.filter(t=>t.enrollmentId===created.data.enrollment.id);
 assert.equal(created.data.enrollment.productVersion,2);assert.equal(cycles.length,6);assert.equal(tasks.length,20);assert.equal(cycles[0].name,'Setup do projeto');
 assert.notEqual(created.data.enrollment.planId,'automatic-v1');
 f.sql.close();
});

test('active removal of an untouched purchase uses one client slice and preserves tombstones',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const enrollment=f.read('ontology.clients.v3').enrollments[0];
  const taskId=f.read('ontology.delivery.v2').extraTasks.find(task=>task.enrollmentId===enrollment.id).id;
  const frozen=activateClientShadow(f,true);
  certifyActiveDeadlines(f);
  const saved=await f.run('enrollments.remove',
    {company:'new-client',enrollmentId:enrollment.id},'active-remove');
  assert.equal(saved.data.enrollmentId,enrollment.id);
  assert.equal(f.sql.prepare(`SELECT version FROM state_documents
    WHERE key='ontology.delivery.v2'`).get().version,frozen.version);
  assert.equal(f.sql.prepare(`SELECT body FROM state_documents
    WHERE key='ontology.delivery.v2'`).get().body,'invalid-delivery-body');
  assert.equal(f.sql.prepare(`SELECT source_revision FROM delivery_client_deadline_heads
    WHERE company='new-client'`).get().source_revision,2);
  assert.equal((await getDoc(f.db,'default','ontology.delivery.v2')).value.extraTasks.length,0);
  assert.equal((await getDoc(f.db,'default','ontology.clients.v3')).value.enrollments.length,0);
  assert.throws(()=>f.sql.prepare(`INSERT INTO external_references
    (workspace_id,system,kind,external_id,entity_id)
    VALUES('default','crm','task','removed',?)`).run(taskId),/external_reference_target_deleted/);
 }finally{f.sql.close();}
});

test('active removal with an incomplete deadline head uses the guarded bridge',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const enrollment=f.read('ontology.clients.v3').enrollments[0];
  const frozen=activateClientShadow(f);
  const prepare=f.db.prepare.bind(f.db);
  let reconstructed=0;
  f.db.prepare=query=>{
    if(query.includes('SELECT company,body FROM delivery_client_snapshots')) reconstructed++;
    return prepare(query);
  };
  await f.run('enrollments.remove',
    {company:'new-client',enrollmentId:enrollment.id},'bridge-remove');
  f.db.prepare=prepare;
  assert.ok(reconstructed>0);
  assert.equal(f.sql.prepare(`SELECT version FROM state_documents
    WHERE key='ontology.delivery.v2'`).get().version,frozen.version);
 }finally{f.sql.close();}
});

test('active removal aborts atomically when execution changes after dependency certification',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const enrollment=f.read('ontology.clients.v3').enrollments[0];
  activateClientShadow(f);
  certifyActiveDeadlines(f);
  const before=JSON.stringify((await getDoc(f.db,'default','ontology.delivery.v2')).value);
  const batch=f.db.batch.bind(f.db);
  f.db.batch=async statements=>{
    f.db.batch=batch;
    f.sql.prepare(`UPDATE delivery_client_shadow_meta
      SET compatibility_version=compatibility_version+1 WHERE workspace_id='default'`).run();
    return batch(statements);
  };
  await assert.rejects(f.run('enrollments.remove',
    {company:'new-client',enrollmentId:enrollment.id},'raced-remove'),
  {code:'version_conflict'});
  assert.equal(JSON.stringify((await getDoc(f.db,'default','ontology.delivery.v2')).value),before);
  assert.ok((await getDoc(f.db,'default','ontology.clients.v3')).value.enrollments
    .some(row=>row.id===enrollment.id));
  assert.equal(f.sql.prepare(`SELECT COUNT(*) AS n FROM operation_receipts
    WHERE idempotency_key='raced-remove'`).get().n,0);
 }finally{f.sql.close();}
});

test('active rebuild of one untouched purchase uses its slice without global reconstruction',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const enrollment=f.read('ontology.clients.v3').enrollments[0];
  const frozen=activateClientShadow(f,true);
  certifyActiveDeadlines(f);
  const prepare=f.db.prepare.bind(f.db);
  f.db.prepare=query=>{
    if(query.includes('SELECT company,body FROM delivery_client_snapshots'))
      throw new Error('Unexpected global reconstruction');
    return prepare(query);
  };
  const result=await f.run('enrollments.rebuild',
    {company:'new-client',enrollmentId:enrollment.id},'active-rebuild');
  assert.equal(result.data.enrollment.id,enrollment.id);
  assert.equal(result.data.enrollment.lifecycleHistory.at(-1).type,'execution_rebuilt');
  assert.equal(f.sql.prepare(`SELECT version FROM state_documents
    WHERE key='ontology.delivery.v2'`).get().version,frozen.version);
  assert.equal(f.sql.prepare(`SELECT body FROM state_documents
    WHERE key='ontology.delivery.v2'`).get().body,'invalid-delivery-body');
  assert.equal(f.sql.prepare(`SELECT source_revision FROM delivery_client_deadline_heads
    WHERE company='new-client'`).get().source_revision,2);
 }finally{f.sql.close();}
});
test('active rebuild moves the first of two purchases to the global array tail',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const first=f.read('ontology.clients.v3').enrollments[0];
  await f.run('enrollments.create',
    {company:'new-client',productId:'product',startsAt:'2027-06-01'});
  const before=f.read('ontology.delivery.v2');
  const firstCycle=before.extraCycles.find(cycle=>cycle.enrollmentId===first.id).id;
  const secondCycle=before.extraCycles.find(cycle=>cycle.enrollmentId!==first.id).id;
  const firstPlan=first.planId;
  const secondPlan=f.read('ontology.clients.v3').enrollments.find(row=>row.id!==first.id).planId;
  const frozen=activateClientShadow(f,true);
  certifyActiveDeadlines(f);
  const prepare=f.db.prepare.bind(f.db);
  f.db.prepare=query=>{
    if(query.includes('SELECT company,body FROM delivery_client_snapshots'))
      throw new Error('Unexpected global reconstruction');
    return prepare(query);
  };
  await f.run('enrollments.rebuild',
    {company:'new-client',enrollmentId:first.id},'active-rebuild-first');
  f.db.prepare=prepare;
  const current=(await getDoc(f.db,'default','ontology.delivery.v2')).value;
  assert.deepEqual(current.extraCycles.map(cycle=>cycle.id),[secondCycle,firstCycle]);
  assert.deepEqual(Object.keys(current.productPlans),Object.keys(before.productPlans));
  assert.deepEqual(Object.keys(current.productPlans),[firstPlan,secondPlan]);
  assert.equal(f.sql.prepare(`SELECT version FROM state_documents
    WHERE key='ontology.delivery.v2'`).get().version,frozen.version);
  assert.equal(f.sql.prepare(`SELECT body FROM state_documents
    WHERE key='ontology.delivery.v2'`).get().body,'invalid-delivery-body');
 }finally{f.sql.close();}
});
test('active rebuild appends after tasks of another client without changing their order',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const first=f.read('ontology.clients.v3').enrollments[0];
  await f.run('clients.create',{client:{...input.client,slug:'other-client',name:'Outro'},
    config:{productIds:['product']},stakeholders:[]});
  await f.run('enrollments.create',
    {company:'new-client',productId:'product',startsAt:'2027-06-01'});
  const prior=f.read('ontology.delivery.v2');
  const expected=[...prior.extraCycles.filter(cycle=>cycle.enrollmentId!==first.id).map(cycle=>cycle.id),
    ...prior.extraCycles.filter(cycle=>cycle.enrollmentId===first.id).map(cycle=>cycle.id)];
  activateClientShadow(f,true); certifyActiveDeadlines(f);
  const prepare=f.db.prepare.bind(f.db);
  f.db.prepare=query=>{
    if(query.includes('SELECT company,body FROM delivery_client_snapshots'))
      throw new Error('Unexpected global reconstruction');
    return prepare(query);
  };
  await f.run('enrollments.rebuild',
    {company:'new-client',enrollmentId:first.id},'active-rebuild-interleaved');
  f.db.prepare=prepare;
  assert.deepEqual((await getDoc(f.db,'default','ontology.delivery.v2')).value.extraCycles
    .map(cycle=>cycle.id),expected);
 }finally{f.sql.close();}
});
test('active rebuild splits a plan shared by two purchases without global reconstruction',async()=>{
 const f=await fixture();try{
  await f.run('clients.create',input);
  const second=(await f.run('enrollments.create',
    {company:'new-client',productId:'product',startsAt:'2027-06-01'})).data.enrollment;
  const clients=f.read('ontology.clients.v3');
  const first=clients.enrollments.find(row=>row.id!==second.id);
  clients.enrollments=clients.enrollments.map(row=>row.id===second.id
    ?{...row,planId:first.planId}:row);
  replaceDocument(f,'ontology.clients.v3',clients);
  const frozen=activateClientShadow(f,true); certifyActiveDeadlines(f);
  const prepare=f.db.prepare.bind(f.db);
  f.db.prepare=query=>{
    if(query.includes('SELECT company,body FROM delivery_client_snapshots'))
      throw new Error('Unexpected global reconstruction');
    return prepare(query);
  };
  const rebuilt=await f.run('enrollments.rebuild',
    {company:'new-client',enrollmentId:first.id},'active-rebuild-shared');
  f.db.prepare=prepare;
  assert.notEqual(rebuilt.data.enrollment.planId,first.planId);
  const delivery=(await getDoc(f.db,'default','ontology.delivery.v2')).value;
  assert.ok(delivery.productPlans[first.planId]);
  assert.ok(delivery.productPlans[rebuilt.data.enrollment.planId]);
  assert.equal(f.sql.prepare(`SELECT version FROM state_documents
    WHERE key='ontology.delivery.v2'`).get().version,frozen.version);
 }finally{f.sql.close();}
});
test('active rebuild preserves an interleaved draft suffix of reused and new task IDs',async()=>{
 const f=await fixture();try{
  const catalog=f.read('ontology.catalog.v2');
  const base=catalog.extraProducts[0].cycles[0].deliveries[0];
  catalog.extraProducts[0].cycles[0].deliveries=[
    {...base,id:'task-a',title:'A'}, {...base,id:'task-b',title:'B'}];
  replaceDocument(f,'ontology.catalog.v2',catalog);
  await f.run('clients.create',input);
  const first=f.read('ontology.clients.v3').enrollments[0];
  const second=(await f.run('enrollments.create',
    {company:'new-client',productId:'product',startsAt:'2027-06-01'})).data.enrollment;
  const secondIds=f.read('ontology.delivery.v2').extraTasks
    .filter(task=>task.enrollmentId===second.id).map(task=>task.id);
  catalog.extraProducts[0].cycles[0].deliveries.splice(1,0,
    {...base,id:'task-x',title:'X'});
  replaceDocument(f,'ontology.catalog.v2',catalog);
  activateClientShadow(f,true); certifyActiveDeadlines(f);
  const prepare=f.db.prepare.bind(f.db);
  f.db.prepare=query=>{
    if(query.includes('SELECT company,body FROM delivery_client_snapshots'))
      throw new Error('Unexpected global reconstruction');
    return prepare(query);
  };
  const result=await f.run('enrollments.rebuild',
    {company:'new-client',enrollmentId:first.id},'active-rebuild-mixed-tail');
  f.db.prepare=prepare;
  assert.deepEqual((await getDoc(f.db,'default','ontology.delivery.v2')).value.extraTasks
    .map(task=>task.id),[...secondIds,...result.data.tasks]);
  assert.match(result.data.tasks[1],/task-x$/);
 }finally{f.sql.close();}
});

test('enrollment lifecycle preserves cancellation history and only deletes untouched mistakes',async()=>{
 const f=await fixture();await f.run('clients.create',input);
 const enrollment=f.read('ontology.clients.v3').enrollments[0];
 const beforeNoop={version:f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.clients.v3'").get().version,audit:f.sql.prepare('SELECT count(*) n FROM client_audit_log').get().n};
 assert.equal((await f.run('enrollments.update',{company:'new-client',enrollmentId:enrollment.id,status:enrollment.status})).data.enrollment.status,enrollment.status);
 assert.deepEqual({version:f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.clients.v3'").get().version,audit:f.sql.prepare('SELECT count(*) n FROM client_audit_log').get().n},beforeNoop);
 await assert.rejects(f.run('enrollments.update',{company:'new-client',enrollmentId:enrollment.id,status:enrollment.status,reason:'Sem mudança'}),/somente ao alterar a situação/);
 await assert.rejects(f.run('enrollments.archive',{company:'new-client',enrollmentId:enrollment.id}),{code:'invalid_input'});
 await assert.rejects(f.run('enrollments.update',{company:'new-client',enrollmentId:enrollment.id,status:'cancelada'}),error=>error.code==='invalid_input'&&/motivo/.test(error.message));
 const cancelled=(await f.run('enrollments.update',{company:'new-client',enrollmentId:enrollment.id,status:'cancelada',reason:'Cliente encerrou o contrato.'})).data.enrollment;
 assert.equal(cancelled.endsAt,enrollmentBusinessDate(cancelled.lifecycleHistory.at(-1).at));assert.equal(cancelled.lifecycleHistory.at(-1).reason,'Cliente encerrou o contrato.');
 const cancelledSnapshot=JSON.stringify(f.read('ontology.clients.v3'));
 for(const patch of [{status:'cancelada'},{status:'ativa'},{endsAt:'2027-12-31'},{startsAt:'2027-02-01'},{productVersion:1}])
  await assert.rejects(f.run('enrollments.update',{company:'new-client',enrollmentId:enrollment.id,...patch}),/somente leitura/);
 assert.equal(JSON.stringify(f.read('ontology.clients.v3')),cancelledSnapshot);
 const contact=f.read('ontology.stakeholders.v1').contacts[0];
 await assert.rejects(f.run('participants.save',{company:'new-client',enrollmentId:enrollment.id,stakeholderId:contact.id,accountRole:'ponto-focal',primary:true,active:true}),/somente leitura/);
 const archived=(await f.run('enrollments.archive',{company:'new-client',enrollmentId:enrollment.id})).data.enrollment;assert.ok(archived.archivedAt);
 await assert.rejects(f.run('enrollments.archive',{company:'new-client',enrollmentId:enrollment.id}),{code:'invalid_input'});
 await assert.rejects(f.run('enrollments.update',{company:'new-client',enrollmentId:enrollment.id,status:'cancelada'}),/Restaure/);
 const restored=(await f.run('enrollments.restore',{company:'new-client',enrollmentId:enrollment.id})).data.enrollment;assert.equal(restored.archivedAt,undefined);assert.equal(restored.lifecycleHistory.at(-1).type,'restored');
 await assert.rejects(f.run('enrollments.restore',{company:'new-client',enrollmentId:enrollment.id}),{code:'invalid_input'});
 const mistaken=(await f.run('enrollments.create',{company:'new-client',productId:'product',startsAt:'2027-01-01'})).data.enrollment;
 await f.run('enrollments.rebuild',{company:'new-client',enrollmentId:mistaken.id});
 assert.equal(f.read('ontology.clients.v3').enrollments.find(e=>e.id===mistaken.id).lifecycleHistory.at(-1).type,'execution_rebuilt');
 await assert.rejects(f.run('enrollments.remove',{company:'new-client',enrollmentId:mistaken.id}),/já possui histórico/);
 const removable=(await f.run('enrollments.create',{company:'new-client',productId:'product',startsAt:'2027-06-01'})).data.enrollment;
 const removedTaskId=f.read('ontology.delivery.v2').extraTasks.find(t=>t.enrollmentId===removable.id).id;
 await f.run('enrollments.remove',{company:'new-client',enrollmentId:removable.id});
 assert.ok(!f.read('ontology.clients.v3').enrollments.some(e=>e.id===removable.id));assert.ok(!f.read('ontology.delivery.v2').extraCycles.some(c=>c.enrollmentId===removable.id));
 assert.throws(()=>f.sql.prepare("INSERT INTO external_references(workspace_id,system,kind,external_id,entity_id) VALUES('default','crm','task','deleted-task',?)").run(removedTaskId),/external_reference_target_deleted/);
 const largeCatalog=f.read('ontology.catalog.v2');largeCatalog.extraProducts.push({id:'large-product',name:'Produto grande',description:'',version:1,cycles:[{id:'large-cycle',name:'Ciclo grande',goal:'Executar',durationDays:120,acceptance:['Aceito'],deliveries:Array.from({length:101},(_,index)=>({id:`task-${index}`,title:`Tarefa ${index}`,description:'',day:index+1,hours:1}))}]});replaceDocument(f,'ontology.catalog.v2',largeCatalog);
 const large=(await f.run('enrollments.create',{company:'new-client',productId:'large-product',startsAt:'2027-08-01'})).data.enrollment;
 await f.run('enrollments.remove',{company:'new-client',enrollmentId:large.id});
 assert.equal(f.sql.prepare('SELECT count(*) n FROM external_reference_tombstones WHERE workspace_id=? AND operation_id IS NOT NULL').get('default').n>=103,true);
 const delivery=f.read('ontology.delivery.v2'),task=delivery.extraTasks.find(t=>t.enrollmentId===enrollment.id);task.status='em-curso';replaceDocument(f,'ontology.delivery.v2',delivery);
 await assert.rejects(f.run('enrollments.remove',{company:'new-client',enrollmentId:enrollment.id}),error=>error.code==='invalid_input'&&/preservar o histórico/.test(error.message));
 const referenced=(await f.run('enrollments.create',{company:'new-client',productId:'product',startsAt:'2028-01-01',externalReference:{system:'crm',kind:'enrollment',externalId:'contract-28'}})).data.enrollment;
 await assert.rejects(f.run('enrollments.remove',{company:'new-client',enrollmentId:referenced.id}),/referência de integração/);
 const childReferenced=(await f.run('enrollments.create',{company:'new-client',productId:'product',startsAt:'2028-06-01'})).data.enrollment;
 const childTask=f.read('ontology.delivery.v2').extraTasks.find(t=>t.enrollmentId===childReferenced.id);
 f.sql.prepare("INSERT INTO external_references(workspace_id,system,kind,external_id,entity_id) VALUES('default','crm','task','task-28',?)").run(childTask.id);
 await assert.rejects(f.run('enrollments.rebuild',{company:'new-client',enrollmentId:childReferenced.id}),/referência de integração/);
 const removableChild=(await f.run('enrollments.create',{company:'new-client',productId:'product',startsAt:'2028-09-01'})).data.enrollment;
 const removableChildTask=f.read('ontology.delivery.v2').extraTasks.find(t=>t.enrollmentId===removableChild.id);
 f.sql.prepare("INSERT INTO external_references(workspace_id,system,kind,external_id,entity_id) VALUES('default','crm','task','task-29',?)").run(removableChildTask.id);
 await assert.rejects(f.run('enrollments.remove',{company:'new-client',enrollmentId:removableChild.id}),/referência de integração/);
 const meetingLinked=(await f.run('enrollments.create',{company:'new-client',productId:'product',startsAt:'2029-01-01'})).data.enrollment;
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.engagement.v2',1,?)").run(JSON.stringify({extraMeetings:[{id:'meeting',company:'new-client',title:'Histórico',startsAt:'2029-01-02T12:00:00Z',durationMin:30,enrollmentIds:[meetingLinked.id],attendeeIds:[],actions:[]}]}));
 await assert.rejects(f.run('enrollments.remove',{company:'new-client',enrollmentId:meetingLinked.id}),/vinculada a reuniões/);
 await assert.rejects(f.run('enrollments.rebuild',{company:'new-client',enrollmentId:meetingLinked.id}),{code:'invalid_input'});
 const predecessor=(await f.run('enrollments.create',{company:'new-client',productId:'product',startsAt:'2030-01-01'})).data.enrollment;
 await f.run('enrollments.create',{company:'new-client',productId:'product',startsAt:'2031-01-01',previousEnrollmentId:predecessor.id});
 await assert.rejects(f.run('enrollments.remove',{company:'new-client',enrollmentId:predecessor.id}),/origem de uma renovação/);
 f.sql.close();
});

test('removing one legacy purchase keeps a private plan shared by a surviving purchase',async()=>{
 const f=await fixture();await f.run('clients.create',input);
 const second=(await f.run('enrollments.create',{company:'new-client',productId:'product',startsAt:'2027-06-01'})).data.enrollment;
 const clients=f.read('ontology.clients.v3'),first=clients.enrollments.find(enrollment=>enrollment.id!==second.id);
 clients.enrollments=clients.enrollments.map(enrollment=>enrollment.id===second.id?{...enrollment,planId:first.planId,status:'cancelada',archivedAt:'2027-07-01T00:00:00Z',archivedBy:'admin'}:enrollment);
 replaceDocument(f,'ontology.clients.v3',clients);
 await f.run('enrollments.remove',{company:'new-client',enrollmentId:first.id});
 assert.equal(f.read('ontology.clients.v3').enrollments.find(enrollment=>enrollment.id===second.id).planId,first.planId);
 assert.ok(f.read('ontology.delivery.v2').productPlans[first.planId]);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM external_reference_tombstones WHERE workspace_id=? AND entity_id=?').get('default',first.planId).n,0);
 f.sql.close();
});

test('rebuilding one purchase splits a private plan shared with another purchase',async()=>{
 const f=await fixture();await f.run('clients.create',input);
 const second=(await f.run('enrollments.create',{company:'new-client',productId:'product',startsAt:'2027-06-01'})).data.enrollment;
 const clients=f.read('ontology.clients.v3'),first=clients.enrollments.find(enrollment=>enrollment.id!==second.id);
 clients.enrollments=clients.enrollments.map(enrollment=>enrollment.id===second.id?{...enrollment,planId:first.planId}:enrollment);
 replaceDocument(f,'ontology.clients.v3',clients);
 const sharedPlan=structuredClone(f.read('ontology.delivery.v2').productPlans[first.planId]);
 const rebuilt=(await f.run('enrollments.rebuild',{company:'new-client',enrollmentId:first.id})).data.enrollment;
 const delivery=f.read('ontology.delivery.v2');
 assert.notEqual(rebuilt.planId,first.planId);
 assert.deepEqual(delivery.productPlans[first.planId],sharedPlan);
 assert.ok(delivery.productPlans[rebuilt.planId]);
 assert.equal(new Set(delivery.extraTasks.filter(task=>[first.id,second.id].includes(task.enrollmentId)).map(task=>task.id)).size,delivery.extraTasks.filter(task=>[first.id,second.id].includes(task.enrollmentId)).length);
 f.sql.close();
});

test('rebuild reserves retained execution IDs against a concurrent external reference',async()=>{
 const f=await fixture();await f.run('clients.create',input);
 const enrollment=f.read('ontology.clients.v3').enrollments[0],taskId=f.read('ontology.delivery.v2').extraTasks.find(task=>task.enrollmentId===enrollment.id).id;
 const before=JSON.stringify(f.read('ontology.delivery.v2')),batch=f.db.batch;
 let inserted=false;
 f.db.batch=async statements=>{
  if(!inserted){inserted=true;f.sql.prepare("INSERT INTO external_references(workspace_id,system,kind,external_id,entity_id) VALUES('default','crm','task','racing-reference',?)").run(taskId);}
  return batch(statements);
 };
 await assert.rejects(f.run('enrollments.rebuild',{company:'new-client',enrollmentId:enrollment.id}),{code:'external_reference_conflict'});
 assert.equal(JSON.stringify(f.read('ontology.delivery.v2')),before);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM external_reference_tombstones WHERE workspace_id=? AND entity_id=?').get('default',taskId).n,0);
 f.sql.close();
});
test('removing an accidental purchase preserves a pre-existing legacy product association',async()=>{
 const f=await fixture();await f.run('clients.create',input);
 const clients=f.read('ontology.clients.v3'),enrollment=clients.enrollments[0];delete enrollment.createdProductLink;replaceDocument(f,'ontology.clients.v3',clients);
 await f.run('enrollments.remove',{company:'new-client',enrollmentId:enrollment.id});
 assert.ok(f.read('ontology.clients.v3').configs['new-client'].productIds.includes('product'));
 f.sql.close();
});
test('product-link ownership follows a surviving purchase and disappears with the last accidental one',async()=>{
 const f=await fixture();await f.run('clients.create',input);
 const first=f.read('ontology.clients.v3').enrollments[0];
 const second=(await f.run('enrollments.create',{company:'new-client',productId:'product',startsAt:'2028-01-01'})).data.enrollment;
 assert.equal(first.createdProductLink,true);assert.equal(second.createdProductLink,undefined);
 await f.run('enrollments.remove',{company:'new-client',enrollmentId:first.id});
 assert.equal(f.read('ontology.clients.v3').enrollments.find(e=>e.id===second.id).createdProductLink,true);
 await f.run('enrollments.remove',{company:'new-client',enrollmentId:second.id});
 assert.ok(!f.read('ontology.clients.v3').configs['new-client'].productIds.includes('product'));
 f.sql.close();
});
test('linked legacy product with no execution materializes once; ambiguous legacy cycles block atomic configure',async()=>{
 const f=await fixture();await f.run('clients.create',input);
 const clients=f.read('ontology.clients.v3'),execution=f.read('ontology.delivery.v2');clients.enrollments=[];
 replaceDocument(f,'ontology.clients.v3',clients);
 replaceDocument(f,'ontology.delivery.v2',{...execution,extraCycles:[],extraTasks:[],productPlans:{},companyJourney:{}});
 await f.run('clients.configure',{...input,stakeholders:undefined});
 assert.equal(f.read('ontology.clients.v3').enrollments.length,1);
 assert.equal(f.read('ontology.delivery.v2').extraCycles.length,1);
 const clean=f.read('ontology.clients.v3'),saved=f.read('ontology.delivery.v2');clean.enrollments=[];
 const cycle={...saved.extraCycles[0]};delete cycle.enrollmentId;
 saved.extraCycles=[cycle,{...cycle,id:'second-legacy-cycle'}];
 replaceDocument(f,'ontology.clients.v3',clean);replaceDocument(f,'ontology.delivery.v2',saved);
 await assert.rejects(f.run('clients.configure',{...input,stakeholders:undefined,client:{...input.client,name:'Must not save'}}),/mais de uma execução/);
 assert.equal(f.read('ontology.clients.v3').enrollments.length,0);
 assert.notEqual(f.read('ontology.clients.v3').clientEdits['new-client'].name,'Must not save');
 f.sql.close();
});

test('the same external sale under a new retry key returns the original purchase without extra events',async()=>{
 const f=await fixture();const request={...input,externalReference:{system:'crm',kind:'sale',externalId:'sale-42'}};
 const first=await f.run('clients.create',request,'one');const count=f.sql.prepare('SELECT count(*) n FROM operation_events').get().n;
 const second=await f.run('clients.create',request,'two');assert.equal(second.data.enrollments[0].id,first.data.enrollments[0].id);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_events').get().n,count);
 await assert.rejects(f.run('clients.create',{...request,client:{...input.client,name:'Changed'}},'three'),{code:'external_reference_conflict'});
 f.sql.close();
});

test('compound replay rechecks every original scope for same key and external reference',async()=>{
 const f=await fixture();const request={...input,externalReference:{system:'crm',kind:'sale',externalId:'scope-test'}};
 const first=await f.run('clients.create',request,'scope-first');
 assert.equal(first.authorizationRequirements,undefined,'internal authorization metadata must never leave the operation');
 const stored=JSON.parse(f.sql.prepare("SELECT result FROM operation_receipts WHERE idempotency_key='scope-first'").get().result);
 assert.ok(stored.authorizationRequirements.some(r=>r.scope==='stakeholders:write'));
 assert.ok(stored.authorizationRequirements.some(r=>r.scope==='delivery:write'));
 for(const removed of ['stakeholders:write','delivery:write','enrollments:write']) {
  f.sql.prepare('UPDATE integration_credentials SET scopes=? WHERE id=?').run(JSON.stringify(integrationScopes.filter(s=>s!==removed)),f.issued.id);
  await assert.rejects(f.run('clients.create',request,'scope-first'),{code:'insufficient_scope'});
  await assert.rejects(f.run('clients.create',request,`retry-${removed}`),{code:'insufficient_scope'});
 }
 assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_receipts').get().n,1);
 f.sql.close();
});

test('external replay across principals has no historical snapshots and checks secondary scopes',async()=>{
 const f=await fixture();
 const session={...f.principal,id:'member:admin',kind:'session',application:'web',scopes:null,companies:null};
 const request={...input,externalReference:{system:'crm',kind:'sale',externalId:'cross-principal'}};
 const first=await executeCommercialCommand(f.db,'default',session,'clients.create',request,'session-create');
 assert.ok(first.documents.length>0);
 const token=await issueIntegrationCredential(f.db,'default','admin@example.com',{name:'Limited replay',ownerEmail:'admin@example.com',scopes:['clients:write'],expiresAt:new Date(Date.now()+3600000).toISOString()});
 const limited=await resolveOperationPrincipal(new Request('https://delivery.test',{headers:{authorization:`Bearer ${token.token}`}}),{DB:f.db});
 await assert.rejects(executeCommercialCommand(f.db,'default',limited,'clients.create',request,'limited'),{code:'insufficient_scope'});
 replaceDocument(f,'ontology.workspace.v3',{extraMembers:[{id:'admin',email:'admin@example.com',access:'admin'},{id:'other',email:'other@example.com',access:'admin'}]});
 const other={...session,id:'member:other',email:'other@example.com',memberId:'other'};
 const replay=await executeCommercialCommand(f.db,'default',other,'clients.create',request,'other');
 assert.deepEqual(replay.documents,[]);
 assert.deepEqual(replay.data,JSON.parse(JSON.stringify(first.data)));
 assert.equal(replay.authorizationRequirements,undefined);
 f.sql.close();
});

test('configure replay revalidates client allocation after role downgrade',async()=>{
 const f=await fixture();await f.run('clients.create',input);
 const roster={extraMembers:[{id:'admin',email:'admin@example.com',access:'admin'},{id:'other',email:'other@example.com',access:'admin'}]};
 replaceDocument(f,'ontology.workspace.v3',roster);
 const request={...input,stakeholders:undefined,leadId:'other',csId:'other'};
 await f.run('clients.configure',request,'allocation');
 roster.extraMembers[0].access='ai_master';replaceDocument(f,'ontology.workspace.v3',roster);
 await assert.rejects(f.run('clients.configure',request,'allocation'),{code:'permission_denied'});
 f.sql.close();
});
