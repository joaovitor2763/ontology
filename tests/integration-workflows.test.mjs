import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { issueIntegrationCredential, integrationScopes } from '../src/server/operations/credentials.ts';
import { apiResponse } from '../src/server/operations/http.ts';
import { mcpResponse } from '../src/server/operations/mcp.ts';
import { dispatchWebhooks } from '../src/server/operations/webhooks.ts';
async function fixture() {
 const f=sqliteD1();
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify({extraMembers:[{id:'admin',name:'Admin fixture',email:'admin@example.com',access:'admin'},{id:'reader',name:'Leitor fixture',email:'reader@example.com',access:'leitor'}]}));
 const product={id:'integration-product',name:'Produto de teste',description:'',version:1,cycles:[{id:'model',name:'Ciclo',goal:'Resultado',durationDays:10,acceptance:['Aceito'],deliveries:[{id:'task',title:'Tarefa',description:'',day:2,hours:1}]}]};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.catalog.v2',1,?)").run(JSON.stringify({extraProducts:[product]}));
 const credential=await issueIntegrationCredential(f.db,'default','admin@example.com',{name:'Integração',ownerEmail:'admin@example.com',scopes:[...integrationScopes],expiresAt:new Date(Date.now()+3600000).toISOString()});
 const env={DB:f.db,INTEGRATION_SECRET_KEY:Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')};
 const headers={authorization:`Bearer ${credential.token}`,'content-type':'application/json'};
 const request=async(path,method='GET',input,key=crypto.randomUUID())=>{
  const url=new URL('https://delivery.test/api/v1/'+path);
  return apiResponse(new Request(url,{method,headers:{...headers,'idempotency-key':key},...(input===undefined?{}:{body:JSON.stringify(input)})}),env,url.pathname.slice('/api/v1/'.length).split('/'));
 };
 return {...f,env,headers,request};
}
const sale={client:{create:{slug:'workflow-client',name:'Cliente integrado',startedAt:'2026-01-01'}},externalReference:{system:'crm',externalId:'workflow-sale'},contacts:[{ref:'person',stakeholder:{name:'Pessoa',role:'Diretora'}}],enrollments:[{ref:'one',productId:'integration-product',startsAt:'2026-02-01',participants:[{stakeholderRef:'person',primary:true}]},{ref:'two',productId:'integration-product',startsAt:'2026-04-01',participants:[{stakeholderRef:'person',primary:true}]}]};
test('REST sale alias feeds compact context, deduplicated stakeholder map and version detail',async()=>{
 const f=await fixture();
 const result=await f.request('sales','POST',sale,'sale');assert.equal(result.status,200);const first=await result.json();
 assert.equal(first.data.enrollments.length,2);
 assert.deepEqual(await (await f.request('sales','POST',sale,'other-key')).json(),first);
 assert.equal((await f.request('me')).status,200);
 const capabilities=await (await f.request('capabilities?company=workflow-client')).json();assert.ok(capabilities.data.permissions.some(p=>p.action==='clientes.criar'&&p.allowed));
 const context=await (await f.request('clients/workflow-client/context')).json();assert.equal(context.data.sections.execution.cycleCount,2);
 const map=await (await f.request('clients/workflow-client/stakeholder-map')).json();assert.equal(map.data.counts.total,1);assert.equal(map.data.counts.shared,1);
 const [firstEnrollment,secondEnrollment]=first.data.enrollments.map(row=>row.enrollment);
 const cancelled=await f.request(`clients/workflow-client/enrollments/${firstEnrollment.id}`,'PATCH',{status:'cancelada',reason:'Encerramento solicitado pelo cliente.'});assert.equal(cancelled.status,200,await cancelled.clone().text());
 assert.equal((await cancelled.json()).data.enrollment.lifecycleHistory.at(-1).reason,'Encerramento solicitado pelo cliente.');
 assert.equal((await f.request(`clients/workflow-client/enrollments/${firstEnrollment.id}/archive`,'POST',{})).status,200);
 assert.equal((await f.request(`clients/workflow-client/enrollments/${firstEnrollment.id}/restore`,'POST',{})).status,200);
 assert.equal((await f.request(`clients/workflow-client/enrollments/${secondEnrollment.id}/rebuild`,'POST',{})).status,200);
 const removableResponse=await f.request('clients/workflow-client/enrollments','POST',{productId:'integration-product',startsAt:'2026-06-01'});assert.equal(removableResponse.status,200);
 const removable=(await removableResponse.json()).data.enrollment;
 assert.equal((await f.request(`clients/workflow-client/enrollments/${removable.id}/remove`,'POST',{})).status,200);
 f.sql.prepare("UPDATE sqlite_sequence SET seq=? WHERE name='client_audit_log'").run('9007199254740992');
 assert.equal((await f.request(`clients/workflow-client/enrollments/${firstEnrollment.id}/archive`,'POST',{})).status,200);
 const auditPage=await (await f.request('clients/workflow-client/audit-log?limit=1')).json();assert.equal(auditPage.data.length,1);assert.equal(auditPage.nextCursor,'9007199254740993');assert.ok(auditPage.data.every(row=>row.source==='api'&&row.actor.id==='admin'&&row.actor.email==='admin@example.com'));
 const auditRest=await (await f.request(`clients/workflow-client/audit-log?limit=100&cursor=${auditPage.nextCursor}`)).json();const audit=[...auditPage.data,...auditRest.data];assert.ok(audit.some(row=>row.action==='enrollment.cancelled'&&row.data.reason==='Encerramento solicitado pelo cliente.'));assert.ok(audit.some(row=>row.action==='enrollment.archived'));assert.ok(audit.some(row=>row.action==='enrollment.removed'));
 const adminAudit=await (await f.request('admin/audit-log?limit=100&company=workflow-client&area=enrollment&source=api')).json();assert.ok(adminAudit.data.length>0);assert.ok(adminAudit.data.every(row=>row.company==='workflow-client'&&row.area==='enrollment'&&row.source==='api'));
 const numbered=await (await f.request('admin/audit-log?limit=1&page=1&company=workflow-client')).json();assert.equal(numbered.page,1);assert.ok(numbered.total>1);assert.equal(numbered.totalPages,numbered.total);assert.equal(numbered.data.length,1);assert.ok(numbered.anchor);
 f.sql.prepare("INSERT INTO client_audit_log(id,workspace_id,operation_id,command,action,area,company,subject,principal_id,actor_id,source,application,data,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run('new-between-pages','default','new-operation','tasks.update','task.updated','task','workflow-client','new-task','admin','admin','api','test','{}','2000-01-01T00:00:00.000Z');
 const numberedNext=await (await f.request(`admin/audit-log?limit=1&page=2&company=workflow-client&anchor=${encodeURIComponent(numbered.anchor)}`)).json();assert.equal(numberedNext.page,2);assert.equal(numberedNext.anchor,numbered.anchor);assert.equal(numberedNext.total,numbered.total);assert.notEqual(numberedNext.data[0].id,numbered.data[0].id);
 assert.equal((await f.request('admin/audit-log?limit=1&page=2&company=workflow-client')).status,400);
 assert.equal((await f.request('admin/audit-log?limit=1&page=1&cursor=invalid')).status,400);
 assert.equal((await f.request('admin/audit-log?anchor=invalid')).status,400);
 f.sql.prepare("UPDATE client_audit_log SET created_at='2099-01-01' WHERE id=?").run(adminAudit.data[0].id);
 const adminPage=await (await f.request('admin/audit-log?limit=1')).json();assert.equal(adminPage.data.length,1);assert.ok(adminPage.nextCursor);const adminNext=await (await f.request(`admin/audit-log?limit=1&cursor=${encodeURIComponent(adminPage.nextCursor)}`)).json();assert.equal(adminNext.data.length,1);assert.notEqual(adminNext.data[0].id,adminPage.data[0].id);
 const reader=await issueIntegrationCredential(f.db,'default','admin@example.com',{name:'Leitura',ownerEmail:'reader@example.com',scopes:['workspace:read'],expiresAt:new Date(Date.now()+3600000).toISOString()});
 const adminUrl=new URL('https://delivery.test/api/v1/admin/audit-log');
 assert.equal((await apiResponse(new Request(adminUrl,{headers:{authorization:`Bearer ${reader.token}`}}),f.env,['admin','audit-log'])).status,403);
 assert.equal((await f.request('admin/audit-log/extra')).status,404);
 const lifecycleContext=await (await f.request('clients/workflow-client/context')).json();assert.equal(lifecycleContext.data.sections.enrollments.length,2);assert.ok(lifecycleContext.data.sections.enrollments.some(row=>row.lifecycleHistory.some(entry=>entry.type==='restored')));assert.ok(lifecycleContext.data.sections.enrollments.some(row=>row.lifecycleHistory.at(-1).type==='execution_rebuilt'));
 const versions=await (await f.request('products/integration-product/versions')).json();assert.equal(versions.data.versions[0].source,'current');
 const detail=await (await f.request('products/integration-product/versions/1')).json();assert.equal(detail.data.product.id,'integration-product');
 assert.equal((await f.request('clients/workflow-client/context/extra')).status,404);
 assert.equal((await f.request('products/integration-product/versions/1/extra')).status,404);
 const api=await (await f.request('openapi.json')).json();
 for(const path of ['/sales','/me','/capabilities','/admin/audit-log','/clients/{company}/stakeholder-map','/clients/{company}/audit-log','/clients/{company}/enrollments/{id}/archive','/clients/{company}/enrollments/{id}/restore','/clients/{company}/enrollments/{id}/remove','/clients/{company}/enrollments/{id}/rebuild','/webhooks/{id}/deliveries/{eventId}/replay']) assert.ok(api.paths[path]);
 f.sql.close();
});
test('MCP exposes and dispatches the same sale, context and outbound management operations',async()=>{
 const f=await fixture();
 const client=new Client({name:'workflow-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 const transport=new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:f.headers},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)});
 await client.connect(transport);
 const tools=await client.listTools();
 assert.ok(!tools.tools.some(t=>t.name==='meetings_sync_artifacts'));
 assert.equal((await f.request('meetings/fixture/sync-artifacts','POST',{})).status,403);
 assert.ok(!tools.tools.some(t=>t.name==='meetings_sync_responses'));
 assert.equal((await f.request('meetings/fixture/sync-responses','POST',{})).status,403);
 for(const name of ['sales_register','enrollments_archive','enrollments_restore','enrollments_remove','enrollments_rebuild','me_get','capabilities_get','clients_context','clients_audit_log','admin_audit_log','clients_stakeholder_map','products_versions','webhooks_update','webhooks_deliveries_list','webhooks_delivery_replay']) assert.ok(tools.tools.some(t=>t.name===name),name);
 const invoke=async(name,args)=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return result.structuredContent;};
 const hook=await invoke('webhooks_create',{idempotencyKey:'hook',url:'https://receiver.example/hook',types:['sale.registered']});
 const first=await invoke('sales_register',{idempotencyKey:'sale',input:sale});
 assert.deepEqual(await invoke('sales_register',{idempotencyKey:'sale-again',input:sale}),first);
 const audit=await invoke('clients_audit_log',{company:'workflow-client',limit:100});assert.ok(audit.data.length>0);assert.ok(audit.data.every(row=>row.source==='mcp'&&row.actor.email==='admin@example.com'));
 const adminAudit=await invoke('admin_audit_log',{company:'workflow-client',source:'mcp',page:1,limit:100});assert.ok(adminAudit.data.length>0);assert.ok(adminAudit.data.every(row=>row.company==='workflow-client'&&row.source==='mcp'));assert.equal(adminAudit.page,1);assert.ok(adminAudit.total>=adminAudit.data.length);
 const map=await invoke('clients_stakeholder_map',{company:'workflow-client'});assert.equal(map.data.counts.shared,1);
 const captured=[];
 const send=async(_url,init)=>{captured.push(new Headers(init.headers).get('x-g4-event-id'));return new Response('ok',{status:200});};
 await dispatchWebhooks(f.env,send);
 assert.equal(captured.length,1);assert.ok(captured[0]);
 const deliveries=await invoke('webhooks_deliveries_list',{subscriptionId:hook.data.id});assert.equal(deliveries.data.length,1);assert.equal(deliveries.data[0].status,'complete');
 const eventId=deliveries.data[0].event_id;
 await invoke('webhooks_update',{idempotencyKey:'pause',subscriptionId:hook.data.id,patch:{active:false}});
 const paused=await client.callTool({name:'webhooks_delivery_replay',arguments:{idempotencyKey:'replay-paused',subscriptionId:hook.data.id,eventId}});assert.equal(paused.isError,true);
 await invoke('webhooks_update',{idempotencyKey:'resume',subscriptionId:hook.data.id,patch:{active:true}});
 const replayArgs={idempotencyKey:'replay',subscriptionId:hook.data.id,eventId};
 await invoke('webhooks_delivery_replay',replayArgs);await invoke('webhooks_delivery_replay',replayArgs);
 await dispatchWebhooks(f.env,send);assert.equal(captured.length,2);assert.equal(captured[0],captured[1]);
 const history=await invoke('webhooks_deliveries_list',{subscriptionId:hook.data.id});assert.equal(history.data[0].attempts,2);assert.equal(history.data[0].history.length,2);
 assert.equal((await f.request(`webhooks/${hook.data.id}/deliveries/${eventId}/replay/extra`,'POST',{})).status,404);
 await client.close();f.sql.close();
});

test('catalog, provisioning and purchase-scoped rollout share REST and MCP contracts',async()=>{
 const f=await fixture(),client=new Client({name:'catalog-workflow',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 try{
  const request=structuredClone(sale);request.enrollments.forEach((e,i)=>{e.startsAt=`2027-0${i+1}-01`;});
  const created=await (await f.request('sales','POST',request)).json();const enrollment=created.data.enrollments[0].enrollment;
  await client.connect(new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:f.headers},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)}));
  const invoke=async(name,args)=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return result.structuredContent;};
  const tools=await client.listTools();for(const name of ['plans_list','plans_save','plans_publish','products_save','enrollments_provision','plans_provision','product_rollouts_preview','product_rollouts_apply'])assert.ok(tools.tools.some(t=>t.name===name),name);
  const provision=await invoke('enrollments_provision',{idempotencyKey:'provision',input:{company:'workflow-client',enrollmentId:enrollment.id}});assert.deepEqual(provision.data.cycles,[]);
  const plan={id:'workflow-plan',name:'Plano',description:'',milestones:[{n:1,name:'Marco',stage:'Etapa',owner:'Responsável',tasks:[{id:'ref',title:'Fazer',hours:1,description:'',completion:'checklist'}]}]};
  const saved=await (await f.request('plans','POST',{plan})).json();assert.ok(saved.data.fingerprint);
  const read=await (await f.request('plans/workflow-plan')).json();assert.equal(read.data.fingerprint,saved.data.fingerprint);
  const published=await invoke('plans_publish',{idempotencyKey:'publish',input:{planId:plan.id,scope:'novos',fingerprint:read.data.fingerprint}});assert.equal(published.data.version.version,1);
  const product=(await (await f.request('products/integration-product')).json()).data;product.cycles[0].deliveries[0].title='Nova tarefa';
  const updated=await (await f.request('products/integration-product','PATCH',product)).json();assert.equal(updated.data.product.version,2);
  const scope={company:'workflow-client',enrollmentId:enrollment.id,productId:product.id,targetVersion:2};
  const preview=await invoke('product_rollouts_preview',scope);assert.match(preview.data.previewFingerprint,/^[a-f0-9]{64}$/);
  const selected=preview.data.cycles.filter(c=>!c.blocked).map(c=>c.id);assert.equal(selected.length,1);
  const input={...scope,cycleIds:selected,previewFingerprint:preview.data.previewFingerprint};
  const applied=await f.request('product-rollouts/apply','POST',input,'rollout');assert.equal(applied.status,200,JSON.stringify(await applied.clone().json()));
  assert.deepEqual(await (await f.request('product-rollouts/apply','POST',input,'rollout')).json(),await applied.json());
  const tasks=(await (await f.request('tasks?company=workflow-client')).json()).data;
  assert.equal(tasks.find(t=>t.enrollmentId===enrollment.id).title,'Nova tarefa');assert.equal(tasks.find(t=>t.enrollmentId!==enrollment.id).title,'Tarefa');
  const spec=await (await f.request('openapi.json')).json();for(const path of ['/plans','/plans/{id}/publish','/product-rollouts/preview','/clients/{company}/enrollments/{id}/provision'])assert.ok(spec.paths[path]);
 }finally{await client.close();f.sql.close();}
});

