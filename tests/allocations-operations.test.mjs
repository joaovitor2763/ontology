import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { executeAllocationCommand,readAllocations } from '../src/server/operations/allocations.ts';
import { projectClients } from '../src/modules/clients/infrastructure/snapshot.ts';
import { authorizeOperation } from '../src/server/operations/principal.ts';
const KEY='ontology.clients.v3';
function fixture(){const f=sqliteD1(),put=(key,value)=>f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?) ON CONFLICT(workspace_id,key) DO UPDATE SET version=version+1,body=excluded.body").run(key,JSON.stringify(value)),person={id:'admin',email:'admin@example.test',access:'admin'};put('ontology.workspace.v3',{extraMembers:[person,{id:'master',email:'master@example.test',access:'ai_master'}],allocationRoles:[{id:'custom-arquiteto',label:'Arquiteto'}]});put(KEY,{extraClients:[{slug:'alpha',name:'Alpha',leadId:'master',csId:'admin'},{slug:'beta',name:'Beta',leadId:'admin',csId:'master'}],enrollments:[{id:'enrollment-alpha',company:'alpha',productId:'product',productVersion:1,startsAt:'2026-01-01',status:'ativa'}]});const principal={id:'member:admin',memberId:'admin',email:person.email,kind:'session',application:'web',scopes:null,companies:null};return{...f,put,person,principal,env:{DB:f.db},run:(command,value,key=crypto.randomUUID(),actor=principal,versions={})=>executeAllocationCommand({DB:f.db},actor,command,value,key,versions),read:()=>JSON.parse(f.sql.prepare('SELECT body FROM state_documents WHERE key=?').get(KEY).body),count:table=>f.sql.prepare(`SELECT count(*) n FROM ${table}`).get().n};}
const input={company:'alpha',allocation:{memberId:'admin',role:'consultor',percent:20}};
test('first write materializes all legacy allocations and duplicate member-role retains identity',async()=>{const f=fixture();try{const before=projectClients(f.read()).allocations,made=await f.run('allocations.save',input,'one');assert.equal(f.read().allocationsMigrated,true);assert.ok(before.every(a=>f.read().allocations.some(b=>b.id===a.id)));assert.ok(made.data.allocation.createdAt);assert.deepEqual(await f.run('allocations.save',input,'one'),JSON.parse(JSON.stringify(made)));const again=await f.run('allocations.save',{...input,allocation:{...input.allocation,percent:30}});assert.equal(again.data.allocation.id,made.data.allocation.id);assert.equal(f.read().allocations.filter(a=>a.company==='alpha'&&a.memberId==='admin'&&a.role==='consultor').length,1);assert.ok((await readAllocations(f.env,f.principal,{company:'beta'})).data.every(a=>a.company==='beta'));}finally{f.sql.close();}});
test('singular role replaces prior holder; removal actually removes authorization despite legacy display fallback',async()=>{const f=fixture();try{const master={...f.principal,id:'member:master',memberId:'master',email:'master@example.test'};await authorizeOperation(f.db,'default',master,{action:'ontologia.editar',scope:'knowledge:write',company:'alpha'});await f.run('allocations.remove',{company:'alpha',allocationId:'alloc-alpha-responsavel'});await assert.rejects(authorizeOperation(f.db,'default',master,{action:'ontologia.editar',scope:'knowledge:write',company:'alpha'}),{code:'permission_denied'});await f.run('allocations.save',{company:'alpha',allocation:{memberId:'master',role:'responsavel',percent:30}});await f.run('allocations.save',{company:'alpha',allocation:{memberId:'admin',role:'responsavel',percent:40}});assert.equal(f.read().allocations.filter(a=>a.company==='alpha'&&a.role==='responsavel').length,1);assert.equal(f.read().allocations.find(a=>a.company==='alpha'&&a.role==='responsavel').memberId,'admin');}finally{f.sql.close();}});
test('existing IDs cannot move clients; dates, inactive members and audit inputs are validated',async()=>{const f=fixture();try{await assert.rejects(f.run('allocations.save',{company:'alpha',allocation:{...input.allocation,id:'alloc-beta-responsavel'}}),{code:'allocation_not_found'});for(const patch of [{from:'2026-02-30'},{from:'2026-10-02',to:'2026-10-01'},{percent:101},{memberId:'missing'},{createdAt:'forged'}])await assert.rejects(f.run('allocations.save',{...input,allocation:{...input.allocation,...patch}}),{code:'invalid_input'});const made=await f.run('allocations.save',{...input,allocation:{...input.allocation,from:'2026-10-01'}});await f.run('allocations.save',{...input,allocation:{...input.allocation,id:made.data.allocation.id,from:null,to:''}});assert.equal(f.read().allocations.find(a=>a.id===made.data.allocation.id).from,undefined);f.put('ontology.workspace.v3',{extraMembers:[f.person,{id:'master',email:'master@example.test',access:'ai_master'}],deactivatedIds:['master']});await assert.rejects(f.run('allocations.save',{...input,allocation:{...input.allocation,memberId:'master'}}),{code:'invalid_input'});}finally{f.sql.close();}});
test('fresh permission and atomic versions prevent self-allocation escalation and role-change races',async()=>{const f=fixture();try{await assert.rejects(f.run('allocations.save',input,'master',{...f.principal,id:'member:master',memberId:'master',email:'master@example.test'}),{code:'permission_denied'});await f.run('allocations.save',input,'saved');f.put('ontology.workspace.v3',{extraMembers:[{...f.person,access:'leitor'}]});await assert.rejects(f.run('allocations.save',input,'saved'),{code:'permission_denied'});await assert.rejects(f.run('allocations.unknown',{company:'alpha'}),{code:'invalid_input'});}finally{f.sql.close();}const race=fixture();try{const before=race.read(),batch=race.db.batch;race.db.batch=async statements=>{race.put('ontology.workspace.v3',{extraMembers:[{...race.person,access:'leitor'}]});return batch(statements);};await assert.rejects(race.run('allocations.save',input),{code:'version_conflict'});assert.deepEqual(race.read(),before);assert.equal(race.count('operation_receipts'),0);}finally{race.sql.close();}});
test('allocation can target one purchase, keeps singular roles per scope and records scope in audit',async()=>{const f=fixture();try{const scoped={company:'alpha',allocation:{memberId:'admin',role:'responsavel',enrollmentId:'enrollment-alpha',percent:25}};await f.run('allocations.save',scoped);await f.run('allocations.save',{company:'alpha',allocation:{memberId:'master',role:'custom-arquiteto',enrollmentId:'enrollment-alpha',percent:15}});const rows=(await readAllocations(f.env,f.principal,{company:'alpha'})).data;assert.ok(rows.some(row=>row.role==='responsavel'&&!row.enrollmentId));assert.ok(rows.some(row=>row.role==='responsavel'&&row.enrollmentId==='enrollment-alpha'&&row.memberId==='admin'));assert.ok(rows.some(row=>row.role==='custom-arquiteto'));const latest=JSON.parse(f.sql.prepare("SELECT data FROM client_audit_log WHERE action='allocations.save' ORDER BY sequence DESC LIMIT 1").get().data);assert.equal(latest.enrollmentId,'enrollment-alpha');await assert.rejects(f.run('allocations.save',{...scoped,allocation:{...scoped.allocation,enrollmentId:'foreign'}}),{code:'invalid_input'});await assert.rejects(f.run('allocations.save',{...scoped,allocation:{...scoped.allocation,role:'unknown'}}),{code:'invalid_input'});}finally{f.sql.close();}});
test('member allocation search counts distinct current authorized clients before pagination',async()=>{const f=fixture();try{
 f.put(KEY,{extraClients:['alpha','beta','gamma','delta'].map(slug=>({slug,name:slug,leadId:'admin',csId:'admin'})),enrollments:[{id:'enrollment-alpha',company:'alpha',productId:'product',status:'ativa'}],archivedClients:['gamma'],allocationsMigrated:true,allocations:[
  {id:'a1',company:'alpha',memberId:'master',role:'responsavel',percent:30},
  {id:'a2',company:'alpha',memberId:'master',role:'responsavel',enrollmentId:'enrollment-alpha',percent:20},
  {id:'b1',company:'beta',memberId:'master',role:'responsavel',percent:30},
  {id:'g1',company:'gamma',memberId:'master',role:'responsavel',percent:30},
  {id:'d1',company:'delta',memberId:'master',role:'responsavel',percent:30,to:'2020-01-01'},
  {id:'b2',company:'beta',memberId:'master',role:'cs',percent:10},
 ]});
 const first=await readAllocations(f.env,f.principal,{memberId:'master',role:'responsavel',limit:1});
 assert.equal(first.total,2);assert.equal(first.totalClients,2);assert.equal(first.nextOffset,1);assert.equal(first.data.length,1);
 const restricted=await readAllocations(f.env,{...f.principal,companies:['alpha']},{memberId:'master',role:'responsavel'});
 assert.equal(restricted.total,1);assert.equal(restricted.totalClients,1);assert.ok(restricted.data.every(row=>row.company==='alpha'));
 await assert.rejects(readAllocations(f.env,f.principal,{}),{code:'invalid_input'});
}finally{f.sql.close();}});

