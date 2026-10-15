import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { rotateWebhookSecret,signWebhook,createWebhook,deactivateWebhook,updateWebhook,listWebhooks,listWebhookDeliveries,replayWebhookDelivery,dispatchWebhooks } from '../src/server/operations/webhooks.ts';
import { issueIntegrationCredential,revokeIntegrationCredential } from '../src/server/operations/credentials.ts';
import { resolveOperationPrincipal } from '../src/server/operations/principal.ts';
async function fixture(companies) {
 const f=sqliteD1(),env={DB:f.db,INTEGRATION_SECRET_KEY:btoa('x'.repeat(32))};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify({extraMembers:[{id:'admin',email:'admin@example.test',access:'admin'}]}));
 const credential=await issueIntegrationCredential(f.db,'default','admin@example.test',{name:'Outbound fixture',ownerEmail:'admin@example.test',scopes:['events:read','events:write'],companies,expiresAt:new Date(Date.now()+3600000).toISOString()});
 const principal=await resolveOperationPrincipal(new Request('https://delivery.test',{headers:{authorization:`Bearer ${credential.token}`}}),env);
 const event=(id,company='alpha')=>f.sql.prepare("INSERT INTO operation_events(id,workspace_id,operation_id,type,company,subject,actor,application,data,created_at) VALUES(?,'default','op','client.updated',?,'client','admin','web','{}',?)").run(id,company,new Date().toISOString());
 const created=await createWebhook(env,principal,{url:'https://example.com/hook',...(companies?{company:companies[0]}:{})},'create');
 return {...f,env,principal,credential,event,id:created.data.id,sub:()=>f.sql.prepare('SELECT * FROM webhook_subscriptions').get(),delivery:()=>f.sql.prepare('SELECT * FROM webhook_deliveries').get()};
}
test('pause/resume retains cursor, validates configuration, and preserves HMAC secret',async()=>{
 const f=await fixture();try{
  f.event('first');await dispatchWebhooks(f.env,async()=>new Response('',{status:200}));
  const before=f.sub();await updateWebhook(f.env,f.principal,f.id,{active:false},'pause');
  f.event('second');await dispatchWebhooks(f.env,async()=>{throw Error('paused must not send');});assert.equal(f.sub().cursor,before.cursor);
  await updateWebhook(f.env,f.principal,f.id,{url:'https://example.org/new',active:true},'resume');
  let sent=0;await dispatchWebhooks(f.env,async(url,init)=>{sent++;assert.equal(url,'https://example.org/new');assert.equal(init.redirect,'manual');assert.equal(init.headers['x-g4-event-id'],'second');return new Response('',{status:200});});assert.equal(sent,1);assert.equal(f.sub().secret,before.secret);
  await assert.rejects(updateWebhook(f.env,f.principal,f.id,{url:'https://127.0.0.1'},'bad'),{code:'invalid_webhook_url'});
  await assert.rejects(updateWebhook(f.env,f.principal,f.id,{cursor:0},'bad-field'),{code:'invalid_input'});
  const listing=await listWebhooks(f.env,f.principal);assert.equal(listing.data[0].active,true);assert.equal(JSON.stringify(listing).includes(before.secret),false);
 }finally{f.sql.close();}
});
test('manual replay grants a new retry budget, retains attempt history, and never rewinds cursor',async()=>{
 const f=await fixture();try{
  f.event('event');for(let n=0;n<8;n++){f.sql.exec("UPDATE webhook_deliveries SET next_at='2000-01-01'");await dispatchWebhooks(f.env,async()=>new Response('',{status:503}));}
  assert.equal(f.delivery().status,'failed');const cursor=f.sub().cursor;
  await replayWebhookDelivery(f.env,f.principal,f.id,'event','replay');
  await dispatchWebhooks(f.env,async()=>new Response('',{status:503}));assert.equal(f.delivery().status,'retry');assert.equal(f.delivery().attempts,9);
  await replayWebhookDelivery(f.env,f.principal,f.id,'event','replay');assert.equal(f.delivery().status,'retry','same intent replay must not requeue');
  await assert.rejects(replayWebhookDelivery(f.env,f.principal,f.id,'event','new-intent'),{code:'delivery_not_replayable'});
  f.sql.exec("UPDATE webhook_deliveries SET next_at='2000-01-01'");await dispatchWebhooks(f.env,async()=>new Response('',{status:200}));
  const listing=await listWebhookDeliveries(f.env,f.principal,f.id);assert.equal(listing.data[0].history.length,10);assert.equal(listing.data[0].attempts,10);assert.equal(f.sub().cursor,cursor);
  assert.equal(listing.data[0].body,undefined);assert.equal(listing.data[0].history[0].status_code,200);
  await assert.rejects(listWebhookDeliveries(f.env,f.principal,f.id,{limit:1.5}),{code:'invalid_pagination'});
 }finally{f.sql.close();}
});
test('active leases and concurrent revisions prevent configuration or manual replay races',async()=>{
 const f=await fixture();try{
  f.event('event');let release;const wait=new Promise(r=>{release=r;});let entered;const started=new Promise(r=>{entered=r;});
  const dispatch=dispatchWebhooks(f.env,async()=>{entered();await wait;return new Response('',{status:200});});await started;
  await assert.rejects(updateWebhook(f.env,f.principal,f.id,{active:false},'pause'),{code:'webhook_busy'});release();await dispatch;
  assert.equal(f.sub().active,1);await updateWebhook(f.env,f.principal,f.id,{active:false},'pause');assert.equal(f.sub().active,0);
  await assert.rejects(replayWebhookDelivery(f.env,f.principal,f.id,'event','replay'),{code:'delivery_not_replayable'});
 }finally{f.sql.close();}
});
test('owner, current allowlist and revocation protect listings, edits and receipt replay',async()=>{
 const f=await fixture(['alpha']);try{
  await assert.rejects(updateWebhook(f.env,f.principal,f.id,{company:'beta'},'foreign'),{code:'client_not_allowed'});
  const other={...f.principal,id:'other'};await assert.rejects(listWebhookDeliveries(f.env,other,f.id),{code:'webhook_not_found'});
  f.event('alpha','alpha');f.event('beta','beta');await dispatchWebhooks(f.env,async()=>new Response('',{status:200}));
  assert.deepEqual((await listWebhookDeliveries(f.env,f.principal,f.id)).data.map(d=>d.event_id),['alpha']);
  await updateWebhook(f.env,f.principal,f.id,{active:false},'pause');
  await revokeIntegrationCredential(f.db,'default','admin@example.test',f.credential.id);
  await assert.rejects(updateWebhook(f.env,f.principal,f.id,{active:false},'pause'));
  await assert.rejects(listWebhookDeliveries(f.env,f.principal,f.id));
  await assert.rejects(replayWebhookDelivery(f.env,f.principal,f.id,'alpha','replay'));
 }finally{f.sql.close();}
});
test('revision change during commit rolls back receipt and newly filtered backlog cannot starve valid deliveries',async()=>{
 const f=await fixture();try{
  const batch=f.db.batch;let inject=true;
  f.db.batch=async statements=>{if(inject){inject=false;f.sql.prepare('UPDATE webhook_subscriptions SET revision=revision+1 WHERE id=?').run(f.id);}return batch(statements);};
  await assert.rejects(updateWebhook(f.env,f.principal,f.id,{active:false},'race'),{code:'webhook_busy'});
  assert.equal(f.sub().active,1);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM operation_receipts WHERE idempotency_key='race'").get().n,0);f.db.batch=batch;
  for(let i=0;i<25;i++)f.event(`beta-${i}`,'beta');await dispatchWebhooks(f.env,async()=>new Response('',{status:503}));
  await updateWebhook(f.env,f.principal,f.id,{company:'alpha'},'filter');f.event('alpha','alpha');
  f.sql.exec("UPDATE webhook_deliveries SET next_at='2000-01-01'");const sent=[];
  await dispatchWebhooks(f.env,async(_url,init)=>{sent.push(init.headers['x-g4-event-id']);return new Response('',{status:200});});assert.deepEqual(sent,['alpha']);
  await assert.rejects(replayWebhookDelivery(f.env,f.principal,f.id,'beta-0','wrong-filter'),{code:'delivery_not_found'});
 }finally{f.sql.close();}
});