test('MCP discovery and OpenAPI advertise mandatory composite scopes consistently',async()=>{
 const f=await fixture(),client=new Client({name:'scope-workflow',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 try{
  f.sql.prepare('UPDATE integration_credentials SET scopes=?').run(JSON.stringify(['delivery:write']));
  await client.connect(new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:f.headers},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)}));
  let tools=await client.listTools();assert.ok(!tools.tools.some(t=>['product_rollouts_apply','enrollments_provision','sales_register','meetings_actions_create_task'].includes(t.name)));
  f.sql.prepare('UPDATE integration_credentials SET scopes=?').run(JSON.stringify(['meetings:write']));
  tools=await client.listTools();assert.ok(!tools.tools.some(t=>t.name==='meetings_actions_create_task'));
  const api=await (await f.request('openapi.json')).json();
  assert.deepEqual(api.paths['/product-rollouts/apply'].post['x-required-scopes'],['delivery:write','catalog:read','enrollments:read']);
  assert.deepEqual(api.paths['/clients/{company}/enrollments/{id}/provision'].post['x-required-scopes'],['enrollments:write','delivery:write']);
  f.sql.prepare('UPDATE integration_credentials SET scopes=?').run(JSON.stringify(['enrollments:write']));
  tools=await client.listTools();assert.ok(!tools.tools.some(t=>['enrollments_provision','enrollments_create'].includes(t.name)));
  f.sql.prepare('UPDATE integration_credentials SET scopes=?').run(JSON.stringify(['enrollments:write','delivery:write']));
  tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='enrollments_provision'));assert.ok(tools.tools.some(t=>t.name==='enrollments_create'));
 }finally{await client.close();f.sql.close();}
});

