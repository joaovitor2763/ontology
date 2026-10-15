import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { executeProvisionCommand } from '../src/server/operations/provisioning.ts';
import { issueIntegrationCredential, integrationScopes } from '../src/server/operations/credentials.ts';
import { resolveOperationPrincipal } from '../src/server/operations/principal.ts';
import { normalizeDeliverySnapshot } from '../src/modules/delivery/infrastructure/snapshot.ts';
import { removeCycleAggregate } from '../src/modules/delivery/application/cycles.ts';
import { prepareProduct } from '../src/modules/delivery/application/product-execution.ts';
import { provisionMissingPlan, provisionMissingProduct } from '../src/modules/delivery/application/provision-missing.ts';
import { createHash } from 'node:crypto';
import { deliveryMapOrder, partitionClientDelivery } from '../src/server/delivery-client-slices.ts';
import { projectClients } from '../src/modules/clients/infrastructure/snapshot.ts';
import { decodeStateBody } from '../src/server/state-body.ts';
import { deliveryPlanClaims } from '../src/server/operations/delivery-client-plan-claims.ts';
const company={slug:'provision-client',name:'Cliente',startedAt:'2020-01-01',journeyId:'selected'};
const product={id:'p',name:'Produto comprado',description:'',version:1,cycles:['one','two'].map(id=>({id,name:id,goal:'Resultado',durationDays:10,acceptance:['Aceito'],deliveries:[{id:'task',title:'Fazer',description:'',day:2,hours:1}]}))};
async function fixture(){
 const f=sqliteD1();
 const write=(key,value)=>f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?) ON CONFLICT(workspace_id,key) DO UPDATE SET body=excluded.body,version=version+1").run(key,JSON.stringify(value));
 write('ontology.workspace.v3',{extraMembers:[{id:'a',email:'admin@example.com',access:'admin'}]});
 write('ontology.clients.v3',{extraClients:[company],enrollments:[{id:'first',company:company.slug,productId:'p',productVersion:1,startsAt:'2027-01-01',status:'ativa'},{id:'second',company:company.slug,productId:'p',productVersion:1,startsAt:'2027-03-01',status:'ativa'}],participations:[{id:'person-link',company:company.slug,enrollmentId:'first',stakeholderId:'person',active:true}]});
 write('ontology.catalog.v2',{extraProducts:[{...product,name:'Novo catálogo',version:2,cycles:product.cycles.slice(0,1)}],productVersions:{p:[{version:1,snapshot:product,at:'2026-01-01',by:'a'}]}});
 write('ontology.delivery.v2',{companyJourney:{[company.slug]:'selected'},companyMilestone:{[company.slug]:3},companyJourneyVersion:{[company.slug]:1}});
 const issued=await issueIntegrationCredential(f.db,'default','admin@example.com',{name:'Fixture',ownerEmail:'admin@example.com',scopes:[...integrationScopes],expiresAt:'2099-01-01T00:00:00Z'});
 const env={DB:f.db},principal=await resolveOperationPrincipal(new Request('https://delivery.test',{headers:{authorization:`Bearer ${issued.token}`}}),env);
 const read=key=>JSON.parse(f.sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body);
 const run=(id,key=crypto.randomUUID(),rest={})=>executeProvisionCommand(env,principal,'enrollments.provision',{company:company.slug,enrollmentId:id,...rest},key);
 return {...f,write,read,run,env,principal,issued};
}
function activateWithClaims(f, foreignClaim = false) {
  if (foreignClaim) {
    const clients = f.read('ontology.clients.v3');
    clients.extraClients.push({ slug: 'other-client', name: 'Outro', startedAt: '2020-01-01' });
    f.write('ontology.clients.v3', clients);
    const raw = f.read('ontology.delivery.v2');
    raw.companyJourney['other-client'] = 'enrollment-first';
    f.write('ontology.delivery.v2', raw);
  }
  const raw = f.read('ontology.delivery.v2'), clients = f.read('ontology.clients.v3');
  const partition = partitionClientDelivery(raw, projectClients(clients).enrollments);
  const generation = 'provision-claims', projection = 'claims-projection';
  for (const slice of partition.slices) {
    const body = JSON.stringify(slice.snapshot), incarnation = `inc-${slice.company}`;
    f.sql.prepare(`INSERT INTO delivery_client_snapshots
      (workspace_id,generation,company,revision,body,body_sha256,incarnation)
      VALUES('default',?,?,1,?,?,?)`).run(generation, slice.company, body,
      createHash('sha256').update(body).digest('hex'), incarnation);
    const claims = deliveryPlanClaims(slice.snapshot, slice.company);
    for (const planId of claims)
      f.sql.prepare(`INSERT INTO delivery_client_plan_claims
        VALUES('default',?,?,?)`).run(projection, slice.company, planId);
    f.sql.prepare(`INSERT INTO delivery_client_plan_claim_heads
      (workspace_id,company,authority_generation,source_revision,source_incarnation,
       projection_generation,expected_claims,updated_at)
      VALUES('default',?,?,1,?,?,?,'now')`).run(slice.company, generation,
        incarnation, projection, claims.length);
  }
  const mapOrder = deliveryMapOrder(raw);
  for (const [identity, ordinal] of mapOrder) {
    const [kind, id] = identity.split('\u0000');
    f.sql.prepare(`INSERT INTO delivery_client_map_order
      (workspace_id,generation,kind,id,ordinal) VALUES('default',?,?,?,?)`)
      .run(generation, kind, id, ordinal);
  }
  const deliveryVersion = f.sql.prepare(`SELECT version FROM state_documents
    WHERE key='ontology.delivery.v2'`).get().version;
  const clientsVersion = f.sql.prepare(`SELECT version FROM state_documents
    WHERE key='ontology.clients.v3'`).get().version;
  f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
    (workspace_id,generation,mode,source_delivery_version,source_clients_version,
     compatibility_version,expected_clients,expected_owners,expected_orphans,
     expected_array_order,expected_map_order,updated_at)
    VALUES('default',?,'active',?,?,?,?,0,0,0,?,'now')`)
    .run(generation, deliveryVersion, clientsVersion, deliveryVersion + 1,
      partition.slices.length, mapOrder.size);
}

test('active purchase provision composes new private plan and enrollment without global delivery rewrite', async () => {
  const f = await fixture(); try {
    activateWithClaims(f);
    const beforeDelivery = f.sql.prepare(`SELECT version,body FROM state_documents
      WHERE key='ontology.delivery.v2'`).get();
    const result = await f.run('first', 'active-private');
    assert.equal(result.data.planId, 'enrollment-first');
    assert.equal(f.read('ontology.clients.v3').enrollments[0].planId, 'enrollment-first');
    assert.deepEqual(f.sql.prepare(`SELECT version,body FROM state_documents
      WHERE key='ontology.delivery.v2'`).get(), beforeDelivery);
    assert.equal(f.sql.prepare(`SELECT revision FROM delivery_client_snapshots
      WHERE company=?`).get(company.slug).revision, 2);
    assert.equal(f.sql.prepare(`SELECT source_revision FROM delivery_client_plan_claim_heads
      WHERE company=?`).get(company.slug).source_revision, 2);
    assert.equal(f.sql.prepare(`SELECT COUNT(*) AS n FROM delivery_client_plan_claims
      WHERE company=? AND plan_id='enrollment-first'`).get(company.slug).n, 1);
  } finally { f.sql.close(); }
});

test('active provision materializes an already-linked missing private plan without changing clients', async () => {
  const f = await fixture(); try {
    const clients = f.read('ontology.clients.v3');
    clients.enrollments[0].planId = 'enrollment-first';
    f.write('ontology.clients.v3', clients);
    activateWithClaims(f);
    const beforeClients = f.sql.prepare(`SELECT version,body FROM state_documents
      WHERE key='ontology.clients.v3'`).get();
    const beforeDelivery = f.sql.prepare(`SELECT version,body FROM state_documents
      WHERE key='ontology.delivery.v2'`).get();
    const beforeMarker = f.sql.prepare(`SELECT source_clients_version FROM
      delivery_client_shadow_meta`).get().source_clients_version;
    const result = await f.run('first', 'linked-private');
    assert.equal(result.data.planId, 'enrollment-first');
    assert.deepEqual(f.sql.prepare(`SELECT version,body FROM state_documents
      WHERE key='ontology.clients.v3'`).get(), beforeClients);
    assert.deepEqual(f.sql.prepare(`SELECT version,body FROM state_documents
      WHERE key='ontology.delivery.v2'`).get(), beforeDelivery);
    assert.equal(f.sql.prepare(`SELECT source_clients_version FROM
      delivery_client_shadow_meta`).get().source_clients_version, beforeMarker);
    const slice = await decodeStateBody(f.sql.prepare(`SELECT body
      FROM delivery_client_snapshots WHERE company=?`).get(company.slug).body);
    assert.ok(slice.productPlans['enrollment-first']);
    assert.equal(slice.extraCycles.length, 2);
    assert.deepEqual((await f.run('first', 'linked-private')).data, result.data);
  } finally { f.sql.close(); }
});

test('an intervening logical write invalidates the private-plan absence proof', async () => {
  const f = await fixture(); try {
    const clients = f.read('ontology.clients.v3');
    clients.enrollments[0].planId = 'enrollment-first';
    f.write('ontology.clients.v3', clients);
    activateWithClaims(f);
    const beforeClients = f.read('ontology.clients.v3');
    const beforeSlice = f.sql.prepare(`SELECT revision,body
      FROM delivery_client_snapshots WHERE company=?`).get(company.slug);
    const batch = f.db.batch.bind(f.db);
    f.db.batch = async statements => {
      f.sql.prepare(`UPDATE delivery_client_shadow_meta
        SET compatibility_version=compatibility_version+1`).run();
      return batch(statements);
    };
    await assert.rejects(f.run('first', 'linked-race'), { code: 'version_conflict' });
    assert.deepEqual(f.read('ontology.clients.v3'), beforeClients);
    assert.deepEqual(f.sql.prepare(`SELECT revision,body
      FROM delivery_client_snapshots WHERE company=?`).get(company.slug), beforeSlice);
    assert.equal(f.sql.prepare(`SELECT COUNT(*) AS n FROM operation_receipts`).get().n, 0);
  } finally { f.sql.close(); }
});

test('foreign raw plan claim prevents provision without changing either document', async () => {
  const f = await fixture(); try {
    activateWithClaims(f, true);
    const beforeClients = f.read('ontology.clients.v3');
    const beforeDelivery = f.read('ontology.delivery.v2');
    await assert.rejects(f.run('first', 'foreign-claim'), {
      code: 'execution_ownership_ambiguous',
    });
    assert.deepEqual(f.read('ontology.clients.v3'), beforeClients);
    assert.deepEqual(f.read('ontology.delivery.v2'), beforeDelivery);
    assert.equal(f.sql.prepare(`SELECT COUNT(*) AS n FROM operation_receipts`).get().n, 0);
  } finally { f.sql.close(); }
});

test('an already-linked missing plan still refuses another client raw claim', async () => {
  const f = await fixture(); try {
    const clients = f.read('ontology.clients.v3');
    clients.enrollments[0].planId = 'enrollment-first';
    f.write('ontology.clients.v3', clients);
    activateWithClaims(f, true);
    const beforeClients = f.read('ontology.clients.v3');
    const beforeDelivery = f.read('ontology.delivery.v2');
    await assert.rejects(f.run('first', 'linked-foreign'), {
      code: 'execution_ownership_ambiguous',
    });
    assert.deepEqual(f.read('ontology.clients.v3'), beforeClients);
    assert.deepEqual(f.read('ontology.delivery.v2'), beforeDelivery);
  } finally { f.sql.close(); }
});
test('active legacy plan provision writes only its client slice',async()=>{
 const f=await fixture();try{
  const plan={id:'legacy-active',name:'Plano',autoCreateCycles:true,milestones:[{n:1,name:'Marco',stage:'Etapa',period:{startMonth:1,endMonth:1},tasks:[{id:'task',title:'Fazer',hours:1}]}]};
  const catalog=f.read('ontology.catalog.v2');catalog.extraJourneys=[plan];f.write('ontology.catalog.v2',catalog);
  const raw=f.read('ontology.delivery.v2');raw.companyJourney[company.slug]=plan.id;f.write('ontology.delivery.v2',raw);
  const physical=f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.delivery.v2'").get();
  const clients=f.read('ontology.clients.v3');
  const slice=partitionClientDelivery(raw,projectClients(clients).enrollments).slices.find(row=>row.company===company.slug);
  assert.ok(slice);const body=JSON.stringify(slice.snapshot),generation='provision-active';
  f.sql.prepare(`INSERT INTO delivery_client_snapshots
    (workspace_id,generation,company,revision,body,body_sha256,incarnation)
    VALUES('default',?,?,1,?,?,?)`).run(generation,company.slug,body,createHash('sha256').update(body).digest('hex'),'incarnation');
  const mapOrder=deliveryMapOrder(raw);
  for(const [identity,ordinal] of mapOrder){const [kind,id]=identity.split('\u0000');
   f.sql.prepare(`INSERT INTO delivery_client_map_order
     (workspace_id,generation,kind,id,ordinal) VALUES('default',?,?,?,?)`)
     .run(generation,kind,id,ordinal);}
  const clientsVersion=f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.clients.v3'").get().version;
  f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
    (workspace_id,generation,mode,source_delivery_version,source_clients_version,
     compatibility_version,expected_clients,expected_owners,expected_orphans,
     expected_array_order,expected_map_order,updated_at)
    VALUES('default',?,'active',?,?,?,1,0,0,0,?,'2026-09-27')`)
    .run(generation,physical.version,clientsVersion,physical.version+1,mapOrder.size);
  const result=await executeProvisionCommand(f.env,f.principal,'plans.provision',
   {company:company.slug,planId:plan.id,enrollmentId:null},'active-legacy');
  assert.equal(result.data.cycles.length,1);
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.delivery.v2'").get(),physical);
  const current=await decodeStateBody(f.sql.prepare('SELECT body FROM delivery_client_snapshots').get().body);
  assert.equal(current.extraCycles.length,1);
  assert.equal(current.extraTasks.length,1);
 }finally{f.sql.close();}
});
test('provision existing purchases uses historical product and each start, preserving identity, people and selection',async()=>{
 const f=await fixture();try{
  const before=f.read('ontology.clients.v3');const first=await f.run('first','intent');await f.run('second');
  const state=f.read('ontology.delivery.v2');assert.equal(state.extraCycles.length,4);assert.equal(state.extraTasks.length,4);
  assert.equal(state.extraCycles.find(c=>c.enrollmentId==='first').startsAt,'2027-01-01');assert.equal(state.extraCycles.find(c=>c.enrollmentId==='second').startsAt,'2027-03-01');
  assert.deepEqual(state.companyJourney,{[company.slug]:'selected'});assert.deepEqual(state.companyMilestone,{[company.slug]:3});assert.deepEqual(state.companyJourneyVersion,{[company.slug]:1});
  assert.deepEqual(f.read('ontology.clients.v3').participations,before.participations);assert.equal(f.read('ontology.clients.v3').enrollments.length,2);
  assert.deepEqual(await f.run('first','intent'),JSON.parse(JSON.stringify(first)));
  const events=f.sql.prepare('SELECT count(*) n FROM operation_events').get().n;const again=await f.run('first');assert.deepEqual(again.data.cycles,[]);assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_events').get().n,events);
 }finally{f.sql.close();}
});
test('provision refuses foreign, frozen and unclassified purchases, and replay rechecks scopes',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.run('missing'),{code:'invalid_input'});
  const clients=f.read('ontology.clients.v3');clients.enrollments[0].productVersion=undefined;f.write('ontology.clients.v3',clients);await assert.rejects(f.run('first'),{code:'invalid_input'});
  clients.enrollments[0].productVersion=1;clients.enrollments[0].status='concluida';f.write('ontology.clients.v3',clients);await assert.rejects(f.run('first'),{code:'invalid_input'});
  await f.run('second','saved');f.sql.prepare('UPDATE integration_credentials SET scopes=? WHERE id=?').run(JSON.stringify(['enrollments:write']),f.issued.id);await assert.rejects(f.run('second','saved'),{code:'insufficient_scope'});
 }finally{f.sql.close();}
});
test('preparing missing cycles never reopens completed execution or restores a removed cycle',()=>{
 const state=normalizeDeliverySnapshot(),draft=prepareProduct(product,company,'now',{id:'first',startsAt:'2027-01-01'});
 const original={...draft.cycles[0],status:'concluido',taskIds:[],debrief:'Preservar'};
 state.extraCycles=[original];state.companyJourney={other:'other'};
 let next=provisionMissingProduct(state,draft);assert.deepEqual(next.extraCycles[0],original);assert.equal(next.extraTasks.length,1);assert.deepEqual(next.companyJourney,{other:'other'});
 next.extraCycles[1].removed=true;assert.deepEqual(provisionMissingProduct(next,draft),next);
 const plan={id:'auto',productId:'p',name:'Auto',autoCreateCycles:true,milestones:[{n:1,name:'Um',stage:'Etapa',cycleTemplateId:'one',period:{startMonth:1,endMonth:1},tasks:[{id:'a',title:'Tarefa',hours:1}]}]};
 const generated=provisionMissingPlan(normalizeDeliverySnapshot(),plan,company,'now',{id:'auto',startsAt:'2027-02-01'});generated.extraCycles[0].status='concluido';generated.extraCycles[0].taskIds=[];generated.extraTasks=[];
 assert.deepEqual(provisionMissingPlan(generated,plan,company,'later',{id:'auto',startsAt:'2027-02-01'}),generated);
});
test('failed atomic provision leaves purchase and execution unchanged',async()=>{
 const f=await fixture();try{
  const before=f.read('ontology.clients.v3'),execution=f.read('ontology.delivery.v2');
  f.sql.exec("CREATE TRIGGER fail_provision BEFORE UPDATE ON state_documents WHEN NEW.key='ontology.clients.v3' BEGIN SELECT RAISE(ABORT,'fixture'); END;");
  await assert.rejects(f.run('first','failed'));assert.deepEqual(f.read('ontology.clients.v3'),before);assert.deepEqual(f.read('ontology.delivery.v2'),execution);assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_receipts').get().n,0);
 }finally{f.sql.close();}
});

