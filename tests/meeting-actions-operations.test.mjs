import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { executeMeetingActionCommand } from '../src/server/operations/meeting-actions.ts';
import { executeMeetingCommand } from '../src/server/operations/meetings.ts';
import { issueIntegrationCredential,revokeIntegrationCredential } from '../src/server/operations/credentials.ts';
import { resolveOperationPrincipal } from '../src/server/operations/principal.ts';
const meeting={id:'meeting',company:'alpha',title:'Reunião fixture',kind:'alinhamento',modality:'presencial',startsAt:'2026-10-01T12:00:00-03:00',durationMin:45,attendeeIds:['admin'],guests:[],summary:'',notes:'',decisions:[],actions:[{text:'Executar ação',ownerId:'admin',dueAt:'2026-10-02',done:true}],enrollmentIds:['purchase','purchase2']};
function fixture(override={}){
 const f=sqliteD1();const put=(key,value)=>f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?) ON CONFLICT(workspace_id,key) DO UPDATE SET version=version+1,body=excluded.body").run(key,JSON.stringify(value));
 const workspace={extraMembers:[{id:'admin',email:'admin@example.test',access:'admin'},{id:'master',email:'master@example.test',access:'ai_master'}]};
 put('ontology.workspace.v3',workspace);put('ontology.clients.v3',{extraClients:[{slug:'alpha',name:'Alpha',journeyId:'global'},{slug:'beta',name:'Beta'}],allocationsMigrated:true,allocations:[],enrollments:[{id:'purchase',company:'alpha',productId:'product',planId:'private'},{id:'purchase2',company:'alpha',productId:'product',planId:'private2'},{id:'foreign',company:'beta',productId:'product'}]});
 put('ontology.catalog.v2',{extraProducts:[{id:'product',name:'Product',description:'',cycles:[]}]});put('ontology.engagement.v2',{extraMeetings:[{...structuredClone(meeting),...override}]});
 const principal={id:'member:admin',kind:'session',email:'admin@example.test',memberId:'admin',access:'admin',application:'web',scopes:null,companies:null,guards:[]},env={DB:f.db};
 return{...f,put,env,principal,workspace,read:key=>JSON.parse(f.sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body),run:(input={meetingId:'meeting',actionId:'meeting-a1',enrollmentId:'purchase'},key=crypto.randomUUID(),actor=principal,versions={})=>executeMeetingActionCommand(env,actor,input,key,versions)};
}
test('legacy action converts atomically to an open task; replay and new keys never duplicate it',async()=>{
 const f=fixture();try{
  const input={meetingId:'meeting',actionId:'meeting-a1',enrollmentId:'purchase'};
  const made=await f.run(input,'first');assert.equal(made.data.task.status,'fila');assert.equal(made.data.task.origin,'reuniao');assert.equal(made.data.task.enrollmentId,'purchase');assert.equal(made.data.task.productId,'product');assert.equal(made.data.task.journeyId,'private');assert.equal(made.data.task.history[0].by,'admin');assert.equal(made.data.meeting.actions[0].deliveryId,made.data.task.id);assert.equal(made.documents.length,2);
  assert.deepEqual(await f.run(input,'first'),JSON.parse(JSON.stringify(made)));
  const again=await f.run(input,'new');assert.equal(again.data.existing,true);assert.equal(again.data.task.id,made.data.task.id);assert.equal(f.read('ontology.delivery.v2').extraTasks.length,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM operation_events').get().n,2);
  const clients=f.read('ontology.clients.v3');clients.enrollments=clients.enrollments.map(row=>row.id==='purchase'?{...row,status:'cancelada'}:row);f.put('ontology.clients.v3',clients);
  const afterCancellation=await f.run(input,'after-cancellation');assert.equal(afterCancellation.data.existing,true);assert.equal(afterCancellation.data.task.id,made.data.task.id);
  await assert.rejects(f.run({...input,enrollmentId:'purchase2'}),{code:'action_task_conflict'});
 }finally{f.sql.close();}
});
test('selection is explicit and bounded to the meeting; cycle/task context cannot contradict it',async()=>{
 const f=fixture();try{
  for(const enrollmentId of [undefined,null,'foreign','missing'])await assert.rejects(f.run({meetingId:'meeting',actionId:'meeting-a1',...(enrollmentId===undefined?{}:{enrollmentId})}),{code:'invalid_input'});
  f.put('ontology.delivery.v2',{extraCycles:[{id:'cycle',company:'alpha',name:'Cycle',goal:'',startsAt:'2026-10-01',endsAt:'2026-10-05',ownerId:'admin',status:'planejado',taskIds:[],acceptance:[],productId:'product',enrollmentId:'purchase2'}]});
  f.put('ontology.engagement.v2',{extraMeetings:[{...meeting,cycleId:'cycle'}]});await assert.rejects(f.run(),/ciclo/);
  const result=await f.run({meetingId:'meeting',actionId:'meeting-a1',enrollmentId:'purchase2'});assert.equal(result.data.task.enrollmentId,'purchase2');assert.deepEqual(f.read('ontology.delivery.v2').extraCycles[0].taskIds,[]);
 }finally{f.sql.close();}
 const local=fixture({enrollmentIds:[]});try{const made=await local.run({meetingId:'meeting',actionId:'meeting-a1',enrollmentId:null});assert.equal(made.data.task.enrollmentId,undefined);assert.equal(made.data.task.journeyId,'global');}finally{local.sql.close();}
});
test('pending journals, cancellation, orphan links, inactive owners and invalid dates create nothing',async()=>{
 for(const override of [{schedulingStatus:'uncertain'},{cancelledAt:'now'},{actions:[{...meeting.actions[0],deliveryId:'missing'}]},{actions:[{...meeting.actions[0],ownerId:'unknown'}]},{actions:[{...meeting.actions[0],dueAt:'2026-02-30'}]}]){
  const f=fixture(override);try{await assert.rejects(f.run());assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM operation_receipts').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM operation_events').get().n,0);}finally{f.sql.close();}
 }
 const f=fixture();try{f.sql.prepare("INSERT INTO meeting_operations(id,workspace_id,principal_id,meeting_id,company,command,desired,pending_meeting,calendar_input,status,created_at,updated_at) VALUES('pending','default','member:admin','meeting','alpha','meetings.update','{}','{}','{}','pending','now','now')").run();await assert.rejects(f.run(),{code:'meeting_operation_pending'});}finally{f.sql.close();}
});
test('both scopes and allocation apply on first execution and receipt replay; commit races roll back both documents',async()=>{
 const f=fixture();try{
  const master={...f.principal,id:'member:master',email:'master@example.test',memberId:'master'};await assert.rejects(f.run(undefined,'master',master),{code:'permission_denied'});
  const token=await issueIntegrationCredential(f.db,'default',f.principal.email,{name:'Meeting fixture',ownerEmail:f.principal.email,scopes:['meetings:write'],companies:['alpha'],expiresAt:new Date(Date.now()+3600000).toISOString()});const actor=await resolveOperationPrincipal(new Request('https://delivery.test',{headers:{authorization:`Bearer ${token.token}`}}),f.env);await assert.rejects(f.run(undefined,'token',actor),{code:'insufficient_scope'});
  f.sql.prepare('UPDATE integration_credentials SET scopes=? WHERE id=?').run(JSON.stringify(['meetings:write','delivery:write']),token.id);await f.run(undefined,'token',actor);await revokeIntegrationCredential(f.db,'default',f.principal.email,token.id);await assert.rejects(f.run(undefined,'token',actor),{code:'invalid_token'});
 }finally{f.sql.close();}
 const race=fixture();try{const before=race.read('ontology.engagement.v2'),batch=race.db.batch;race.db.batch=async statements=>{race.put('ontology.workspace.v3',{extraMembers:race.workspace.extraMembers.map(p=>({...p,access:'leitor'}))});return batch(statements);};await assert.rejects(race.run(),{code:'version_conflict'});assert.deepEqual(race.read('ontology.engagement.v2'),before);assert.equal(race.sql.prepare("SELECT COUNT(*) n FROM state_documents WHERE key='ontology.delivery.v2'").get().n,0);assert.equal(race.sql.prepare('SELECT COUNT(*) n FROM operation_receipts').get().n,0);}finally{race.sql.close();}
});
test('generic meeting edits preserve omitted links and reject forging, replacement and deletion including legacy IDs',async()=>{
 const f=fixture({enrollmentIds:[]});try{
  const made=await f.run({meetingId:'meeting',actionId:'meeting-a1',enrollmentId:null});
  const action={...meeting.actions[0],id:'meeting-a1',text:'Revisada'};
  const edited=await executeMeetingCommand(f.env,f.principal,'meetings.update',{meetingId:'meeting',patch:{actions:[action]}},'edit');assert.equal(edited.data.meeting.actions[0].deliveryId,made.data.task.id);
  for(const actions of [[],[{...action,deliveryId:'forged'}],[{...action,deliveryId:null}],[{...action},{...action}]])await assert.rejects(executeMeetingCommand(f.env,f.principal,'meetings.update',{meetingId:'meeting',patch:{actions}},crypto.randomUUID()));
  await assert.rejects(executeMeetingCommand(f.env,f.principal,'meetings.create',{meeting:{...meeting,actions:[{...action,deliveryId:made.data.task.id}]}},'forge-create'));
 }finally{f.sql.close();}
});