test('meeting action conversion shares atomic REST and MCP contract across purchase contexts',async()=>{
 const f=await fixture(),client=new Client({name:'meeting-action-workflow',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 try{
  const sold=await(await f.request('sales','POST',sale)).json();const purchases=sold.data.enrollments.map(e=>e.enrollment.id);
  const meetingResult=await f.request('meetings','POST',{meeting:{company:'workflow-client',title:'Ações combinadas',startsAt:'2027-01-15T12:00:00-03:00',durationMin:30,attendeeIds:[],enrollmentIds:purchases,actions:[{id:'followup',text:'Concluir análise',ownerId:'admin',dueAt:'2027-02-01',done:true}]}});
  assert.equal(meetingResult.status,200,JSON.stringify(await meetingResult.clone().json()));
  const meeting=(await meetingResult.json()).data.meeting;
  await client.connect(new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:f.headers},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)}));
  const tool=(await client.listTools()).tools.find(t=>t.name==='meetings_actions_create_task');assert.ok(tool);assert.equal(tool.annotations.openWorldHint,false);
  const converted=await client.callTool({name:tool.name,arguments:{idempotencyKey:'convert-action',input:{meetingId:meeting.id,actionId:'followup',enrollmentId:purchases[1]}}});
  assert.ok(!converted.isError,JSON.stringify(converted));const task=converted.structuredContent.data.task;
  assert.equal(task.status,'fila');assert.equal(task.enrollmentId,purchases[1]);assert.equal(task.productId,'integration-product');
  const alias=`meetings/${meeting.id}/actions/followup/task`;
  const repeated=await f.request(alias,'POST',{enrollmentId:purchases[1]},'different-intent-key');assert.equal(repeated.status,200);assert.equal((await repeated.json()).data.task.id,task.id);
  assert.equal((await f.request(alias+'/extra','POST',{enrollmentId:purchases[1]})).status,404);
  const current=(await(await f.request(`meetings/${meeting.id}`)).json()).data;assert.equal(current.actions[0].deliveryId,task.id);
  const spec=await(await f.request('openapi.json')).json();assert.deepEqual(spec.paths['/meetings/{id}/actions/{actionId}/task'].post['x-required-scopes'],['meetings:write','delivery:write']);
  const changed=await f.request(`meetings/${meeting.id}`,'PATCH',{actions:[{...current.actions[0],deliveryId:'forged'}]});assert.equal(changed.status,422);
 }finally{await client.close();f.sql.close();}
});


