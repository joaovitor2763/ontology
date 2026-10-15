import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {apiResponse} from '../src/server/operations/http.ts';
import {issueIntegrationCredential} from '../src/server/operations/credentials.ts';
import {projectDelivery} from '../src/modules/delivery/infrastructure/snapshot.ts';
import {seal} from '../src/server/google.ts';
import {openApiDocument} from '../src/server/operations/openapi.ts';
function fixture(){
 const f=sqliteD1();
 const put=(key,value)=>f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(key,JSON.stringify(value));
 put('ontology.workspace.v3',{extraMembers:[{id:'admin',name:'Admin',email:'admin@example.test',access:'admin'}]});
 put('ontology.clients.v3',{extraClients:['one','two'].map(slug=>({slug,name:slug,status:'ativo',startedAt:'2026-01-01',leadId:'admin',csId:'admin',milestone:1})),enrollments:['one','two'].map(company=>({id:`purchase-${company}`,company,productId:'product'})),participations:['one','two'].map(company=>({id:`participation-${company}`,company,enrollmentId:`purchase-${company}`,stakeholderId:`contact-${company}`}))});
 put('ontology.delivery.v2',{extraTasks:['one','two'].map(company=>({id:`task-${company}`,company,title:company})),extraCycles:['one','two'].map(company=>({id:`cycle-${company}`,company,name:company,startsAt:"2026-01-01",endsAt:"2026-01-31",taskIds:[]}))});
 put('ontology.catalog.v2',{extraProducts:[{id:'product',name:'Product',version:1,cycles:[]}]});
 put('ontology.engagement.v2',{extraMeetings:['one','two'].map(company=>({id:`meeting-${company}`,company,title:company,actions:[],attendeeIds:[],startsAt:"2026-01-01T10:00:00Z"}))});
 put('ontology.stakeholders.v1',{contacts:['one','two'].map(company=>({id:`contact-${company}`,company,name:company,active:true}))});
 const env={DB:f.db,AUTH_MODE:'dev',DEV_USER_EMAIL:'admin@example.test'};
 const request=async(path,token,method='GET',body)=>{const r=await apiResponse(new Request(`https://app.example/api/v1/${path}`,{method,body:body?JSON.stringify(body):undefined,headers:token?{authorization:`Bearer ${token}`}:{origin:'https://app.example','Idempotency-Key':crypto.randomUUID()}}),env,path.split('?')[0].split('/'));return {status:r.status,body:await r.json()};};
 return {...f,env,request,token:async(scopes,companies)=>{const c=await issueIntegrationCredential(f.db,'default','admin@example.test',{name:'Fixture',ownerEmail:'admin@example.test',scopes,companies,expiresAt:'2099-01-01T00:00:00Z'});return c.token;}};
}
test('REST details return one exact authorized record, nested client records cannot cross clients',async()=>{
 const f=fixture();try{
 for(const [resource,id] of [['clients','one'],['products','product'],['tasks','task-one'],['cycles','cycle-one'],['meetings','meeting-one'],['enrollments','purchase-one'],['participants','participation-one'],['stakeholders','contact-one']]){
  const r=await f.request(`${resource}/${id}`);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.data.id??r.body.data.slug,id);assert.equal(Array.isArray(r.body.data),false);
  assert.equal((await f.request(`${resource}/missing`)).status,404);
 }
 for(const [resource,id] of [['enrollments','purchase'],['participants','participation'],['stakeholders','contact']]){
  assert.equal((await f.request(`clients/one/${resource}/${id}-one`)).status,200);
  assert.equal((await f.request(`clients/one/${resource}/${id}-two`)).status,404);
 }
 for(const limit of ['1.5','0','101','nope','']) assert.equal((await f.request(`tasks?limit=${limit}`)).status,400);
 const list=await f.request('tasks?company=one&limit=1');assert.equal(list.body.data.length,1);assert.equal(list.body.data[0].id,'task-one');
 }finally{f.sql.close();}
});
test('REST read scopes and client restrictions apply to details and collections',async()=>{
 const f=fixture();try{
 const token=await f.token(['delivery:read'],['one']);
 assert.equal((await f.request('tasks/task-one',token)).status,200);
 assert.equal((await f.request('tasks/task-two',token)).status,404);
 assert.equal((await f.request('tasks?company=two',token)).status,403);
 assert.equal((await f.request('meetings/meeting-one',token)).status,403);
 assert.equal((await f.request('meetings',token)).status,403);
 const empty=await f.token(['clients:read'],[]);
 assert.equal((await f.request('tasks',empty)).status,403);
 const listed=await f.request('tasks',token);assert.deepEqual(listed.body.data.map(t=>t.id),['task-one']);
 }finally{f.sql.close();}
});
test('task history pages require the task to belong to the authorized client',async()=>{
 const f=fixture();try{
  for(const task of ['task-one','task-two']) f.sql.prepare(`INSERT INTO delivery_task_history
   (workspace_id,task_id,entry_id,entry_hash,occurrence,entry_json,event_at,is_legacy_summary,source_first_version,source_last_version)
   VALUES('default',?,?,?,?,?,?,0,1,1)`)
   .run(task,`history-${task}`,task,1,JSON.stringify({field:'status',to:'fila'}),'2026-01-01');
  const token=await f.token(['delivery:read'],['one']);
  const own=await f.request('tasks/task-one/history?company=one',token);
  assert.equal(own.status,200,JSON.stringify(own));
  assert.deepEqual(own.body.data.map(entry=>entry.id),['history-task-one']);
  assert.equal((await f.request('tasks/task-two/history?company=one',token)).status,404);
  assert.equal((await f.request('tasks/task-two/history?company=two',token)).status,403);
  assert.equal((await f.request('tasks/task-one/history',token)).status,422);
 }finally{f.sql.close();}
});
test('client and enrollment filters follow allocations and enrollment milestones, not legacy client fields',async()=>{
 const f=fixture();try{
  const state=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body);
  state.allocationsMigrated=true;state.allocations=[
   {id:'one-general',company:'one',memberId:'master',role:'responsavel',percent:30},
   {id:'one-purchase',company:'one',memberId:'admin',role:'responsavel',enrollmentId:'purchase-one',percent:20},
   {id:'two-general',company:'two',memberId:'master',role:'responsavel',percent:30},
  ];
  state.extraClients[0].healthFlag='green';
  state.enrollments=state.enrollments.map(e=>({...e,milestone:e.company==='one'?1:2}));
  f.sql.prepare("UPDATE state_documents SET body=? WHERE key='ontology.clients.v3'").run(JSON.stringify(state));
  const clients=await f.request('clients?status=ativo&limit=1');
  assert.equal(clients.status,200);assert.equal(clients.body.total,2);assert.equal(clients.body.nextCursor,'1');assert.equal(typeof clients.body.snapshotVersion,'number');
  assert.equal((await f.request(`clients?status=ativo&cursor=1&expectedVersion=${clients.body.snapshotVersion}`)).status,200);
  assert.deepEqual((await f.request('clients?memberId=master&role=responsavel')).body.data.map(c=>c.slug),['two']);
  assert.deepEqual((await f.request('clients?q=TW')).body.data.map(c=>c.slug),['two']);
  const summary=await f.request('clients?view=summary&status=ativo&healthFlag=green');
  assert.equal(summary.body.total,1);assert.equal(summary.body.data[0].slug,'one');assert.equal(summary.body.data[0].leadId,undefined);assert.equal(summary.body.data[0].milestone,undefined);
  const enrollments=await f.request('enrollments?memberId=master&role=responsavel&productId=product&milestone=2');
  assert.equal(enrollments.body.total,1);assert.equal(enrollments.body.data[0].company,'two');
  assert.equal((await f.request('enrollments?memberId=master&role=responsavel&milestone=1')).body.total,0);
  assert.equal((await f.request('enrollments?currentOnly=true')).body.total,2);
  assert.equal((await f.request('clients?currentOnly=true')).status,400);
  assert.equal((await f.request('tasks?memberId=master')).status,400);
  const allocations=await f.request('allocations?memberId=master&role=responsavel');
  assert.equal(allocations.body.totalClients,1);assert.equal(allocations.body.total,1);assert.equal(allocations.body.snapshotVersion,clients.body.snapshotVersion);
  const roster=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.workspace.v3'").get().body);
  roster.extraMembers.push({id:'master',name:'Master',email:'master@example.test',access:'ai_master'});
  f.sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.workspace.v3'").run(JSON.stringify(roster));
  const team=await f.request('members?company=one&role=responsavel');
  assert.equal(team.body.total,1);assert.deepEqual(team.body.data.map(m=>m.id),['admin']);
  const restricted=await f.token(['workspace:read','clients:read','enrollments:read'],['one']);
  assert.deepEqual((await f.request('clients?memberId=master&role=responsavel',restricted)).body.data.map(c=>c.slug),[]);
  assert.equal((await f.request('allocations?memberId=master&role=responsavel',restricted)).body.totalClients,0);
  assert.equal((await f.request('allocations',restricted)).status,422);
  state.enrollments[1].status='cancelada';
  state.archivedClients=['two'];
  f.sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.clients.v3'").run(JSON.stringify(state));
  assert.equal((await f.request(`clients?expectedVersion=${clients.body.snapshotVersion}`)).status,409);
  assert.equal((await f.request(`allocations?memberId=master&expectedVersion=${clients.body.snapshotVersion}`)).status,409);
  assert.equal((await f.request('enrollments?currentOnly=true')).body.total,1);
  assert.equal((await f.request('clients/two')).body.data.archived,true);
  assert.ok(!(await f.request('clients?includeArchived=false')).body.data.some(c=>c.slug==='two'));
  assert.equal((await f.request('allocations?memberId=master&role=responsavel')).body.totalClients,0);
 }finally{f.sql.close();}
});
test('member and product filters join through the same enrollment and honor scoped responsibility',async()=>{
 const f=fixture();try{
  const state=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body);
  state.allocationsMigrated=true;
  state.allocations=[
   {id:'general',company:'one',memberId:'general-owner',role:'responsavel',percent:100},
   {id:'specific',company:'one',memberId:'product-owner',role:'responsavel',enrollmentId:'purchase-one',percent:100},
  ];
  state.enrollments.push({id:'other-purchase',company:'one',productId:'other-product'});
  f.sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.clients.v3'").run(JSON.stringify(state));
  assert.equal((await f.request('clients?memberId=general-owner&productId=product')).body.total,0);
  assert.deepEqual((await f.request('clients?memberId=general-owner&productId=other-product')).body.data.map(c=>c.slug),['one']);
  assert.deepEqual((await f.request('enrollments?memberId=general-owner&productId=other-product')).body.data.map(e=>e.id),['other-purchase']);
  assert.equal((await f.request('enrollments?memberId=general-owner&productId=product')).body.total,0);
  assert.deepEqual((await f.request('enrollments?memberId=product-owner&productId=product')).body.data.map(e=>e.id),['purchase-one']);
  const purchases=await f.request('enrollments?company=one');
  assert.equal(purchases.body.total,2);assert.equal(purchases.body.totalClients,1);
  state.allocations.push({id:'other-specific',company:'one',memberId:'product-owner',role:'responsavel',enrollmentId:'other-purchase',percent:100});
  f.sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.clients.v3'").run(JSON.stringify(state));
  assert.equal((await f.request('clients?memberId=general-owner&role=responsavel')).body.total,0);
  assert.equal((await f.request('allocations?memberId=general-owner&role=responsavel')).body.totalClients,0);
 }finally{f.sql.close();}
});
test('closed enrollment allocations leave current portfolio and team filters',async()=>{
 const f=fixture();try{
  const state=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body);
  state.allocationsMigrated=true;
  state.allocations=[{id:'scoped',company:'one',memberId:'admin',role:'responsavel',enrollmentId:'purchase-one',percent:100}];
  state.enrollments[0].status='cancelada';
  f.sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.clients.v3'").run(JSON.stringify(state));
  assert.equal((await f.request('allocations?memberId=admin&role=responsavel')).body.totalClients,0);
  assert.equal((await f.request('clients?memberId=admin&role=responsavel')).body.total,0);
  assert.equal((await f.request('members?company=one&role=responsavel')).body.total,0);
  assert.equal((await f.request('allocations?company=one')).body.total,1);
 }finally{f.sql.close();}
});
test('unknown suffixes never route to a collection or execute a mutation',async()=>{
 const f=fixture();try{
 for(const path of ['tasks/task-one/unknown','clients/one/tasks','clients/one/enrollments/purchase-one/unknown','events/id','webhooks/id','credentials/id','operations/id/resume','openapi.json/extra'])assert.equal((await f.request(path)).status,404,path);
 for(const [path,method] of [['commands/extra','POST'],['meetings/meeting-one/unknown','PATCH'],['clients/one/archive/extra','POST'],['cycles/cycle-one/extra','DELETE'],['credentials/id/extra','DELETE']])assert.equal((await f.request(path,undefined,method)).status,404,path);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_receipts').get().n,0);
 }finally{f.sql.close();}
});
test('OpenAPI documents details, aliases, webhook security and implemented command scopes',()=>{
 const api=openApiDocument('https://app.example');
 assert.equal(api.paths['/tasks/{id}'].get['x-required-scopes'][0],'delivery:read');
 assert.equal(api.paths['/tasks/{id}/history'].get['x-required-scopes'][0],'delivery:read');
 assert.equal(api.paths['/tasks/{id}/complete'].post['x-command'],'tasks.complete');
 assert.ok(api.paths['/tasks/{id}/complete'].post.requestBody.content['application/json'].schema.properties.completedAt);
 assert.equal(api.paths['/tasks/{id}/complete'].post.requestBody.content['application/json'].schema.properties.taskId,undefined);
 assert.ok(api.paths['/clients/{company}/stakeholders/{id}'].get);
 assert.deepEqual(api.paths['/webhooks'].post['x-required-scopes'],['events:read','events:write']);
 assert.ok(api.paths['/webhooks/{id}'].delete.parameters.some(p=>p.name==='Idempotency-Key'));
 assert.equal(api.paths['/credentials'].post.security[0].session.length,0);
 assert.deepEqual(api.paths['/files/{id}'].put['x-required-scopes'],['documents:write']);
 assert.deepEqual(api.paths['/files/{id}'].get['x-required-scopes'],['documents:read']);
 assert.equal(api.paths['/files/{id}'].put.requestBody.content['application/octet-stream'].schema.format,'binary');
 assert.equal(api.paths['/events/{id}'],undefined);
});

