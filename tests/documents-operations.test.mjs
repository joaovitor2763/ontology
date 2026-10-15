import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { executeDocumentCommand,readDocuments } from '../src/server/operations/documents.ts';
import { documents as seeds } from '../src/modules/documents/infrastructure/seed.ts';
const KEY='ontology.documents.v3';
function fixture(){const f=sqliteD1(),put=(key,value)=>f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?) ON CONFLICT(workspace_id,key) DO UPDATE SET version=version+1,body=excluded.body").run(key,JSON.stringify(value));const person={id:'admin',name:'Pessoa',email:'admin@example.test',access:'admin'};put('ontology.workspace.v3',{extraMembers:[person,{id:'manager',name:'Gestor',email:'manager@example.test',access:'gestor'}]});put('ontology.clients.v3',{extraClients:[{slug:'alpha',name:'Alpha'},{slug:'beta',name:'Beta'}],allocationsMigrated:true,allocations:[]});put('ontology.relationship.v1',{spaces:[{id:'thread',company:'alpha',kind:'notes',messages:[]}],notes:{}});put('ontology.delivery.v2',{extraTasks:[{id:'task',company:'alpha',title:'Tarefa',status:'fila',dueAt:'2026-10-01'}]});const principal={id:'member:admin',memberId:'admin',email:person.email,kind:'session',application:'web',scopes:null,companies:null};const upload=(id='up-first',company='alpha',owner=principal.id)=>f.sql.prepare("INSERT INTO files(id,workspace_id,r2_key,name,mime,size,created_by,company,status) VALUES(?,'default',?,'Arquivo.txt','text/plain',4,?,?,'ready')").run(id,`bytes/${id}`,owner,company);upload();return{...f,put,person,principal,upload,env:{DB:f.db},run:(command,value,key=crypto.randomUUID(),actor=principal,versions={})=>executeDocumentCommand({DB:f.db},actor,command,value,key,versions),read:()=>{const row=f.sql.prepare('SELECT body FROM state_documents WHERE key=?').get(KEY);return row?JSON.parse(row.body):undefined;},count:table=>f.sql.prepare(`SELECT count(*) n FROM ${table}`).get().n};}
const register={company:'alpha',fileId:'up-first',kind:'comunicacao',visibility:'cliente',note:'Contexto',relatedThreadId:'thread',relatedTaskId:'task'};
test('registration uses file metadata, review appends history, version inherits links and starts pending',async t=>{t.mock.method(globalThis,'fetch',()=>{throw Error('No external');});const f=fixture();try{const made=await f.run('documents.register',register,'register');assert.equal(made.data.document.name,'Arquivo.txt');assert.equal(made.data.document.uploadedBy,'admin');assert.equal(made.data.document.version,1);assert.deepEqual(await f.run('documents.register',register,'register'),JSON.parse(JSON.stringify(made)));await f.run('documents.review',{documentId:'up-first',status:'aprovado',notes:'Bom'},'review');f.upload('up-second');const next=await f.run('documents.version',{previousId:'up-first',fileId:'up-second'});assert.equal(next.data.document.version,2);assert.equal(next.data.document.supersedesId,'up-first');assert.equal(next.data.document.relatedTaskId,'task');assert.equal(next.data.document.relatedThreadId,'thread');assert.equal(next.data.document.visibility,'cliente');assert.equal(next.data.document.kind,'comunicacao');assert.equal(next.data.document.note,'Contexto');assert.equal(next.data.document.reviewStatus,'pendente');assert.deepEqual(next.data.document.reviewHistory,[]);assert.equal(f.read().docEdits['up-first'].reviewHistory.length,1);f.upload('up-third');await assert.rejects(f.run('documents.version',{previousId:'up-first',fileId:'up-third'}),{code:'document_not_head'});assert.equal(f.read().extraDocs.length,2);}finally{f.sql.close();}});
test('metadata clears persist, removal preserves file/record and restoration includes seed records',async()=>{const f=fixture();try{await f.run('documents.register',register);await f.run('documents.update',{documentId:'up-first',patch:{note:'',visibility:'interna'}});assert.equal(f.read().docEdits['up-first'].note,'');await f.run('documents.remove',{documentId:'up-first'});assert.equal(f.read().extraDocs.length,1);assert.equal(f.count('files'),1);assert.equal((await readDocuments(f.env,f.principal,{company:'alpha'})).data.length,0);assert.equal((await readDocuments(f.env,f.principal,{company:'alpha',includeRemoved:true})).data[0].removed,true);await f.run('documents.restore',{documentId:'up-first'});assert.equal((await readDocuments(f.env,f.principal,{company:'alpha'})).data.length,1);await f.run('documents.remove',{documentId:seeds[0].id});await f.run('documents.restore',{documentId:seeds[0].id});assert.equal(f.read().extraDocs.length,1);}finally{f.sql.close();}});
test('document links can be changed or cleared only inside the same client',async()=>{const f=fixture();try{await f.run('documents.register',register);const linked=await f.run('documents.update',{documentId:'up-first',patch:{relatedThreadId:null,relatedTaskId:'task'}});assert.equal(linked.data.document.relatedThreadId,undefined);assert.equal(linked.data.document.relatedTaskId,'task');await assert.rejects(f.run('documents.update',{documentId:'up-first',patch:{relatedTaskId:'missing'}}),{code:'invalid_input'});const cleared=await f.run('documents.update',{documentId:'up-first',patch:{relatedTaskId:null}});assert.equal(cleared.data.document.relatedTaskId,undefined);}finally{f.sql.close();}});
test('review requires current admin; rejected adjustments and forged audit do not write',async()=>{const f=fixture();try{await f.run('documents.register',register);const manager={...f.principal,id:'member:manager',memberId:'manager',email:'manager@example.test'};await assert.rejects(f.run('documents.review',{documentId:'up-first',status:'aprovado'},'manager',manager),{code:'admin_required'});await assert.rejects(f.run('documents.review',{documentId:'up-first',status:'ajustes'}),{code:'invalid_input'});await assert.rejects(f.run('documents.update',{documentId:'up-first',patch:{uploadedBy:'forge'}}),{code:'invalid_input'});await f.run('documents.review',{documentId:'up-first',status:'ajustes',notes:'Corrigir'},'review');assert.equal(f.read().docEdits['up-first'].reviewHistory[0].by,'admin');f.put('ontology.workspace.v3',{extraMembers:[{...f.person,access:'gestor'}]});await assert.rejects(f.run('documents.review',{documentId:'up-first',status:'ajustes',notes:'Corrigir'},'review'),{code:'admin_required'});}finally{f.sql.close();}});
test('new files must be owned, ready, unreferenced and linked only inside company',async()=>{const f=fixture();try{await assert.rejects(f.run('documents.register',{...register,relatedThreadId:'missing'}),{code:'invalid_input'});await assert.rejects(f.run('documents.register',{...register,relatedTaskId:'missing'}),{code:'invalid_input'});await assert.rejects(f.run('documents.register',{...register,deliverableTemplateId:'missing'}),{code:'invalid_input'});f.upload('up-other','beta');await assert.rejects(f.run('documents.register',{...register,fileId:'up-other'}),{code:'file_unavailable'});f.upload('up-owner','alpha','member:manager');await assert.rejects(f.run('documents.register',{...register,fileId:'up-owner'}),{code:'file_unavailable'});await f.run('documents.register',register);await assert.rejects(f.run('documents.register',register),{code:'file_already_linked'});await assert.rejects(f.run('documents.unknown',{documentId:'up-first'}),{code:'invalid_input'});assert.equal(f.read().extraDocs.length,1);}finally{f.sql.close();}});
test('file and document revision races abort registration/version atomically',async()=>{for(const kind of ['file','document']){const f=fixture();try{if(kind==='document'){await f.run('documents.register',register);f.upload('up-second');}const before=f.read(),batch=f.db.batch;f.db.batch=async statements=>{if(kind==='file')f.sql.exec("UPDATE files SET status='deleting'");else f.put(KEY,before);return batch(statements);};const count=f.count('operation_receipts');await assert.rejects(f.run(kind==='file'?'documents.register':'documents.version',kind==='file'?register:{previousId:'up-first',fileId:'up-second'}),{code:'version_conflict'});assert.deepEqual(f.read(),before);assert.equal(f.count('operation_receipts'),count);}finally{f.sql.close();}}});