test('meeting lifecycle REST and MCP preserve history and expose removed records explicitly',async()=>{
 const f=await fixture(),meeting={id:'lifecycle',company:'santa-clara',title:'Reunião',startsAt:'2026-09-17T12:00:00Z',durationMin:30,attendeeIds:[],actions:[{id:'action',text:'Ação',ownerId:'admin',dueAt:'2026-09-18',done:false,deliveryId:'preserved-task'}],decisions:[],summary:''};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.engagement.v2',1,?)").run(JSON.stringify({extraMeetings:[meeting]}));
 const client=new Client({name:'lifecycle-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:f.headers},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)}));
  const tools=(await client.listTools()).tools;for(const name of ['meetings_remove','meetings_restore','meetings_actions_remove','meetings_actions_restore']){const tool=tools.find(t=>t.name===name);assert.ok(tool);assert.equal(tool.annotations.openWorldHint,false);}
  const removedAction=await f.request('meetings/lifecycle/actions/action/remove','POST',{});assert.equal(removedAction.status,200,await removedAction.clone().text());assert.equal((await removedAction.json()).data.meeting.actions[0].deliveryId,'preserved-task');
  const restoredAction=await client.callTool({name:'meetings_actions_restore',arguments:{idempotencyKey:'restore-action',input:{meetingId:'lifecycle',actionId:'action'}}});assert.ok(!restoredAction.isError,JSON.stringify(restoredAction));assert.equal(restoredAction.structuredContent.data.meeting.actions[0].removedAt,undefined);
  const args={idempotencyKey:'remove-meeting',input:{meetingId:'lifecycle'}};const removed=await client.callTool({name:'meetings_remove',arguments:args});assert.ok(!removed.isError,JSON.stringify(removed));assert.deepEqual((await client.callTool({name:'meetings_remove',arguments:args})).structuredContent,removed.structuredContent);
  assert.equal((await f.request('meetings/lifecycle')).status,404);
  const listed=await client.callTool({name:'meetings_list',arguments:{includeRemoved:true,company:'santa-clara'}});assert.equal(listed.structuredContent.data.find(m=>m.id==='lifecycle').removed,true);
  const restored=await f.request('meetings/lifecycle/restore','POST',{});assert.equal(restored.status,200,await restored.clone().text());assert.equal((await restored.json()).data.meeting.actions[0].deliveryId,'preserved-task');
  assert.equal((await f.request('meetings/lifecycle/actions/action/remove/extra','POST',{})).status,404);
  const api=await (await f.request('openapi.json')).json();for(const path of ['/meetings/{id}/remove','/meetings/{id}/restore','/meetings/{id}/actions/{actionId}/remove','/meetings/{id}/actions/{actionId}/restore'])assert.ok(api.paths[path]);
 }finally{await client.close();f.sql.close();}
});

test('REST upload and interaction commands share atomic note documents with MCP reads and edits',async()=>{
 const f=await fixture(),{fileResponse}=await import('../src/server/operations/files.ts'),objects=new Map();
 f.env.FILES={async put(key,body){objects.set(key,body);return {key};},async get(key){const value=objects.get(key);return value===undefined?null:{body:value,arrayBuffer:async()=>value};},async delete(key){objects.delete(key);}};
 const client=new Client({name:'interaction-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 try{
  const upload=await fileResponse(new Request('https://delivery.test/api/files/up-interaction-fixture',{method:'PUT',headers:{...f.headers,'content-type':'text/plain','x-client-company':'santa-clara','x-file-name':'contexto.txt'},body:'Contexto sintético'}),f.env,'up-interaction-fixture');assert.equal(upload.status,200,await upload.clone().text());
  const input={company:'santa-clara',title:'Conversa inicial',text:'Contexto da reunião',at:'2026-09-17T12:00:00Z',kind:'conversa',fileIds:['up-interaction-fixture']};
  const created=await f.request('interactions','POST',input,'interaction-create');assert.equal(created.status,200,await created.clone().text());const first=await created.json();
  assert.equal(first.data.note.files[0].id,'up-interaction-fixture');assert.deepEqual(await (await f.request('interactions','POST',input,'interaction-create')).json(),first);
  const docs=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.documents.v3'").get().body);assert.equal(docs.extraDocs.filter(d=>d.id==='up-interaction-fixture').length,1);assert.equal(docs.extraDocs.find(d=>d.id==='up-interaction-fixture').relatedThreadId,first.data.thread.id);
  await client.connect(new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:f.headers},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)}));
  for(const name of ['interactions_create','interactions_update','interactions_list'])assert.ok((await client.listTools()).tools.some(t=>t.name===name));
  const edited=await client.callTool({name:'interactions_update',arguments:{idempotencyKey:'interaction-edit',input:{company:'santa-clara',noteId:first.data.note.id,patch:{text:'Contexto corrigido'}}}});assert.ok(!edited.isError,JSON.stringify(edited));assert.equal(edited.structuredContent.data.note.createdAt,first.data.note.createdAt);assert.equal(edited.structuredContent.data.note.history.at(-1).to,'Contexto corrigido');
  const listed=await client.callTool({name:'interactions_list',arguments:{company:'santa-clara',limit:1}});assert.ok(!listed.isError,JSON.stringify(listed));assert.equal(listed.structuredContent.data[0].id,first.data.note.id);
  assert.equal((await f.request('interactions?company=santa-clara&cursor=-1')).status,400);assert.equal((await f.request('interactions/unknown/extra','POST',{})).status,404);
 }finally{await client.close();f.sql.close();}
});

