import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {apiResponse} from '../src/server/operations/http.ts';

test('JSON inválido recebe 400 sem registrar falha interna',async()=>{
  const fixture=sqliteD1();
  const original=console.error;
  const logged=[];
  console.error=(entry)=>logged.push(entry);
  try {
    fixture.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)")
      .run(JSON.stringify({extraMembers:[{id:'admin',name:'Admin',email:'admin@example.test',access:'admin',active:true}]}));
    const request=new Request('https://delivery.test/api/v1/commands',{
      method:'POST',headers:{origin:'https://delivery.test','idempotency-key':'bad-json'},body:'{',
    });
    const result=await apiResponse(request,{DB:fixture.db,AUTH_MODE:'dev',DEV_USER_EMAIL:'admin@example.test'},['commands']);
    assert.equal(result.status,400);
    assert.equal((await result.json()).error.code,'invalid_json');
    assert.equal(logged.length,0);
  } finally { console.error=original;fixture.sql.close(); }
});

test('falha inesperada expõe só código de suporte e registra causa sem credenciais',async()=>{
  const original=console.error;
  const logged=[];
  console.error=(entry)=>logged.push(entry);
  try {
    const db={prepare(){throw new SyntaxError('D1_ERROR: broken row for admin@example.test g4d_secret');}};
    const result=await apiResponse(new Request('https://delivery.test/api/v1/me'),{DB:db,AUTH_MODE:'dev',DEV_USER_EMAIL:'admin@example.test'},['me']);
    assert.equal(result.status,500);
    const body=await result.json();
    assert.equal(body.error.code,'internal_error');
    assert.match(body.error.details.requestId,/^[0-9a-f-]{36}$/);
    assert.equal(result.headers.get('x-request-id'),body.error.details.requestId);
    assert.equal(logged[0].requestId,body.error.details.requestId);
    assert.equal(logged[0].error.name,'SyntaxError');
    assert.match(logged[0].error.message,/D1_ERROR/);
    assert.doesNotMatch(JSON.stringify(logged),/admin@example\.test|g4d_secret/);
    assert.doesNotMatch(JSON.stringify(body),/D1_ERROR|admin@example\.test|g4d_secret/);
  } finally { console.error=original; }
});
