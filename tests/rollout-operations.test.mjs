import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {issueIntegrationCredential} from '../src/server/operations/credentials.ts';
import {resolveOperationPrincipal} from '../src/server/operations/principal.ts';
import {previewProductRollout,executeProductRollout} from '../src/server/operations/rollouts.ts';
import {prepareProduct} from '../src/modules/delivery/application/product-execution.ts';
import {createHash} from 'node:crypto';
import {partitionClientDelivery,deliveryMapOrder} from '../src/server/delivery-client-slices.ts';
import {projectClients} from '../src/modules/clients/infrastructure/snapshot.ts';
import {projectDelivery} from '../src/modules/delivery/infrastructure/snapshot.ts';
import {decodeStateBody} from '../src/server/state-body.ts';
async function fixture(){
 const f=sqliteD1();const write=(key,value)=>f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?) ON CONFLICT(workspace_id,key) DO UPDATE SET body=excluded.body,version=version+1").run(key,JSON.stringify(value));
 write('ontology.workspace.v3',{extraMembers:[{id:'a',email:'a@example.com',access:'admin'}]});
 const company={slug:'client',name:'Cliente',startedAt:'2090-01-01',leadId:'a'};
 const original={id:'p',name:'Produto',description:'',version:1,cycles:[{id:'c',name:'Ciclo',goal:'Resultado',durationDays:10,acceptance:['Aceite'],deliveries:[{id:'t',title:'Tarefa',description:'Antes',day:3,hours:1,completion:'checklist',checklistItems:['Item']}]}]};
 const a=prepareProduct(original,company,'now',{id:'a',startsAt:'2090-01-01'}),b=prepareProduct(original,company,'now',{id:'b',startsAt:'2090-02-01'});
 const head=structuredClone(original);head.version=2;head.cycles[0].deliveries[0].description='Depois';head.cycles[0].deliveries.push({...head.cycles[0].deliveries[0],id:'new',title:'Nova'});
 write('ontology.clients.v3',{extraClients:[company],enrollments:['a','b'].map(id=>({id,company:'client',productId:'p',startsAt:id==='a'?'2090-01-01':'2090-02-01',status:'ativa',productVersion:1}))});
 write('ontology.catalog.v2',{extraProducts:[head],productVersions:{p:[{version:1,at:'now',snapshot:original}]}});
 const state={extraCycles:[...a.cycles,...b.cycles],extraTasks:[...a.tasks,...b.tasks],taskPatches:{},cycleEdits:{},statusMap:{}};write('ontology.delivery.v2',state);
 const issued=await issueIntegrationCredential(f.db,'default','a@example.com',{name:'Rollout',ownerEmail:'a@example.com',scopes:['catalog:read','delivery:read','delivery:write','enrollments:read'],companies:['client'],expiresAt:'2099-01-01T00:00:00Z'});
 const env={DB:f.db},principal=await resolveOperationPrincipal(new Request('https://delivery.test',{headers:{authorization:`Bearer ${issued.token}`}}),env);
 const input={company:'client',enrollmentId:'a',productId:'p',targetVersion:2};
 const preview=()=>previewProductRollout(env,principal,input);
 return {...f,env,principal,issued,input,write,state,a,b,preview,read:()=>JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get().body)};
}
function activate(f){
 const raw=f.read(),clients=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body);
 const slices=partitionClientDelivery(raw,projectClients(clients).enrollments).slices;
 assert.equal(slices.length,1);
 const body=JSON.stringify(slices[0].snapshot),generation='rollout-test';
 f.sql.prepare(`INSERT INTO delivery_client_snapshots
  (workspace_id,generation,company,revision,body,body_sha256,incarnation)
  VALUES('default',?,?,1,?,?,?)`).run(generation,'client',body,createHash('sha256').update(body).digest('hex'),'incarnation');
 const projected=projectDelivery(raw),owners=[...projected.tasks.map(t=>['task',t]),...projected.cycles.map(c=>['cycle',c])];
 for(const [kind,row] of owners)f.sql.prepare(`INSERT INTO delivery_entity_owners
  (workspace_id,generation,kind,id,company) VALUES('default',?,?,?,?)`).run(generation,kind,row.id,row.company);
 for(const kind of ['extraTasks','extraCycles'])for(const [ordinal,row] of (raw[kind]??[]).entries())
  f.sql.prepare(`INSERT INTO delivery_client_array_order
   (workspace_id,generation,kind,id,ordinal,company) VALUES('default',?,?,?,?,?)`)
   .run(generation,kind,row.id,ordinal,row.company);
 const mapOrder=deliveryMapOrder(raw);
 for(const [identity,ordinal] of mapOrder){const [kind,id]=identity.split('\u0000');
  f.sql.prepare(`INSERT INTO delivery_client_map_order
   (workspace_id,generation,kind,id,ordinal) VALUES('default',?,?,?,?)`)
   .run(generation,kind,id,ordinal);}
 const deliveryVersion=f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.delivery.v2'").get().version;
 const clientsVersion=f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.clients.v3'").get().version;
 f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
  (workspace_id,generation,mode,source_delivery_version,source_clients_version,
   compatibility_version,expected_clients,expected_owners,expected_orphans,
   expected_array_order,expected_map_order,updated_at)
  VALUES('default',?,'active',?,?,?,1,?,0,?,?,?)`)
  .run(generation,deliveryVersion,clientsVersion,deliveryVersion+1,owners.length,
   (raw.extraTasks??[]).length+(raw.extraCycles??[]).length,mapOrder.size,'2026-09-27');
 return f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.delivery.v2'").get();
}
test('active rollout previews and applies within one client while the global document stays frozen',async()=>{
 const f=await fixture();try{
  const frozen=activate(f),preview=await f.preview();
  const input={...f.input,cycleIds:[f.a.cycles[0].id],previewFingerprint:preview.data.previewFingerprint};
  const result=await executeProductRollout(f.env,f.principal,input,'active-rollout');
  assert.equal(result.documents.length,0);
  assert.deepEqual(f.sql.prepare("SELECT version,body FROM state_documents WHERE key='ontology.delivery.v2'").get(),frozen);
  const raw=f.sql.prepare("SELECT body FROM delivery_client_snapshots WHERE company='client'").get().body;
  const state=await decodeStateBody(raw);
  assert.equal(state.taskPatches[f.a.tasks[0].id].description,'Depois');
  assert.equal(state.extraTasks.filter(t=>t.enrollmentId==='a').length,2);
  assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='client'").get().revision,2);
 }finally{f.sql.close();}
});
test('opaque preview applies selected purchase atomically and replays once without snapshots',async()=>{
 const f=await fixture(),preview=await f.preview();assert.match(preview.data.previewFingerprint,/^[a-f0-9]{64}$/);assert.equal(preview.data.cycles.length,1);assert.equal(preview.data.cycles[0].addedTaskCount,1);assert.equal(preview.data.cycles[0].tasks,undefined);
 const input={...f.input,cycleIds:[f.a.cycles[0].id],previewFingerprint:preview.data.previewFingerprint};
 const result=await executeProductRollout(f.env,f.principal,input,'apply');assert.deepEqual(result.documents,[]);assert.deepEqual(await executeProductRollout(f.env,f.principal,input,'apply'),result);
 const after=f.read();assert.equal(after.taskPatches[f.a.tasks[0].id].description,'Depois');assert.deepEqual(after.extraCycles.find(c=>c.enrollmentId==='b'),f.b.cycles[0]);assert.equal(after.extraTasks.filter(t=>t.enrollmentId==='a').length,2);assert.equal(after.extraCycles.find(c=>c.enrollmentId==='a').productUpdates[0].by,'a');assert.equal(f.sql.prepare("SELECT count(*) n FROM operation_events WHERE type='product_rollout.applied'").get().n,1);
 f.sql.prepare('UPDATE integration_credentials SET revoked_at=? WHERE id=?').run('now',f.issued.id);await assert.rejects(executeProductRollout(f.env,f.principal,input,'apply'),{code:'invalid_token'});f.sql.close();
});
test('changed execution, catalog and expected versions invalidate preview without events',async()=>{
 const f=await fixture(),p=await f.preview(),input={...f.input,cycleIds:[f.a.cycles[0].id],previewFingerprint:p.data.previewFingerprint};
 await assert.rejects(executeProductRollout(f.env,f.principal,input,'version',{'ontology.delivery.v2':0}),{code:'version_conflict'});
 f.write('ontology.delivery.v2',{...f.state,taskPatches:{[f.a.tasks[0].id]:{status:'entregue'}}});await assert.rejects(executeProductRollout(f.env,f.principal,input,'stale'),{code:'stale_preview'});
 const next=await f.preview();assert.ok(next.data.cycles[0].blocked);await assert.rejects(executeProductRollout(f.env,f.principal,{...input,previewFingerprint:next.data.previewFingerprint},'blocked'),{code:'invalid_rollout'});
 assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_receipts').get().n,0);f.sql.close();
});
test('scope, explicit legacy, membership and selection cannot cross purchases',async()=>{
 const f=await fixture();await assert.rejects(previewProductRollout(f.env,f.principal,{...f.input,enrollmentId:undefined}),{code:'invalid_input'});
 await assert.rejects(previewProductRollout(f.env,f.principal,{...f.input,company:'other'}),{code:'client_not_allowed'});
 await assert.rejects(previewProductRollout(f.env,f.principal,{...f.input,enrollmentId:null}),{code:'invalid_input'});
 await assert.rejects(previewProductRollout(f.env,f.principal,{...f.input,cycleIds:[f.b.cycles[0].id]}),{code:'invalid_input'});
 f.sql.prepare('UPDATE integration_credentials SET scopes=? WHERE id=?').run('["catalog:read","delivery:read"]',f.issued.id);await assert.rejects(f.preview(),{code:'insufficient_scope'});f.sql.close();
});
test('unknown baseline is blocked and legacy selection preserves independent purchases',async()=>{
 const f=await fixture(),legacy={...f.a.cycles[0],enrollmentId:undefined,productBaseline:undefined,productVersion:undefined};
 f.write('ontology.delivery.v2',{...f.state,extraCycles:[legacy,...f.b.cycles],extraTasks:f.state.extraTasks.map(t=>t.enrollmentId==='a'?{...t,enrollmentId:undefined}:t)});
 const p=await previewProductRollout(f.env,f.principal,{...f.input,enrollmentId:null});assert.equal(p.data.cycles.length,1);assert.match(p.data.cycles[0].blocked,/Sem versão/);f.sql.close();
});
test('catalog changes invalidate selection and an event failure rolls back documents and receipt',async()=>{
 const f=await fixture(),p=await f.preview(),input={...f.input,cycleIds:[f.a.cycles[0].id],previewFingerprint:p.data.previewFingerprint};
 f.sql.prepare("UPDATE state_documents SET version=version+1 WHERE key='ontology.catalog.v2'").run();
 await assert.rejects(executeProductRollout(f.env,f.principal,input,'catalog-stale'),{code:'stale_preview'});
 input.previewFingerprint=(await f.preview()).data.previewFingerprint;
 const before=f.read();f.sql.exec("CREATE TRIGGER reject_rollout_event BEFORE INSERT ON operation_events BEGIN SELECT RAISE(ABORT,'fixture_event_failure'); END;");
 await assert.rejects(executeProductRollout(f.env,f.principal,input,'rollback'),/fixture_event_failure/);
 assert.deepEqual(f.read(),before);assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_receipts').get().n,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM state_history').get().n,0);f.sql.close();
});
test('session receives adopted document and read-only members cannot prepare mutations',async()=>{
 const f=await fixture(),env={...f.env,AUTH_MODE:'dev',DEV_USER_EMAIL:'a@example.com'};
 const session=await resolveOperationPrincipal(new Request('https://delivery.test'),env),p=await previewProductRollout(env,session,f.input);
 const result=await executeProductRollout(env,session,{...f.input,cycleIds:[f.a.cycles[0].id],previewFingerprint:p.data.previewFingerprint},'session');
 assert.equal(result.documents.length,1);assert.equal(result.documents[0].key,'ontology.delivery.v2');assert.equal(result.documents[0].version,2);
 f.write('ontology.workspace.v3',{extraMembers:[{id:'a',email:'a@example.com',access:'leitor'}]});await assert.rejects(previewProductRollout(env,session,f.input),{code:'permission_denied'});f.sql.close();
});