test('capture and content commands are available through REST and MCP without calendar effects',async()=>{
 const f=await fixture(),client=new Client({name:'meeting-content-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 try{
  const meeting={id:'captured-fixture',company:'santa-clara',title:'Reunião realizada',kind:'alinhamento',modality:'presencial',startsAt:'2026-09-15T12:00:00Z',durationMin:30,attendeeIds:['admin'],summary:'Registro',notes:'Notas iniciais',decisions:[],actions:[],decisionItems:[]};
  const input={meeting,pains:[],solutions:[],hypotheses:[],noNewPains:true};
  const response=await f.request('meetings/capture','POST',input,'capture-fixture');assert.equal(response.status,200,await response.clone().text());const created=await response.json();assert.equal(created.data.meeting.id,meeting.id);
  assert.deepEqual(await (await f.request('meetings/capture','POST',input,'capture-fixture')).json(),created);
  const changed=await f.request('meetings/captured-fixture/content','PATCH',{notes:'Notas revisadas',prep:{questions:'O que aprendemos?'}});assert.equal(changed.status,200,await changed.clone().text());
  await client.connect(new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:f.headers},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)}));
  for(const name of ['meetings_capture','meetings_content_update']){const tool=(await client.listTools()).tools.find(t=>t.name===name);assert.ok(tool);assert.equal(tool.annotations.openWorldHint,false);}
  const result=await client.callTool({name:'meetings_content_update',arguments:{idempotencyKey:'content-fixture',input:{meetingId:meeting.id,patch:{notes:'Notas confirmadas pelo MCP',decisions:['Próximo passo confirmado']}}}});assert.ok(!result.isError,JSON.stringify(result));
  const state=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.engagement.v2'").get().body);assert.equal(state.notes[meeting.id],'Notas confirmadas pelo MCP');assert.equal(state.extraMeetings.find(m=>m.id===meeting.id).notes,state.notes[meeting.id]);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM meeting_operations').get().n,0);
  assert.equal((await f.request('meetings/captured-fixture/content/extra','PATCH',{})).status,404);
  const api=await (await f.request('openapi.json')).json();assert.ok(api.paths['/meetings/capture']);assert.ok(api.paths['/meetings/{id}/content']);
 }finally{await client.close();f.sql.close();}
});

test('diagnosis REST and MCP refine atomically and preserve evidence through removal and restoration',async()=>{
 const f=await fixture(),client=new Client({name:'diagnosis-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 try{
  const input={company:'santa-clara',hypothesis:{statement:'A causa pode ser o processo',painIds:[]}};
  const response=await f.request('hypotheses','POST',input,'diagnosis-create');assert.equal(response.status,200,await response.clone().text());const made=await response.json(),id=made.data.hypothesis.id;
  assert.deepEqual(await (await f.request('hypotheses','POST',input,'diagnosis-create')).json(),made);
  assert.equal((await f.request(`hypotheses/${id}/evidence`,'POST',{company:input.company,kind:'confirma',source:'dados',note:'Observação de teste'})).status,200);
  await client.connect(new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:f.headers},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)}));
  const tools=(await client.listTools()).tools;for(const name of ['pains_list','solutions_list','hypotheses_list','hypotheses_refine'])assert.ok(tools.some(t=>t.name===name));
  const refined=await client.callTool({name:'hypotheses_refine',arguments:{idempotencyKey:'diagnosis-refine',input:{company:input.company,hypothesisId:id,statement:'A causa está na passagem entre áreas'}}});assert.ok(!refined.isError,JSON.stringify(refined));
  const all=await (await f.request('hypotheses?company=santa-clara')).json(),parent=all.data.find(h=>h.id===id),child=all.data.find(h=>h.parentId===id);assert.equal(parent.status,'refinada');assert.equal(parent.evidence.length,1);assert.ok(child);assert.equal(child.evidence.length,0);
  assert.equal((await f.request(`hypotheses/${id}/remove`,'POST',{company:input.company})).status,200);
  const removed=await (await f.request('hypotheses?company=santa-clara&includeRemoved=true')).json();assert.ok(removed.data.some(h=>h.id===id));
  assert.equal((await f.request(`hypotheses/${id}/restore`,'POST',{company:input.company})).status,200);
  const restored=await (await f.request('hypotheses?company=santa-clara')).json();assert.equal(restored.data.find(h=>h.id===id).evidence.length,1);
  const schema=await (await f.request('openapi.json')).json();assert.ok(schema.paths['/hypotheses/{id}/refine']);assert.equal((await f.request(`hypotheses/${id}/refine/extra`,'POST',{})).status,404);
 }finally{await client.close();f.sql.close();}
});

