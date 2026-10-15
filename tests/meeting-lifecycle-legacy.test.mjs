import test from 'node:test';
import assert from 'node:assert/strict';
import {protectOperationFields} from '../src/server/operations/legacy-state.ts';
import {saveLegacyState} from '../src/server/operations/legacy-authorization.ts';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
const key='ontology.engagement.v2';
const action={id:'a',text:'Passado',ownerId:'admin',dueAt:'2026-10-01',deliveryId:'task',removedAt:'removed',removedBy:'admin'};
const meeting={id:'m',company:'santa-clara',title:'Reunião',actions:[action,{id:'b',text:'Ativa'}],removedAt:'removed',removedBy:'admin',google:{eventId:'event'}};
test('omitted meeting tombstones and hidden records survive old snapshots',()=>{
 const before={extraMeetings:[meeting],removedMeetings:['m']};
 const next=protectOperationFields(key,before,{extraMeetings:[],extraTemplates:[{id:'event',company:'santa-clara'}]});
 assert.deepEqual(next.removedMeetings,['m']);assert.deepEqual(next.extraMeetings,[meeting]);
 for(const removedMeetings of [[],['new']])assert.throws(()=>protectOperationFields(key,before,{...before,removedMeetings}),{code:'operation_required'});
 for(const field of ['removedAt','removedBy','restoredAt','restoredBy'])assert.throws(()=>protectOperationFields(key,before,{...before,extraMeetings:[{...meeting,[field]:'forged'}]}),{code:'operation_required'});
});
test('missing removed actions are preserved; resurrection, edits and new tombstones are refused',()=>{
 const live={...meeting};delete live.removedAt;delete live.removedBy;delete live.google;
 const before={extraMeetings:[live],removedMeetings:[]};
 const preserved=protectOperationFields(key,before,{...before,extraMeetings:[{...live,actions:[live.actions[1]]}]});
 assert.deepEqual(preserved.extraMeetings[0].actions,[action,live.actions[1]]);
 const {removedAt,removedBy,deliveryId,...omitted}=action;assert.ok(removedAt&&removedBy&&deliveryId);
 assert.deepEqual(protectOperationFields(key,before,{...before,extraMeetings:[{...live,actions:[omitted,live.actions[1]]}]}).extraMeetings[0].actions[0],action);
 for(const patch of [{removedAt:null},{removedBy:'other'},{text:'Changed'},{done:true},{deliveryId:'other'}])assert.throws(()=>protectOperationFields(key,before,{...before,extraMeetings:[{...live,actions:[{...action,...patch},live.actions[1]]}]}),{code:'operation_required'});
 assert.throws(()=>protectOperationFields(key,before,{...before,extraMeetings:[{...live,actions:[action,{...live.actions[1],removedAt:'fake'}]}]}),{code:'operation_required'});
});
test('legacy write preserves removed extra and action history atomically while updating an unrelated template',async()=>{
 const f=sqliteD1();const before={extraMeetings:[meeting],removedMeetings:['m']};
 for(const [key,value] of [['ontology.workspace.v3',{extraMembers:[{id:'admin',email:'admin@example.com',access:'admin'}]}],['ontology.engagement.v2',before]])f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(key,JSON.stringify(value));
 await assert.rejects(saveLegacyState(f.db,'default','admin@example.com',key,{...before,removedMeetings:[]},1),{code:'operation_required'});
 await saveLegacyState(f.db,'default','admin@example.com',key,{extraMeetings:[],extraTemplates:[{id:'event',company:'santa-clara',title:'Evento'}]},1);
 const after=JSON.parse(f.sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body);assert.deepEqual(after.extraMeetings,[meeting]);assert.deepEqual(after.removedMeetings,['m']);assert.equal(after.extraTemplates[0].title,'Evento');f.sql.close();
});
test('seed tombstones preserve replacement edits and restored metadata cannot be forged',async()=>{
 const {meetings}=await import('../src/modules/engagement/infrastructure/seed.ts');const seed=meetings[0];
 const saved={...seed,removedAt:'removed',removedBy:'admin',actions:[action]};const before={removedMeetings:[seed.id],meetingEdits:{[seed.id]:saved}};
 const after=protectOperationFields(key,before,{meetingEdits:{},notes:{}});assert.deepEqual(after.meetingEdits[seed.id],saved);assert.deepEqual(after.removedMeetings,[seed.id]);
 const restored={...saved,removedAt:undefined,removedBy:undefined,restoredAt:'restored',restoredBy:'admin'};
 const live={removedMeetings:[],meetingEdits:{[seed.id]:restored}};
 const {restoredAt,restoredBy,...oldClient}=restored;assert.ok(restoredAt&&restoredBy);
 assert.equal(protectOperationFields(key,live,{...live,meetingEdits:{[seed.id]:oldClient}}).meetingEdits[seed.id].restoredBy,'admin');
 assert.throws(()=>protectOperationFields(key,{}, {extraMeetings:[{id:'new',actions:[],removedAt:'fake'}]}),{code:'operation_required'});
});
