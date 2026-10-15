import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {resolveOperationPrincipal} from '../src/server/operations/principal.ts';
import {executeMeetingContentCommand} from '../src/server/operations/meeting-content.ts';
const KEY='ontology.engagement.v2';
async function fixture(){const f=sqliteD1();const meeting={id:'content',company:'santa-clara',title:'Título Google',kind:'entrevista',startsAt:'2026-09-17T12:00:00',durationMin:45,attendeeIds:[],summary:'Antes',notes:'Original',decisions:[],google:{eventId:'event',etag:'etag'},actions:[{id:'linked',text:'Ação ligada',ownerId:'admin',dueAt:'',deliveryId:'task'},{id:'removed',text:'Passado',ownerId:'admin',dueAt:'',removedAt:'then',removedBy:'admin',deliveryId:'old-task'}]};
 const state={extraMeetings:[meeting],notes:{content:'Override antigo'},extraHypotheses:[{id:'mine',company:'santa-clara'},{id:'foreign',company:'banco-litoral'}]};
 for(const [key,value] of [['ontology.workspace.v3',{extraMembers:[{id:'admin',email:'admin@example.com',access:'admin'}]}],[KEY,state]])f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(key,JSON.stringify(value));
 const env={DB:f.db,AUTH_MODE:'dev',DEV_USER_EMAIL:'admin@example.com'},principal=await resolveOperationPrincipal(new Request('https://delivery.test'),env);
 return {...f,env,principal,meeting,state,read:()=>JSON.parse(f.sql.prepare('SELECT body FROM state_documents WHERE key=?').get(KEY).body)};}
test('content edits preserve legacy scheduling and Google while notes override and history commit atomically',async()=>{
 const f=await fixture(),input={meetingId:'content',patch:{summary:'Depois',notes:'Notas novas',prep:{homeworkDone:true,hypothesisIds:['mine'],format:'conversa'},learnings:'Aprendi',implications:'Próximo passo',receptiveness:'aliado',commitmentObtained:true,decisions:['Decisão'],tags:['feedback']}};
 const result=await executeMeetingContentCommand(f.env,f.principal,input,'content');assert.equal(result.data.meeting.startsAt,f.meeting.startsAt);assert.deepEqual(result.data.meeting.google,f.meeting.google);assert.equal(result.data.meeting.title,f.meeting.title);assert.equal(f.read().notes.content,'Notas novas');assert.equal(f.read().extraMeetings[0].notes,'Notas novas');assert.deepEqual(await executeMeetingContentCommand(f.env,f.principal,input,'content'),result);assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_events').get().n,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM state_history').get().n,1);
 await executeMeetingContentCommand(f.env,f.principal,{meetingId:'content',patch:{notes:'',receptiveness:null}},'clear');assert.equal(f.read().notes.content,'');assert.equal(f.read().extraMeetings[0].receptiveness,undefined);f.sql.close();
});
test('actions preserve linked tasks and omitted tombstones; forged or removed links and invalid ownership reject',async()=>{
 const f=await fixture(),action=f.meeting.actions[0];
 for(const actions of [[{...action,deliveryId:'forged'}],[],[{...action,ownerId:'nonmember'}],[{...action,dueAt:'not-a-date'}],[{...f.meeting.actions[1],text:'rewrite'},action]])await assert.rejects(executeMeetingContentCommand(f.env,f.principal,{meetingId:'content',patch:{actions}},crypto.randomUUID()),{code:'invalid_input'});
 const {deliveryId,...without}=action;assert.ok(deliveryId);await executeMeetingContentCommand(f.env,f.principal,{meetingId:'content',patch:{actions:[{...without,done:true}]}},'toggle');
 const actions=f.read().extraMeetings[0].actions;assert.equal(actions[0].deliveryId,'task');assert.equal(actions[0].done,true);assert.deepEqual(actions[1],f.meeting.actions[1]);f.sql.close();
});
test('content rejects scheduling fields, foreign hypotheses, stale writes, and revalidates revoked member on retry',async()=>{
 const f=await fixture();for(const patch of [{startsAt:'2090-01-01T00:00:00Z'},{google:{}},{prep:{hypothesisIds:['foreign']}},{prep:{format:'invalid'}},{painIds:[]}])await assert.rejects(executeMeetingContentCommand(f.env,f.principal,{meetingId:'content',patch},crypto.randomUUID()),{code:'invalid_input'});
 const input={meetingId:'content',patch:{summary:'Atual'}};await assert.rejects(executeMeetingContentCommand(f.env,f.principal,input,'stale',{[KEY]:0}),{code:'version_conflict'});assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);
 await executeMeetingContentCommand(f.env,f.principal,input,'good');f.sql.prepare("UPDATE state_documents SET body=? WHERE key='ontology.workspace.v3'").run(JSON.stringify({extraMembers:[{id:'admin',email:'admin@example.com',access:'admin'}],deactivatedIds:['admin']}));await assert.rejects(executeMeetingContentCommand(f.env,f.principal,input,'good'),{code:'inactive_member'});f.sql.close();
});
test('failed event insertion rolls back both notes representations and receipt',async()=>{const f=await fixture();f.sql.exec("CREATE TRIGGER reject_content BEFORE INSERT ON operation_events BEGIN SELECT RAISE(ABORT,'fixture_failure'); END;");await assert.rejects(executeMeetingContentCommand(f.env,f.principal,{meetingId:'content',patch:{notes:'Should rollback'}},'rollback'),/fixture_failure/);assert.deepEqual(f.read(),f.state);assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_receipts').get().n,0);f.sql.close();});
test('pending Google operation blocks content, and unchanged decisions retain structured history',async()=>{
 const f=await fixture();const decisionItems=[{id:'d',summary:'Acordo',status:'cumprida'}];
 f.sql.prepare('UPDATE state_documents SET body=? WHERE key=?').run(JSON.stringify({...f.state,extraMeetings:[{...f.meeting,schedulingStatus:'uncertain',decisions:['Acordo'],decisionItems}]}),KEY);
 await assert.rejects(executeMeetingContentCommand(f.env,f.principal,{meetingId:'content',patch:{summary:'Changed'}},'pending'),{code:'meeting_operation_pending'});
 f.sql.prepare('UPDATE state_documents SET body=? WHERE key=?').run(JSON.stringify({...f.state,extraMeetings:[{...f.meeting,decisions:['Acordo'],decisionItems}]}),KEY);
 await executeMeetingContentCommand(f.env,f.principal,{meetingId:'content',patch:{decisions:['Acordo'],summary:'Resumo'}},'same');assert.deepEqual(f.read().extraMeetings[0].decisionItems,decisionItems);
 await executeMeetingContentCommand(f.env,f.principal,{meetingId:'content',patch:{decisions:['Acordo','Novo acordo']}},'changed');assert.deepEqual(f.read().extraMeetings[0].decisionItems[0],decisionItems[0]);assert.equal(f.read().extraMeetings[0].decisionItems[1].summary,'Novo acordo');assert.equal(f.read().extraMeetings[0].decisionItems[1].status,'registrada');f.sql.close();
});