test('REST calendar aliases preserve expected Google revision in persisted intent without external calls',async t=>{
 const f=fixture(), original=globalThis.fetch;
 globalThis.fetch=async()=>{throw new Error('fixture: no external effects');};
 t.after(()=>{globalThis.fetch=original;f.sql.close();});
 Object.assign(f.env,{GOOGLE_ENABLED:'true',GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test',GOOGLE_TOKEN_KEY:'fixture-key'});
 f.sql.prepare("INSERT INTO google_connections(workspace_id,user_email,account_email,scopes,refresh_token_enc,created_at,updated_at) VALUES('default',?,?,?,?,?,?)").run('admin@example.test','admin@example.test','calendar',await seal('fixture-key','fixture-refresh'),'now','now');
 const meetings={extraMeetings:['move','cancel','flat'].map(id=>({id,company:'one',title:'Fixture',startsAt:'2026-10-01T15:00:00Z',durationMin:30,actions:[],attendeeIds:[],modality:'presencial',organizerEmail:'admin@example.test',google:{eventId:id,calendarId:'primary',etag:'old',organizer:'admin@example.test'}}))};
 f.sql.prepare("UPDATE state_documents SET body=? WHERE key='ontology.engagement.v2'").run(JSON.stringify(meetings));
 for(const [id,action,body] of [['move','reschedule',{patch:{startsAt:'2026-10-02T15:00:00Z'},expectedGoogleEtag:'current'}],['cancel','cancel',{expectedGoogleEtag:'current'}],['flat','reschedule',{startsAt:'2026-10-03T15:00:00Z',expectedGoogleEtag:'current'}]]){
  const result=await f.request(`meetings/${id}/${action}`,undefined,'POST',body);
  assert.equal(result.status,200,JSON.stringify(result));
  const journal=f.sql.prepare('SELECT calendar_input,desired FROM meeting_operations WHERE meeting_id=?').get(id);
  assert.equal(JSON.parse(journal.calendar_input).previous.etag,'current');
  if(action==='reschedule') assert.equal(Date.parse(JSON.parse(journal.desired).startsAt),Date.parse(body.patch?.startsAt??body.startsAt));
 }
});


test('minimal task creation belongs to the selected client plan without inventing a product or purchase',async()=>{
 const f=fixture();try{
  const state=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get().body);
  state.companyJourney={one:'service-delivery'};
  f.sql.prepare("UPDATE state_documents SET body=? WHERE key='ontology.delivery.v2'").run(JSON.stringify(state));
  const created=await f.request('tasks',undefined,'POST',{company:'one',task:{title:'Minimal API',dueAt:'2026-10-01',ownerId:'admin'}});
  assert.equal(created.status,200,JSON.stringify(created));
  assert.equal(created.body.data.task.journeyId,'service-delivery');
  assert.equal(created.body.data.task.productId,undefined);assert.equal(created.body.data.task.enrollmentId,undefined);
  const saved=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get().body);
  assert.ok(projectDelivery(saved,'one','service-delivery').tasks.some(t=>t.id===created.body.data.task.id));
 }finally{f.sql.close();}
});