test('program events share REST and MCP lifecycle without calendar effects',async()=>{
 const f=await fixture(),client=new Client({name:'agenda-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 try{
  const input={company:'santa-clara',event:{title:'Workshop',kind:'Workshop',startsAt:'2026-10-01T12:00:00Z',place:'Sala',detail:'Teste'}};
  const response=await f.request('program-events','POST',input,'agenda-create');assert.equal(response.status,200,await response.clone().text());const made=await response.json(),id=made.data.event.id;
  assert.deepEqual(await (await f.request('program-events','POST',input,'agenda-create')).json(),made);
  assert.equal((await f.request(`program-events/${id}`,'PATCH',{company:input.company,patch:{title:'Workshop revisado'}})).status,200);
  await client.connect(new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:f.headers},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)}));
  const list=await client.callTool({name:'program_events_list',arguments:{company:input.company}});assert.ok(!list.isError,JSON.stringify(list));
  const removed=await client.callTool({name:'program_events_remove',arguments:{idempotencyKey:'agenda-remove',input:{company:input.company,eventId:id}}});assert.ok(!removed.isError,JSON.stringify(removed));
  assert.ok(!(await (await f.request('program-events?company=santa-clara')).json()).data.some(e=>e.id===id));
  const hidden=(await (await f.request('program-events?company=santa-clara&includeRemoved=true')).json()).data.find(e=>e.id===id);assert.equal(hidden.title,'Workshop revisado');
  assert.equal((await f.request(`program-events/${id}/restore`,'POST',{company:input.company})).status,200);
  assert.ok((await (await f.request('program-events?company=santa-clara')).json()).data.some(e=>e.id===id));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM meeting_operations').get().n,0);
  assert.equal((await f.request(`program-events/${id}/restore/extra`,'POST',{})).status,404);
  assert.ok((await (await f.request('openapi.json')).json()).paths['/program-events/{id}/restore']);
 }finally{await client.close();f.sql.close();}
});

test('signal task conversion is shared by REST and MCP and reopens without losing its task',async()=>{
 const f=await fixture(),client=new Client({name:'signals-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 try{
  const at=new Date().toISOString(),thread={id:'signal-thread',company:'santa-clara',channel:'whatsapp',title:'Conversa fixture',unread:0,lastAt:at,preview:'Preciso de ajuda?',messages:[{id:'message',at,from:'Cliente teste',text:'Preciso de ajuda?'}]};
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.relationship.v1',1,?)").run(JSON.stringify({spaces:[thread],notes:{},read:[],unread:[],pinned:[]}));
  const rows=await (await f.request('signals?company=santa-clara')).json(),signal=rows.data.find(s=>s.threadId===thread.id);assert.ok(signal,JSON.stringify(rows));
  assert.equal((await f.request(`signals/${signal.id}/resolve`,'POST',{company:thread.company})).status,200);
  assert.equal((await f.request(`signals/${signal.id}/reopen`,'POST',{company:thread.company})).status,200);
  const input={company:thread.company,enrollmentId:null};const response=await f.request(`signals/${signal.id}/task`,'POST',input,'signal-task');assert.equal(response.status,200,await response.clone().text());const made=await response.json();assert.ok(made.data.task.id);
  await client.connect(new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:f.headers},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)}));
  const reopened=await client.callTool({name:'signals_reopen',arguments:{idempotencyKey:'signal-reopen',input:{company:thread.company,signalId:signal.id}}});assert.ok(!reopened.isError,JSON.stringify(reopened));
  const repeated=await (await f.request(`signals/${signal.id}/task`,'POST',input,'signal-another-key')).json();assert.equal(repeated.data.task.id,made.data.task.id);assert.equal(repeated.data.existing,true);
  const state=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get().body);assert.equal(state.extraTasks.filter(t=>t.id===made.data.task.id).length,1);
  const listed=await client.callTool({name:'signals_list',arguments:{company:thread.company}});assert.ok(!listed.isError,JSON.stringify(listed));
  assert.equal((await f.request(`signals/${signal.id}/task/extra`,'POST',input)).status,404);assert.ok((await (await f.request('openapi.json')).json()).paths['/signals/{id}/task']);
 }finally{await client.close();f.sql.close();}
});

test('Inbox notes and desired flags share REST and MCP without editing imported messages',async()=>{
 const f=await fixture(),client=new Client({name:'inbox-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 try{
  const at=new Date().toISOString(),thread={id:'inbox-fixture',company:'santa-clara',channel:'email',title:'Conversa fixture',unread:1,lastAt:at,preview:'Mensagem',messages:[{id:'imported',at,from:'Cliente',text:'Mensagem'}]};
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.relationship.v1',1,?)").run(JSON.stringify({spaces:[thread],notes:{},read:[],unread:[],pinned:[]}));
  const created=await f.request(`inbox/threads/${thread.id}/notes`,'POST',{text:'Nota interna'},'inbox-create');assert.equal(created.status,200,await created.clone().text());const made=await created.json(),id=made.data.note.id;
  assert.deepEqual(await (await f.request(`inbox/threads/${thread.id}/notes`,'POST',{text:'Nota interna'},'inbox-create')).json(),made);
  const edited=await f.request(`inbox/threads/${thread.id}/notes/${id}`,'PATCH',{patch:{text:'Nota revisada'}});assert.equal(edited.status,200,await edited.clone().text());
  assert.ok((await f.request(`inbox/threads/${thread.id}/notes/imported`,'PATCH',{patch:{text:'Forjada'}})).status>=400);
  await client.connect(new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:f.headers},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)}));
  const flags=await client.callTool({name:'inbox_thread_update',arguments:{idempotencyKey:'inbox-flags',input:{threadId:thread.id,pinned:true,read:false}}});assert.ok(!flags.isError,JSON.stringify(flags));
  const notes=await (await f.request(`inbox/threads/${thread.id}/messages?company=santa-clara`)).json();assert.equal(notes.data.filter(n=>n.id===id).length,1);assert.equal(notes.data.find(n=>n.id===id).text,'Nota revisada');assert.equal(notes.data.find(n=>n.id===id).history.length,1);
  const list=await client.callTool({name:'inbox_list',arguments:{company:thread.company}});assert.ok(!list.isError,JSON.stringify(list));
  const state=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.relationship.v1'").get().body);assert.ok(state.pinned.includes(thread.id));assert.ok(state.unread.includes(thread.id));assert.ok(!state.read.includes(thread.id));
  assert.equal((await f.request(`inbox/threads/${thread.id}/notes/${id}/extra`,'PATCH',{})).status,404);assert.ok((await (await f.request('openapi.json')).json()).paths['/inbox/threads/{threadId}/notes']);
 }finally{await client.close();f.sql.close();}
});