test('a missing private snapshot never replaces the historical purchase plan identity',async()=>{
 const f=await fixture();try{
  const clients=f.read('ontology.clients.v3');clients.enrollments[0].planId='historical-private-plan';f.write('ontology.clients.v3',clients);
  const execution=f.read('ontology.delivery.v2');
  await assert.rejects(f.run('first'),/identidade histórica/);
  assert.deepEqual(f.read('ontology.clients.v3'),clients);assert.deepEqual(f.read('ontology.delivery.v2'),execution);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_receipts').get().n,0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);
 }finally{f.sql.close();}
});

test('historical snapshot from another product cannot materialize a purchase',async()=>{
 const f=await fixture();try{
  const catalog=f.read('ontology.catalog.v2');catalog.productVersions.p[0].snapshot.id='another-product';f.write('ontology.catalog.v2',catalog);
  const clients=f.read('ontology.clients.v3'),execution=f.read('ontology.delivery.v2');
  await assert.rejects(f.run('first'),/versão contratada/);
  assert.deepEqual(f.read('ontology.clients.v3'),clients);assert.deepEqual(f.read('ontology.delivery.v2'),execution);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);
 }finally{f.sql.close();}
});

test('automatic plans without template IDs provision missing milestones independently',()=>{
 const plan={id:'legacy-auto',name:'Plano',autoCreateCycles:true,milestones:[1,2].map(n=>({n,name:'Marco '+n,stage:'Etapa',period:{startMonth:n,endMonth:n},tasks:[{id:'task'+n,title:'Fazer',hours:1}]}))};
 const state=provisionMissingPlan(normalizeDeliverySnapshot(),plan,company,'now');
 state.extraCycles=state.extraCycles.slice(0,1);state.extraTasks=state.extraTasks.slice(0,1);
 const next=provisionMissingPlan(state,plan,company,'later');assert.equal(next.extraCycles.length,2);assert.equal(next.extraTasks.length,2);assert.deepEqual(next.extraCycles[0],state.extraCycles[0]);
});

