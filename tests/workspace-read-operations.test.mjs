import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {apiResponse} from '../src/server/operations/http.ts';
import {issueIntegrationCredential} from '../src/server/operations/credentials.ts';
import {alerts} from '../src/modules/workspace/infrastructure/seed.ts';
import {defaultAlertRules} from '../src/modules/workspace/domain/models.ts';

test('workspace reads expose effective settings and only unseen client alerts with scoped credentials',async()=>{
 const f=sqliteD1(),alert=alerts[0];
 const state={workspaceName:'Fixture',alertRules:{silentClientDays:21},hidden:[alert.id],currentUserId:'private-session',extraMembers:[{id:'admin',email:'admin@example.test',access:'admin'}]};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify(state));
 const env={DB:f.db};
 const token=async(scopes,companies)=> (await issueIntegrationCredential(f.db,'default','admin@example.test',{name:'Read fixture',ownerEmail:'admin@example.test',scopes,companies,expiresAt:new Date(Date.now()+600000).toISOString()})).token;
 const get=(path,bearer)=>apiResponse(new Request('http://localhost/api/v1/'+path,{headers:{authorization:'Bearer '+bearer}}),env,path.split('?')[0].split('/'));
 try{
 const read=await token(['workspace:read']);
 const settings=await get('workspace/settings',read);assert.equal(settings.status,200);
 const body=await settings.json();assert.deepEqual(body.data,{workspaceName:'Fixture',alertRules:{...defaultAlertRules,silentClientDays:21},memberRoles:[],allocationRoles:[]});assert.equal(body.versions['ontology.workspace.v3'],1);assert.equal(JSON.stringify(body).includes('private-session'),false);assert.equal(JSON.stringify(body).includes('admin@example.test'),false);
 const list=await get('alerts?company='+alert.company,read);assert.equal(list.status,200);const items=await list.json();assert.ok(items.data.every(a=>a.company===alert.company&&a.id!==alert.id));
 assert.equal((await get('alerts',read)).status,422);
 assert.equal((await get('alerts?company='+alert.company+'&limit=0',read)).status,422);
 const wrong=await token(['clients:read']);assert.equal((await get('workspace/settings',wrong)).status,403);assert.equal((await get('alerts?company='+alert.company,wrong)).status,403);
 const restricted=await token(['workspace:read'],['different-client']);assert.equal((await get('alerts?company='+alert.company,restricted)).status,403);assert.equal((await get('workspace/settings',restricted)).status,403);
 state.extraMembers[0].access='leitor';f.sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.workspace.v3'").run(JSON.stringify(state));
 assert.equal((await get('workspace/settings',read)).status,403);
 }finally{f.sql.close();}
});
