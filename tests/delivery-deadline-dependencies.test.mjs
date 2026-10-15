import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryDeadlineDependencies, clientDeadlineStatements,
 noSurvivingDeadlineDependencies } from '../src/server/operations/delivery-client-deadline-dependencies.ts';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';

const task=(id,deadline,company='client')=>({id,company,deadline});
test('raw deadline projection keeps removed tasks and seed patches, respecting explicit overrides',()=>{
 const snapshot={extraTasks:[
  task('raw',{mode:'task',taskId:'target'}),
  {...task('removed',{mode:'task',taskId:'target'}),removed:true},
  task('overridden',{mode:'task',taskId:'old'}),
  task('cleared',{mode:'task',taskId:'old'}),
 ],taskPatches:{
  overridden:{deadline:{mode:'task',taskId:'new'}},
  cleared:{deadline:undefined},
  'seed-task':{deadline:{mode:'task',taskId:'target'}},
 }};
 assert.deepEqual(deliveryDeadlineDependencies(snapshot,'client'),[
  {sourceTaskId:'overridden',targetTaskId:'new'},
  {sourceTaskId:'raw',targetTaskId:'target'},
  {sourceTaskId:'removed',targetTaskId:'target'},
  {sourceTaskId:'seed-task',targetTaskId:'target'},
 ]);
 assert.deepEqual(deliveryDeadlineDependencies(snapshot,'other'),[
  {sourceTaskId:'seed-task',targetTaskId:'target'},
 ]);
});
test('dependency order matches SQLite binary collation',()=>{
 assert.deepEqual(deliveryDeadlineDependencies({extraTasks:[
  task('z',{mode:'task',taskId:'end'}),
  task('A',{mode:'task',taskId:'end'}),
 ]},'client').map(row=>row.sourceTaskId),['A','z']);
});
test('deadline projection advances only a current complete head',async()=>{
 const f=sqliteD1();try{
  const before={extraTasks:[task('a',{mode:'task',taskId:'old'})]};
  const after={extraTasks:[task('a',{mode:'task',taskId:'new'})]};
  f.sql.prepare(`INSERT INTO delivery_client_deadline_heads
    (workspace_id,company,authority_generation,source_revision,source_incarnation,
     projection_generation,expected_dependencies,updated_at)
    VALUES('default','client','active',3,'inc','projection',1,'now')`).run();
  f.sql.prepare(`INSERT INTO delivery_client_deadline_dependencies
    (workspace_id,projection_generation,company,source_task_id,target_task_id)
    VALUES('default','projection','client','a','old')`).run();
  const head={authority_generation:'active',source_revision:3,source_incarnation:'inc',
   projection_generation:'projection',expected_dependencies:1,actual_dependencies:1};
  assert.deepEqual(clientDeadlineStatements(f.db,'default','client','active',2,'inc',before,after,head,10),[]);
  const statements=clientDeadlineStatements(f.db,'default','client','active',3,'inc',before,after,head,10,
   new Map([['a','old']]));
  assert.equal(statements.length,3);
  await f.db.batch(statements);
  assert.deepEqual({...f.sql.prepare("SELECT source_revision,expected_dependencies FROM delivery_client_deadline_heads WHERE company='client'").get()},
   {source_revision:4,expected_dependencies:1});
  assert.equal(f.sql.prepare("SELECT target_task_id FROM delivery_client_deadline_dependencies WHERE source_task_id='a'").get().target_task_id,'new');
  assert.deepEqual(clientDeadlineStatements(f.db,'default','client','active',4,'inc',after,before,
   {...head,source_revision:4},10,new Map([['a','wrong']])),[]);
 }finally{f.sql.close();}
});
test('absence proof covers every current client and ignores sources removed together',async()=>{
 const f=sqliteD1();try{
  for(const key of ['ontology.delivery.v2','ontology.clients.v3'])
   f.sql.prepare(`INSERT INTO state_documents(workspace_id,key,version,body)
     VALUES('default',?,1,'{}')`).run(key);
  f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
    (workspace_id,generation,mode,source_delivery_version,source_clients_version,
     compatibility_version,expected_clients,expected_owners,expected_orphans,
     expected_array_order,expected_map_order,updated_at)
    VALUES('default','active','active',1,1,7,2,0,0,0,0,'now')`).run();
  for(const [company,incarnation] of [['one','inc-1'],['two','inc-2']]) {
   f.sql.prepare(`INSERT INTO delivery_client_snapshots
     (workspace_id,generation,company,revision,body,body_sha256,incarnation)
     VALUES('default','active',?,1,'{}','hash',?)`).run(company,incarnation);
   f.sql.prepare(`INSERT INTO delivery_client_deadline_heads
     (workspace_id,company,authority_generation,source_revision,source_incarnation,
      projection_generation,expected_dependencies,updated_at)
     VALUES('default',?,'active',1,?,'projection',1,'now')`).run(company,incarnation);
  }
  for(const [company,source] of [['one','removed'],['two','other']])
   f.sql.prepare(`INSERT INTO delivery_client_deadline_dependencies
     (workspace_id,projection_generation,company,source_task_id,target_task_id)
     VALUES('default','projection',?,?,'target')`).run(company,source);
  assert.equal(await noSurvivingDeadlineDependencies(f.db,'default',['removed','target'],7),false);
  f.sql.prepare(`DELETE FROM delivery_client_deadline_dependencies WHERE company='two'`).run();
  f.sql.prepare(`UPDATE delivery_client_deadline_heads SET expected_dependencies=0
    WHERE company='two'`).run();
  assert.equal(await noSurvivingDeadlineDependencies(f.db,'default',['removed','target'],7),true);
  assert.equal(await noSurvivingDeadlineDependencies(f.db,'default',['removed','target'],6),false);
  f.sql.prepare(`UPDATE delivery_client_deadline_heads SET source_revision=0 WHERE company='two'`).run();
  assert.equal(await noSurvivingDeadlineDependencies(f.db,'default',['removed','target'],7),false);
 }finally{f.sql.close();}
});
