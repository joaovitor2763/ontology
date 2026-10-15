import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {apiResponse} from '../src/server/operations/http.ts';
import {resolveOperationPrincipal,authorizeOperation} from '../src/server/operations/principal.ts';
import {can,matrixCell} from '../src/modules/workspace/domain/permissions.ts';
function fixture(){
 const f=sqliteD1();
 const roster={extraMembers:['admin','gestor','ai_master','leitor'].map(access=>({id:access,name:access,email:`${access}@example.test`,access})),deactivatedIds:[]};
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify(roster));
 f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,?)").run(JSON.stringify({allocationsMigrated:true,allocations:[{company:'alpha',memberId:'ai_master'}]}));
 async function request(user,path,method='GET',body,headers={}){const r=await apiResponse(new Request(`https://app.example/api/v1/${path}`,{method,headers:{origin:'https://app.example',...headers},...(body?{body:JSON.stringify(body)}:{})}),{DB:f.db,AUTH_MODE:'dev',DEV_USER_EMAIL:`${user}@example.test`},path.split('/'));return {status:r.status,body:await r.json()};}
 const principal=token=>resolveOperationPrincipal(new Request('https://app.example/api/v1/me',{headers:{authorization:`Bearer ${token}`}}),{DB:f.db});
 return {...f,roster,request,principal};
}
test('each active level manages only own keys; secret is shown once, owner and grants cannot be supplied',async()=>{
 const f=fixture();try{
 for(const level of ['admin','gestor','ai_master','leitor']){
  assert.equal(can({access:level,memberId:level},'api-keys.gerenciar'),true);assert.equal(matrixCell(level,'api-keys.gerenciar'),'tudo');
  const created=await f.request(level,'api-keys','POST',{name:'CRM',expiresInDays:90});assert.equal(created.status,201);const {token,id}=created.body.data;
  const list=await f.request(level,'api-keys');assert.equal(list.body.data.length,1);assert.equal(list.body.data[0].id,id);assert.equal(JSON.stringify(list).includes(token),false);assert.equal(Object.hasOwn(list.body.data[0],'token_hash'),false);
  const other=level==='admin'?'gestor':'admin';assert.equal((await f.request(other,`api-keys/${id}`,'DELETE')).status,404);
  for(const field of ['ownerEmail','scopes','companies'])assert.equal((await f.request(level,'api-keys','POST',{name:'Bad',expiresInDays:90,[field]:'admin@example.test'})).status,422);
  assert.equal((await f.request(level,'api-keys','POST',{name:'Bad',expiresInDays:0})).status,422);
  assert.equal((await f.request(level,'api-keys','GET',null,{authorization:`Bearer ${token}`})).status,403);
  assert.equal((await f.request(level,'api-keys','POST',{name:'CSRF',expiresInDays:90},{origin:'https://evil.example'})).status,403);
  assert.equal((await f.request(level,`api-keys/${id}`,'DELETE')).status,200);await assert.rejects(f.principal(token),{code:'invalid_token'});
 }
 }finally{f.sql.close();}
});
test('personal keys follow allocation, downgrade, deactivation and expiration without broadening access',async()=>{
 const f=fixture();try{
 const {body}=await f.request('ai_master','api-keys','POST',{name:'Tasks',expiresInDays:30}),p=await f.principal(body.data.token);
 await authorizeOperation(f.db,'default',p,{action:'entregas.editar',scope:'delivery:write',company:'alpha'});
 await assert.rejects(authorizeOperation(f.db,'default',p,{action:'entregas.editar',scope:'delivery:write',company:'beta'}),{code:'permission_denied'});
 f.roster.extraMembers.find(m=>m.id==='ai_master').access='leitor';f.sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.workspace.v3'").run(JSON.stringify(f.roster));
 await assert.rejects(authorizeOperation(f.db,'default',p,{action:'entregas.editar',scope:'delivery:write',company:'alpha'}),{code:'permission_denied'});
 f.roster.deactivatedIds=['ai_master'];f.sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.workspace.v3'").run(JSON.stringify(f.roster));
 await assert.rejects(f.principal(body.data.token),{code:'inactive_member'});assert.equal((await f.request('ai_master','api-keys')).status,403);
 const other=await f.request('gestor','api-keys','POST',{name:'Expired',expiresInDays:30});f.sql.prepare("UPDATE integration_credentials SET expires_at='2000-01-01' WHERE id=?").run(other.body.data.id);await assert.rejects(f.principal(other.body.data.token),{code:'invalid_token'});
 }finally{f.sql.close();}
});
test('docs are machine readable, linked to OpenAPI and available with personal key; invalid routes stay closed',async()=>{
 const f=fixture();try{
 const created=await f.request('leitor','api-keys','POST',{name:'Read docs',expiresInDays:90});
 const headers={authorization:`Bearer ${created.body.data.token}`};
 const docs=await f.request('leitor','docs','GET',null,headers);assert.equal(docs.status,200);assert.equal(docs.body.data.baseUrl,'https://app.example/api/v1');assert.ok(docs.body.data.instructions.includes('Idempotency-Key'));assert.ok(docs.body.data.saleExample.enrollments.length);assert.equal((await f.request('leitor','doc','GET',null,headers)).status,200);
 const spec=await f.request('leitor','openapi.json');assert.ok(spec.body.paths['/docs'].get);assert.ok(spec.body.paths['/api-keys'].post);
 for(const path of ['docs/extra','api-keys/other'])assert.equal((await f.request('leitor',path)).status,404);
 assert.equal((await f.request('leitor','docs','GET',null,{authorization:'Bearer invalid'})).status,401);
 }finally{f.sql.close();}
});