test('documents upload, version, review and reversible removal share REST and MCP contracts',async()=>{
 const f=await fixture(),objects=new Map();
 f.env.FILES={async put(key,body){objects.set(key,body);return {key};},async get(key){const value=objects.get(key);return value===undefined?null:{body:value,arrayBuffer:async()=>value};},async delete(key){objects.delete(key);}};
 const client=new Client({name:'documents-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:f.headers},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)}));
  const uploadRest=async id=>apiResponse(new Request(`https://delivery.test/api/v1/files/${id}`,{method:'PUT',headers:{...f.headers,'content-type':'text/plain','x-client-company':'santa-clara','x-file-name':encodeURIComponent(id+'.txt')},body:'Conteúdo sintético'}),f.env,['files',id]);
  for(const id of ['up-doc-one','up-doc-three']){const upload=await uploadRest(id);assert.equal(upload.status,200,await upload.clone().text());}
  const uploadMcp=await client.callTool({name:'files_upload',arguments:{company:'santa-clara',fileId:'up-doc-two',name:'up-doc-two.txt',mimeType:'text/plain',contentBase64:Buffer.from('Conteúdo sintético').toString('base64')}});assert.ok(!uploadMcp.isError,JSON.stringify(uploadMcp));assert.equal(uploadMcp.structuredContent.data.fileId,'up-doc-two');
  const input={company:'santa-clara',fileId:'up-doc-one',kind:'entregavel',visibility:'cliente'};
  const registered=await f.request('documents','POST',input,'doc-register');assert.equal(registered.status,200,await registered.clone().text());const first=await registered.json();assert.equal(first.data.document.id,input.fileId);
  assert.deepEqual(await (await f.request('documents','POST',input,'doc-register')).json(),first);
  assert.equal((await f.request('documents/up-doc-one/review','POST',{status:'aprovado',notes:'Validado'})).status,200);
  const version=await f.request('documents/up-doc-one/versions','POST',{fileId:'up-doc-two'});assert.equal(version.status,200,await version.clone().text());const second=await version.json();assert.equal(second.data.document.version,2);assert.equal(second.data.document.supersedesId,'up-doc-one');
  assert.equal((await f.request('documents/up-doc-one/versions','POST',{fileId:'up-doc-three'})).status,409);
  const update=await client.callTool({name:'documents_update',arguments:{idempotencyKey:'doc-update',input:{documentId:'up-doc-two',patch:{note:'Nota revisada'}}}});assert.ok(!update.isError,JSON.stringify(update));
  const downloaded=await client.callTool({name:'files_download',arguments:{fileId:'up-doc-two'}});assert.ok(!downloaded.isError,JSON.stringify(downloaded));const resource=downloaded.content.find(part=>part.type==='resource');assert.equal(Buffer.from(resource.resource.blob,'base64').toString(),'Conteúdo sintético');
  const restDownload=await apiResponse(new Request('https://delivery.test/api/v1/files/up-doc-one',{headers:f.headers}),f.env,['files','up-doc-one']);assert.equal(await restDownload.text(),'Conteúdo sintético');
  assert.equal((await f.request('documents/up-doc-two/remove','POST',{})).status,200);
  const deleted=await apiResponse(new Request('https://delivery.test/api/v1/files/up-doc-two',{method:'DELETE',headers:f.headers}),f.env,['files','up-doc-two']);assert.equal(deleted.status,409);assert.equal(objects.size,3);
  const orphanDeleted=await client.callTool({name:'files_delete',arguments:{fileId:'up-doc-three'}});assert.ok(!orphanDeleted.isError,JSON.stringify(orphanDeleted));assert.equal(objects.size,2);
  const restore=await client.callTool({name:'documents_restore',arguments:{idempotencyKey:'doc-restore',input:{documentId:'up-doc-two'}}});assert.ok(!restore.isError,JSON.stringify(restore));
  const rows=await (await f.request('documents?company=santa-clara')).json();assert.equal(rows.data.find(d=>d.id==='up-doc-two').note,'Nota revisada');assert.equal(rows.data.find(d=>d.id==='up-doc-one').reviewStatus,'aprovado');
  const listed=await client.callTool({name:'documents_list',arguments:{company:'santa-clara'}});assert.ok(!listed.isError,JSON.stringify(listed));const api=(await (await f.request('openapi.json')).json());assert.ok(api.paths['/documents/{id}/versions']);assert.ok(api.paths['/files/{id}'].put);assert.ok(api.paths['/files/{id}'].get);assert.ok(api.paths['/files/{id}'].delete);
 }finally{await client.close();f.sql.close();}
});

test('knowledge REST and MCP preserve graph and protect undo against concurrent changes',async()=>{
 const f=await fixture(),client=new Client({name:'knowledge-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 try{
  assert.equal((await f.request('sales','POST',sale)).status,200);const company='workflow-client';
  const node={id:'node-a',label:'Área A',kind:'instance',elementType:'area',domain:'organizacao',x:0,y:0,coverage:0,description:'',properties:[]};
  const first=await f.request(`knowledge/${company}/elements`,'POST',{node},'knowledge-first');assert.equal(first.status,200,await first.clone().text());const saved=await first.json();assert.equal(saved.data.previousVersion,0);
  const second=await f.request(`knowledge/${company}/elements`,'POST',{node:{...node,id:'node-b',label:'Área B'},edge:{id:'edge-ab',from:'node-a',to:'node-b',label:'apoia'}});assert.equal(second.status,200,await second.clone().text());const linked=await second.json();assert.equal(linked.data.ontology.edges.length,1);
  await client.connect(new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:f.headers},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)}));
  const undone=await client.callTool({name:'knowledge_history_restore',arguments:{idempotencyKey:'knowledge-undo',input:{company,targetVersion:saved.data.version,expectedVersion:linked.data.version,responseMode:'full'}}});assert.ok(!undone.isError,JSON.stringify(undone));assert.equal(undone.structuredContent.data.ontology.nodes.length,1);
  const redone=await f.request(`knowledge/${company}/history/restore`,'POST',{targetVersion:linked.data.version,expectedVersion:undone.structuredContent.data.version});assert.equal(redone.status,200,await redone.clone().text());const restored=await redone.json();assert.equal(restored.data.ontology.nodes.length,2);
  const moved=await f.request(`knowledge/${company}/layout`,'POST',{positions:[{nodeId:'node-a',networkPosition:{x:100,y:200}}]});assert.equal(moved.status,200,await moved.clone().text());
  assert.equal((await f.request(`knowledge/${company}/history/restore`,'POST',{targetVersion:0,expectedVersion:restored.data.version})).status,409);
  const reset=await f.request(`knowledge/${company}/layout/reset`,'POST',{nodeIds:['node-a']});assert.equal(reset.status,200,await reset.clone().text());
  const read=await client.callTool({name:'knowledge_get',arguments:{company,view:'full'}});assert.ok(!read.isError,JSON.stringify(read));assert.equal(read.structuredContent.data.ontology.edges.length,1);
  assert.equal((await f.request(`knowledge/${company}/elements/node-b/remove`,'POST',{})).status,200);
  const final=await (await f.request(`knowledge/${company}`)).json();assert.equal(final.data.ontology.nodes.length,1);assert.equal(final.data.ontology.edges.length,0);
  assert.equal((await f.request(`knowledge/${company}/history/restore/extra`,'POST',{})).status,404);assert.ok((await (await f.request('openapi.json')).json()).paths['/knowledge/{company}/history/restore']);
 }finally{await client.close();f.sql.close();}
});