test('changing client responsible updates only general responsibility atomically, preserving other work',async()=>{
 const f=fixture();try{
  await f.run('allocations.save',{company:'alpha',allocation:{memberId:'master',role:'responsavel',enrollmentId:'enrollment-alpha',percent:17}});
  const before=f.read(), other=before.allocations.filter(row=>row.company!=='alpha'||row.role!=='responsavel');
  const args={company:'alpha',memberId:'admin'};
  const first=await f.run('clients.setResponsible',args,'set-responsible');
  assert.deepEqual(await f.run('clients.setResponsible',args,'set-responsible'),JSON.parse(JSON.stringify(first)));
  const after=f.read();
  assert.equal(after.clientEdits.alpha.leadId,'admin');
  assert.equal(after.allocations.find(row=>row.company==='alpha'&&row.role==='responsavel'&&!row.enrollmentId).memberId,'admin');
  assert.equal(after.allocations.find(row=>row.enrollmentId==='enrollment-alpha'&&row.role==='responsavel').memberId,'master');
  assert.equal(after.allocations.find(row=>row.enrollmentId==='enrollment-alpha'&&row.role==='responsavel').percent,17);
  assert.deepEqual(after.allocations.filter(row=>row.company!=='alpha'||row.role!=='responsavel'),other);
  const audit=f.sql.prepare("SELECT data FROM client_audit_log WHERE action='clients.setResponsible'").all();
  assert.equal(audit.length,1);assert.equal(JSON.parse(audit[0].data).memberId,'admin');
  assert.equal(JSON.parse(audit[0].data).scope,'client');
  await assert.rejects(f.run('clients.setResponsible',{...args,memberId:'master'},'set-responsible'),{code:'idempotency_conflict'});
  await assert.rejects(f.run('clients.setResponsible',args,crypto.randomUUID(),f.principal,{[KEY]:0}),{code:'version_conflict'});
 }finally{f.sql.close();}
});
test('changing only a purchase responsible leaves general responsibility and rejects invalid scopes and members',async()=>{
 const f=fixture();try{
  await f.run('clients.setResponsible',{company:'alpha',memberId:'admin',enrollmentId:'enrollment-alpha'});
  const rows=f.read().allocations;
  assert.equal(rows.find(row=>row.company==='alpha'&&row.role==='responsavel'&&!row.enrollmentId).memberId,'master');
  assert.equal(rows.find(row=>row.enrollmentId==='enrollment-alpha'&&row.role==='responsavel').memberId,'admin');
  for(const input of [{company:'alpha',memberId:'absent'},{company:'alpha',memberId:'admin',enrollmentId:'foreign'},{company:'alpha',memberId:'admin',leadId:'master'}])
    await assert.rejects(f.run('clients.setResponsible',input),{code:'invalid_input'});
  const master={...f.principal,id:'member:master',memberId:'master',email:'master@example.test'};
  await f.run('clients.setResponsible',{company:'alpha',memberId:'master'},'allocated',master);
  await f.run('allocations.remove',{company:'beta',allocationId:'alloc-beta-cs'});
  await assert.rejects(f.run('clients.setResponsible',{company:'beta',memberId:'master'},'forbidden',master),{code:'permission_denied'});
  f.put('ontology.workspace.v3',{extraMembers:[f.person,{id:'master',email:'master@example.test',access:'ai_master'}],deactivatedIds:['master']});
  await assert.rejects(f.run('clients.setResponsible',{company:'alpha',memberId:'master'}),{code:'invalid_input'});
 }finally{f.sql.close();}
});