function activeFixture() {
  const f=fixture();
  for(const [company,snapshot] of [
    ['alpha',{extraTasks:[{id:'task',company:'alpha',title:'Tarefa',status:'fila',dueAt:'2026-10-01'}]}],
    ['beta',{extraTasks:[{id:'beta-task',company:'beta',title:'Outra',status:'fila',dueAt:'2026-10-01'}]}],
  ]) {
    const body=JSON.stringify(snapshot);
    f.sql.prepare(`INSERT INTO delivery_client_snapshots
      (workspace_id,generation,company,revision,body,body_sha256,incarnation)
      VALUES('default','docs-active',?,1,?,?,?)`).run(company,body,createHash('sha256').update(body).digest('hex'),`${company}-incarnation`);
  }
  f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
    (workspace_id,generation,mode,source_delivery_version,source_clients_version,
     compatibility_version,expected_clients,expected_owners,expected_orphans,
     expected_array_order,expected_map_order,updated_at)
    VALUES('default','docs-active','active',1,1,41,2,2,0,2,0,'2026-09-28')`).run();
  return f;
}

test('active document links validate only the client slice and keep replay atomic',async()=>{
  const f=activeFixture();
  try {
    const prepare=f.db.prepare.bind(f.db);
    f.db.prepare=sql=>{
      assert.doesNotMatch(sql,/SELECT company,body FROM delivery_client_snapshots/);
      return prepare(sql);
    };
    await assert.rejects(f.run('documents.register',{...register,relatedTaskId:'beta-task'}),{code:'invalid_input'});
    await assert.rejects(f.run('documents.register',register,'stale',f.principal,{'ontology.delivery.v2':40}),{code:'version_conflict'});
    const made=await f.run('documents.register',register,'active-register');
    assert.equal(made.data.document.relatedTaskId,'task');
    assert.deepEqual(await f.run('documents.register',register,'active-register'),JSON.parse(JSON.stringify(made)));
    assert.equal(f.count('operation_receipts'),1);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM delivery_client_guards').get().n,0);
    f.upload('up-second');
    const next=await f.run('documents.version',{previousId:'up-first',fileId:'up-second'});
    assert.equal(next.data.document.relatedTaskId,'task');
    await f.run('documents.update',{documentId:'up-second',patch:{relatedTaskId:null}});
    assert.equal(f.read().docEdits['up-second'].relatedTaskId,undefined);
  }finally{f.sql.close();}
});

test('active document linking refuses a concurrent task revision without partial write',async()=>{
  const f=activeFixture();
  try {
    const batch=f.db.batch.bind(f.db);
    f.db.batch=async statements=>{
      f.sql.prepare(`UPDATE delivery_client_snapshots SET revision=revision+1
        WHERE generation='docs-active' AND company='alpha'`).run();
      return batch(statements);
    };
    await assert.rejects(f.run('documents.register',register),{code:'version_conflict'});
    assert.equal(f.read(),undefined);
    assert.equal(f.count('operation_receipts'),0);
    assert.equal(f.count('operation_events'),0);
    assert.equal(f.count('delivery_client_guards'),0);
  }finally{f.sql.close();}
});

test('active document guard rejects mode, incarnation and explicit global version races',async()=>{
  for(const change of [
    `UPDATE delivery_client_shadow_meta SET mode='shadow' WHERE workspace_id='default'`,
    `UPDATE delivery_client_snapshots SET incarnation='recreated' WHERE company='alpha'`,
    `UPDATE delivery_client_shadow_meta SET compatibility_version=42 WHERE workspace_id='default'`,
  ]) {
    const f=activeFixture();
    try {
      const batch=f.db.batch.bind(f.db);
      f.db.batch=async statements=>{f.sql.exec(change);return batch(statements);};
      await assert.rejects(f.run('documents.register',register,crypto.randomUUID(),f.principal,
        {'ontology.delivery.v2':41}),{code:'version_conflict'});
      assert.equal(f.read(),undefined);
      assert.equal(f.count('operation_receipts'),0);
      assert.equal(f.count('operation_events'),0);
    }finally{f.sql.close();}
  }
});
