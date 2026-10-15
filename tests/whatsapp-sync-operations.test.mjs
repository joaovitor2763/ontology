import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {apiResponse} from '../src/server/operations/http.ts';
import {issueIntegrationCredential} from '../src/server/operations/credentials.ts';

test('WhatsApp import requests share a durable job and atomically record authorized receipts',async t=>{
 const f=sqliteD1();t.after(()=>f.sql.close());const company='santa-clara';
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify({extraMembers:[{id:'admin',email:'admin@example.test',access:'admin'}]}));
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,?)").run(JSON.stringify({configs:{[company]:{whatsapp:{groupId:'configured'}}}}));
 const env={DB:f.db,WHATSAPP_ENABLED:'true',SUPABASE_URL:'https://source.example.test',SUPABASE_SERVICE_KEY:'fixture'};
 const issue=async scopes=>(await issueIntegrationCredential(f.db,'default','admin@example.test',{name:'Fixture',ownerEmail:'admin@example.test',scopes,companies:[company],expiresAt:new Date(Date.now()+600000).toISOString()})).token;
 const token=await issue(['engagement:write']);
 const sync=(key,days=30,bearer=token,client=company)=>apiResponse(new Request('https://delivery.test/api/v1/whatsapp/sync',{method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json','idempotency-key':key},body:JSON.stringify({company:client,days})}),env,['whatsapp','sync']);
 assert.equal((await sync('read',30,await issue(['engagement:read']))).status,403);
 assert.equal((await sync('other',30,token,'other')).status,403);assert.equal((await sync('invalid',7)).status,422);
 const first=await sync('once');assert.equal(first.status,202,await first.clone().text());const data=await first.json();
 assert.deepEqual(await (await sync('once')).json(),data);assert.equal((await sync('once',90)).status,409);
 assert.deepEqual(await (await sync('another')).json(),data);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM whatsapp_jobs').get().n,1);assert.equal(f.sql.prepare("SELECT count(*) AS n FROM operation_events WHERE type='whatsapp.sync'").get().n,1);
 const expanded=await sync('expanded',365);assert.equal(expanded.status,202);assert.notEqual((await expanded.json()).data.id,data.data.id);
 assert.equal(f.sql.prepare("SELECT status FROM whatsapp_jobs WHERE id=?").get(data.data.id).status,'cancelled');
 const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{f.sql.prepare("UPDATE state_documents SET version=version+1 WHERE key='ontology.clients.v3'").run();return batch(statements);};
 assert.equal((await sync('changed',90)).status,409);
 assert.equal(f.sql.prepare("SELECT count(*) AS n FROM operation_receipts WHERE idempotency_key='changed'").get().n,0);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM whatsapp_jobs').get().n,2);
});