test('removing a locally created purchase cycle preserves its tombstone during later preparation',()=>{
 const draft=prepareProduct(product,company,'now',{id:'first',startsAt:'2027-01-01'});
 const state=provisionMissingProduct(normalizeDeliverySnapshot(),draft);
 const removed=removeCycleAggregate(state,state.extraCycles[0]);
 const next=provisionMissingProduct(removed,draft);
 assert.equal(next.extraCycles.length,1);assert.equal(next.cycleEdits[draft.cycles[0].id].removed,true);
 assert.deepEqual(next.extraTasks,state.extraTasks);
});

test('separate legacy automatic plans without products never share cycles through template aliases',()=>{
 const base={name:'Plano',autoCreateCycles:true,milestones:[{n:1,name:'Marco',stage:'Etapa',cycleTemplateId:'shared-template',period:{startMonth:1,endMonth:1},tasks:[{id:'task',title:'Fazer',hours:1}]}]};
 const first=provisionMissingPlan(normalizeDeliverySnapshot(),{...base,id:'old'},company,'now');
 const second=provisionMissingPlan(first,{...base,id:'new'},company,'later');
 assert.equal(second.extraCycles.length,2);assert.equal(second.extraTasks.length,2);assert.deepEqual(second.extraCycles[0],first.extraCycles[0]);
 assert.deepEqual(provisionMissingPlan(second,{...base,id:'new'},company,'again'),second);
});

