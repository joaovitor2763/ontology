import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { createWebhook, dispatchWebhooks, signWebhook, webhookUrl } from '../src/server/operations/webhooks.ts';
import { listEvents } from '../src/server/operations/events.ts';
import { issueIntegrationCredential } from '../src/server/operations/credentials.ts';
import { resolveOperationPrincipal } from '../src/server/operations/principal.ts';
async function fixture(companies) {
 const f=sqliteD1(),env={DB:f.db,INTEGRATION_SECRET_KEY:btoa('x'.repeat(32))};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify({extraMembers:[{id:'admin',email:'admin@example.com',access:'admin'}]}));
 const token=await issueIntegrationCredential(f.db,'default','admin@example.com',{name:'Outbound',ownerEmail:'admin@example.com',scopes:['events:read','events:write'],companies,expiresAt:new Date(Date.now()+3600000).toISOString()});
 const principal=await resolveOperationPrincipal(new Request('https://delivery.test',{headers:{authorization:`Bearer ${token.token}`}}),env);
 const event=(id,company)=>f.sql.prepare("INSERT INTO operation_events(id,workspace_id,operation_id,type,company,subject,actor,application,data,created_at) VALUES(?,'default','op','client.updated',?,'client','admin','web','{}',?)").run(id,company,new Date().toISOString());
 return {...f,env,principal,event};
}
test('feed scans skipped events with a monotonic cursor and respects client grants',async()=>{
 const f=await fixture(['alpha']);f.event('one','beta');f.event('two','alpha');f.event('three','beta');
 const feed=await listEvents(f.db,'default',f.principal,{limit:1});assert.deepEqual(feed.data.map(e=>e.id),['two']);assert.equal(feed.nextCursor,'2');
 const rest=await listEvents(f.db,'default',f.principal,{cursor:feed.nextCursor});assert.deepEqual(rest.data,[]);assert.equal(rest.nextCursor,'3');
 await assert.rejects(listEvents(f.db,'default',f.principal,{company:'beta'}),{code:'client_not_allowed'});f.sql.close();
});
test('webhooks encrypt signing secrets, sign exact payload, retry with stable event ID, and never follow redirects',async()=>{
 const f=await fixture();
 const created=await createWebhook(f.env,f.principal,{url:'https://example.com/hook',types:['client.updated']},'create');
 assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM webhook_subscriptions').get()).includes(created.data.secret),false);
 assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM operation_receipts').get()).includes(created.data.secret),false);
 assert.equal((await createWebhook(f.env,f.principal,{url:'https://example.com/hook',types:['client.updated']},'create')).data.secret,created.data.secret);
 f.event('event-one','alpha');let sent=0;
 await dispatchWebhooks(f.env,async(url,init)=>{sent++;assert.equal(init.redirect,'manual');assert.equal(init.headers['x-g4-signature'],`v1=${await signWebhook(created.data.secret,init.headers['x-g4-timestamp'],init.body)}`);return new Response('',{status:503});});
 assert.equal(sent,1);assert.equal(f.sql.prepare('SELECT status FROM webhook_deliveries').get().status,'retry');
 f.sql.exec("UPDATE webhook_deliveries SET next_at='2000-01-01'");
 await dispatchWebhooks(f.env,async(url,init)=>{sent++;assert.equal(init.headers['x-g4-event-id'],'event-one');return new Response('',{status:200});});
 assert.equal(sent,2);await dispatchWebhooks(f.env,async()=>{throw new Error('must not send again');});assert.equal(f.sql.prepare('SELECT attempts FROM webhook_deliveries').get().attempts,2);
 f.sql.close();
});
test('unsafe webhook destinations are refused before fetch',()=>{
 for(const url of ['http://example.com','https://127.0.0.1','https://2130706433','https://[::1]','https://localhost','https://metadata.internal','https://user:pass@example.com']) assert.throws(()=>webhookUrl(url));
 assert.equal(webhookUrl('https://example.com/webhooks'),'https://example.com/webhooks');
});
test('empty client allowlist cannot skip feed authorization or observe its global cursor',async()=>{
 const f=await fixture([]);f.event('hidden','alpha');
 await assert.rejects(listEvents(f.db,'default',f.principal),{code:'client_not_allowed'});
 f.sql.prepare('UPDATE integration_credentials SET scopes=?').run(JSON.stringify(['clients:read']));
 await assert.rejects(listEvents(f.db,'default',f.principal),{code:'insufficient_scope'});f.sql.close();
});
test('feed refuses fractional and nonfinite limits instead of returning unusable cursors',async()=>{
 const f=await fixture();
 for(const limit of [1.5,NaN,Infinity,0,101]) await assert.rejects(listEvents(f.db,'default',f.principal,{limit}),{code:'invalid_limit'});
 f.sql.close();
});