test('purchase without a private plan never inherits another selected client plan',async()=>{
 const f=fixture();try{
  const clients=f.read('ontology.clients.v3');delete clients.enrollments[0].planId;f.put('ontology.clients.v3',clients);
  f.put('ontology.delivery.v2',{companyJourney:{alpha:'other-purchase-plan'}});
  const made=await f.run();assert.equal(made.data.task.enrollmentId,'purchase');assert.equal(made.data.task.journeyId,undefined);
 }finally{f.sql.close();}
});

test('ID-less insertion or reordering cannot transfer a linked action identity',async()=>{
 const second={text:'Segunda ação',ownerId:'admin',dueAt:'2026-10-03'};
 const f=fixture({actions:[meeting.actions[0],second],enrollmentIds:[]});try{
  const created=await f.run({meetingId:'meeting',actionId:'meeting-a1',enrollmentId:null});
  const before=f.read('ontology.engagement.v2');
  for(const actions of [[second,meeting.actions[0]],[{...second,text:'Inserida'},meeting.actions[0],second]]){
   await assert.rejects(executeMeetingCommand(f.env,f.principal,'meetings.update',{meetingId:'meeting',patch:{actions}},crypto.randomUUID()),/identificadores/);
   assert.deepEqual(f.read('ontology.engagement.v2'),before);
  }
  const reordered=await executeMeetingCommand(f.env,f.principal,'meetings.update',{meetingId:'meeting',patch:{actions:[{...second,id:'meeting-a2'},{...meeting.actions[0],id:'meeting-a1'}]}},'reorder');
  assert.equal(reordered.data.meeting.actions[0].id,'meeting-a2');assert.equal(reordered.data.meeting.actions[0].deliveryId,undefined);
  assert.equal(reordered.data.meeting.actions[1].id,'meeting-a1');assert.equal(reordered.data.meeting.actions[1].deliveryId,created.data.task.id);
 }finally{f.sql.close();}
});


test('removed actions cannot convert or be revived by generic meeting updates',async()=>{
 const removed={id:'removed',text:'Histórico',ownerId:'admin',dueAt:'2026-10-02',done:false,removedAt:'2026-09-17T10:00:00Z',removedBy:'admin'};
 const f=fixture({actions:[removed]});try{
  await assert.rejects(f.run({meetingId:'meeting',actionId:'removed',enrollmentId:'purchase'}),{code:'action_not_found'});
  const update=(patch)=>executeMeetingCommand(f.env,f.principal,'meetings.update',{meetingId:'meeting',patch},crypto.randomUUID());
  await update({notes:'Nota válida',actions:[]});assert.deepEqual(f.read('ontology.engagement.v2').extraMeetings[0].actions,[removed]);
  await assert.rejects(update({actions:[{...removed,removedAt:null}]}),{code:'invalid_meeting'});
  await assert.rejects(update({actions:[{...removed,text:'Apagar história'}]}),{code:'invalid_meeting'});
  await assert.rejects(update({removedAt:'forged'}),{code:'invalid_meeting'});
 }finally{f.sql.close();}
});