test('legacy provisioning requires a product-less assigned plan and cannot bypass purchase identity',async()=>{
 const f=await fixture();try{
  const plan={id:'legacy',name:'Plano',autoCreateCycles:true,milestones:[{n:1,name:'Marco',stage:'Etapa',period:{startMonth:1,endMonth:1},tasks:[{id:'task',title:'Fazer',hours:1}]}]};
  const catalog=f.read('ontology.catalog.v2');catalog.extraJourneys=[{...plan,productId:'p'}];f.write('ontology.catalog.v2',catalog);
  const state=f.read('ontology.delivery.v2');state.companyJourney[company.slug]='legacy';f.write('ontology.delivery.v2',state);
  const run=input=>executeProvisionCommand(f.env,f.principal,'plans.provision',input,crypto.randomUUID());
  const input={company:company.slug,planId:'legacy',enrollmentId:null};
  await assert.rejects(run(input),{code:'invalid_input'});assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);
  catalog.extraJourneys=[plan];f.write('ontology.catalog.v2',catalog);
  await assert.rejects(run({...input,enrollmentId:undefined}),{code:'invalid_input'});
  const result=await run(input);assert.equal(result.data.cycles.length,1);
  assert.equal(f.read('ontology.delivery.v2').extraCycles[0].enrollmentId,undefined);
 }finally{f.sql.close();}
});