test('allocations and client lifecycle share authorized REST and MCP commands',async()=>{
 const f=await fixture(),client=new Client({name:'allocation-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 try{
  const input={company:'santa-clara',allocation:{memberId:'admin',role:'consultor',percent:25}};
  const created=await f.request('allocations','POST',input,'allocation-create');assert.equal(created.status,200,await created.clone().text());const made=await created.json(),id=made.data.allocation.id;
  assert.deepEqual(await (await f.request('allocations','POST',input,'allocation-create')).json(),made);
  await client.connect(new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:f.headers},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)}));
  const edited=await client.callTool({name:'allocations_save',arguments:{idempotencyKey:'allocation-edit',input:{company:input.company,allocation:{...input.allocation,id,percent:40}}}});assert.ok(!edited.isError,JSON.stringify(edited));
  const listed=await (await f.request('allocations?company=santa-clara')).json();assert.equal(listed.data.find(a=>a.id===id).percent,40);
  assert.equal((await f.request(`allocations/${id}/remove`,'POST',{company:input.company})).status,200);
  const after=await client.callTool({name:'allocations_list',arguments:{company:input.company}});assert.ok(!after.isError,JSON.stringify(after));assert.ok(!after.structuredContent.data.some(a=>a.id===id));
  assert.equal((await f.request('clients/santa-clara/archive','POST',{})).status,200);
  const restore=await client.callTool({name:'clients_restore',arguments:{idempotencyKey:'client-restore',input:{company:input.company}}});assert.ok(!restore.isError,JSON.stringify(restore));
  const state=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body);assert.ok(!state.archivedClients.includes(input.company));assert.ok(state.allocationsMigrated);
  assert.equal((await f.request(`allocations/${id}/remove/extra`,'POST',{})).status,404);assert.ok((await (await f.request('openapi.json')).json()).paths['/allocations/{id}/remove']);
 }finally{await client.close();f.sql.close();}
});

test('members REST and MCP reuse Delivery authorization and confirmed operations',async()=>{
 const f=await fixture(),client=new Client({name:'members-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 try{
  const input={member:{name:'Pessoa integrada',email:'member@example.test',role:'AI Master',access:'ai_master'}};
  const created=await f.request('members','POST',input,'member-create');assert.equal(created.status,200,await created.clone().text());const made=await created.json(),id=made.data.member.id;
  assert.deepEqual(await (await f.request('members','POST',input,'member-create')).json(),made);
  await client.connect(new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:f.headers},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)}));
  const tools=(await client.listTools()).tools;for(const name of ['members_update','stakeholders_save']){const schema=JSON.stringify(tools.find(tool=>tool.name===name)?.inputSchema);assert.match(schema,/emails/,name);assert.match(schema,/phones/,name);}
  const edited=await client.callTool({name:'members_update',arguments:{idempotencyKey:'member-edit',input:{memberId:id,patch:{name:'Pessoa atualizada'}}}});assert.ok(!edited.isError,JSON.stringify(edited));
  assert.equal((await f.request(`members/${id}`,'PATCH',{patch:{capacityHoursWeek:32}})).status,200);
  assert.equal((await f.request(`members/${id}/active`,'POST',{active:false})).status,200);
  const listed=await client.callTool({name:'members_list',arguments:{includeInactive:true}});assert.ok(!listed.isError,JSON.stringify(listed));const member=listed.structuredContent.data.find(m=>m.id===id);assert.equal(member.name,'Pessoa atualizada');assert.equal(member.capacityHoursWeek,32);assert.equal(member.active,false);
  assert.equal((await f.request(`members/${id}/active/extra`,'POST',{active:true})).status,404);
  assert.equal((await f.request('members?includeInactive=no')).status,400);
  const openapi=await (await f.request('openapi.json')).json();assert.ok(openapi.paths['/members/{id}/active']);for(const path of ['/members','/clients/{company}/stakeholders']){const schema=JSON.stringify(openapi.paths[path].post);assert.match(schema,/emails/,path);assert.match(schema,/phones/,path);}
 }finally{await client.close();f.sql.close();}
});

test('REST and MCP advance only the selected purchase and expose the same contract',async()=>{
 const f=await fixture(),client=new Client({name:'milestone-fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 try{
  const doc=JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.catalog.v2'").get().body),product=doc.extraProducts[0];
  product.cycles.push({...product.cycles[0],id:'second-cycle',name:'Segundo ciclo'});
  f.sql.prepare("UPDATE state_documents SET body=? WHERE key='ontology.catalog.v2'").run(JSON.stringify(doc));
  const created=await (await f.request('sales','POST',sale)).json();const [first,second]=created.data.enrollments.map(row=>row.enrollment);
  await client.connect(new StreamableHTTPClientTransport(new URL('https://delivery.test/mcp'),{requestInit:{headers:f.headers},fetch:(url,init)=>mcpResponse(new Request(url,init),f.env)}));
  const result=await client.callTool({name:'plans_advance',arguments:{idempotencyKey:'advance-mcp',input:{company:'workflow-client',planId:first.planId,enrollmentId:first.id,currentMilestone:1,justification:'Acordado com o cliente nesta reunião'}}});assert.ok(!result.isError,JSON.stringify(result));assert.equal(result.structuredContent.data.to,2);
  const response=await f.request(`clients/workflow-client/plans/${second.planId}/advance`,'POST',{enrollmentId:second.id,currentMilestone:1,justification:'Outra compra com decisão independente'});assert.equal(response.status,200,await response.clone().text());
  assert.equal((await f.request(`clients/workflow-client/plans/${second.planId}/advance/extra`,'POST',{})).status,404);
  assert.ok((await (await f.request('openapi.json')).json()).paths['/clients/{company}/plans/{id}/advance']);
 }finally{await client.close();f.sql.close();}
});