test('null removes just the chosen responsibility, clears the general legacy field and audits product scope',async()=>{
 const f=fixture();try{
  await f.run('clients.setResponsible',{company:'alpha',memberId:'admin',enrollmentId:'enrollment-alpha'});
  const product=f.read().allocations.find(row=>row.enrollmentId==='enrollment-alpha'&&row.role==='responsavel');
  const deliveryBefore=f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get();
  await f.run('clients.setResponsible',{company:'alpha',memberId:null});
  assert.equal(f.read().clientEdits.alpha.leadId,'');
  assert.ok(!f.read().allocations.some(row=>row.company==='alpha'&&row.role==='responsavel'&&!row.enrollmentId));
  assert.deepEqual(f.read().allocations.find(row=>row.id===product.id),product);
  await f.run('clients.setResponsible',{company:'alpha',memberId:null,enrollmentId:'enrollment-alpha'});
  const event=JSON.parse(f.sql.prepare("SELECT data FROM client_audit_log WHERE action='clients.setResponsible' ORDER BY sequence DESC LIMIT 1").get().data);
  assert.equal(event.role,'responsavel');assert.equal(event.enrollmentId,'enrollment-alpha');
  assert.equal(event.memberId,null);assert.deepEqual(event.previousResponsibleIds,['admin']);
  assert.deepEqual(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.delivery.v2'").get(),deliveryBefore);
 }finally{f.sql.close();}
});