test('REST has a direct responsible mutation with an explicit OpenAPI schema',async()=>{
 const f=fixture();try{
  const result=await f.request('clients/one/responsible',undefined,'POST',{memberId:'marina'});
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.data.allocation.memberId,'marina');
  const rows=await f.request('allocations?company=one');
  assert.equal(rows.body.data.find(row=>row.role==='responsavel'&&!row.enrollmentId).memberId,'marina');
  const api=openApiDocument('https://app.example');
  const route=api.paths['/clients/{company}/responsible'].post;
  assert.deepEqual(route['x-required-scopes'],['workspace:write']);
  assert.deepEqual(route.requestBody.content['application/json'].schema.required,['memberId']);
 }finally{f.sql.close();}
});

test('explicit responsible filters combine general and same-product roles without inheritance',async()=>{
 const f=fixture();try{
  await f.request('clients/one/responsible',undefined,'POST',{memberId:'marina',enrollmentId:'purchase-one'});
  const ids=async query=>(await f.request(`clients?${query}`)).body.data.map(row=>row.slug);
  assert.deepEqual(await ids('productId=product&clientResponsibleId=admin&productResponsibleId=marina'),['one']);
  assert.deepEqual(await ids('productId=product&productResponsibleId=__none__'),['two']);
  assert.deepEqual(await ids('productId=product&productResponsibleId=admin'),[]);
  assert.deepEqual(await ids('productId=other&productResponsibleId=marina'),[]);
  assert.equal((await f.request('clients?productResponsibleId=marina')).status,400);
  await f.request('clients/one/responsible',undefined,'POST',{memberId:null});
  assert.ok((await ids('clientResponsibleId=__none__')).includes('one'));
  assert.deepEqual(await ids('productId=product&clientResponsibleId=__none__&productResponsibleId=marina'),['one']);
  const api=openApiDocument('https://app.example');
  assert.ok(api.paths['/clients'].get.parameters.some(p=>p.name==='productResponsibleId'));
 }finally{f.sql.close();}
});
