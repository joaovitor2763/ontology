import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { executeMeetingLifecycleCommand } from '../src/server/operations/meeting-lifecycle.ts';
import { meetings } from '../src/modules/engagement/infrastructure/seed.ts';
const E='ontology.engagement.v2';
function fixture(overrides={}){
 const f=sqliteD1(),put=(key,value)=>f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?) ON CONFLICT(workspace_id,key) DO UPDATE SET version=version+1,body=excluded.body").run(key,JSON.stringify(value));
 const person={id:'admin',email:'admin@example.test',access:'admin'},meeting={id:'m',company:'alpha',title:'Fixture',startsAt:'2026-10-01T12:00:00Z',durationMin:30,actions:[{text:'Ação',ownerId:'admin',dueAt:'2026-10-02',done:true,deliveryId:'task'}],notes:'Preservar',...overrides};
 put('ontology.workspace.v3',{extraMembers:[person]});put('ontology.clients.v3',{extraClients:[{slug:'alpha',name:'Alpha'}]});put(E,{extraMeetings:[meeting]});put('ontology.delivery.v2',{extraTasks:[{id:'task',company:'alpha',title:'Preservar'}]});
 const principal={id:'member:admin',kind:'session',email:person.email,memberId:'admin',application:'web',scopes:null,companies:null};
 return {...f,put,principal,run:(command,input={meetingId:'m'},key=crypto.randomUUID(),versions={})=>executeMeetingLifecycleCommand({DB:f.db},principal,command,input,key,versions),read:key=>JSON.parse(f.sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body),count:table=>f.sql.prepare(`SELECT count(*) n FROM ${table}`).get().n};
}
test('remove/restore preserve records and tasks, reauthorize replay and never contact Google',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('No external effects');});const f=fixture();try{
 const delivery=f.read('ontology.delivery.v2'),removed=await f.run('meetings.remove',undefined,'remove');assert.equal(removed.data.meeting.removedBy,'admin');assert.deepEqual(f.read(E).removedMeetings,['m']);assert.equal(f.read(E).extraMeetings.length,1);assert.deepEqual(await f.run('meetings.remove',undefined,'remove'),JSON.parse(JSON.stringify(removed)));
 assert.equal((await f.run('meetings.remove')).data.changed,false);const state=f.read(E);state.extraMeetings[0].notes='Edited while hidden';f.put(E,state);const restored=await f.run('meetings.restore');assert.equal(restored.data.meeting.notes,'Edited while hidden');assert.equal(restored.data.meeting.removedAt,undefined);assert.deepEqual(f.read(E).removedMeetings,[]);assert.deepEqual(f.read('ontology.delivery.v2'),delivery);assert.equal(f.count('operation_events'),2);
 f.put('ontology.workspace.v3',{extraMembers:[{id:'admin',email:'admin@example.test',access:'leitor'}]});await assert.rejects(f.run('meetings.remove',undefined,'remove'),{code:'permission_denied'});
 }finally{f.sql.close();}
});
test('live Google event requires explicit keep choice; confirmed cancellation allows local removal',async()=>{
 for(const google of [{eventId:'event'},{eventId:'event',cancelled:true}]){const f=fixture({google});try{if(!google.cancelled){await assert.rejects(f.run('meetings.remove'),{code:'calendar_choice_required'});await assert.rejects(f.run('meetings.remove',{meetingId:'m',keepCalendar:false}),{code:'calendar_choice_required'});assert.equal(f.count('operation_receipts'),0);}await f.run('meetings.remove',{meetingId:'m',keepCalendar:true});const restored=await f.run('meetings.restore');assert.deepEqual(restored.data.meeting.google,google);}finally{f.sql.close();}}
 const f=fixture({google:{eventId:'event'},cancelledAt:'2026-09-01T00:00:00Z'});try{await f.run('meetings.remove');}finally{f.sql.close();}
});
test('action tombstones preserve linked task and legacy identity; restoring a hidden meeting action requires parent restoration',async()=>{
 const f=fixture();try{const input={meetingId:'m',actionId:'m-a1'},removed=await f.run('meetings.actions.remove',input);assert.equal(removed.data.meeting.actions[0].deliveryId,'task');assert.equal(removed.data.meeting.actions[0].removedBy,'admin');assert.equal((await f.run('meetings.actions.remove',input)).data.changed,false);await f.run('meetings.remove');await assert.rejects(f.run('meetings.actions.restore',input),{code:'meeting_removed'});await f.run('meetings.restore');const restored=await f.run('meetings.actions.restore',input);assert.equal(restored.data.meeting.actions[0].removedAt,undefined);assert.equal(restored.data.meeting.actions[0].done,true);assert.equal(f.read('ontology.delivery.v2').extraTasks.length,1);}finally{f.sql.close();}
});
test('seed restoration resolves original record without recreating it; stale versions and authorization races roll back',async()=>{
 const f=fixture();try{const seed=meetings[0];f.put(E,{removedMeetings:[seed.id]});const restored=await f.run('meetings.restore',{meetingId:seed.id});assert.equal(restored.data.meeting.id,seed.id);assert.equal(f.read(E).extraMeetings.length,0);assert.deepEqual(f.read(E).removedMeetings,[]);await assert.rejects(f.run('meetings.remove',{meetingId:seed.id,keepCalendar:true},'stale',{[E]:1}),{code:'version_conflict'});}finally{f.sql.close();}
 const race=fixture();try{const before=race.read(E),batch=race.db.batch;race.db.batch=async statements=>{race.put('ontology.workspace.v3',{extraMembers:[{id:'admin',email:'admin@example.test',access:'leitor'}]});return batch(statements);};await assert.rejects(race.run('meetings.remove'),{code:'version_conflict'});assert.deepEqual(race.read(E),before);assert.equal(race.count('operation_receipts'),0);}finally{race.sql.close();}
});
test('pending scheduling never hides a meeting or changes actions',async()=>{
 const f=fixture({schedulingStatus:'uncertain'});try{for(const command of ['meetings.remove','meetings.restore','meetings.actions.remove'])await assert.rejects(f.run(command,{meetingId:'m',...(command.includes('actions')?{actionId:'m-a1'}:{})}),{code:'meeting_operation_pending'});assert.equal(f.count('operation_events'),0);}finally{f.sql.close();}
});