test('deactivation preserves write-only authorization while edits and history still require read scope',async()=>{
 const f=await fixture();try{
  f.sql.prepare('UPDATE integration_credentials SET scopes=? WHERE id=?').run(JSON.stringify(['events:write']),f.credential.id);
  await assert.rejects(updateWebhook(f.env,f.principal,f.id,{active:false},'edit'),{code:'insufficient_scope'});
  await assert.rejects(listWebhookDeliveries(f.env,f.principal,f.id),{code:'insufficient_scope'});
  await assert.rejects(replayWebhookDelivery(f.env,f.principal,f.id,'event','replay'),{code:'insufficient_scope'});
  const result=await deactivateWebhook(f.env,f.principal,f.id,'delete');assert.equal(f.sub().active,0);
  assert.deepEqual(await deactivateWebhook(f.env,f.principal,f.id,'delete'),result);
  f.sql.prepare('UPDATE integration_credentials SET scopes=? WHERE id=?').run(JSON.stringify(['events:read']),f.credential.id);
  await assert.rejects(deactivateWebhook(f.env,f.principal,f.id,'delete'),{code:'insufficient_scope'});
 }finally{f.sql.close();}
});

test('changing company filter retains authorized historical attempts and respects a narrowed credential',async()=>{
 const f=await fixture();try{
  f.event('alpha-history','alpha');await dispatchWebhooks(f.env,async()=>new Response('',{status:200}));
  await updateWebhook(f.env,f.principal,f.id,{company:'beta'},'filter-beta');
  f.event('beta-history','beta');await dispatchWebhooks(f.env,async()=>new Response('',{status:200}));
  let listing=await listWebhookDeliveries(f.env,f.principal,f.id);
  assert.deepEqual(listing.data.map(d=>d.event_id),['alpha-history','beta-history']);
  assert.equal(listing.data[0].history.length,1);
  f.sql.prepare('UPDATE integration_credentials SET companies=? WHERE id=?').run(JSON.stringify(['beta']),f.credential.id);
  listing=await listWebhookDeliveries(f.env,f.principal,f.id);
  assert.deepEqual(listing.data.map(d=>d.event_id),['beta-history']);
 }finally{f.sql.close();}
});

