import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {executeWorkspaceSettings} from '../src/server/operations/workspace-settings.ts';
import {apiResponse} from '../src/server/operations/http.ts';

test('workspace settings preserve roster, reject stale/invalid writes and reauthorize replay',async()=>{
 const f=sqliteD1(),state={workspaceName:'Antes',alertRules:{},extraMembers:[{id:'admin',name:'Admin',email:'admin@example.test',access:'admin',role:'Head de Operações',org:'praxis'},{id:'reader',email:'reader@example.test',access:'leitor',role:'Suporte',org:'praxis'}],currentUserId:'admin'};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify(state));
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,?)").run(JSON.stringify({allocationsMigrated:true,allocations:[{id:'alloc-1',company:'cc',memberId:'admin',role:'custom-arquiteto',percent:10}]}));
 const env={DB:f.db,AUTH_MODE:'dev',DEV_USER_EMAIL:'admin@example.test'},actor={id:'member:admin',kind:'session',email:'admin@example.test',memberId:'admin',access:'admin',application:'web',scopes:null,companies:null,guards:[]};
 const read=()=>JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.workspace.v3'").get().body);
 try{
 const input={workspaceName:'Depois',alertRules:{silentClientDays:21},memberRoles:['Head de Operações'],allocationRoles:[{id:'custom-arquiteto',label:'Arquiteto'}]};
 const saved=await executeWorkspaceSettings(env,actor,input,'save');
 assert.deepEqual(read().extraMembers,state.extraMembers);assert.equal(read().currentUserId,'admin');
 assert.deepEqual(read().memberRoles,['Head de Operações']);assert.deepEqual(read().allocationRoles,[{id:'custom-arquiteto',label:'Arquiteto'}]);
 assert.deepEqual(await executeWorkspaceSettings(env,actor,input,'save'),saved);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_events').get().n,1);
 await assert.rejects(executeWorkspaceSettings(env,actor,{workspaceName:'Stale'},'stale',{'ontology.workspace.v3':1}),{code:'version_conflict'});
 await assert.rejects(executeWorkspaceSettings(env,actor,{memberRoles:[]},'remove-used-cargo'),/cargo que está em uso/);
 await assert.rejects(executeWorkspaceSettings(env,actor,{allocationRoles:[]},'remove-used-role'),/papel que está em uso/);
 await assert.rejects(executeWorkspaceSettings(env,actor,{allocationRoles:input.allocationRoles},'stale-clients',{'ontology.clients.v3':0}),{code:'version_conflict'});
 for(const bad of [{currentUserId:'reader'},{alertRules:{silentClientDays:-1}},{alertRules:{silentClientDays:null}},{alertRules:{unknown:2}},{workspaceName:' '},{memberRoles:['Duplicado','duplicado']},{memberRoles:['AI Master']},{allocationRoles:[{id:'responsavel',label:'Outro'}]},{allocationRoles:[{id:'custom-valido',label:''}]},{allocationRoles:[{id:'custom-a',label:'Arquiteto'},{id:'custom-b',label:'arquiteto'}]},{allocationRoles:[{id:'custom-responsavel',label:'Responsável'}]}])await assert.rejects(executeWorkspaceSettings(env,actor,bad,crypto.randomUUID()));
 const req=new Request('http://localhost/api/v1/workspace/settings',{method:'PATCH',headers:{origin:'http://localhost','content-type':'application/json','idempotency-key':'reset'},body:JSON.stringify({alertRules:{}})});
 const response=await apiResponse(req,env,['workspace','settings']);assert.equal(response.status,200,await response.clone().text());assert.deepEqual(read().alertRules,{});
 const next=read();next.extraMembers[0].access='leitor';f.sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.workspace.v3'").run(JSON.stringify(next));
 await assert.rejects(executeWorkspaceSettings(env,actor,input,'save'),{code:'permission_denied'});
 }finally{f.sql.close();}
});
