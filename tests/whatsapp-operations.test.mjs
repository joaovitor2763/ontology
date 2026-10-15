import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {apiResponse} from '../src/server/operations/http.ts';
import {issueIntegrationCredential} from '../src/server/operations/credentials.ts';

test('remote WhatsApp reads use configured client group, cached pages and current credential scope',async t=>{
 const f=sqliteD1(),company='santa-clara',state={configs:{[company]:{whatsapp:{groupId:'configured@g.us',groupName:'Grupo configurado'}}}};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify({extraMembers:[{id:'admin',email:'admin@example.test',access:'admin'}]}));
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,?)").run(JSON.stringify(state));
 const env={DB:f.db,WHATSAPP_ENABLED:'true',SUPABASE_URL:'https://source.example.test',SUPABASE_SERVICE_KEY:'fixture-secret'};
 const issue=async scopes=> (await issueIntegrationCredential(f.db,'default','admin@example.test',{name:'Fixture',ownerEmail:'admin@example.test',scopes,companies:[company],expiresAt:new Date(Date.now()+600000).toISOString()})).token;
 const token=await issue(['engagement:read']);
 const get=(query,bearer=token)=>apiResponse(new Request('https://delivery.test/api/v1/whatsapp/messages?'+query,{headers:{authorization:'Bearer '+bearer}}),env,['whatsapp','messages']);
 let calls=0,changeGroup=false;const original=globalThis.fetch;
 globalThis.fetch=async url=>{calls++;assert.equal(new URL(url).searchParams.get('group_id'),'eq.configured@g.us');if(changeGroup){state.configs[company].whatsapp.groupId='changed@g.us';f.sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.clients.v3'").run(JSON.stringify(state));}return Response.json([{id:'message',created_at:'2026-09-17T10:00:00Z',sender_name:'Fixture',body:'Mensagem de teste',group_id:'configured@g.us'}]);};
 t.after(()=>{globalThis.fetch=original;f.sql.close();});
 const first=await get('company='+company+'&group=arbitrary');assert.equal(first.status,200,await first.clone().text());const body=await first.json();assert.equal(body.data.messages.length,1);assert.equal(body.data.company,company);assert.equal(JSON.stringify(body).includes('fixture-secret'),false);
 assert.equal((await get('company='+company)).status,200);assert.equal(calls,1);
 assert.equal((await get('company=another-client')).status,403);assert.equal(calls,1);
 assert.equal((await get('company='+company,await issue(['clients:read']))).status,403);
 assert.equal((await get('company='+company+'&before=bad')).status,422);
 assert.equal((await get('company='+company+'&refresh=maybe')).status,422);
 changeGroup=true;assert.equal((await get('company='+company+'&refresh=true')).status,409);
});