test('secret rotation requires pause, encrypts receipts, replays safely and signs resumed deliveries',async()=>{
 const f=await fixture();try{
 await assert.rejects(rotateWebhookSecret(f.env,f.principal,f.id,{},'rotate'),{code:'webhook_must_be_paused'});
 await updateWebhook(f.env,f.principal,f.id,{active:false},'pause');const before=f.sub();
 const result=await rotateWebhookSecret(f.env,f.principal,f.id,{},'rotate');assert.notEqual(f.sub().secret,before.secret);assert.equal(f.sub().cursor,before.cursor);assert.equal(f.sub().active,0);
 assert.deepEqual(await rotateWebhookSecret(f.env,f.principal,f.id,{},'rotate'),result);
 assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM operation_receipts').all()).includes(result.data.secret),false);
 await updateWebhook(f.env,f.principal,f.id,{active:true},'resume');f.event('rotated');
 await dispatchWebhooks(f.env,async(url,init)=>{assert.equal(init.headers['x-g4-signature'],'v1='+await signWebhook(result.data.secret,init.headers['x-g4-timestamp'],init.body));return new Response('',{status:200});});assert.equal(f.delivery().status,'complete');
 await updateWebhook(f.env,f.principal,f.id,{active:false},'pause-again');await rotateWebhookSecret(f.env,f.principal,f.id,{},'rotate-again');
 await assert.rejects(rotateWebhookSecret(f.env,f.principal,f.id,{},'rotate'),{code:'rotation_superseded'});
 await revokeIntegrationCredential(f.db,'default','admin@example.test',f.credential.id);
 await assert.rejects(rotateWebhookSecret(f.env,f.principal,f.id,{},'rotate-again'),{code:'invalid_token'});
 }finally{f.sql.close();}
});
