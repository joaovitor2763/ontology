import test from 'node:test';
import assert from 'node:assert/strict';
import {protectOperationFields} from '../src/server/operations/legacy-state.ts';
import {saveLegacyState} from '../src/server/operations/legacy-authorization.ts';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {threads} from '../src/modules/engagement/infrastructure/seed.ts';
const key='ontology.relationship.v1';
const space={id:'client-notes',company:'santa-clara',kind:'notes',channel:'note',messages:[],title:'Notas'};
const note={id:'n1',text:'Registro',from:'Admin',at:'2026-09-17',createdAt:'2026-09-17',history:[{by:'admin',at:'now',field:'text',from:'A',to:'Registro'}],files:[{id:'file1'}]};
const before={spaces:[space],notes:{[space.id]:[note]},read:[],unread:[],pinned:[]};
test('notes spaces and authorship/history/attachments only change through commands',()=>{
 for(const patch of [{text:'forged'},{from:'Other'},{createdAt:'old'},{at:'old'},{history:[]},{files:[]}])assert.throws(()=>protectOperationFields(key,before,{...before,notes:{[space.id]:[{...note,...patch}]}}),{code:'operation_required'});
 for(const changed of [{...space,company:'other'},{...space,kind:'conversation'},{...space,title:'Changed'}])assert.throws(()=>protectOperationFields(key,before,{...before,spaces:[changed]}),{code:'operation_required'});
 assert.throws(()=>protectOperationFields(key,{}, {spaces:[space],notes:{}}),{code:'operation_required'});
 const restored=protectOperationFields(key,before,{spaces:[],notes:{},read:[]});assert.deepEqual(restored.spaces,[space]);assert.deepEqual(restored.notes,before.notes);assert.deepEqual(restored.read,[]);
});
test('protected note IDs cannot move to conversation notes or messages and ordinary Inbox writes also require commands',()=>{
 const chat={id:'chat',company:'santa-clara',kind:'group',messages:[]};
 for(const incoming of [{spaces:[space,chat],notes:{...before.notes,chat:[note]}},{spaces:[space,{...chat,messages:[note]}],notes:before.notes}])assert.throws(()=>protectOperationFields(key,before,incoming),{code:'operation_required'});
 const ordinary={spaces:[space,chat],notes:{...before.notes,chat:[{id:'annotation',text:'Nota da conversa'}]},pinned:['chat']};assert.throws(()=>protectOperationFields(key,before,ordinary),{code:'operation_required'});
 const seed=threads.find(thread=>thread.kind==='notes');assert.ok(seed);assert.throws(()=>protectOperationFields(key,{}, {notes:{[seed.id]:[note]}}),{code:'operation_required'});
});
test('legacy Inbox annotations require commands and omitted fields preserve all data',async()=>{
 const f=sqliteD1();const chat={id:'chat',company:'santa-clara',kind:'group',messages:[]};const saved={...before,spaces:[space,chat]};
 for(const [k,value] of [['ontology.workspace.v3',{extraMembers:[{id:'admin',email:'admin@example.com',access:'admin'}]}],[key,saved]])f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(k,JSON.stringify(value));
 await assert.rejects(saveLegacyState(f.db,'default','admin@example.com',key,{...saved,notes:{[space.id]:[{...note,from:'Forged'}]}},1),{code:'operation_required'});
 assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);
 await assert.rejects(saveLegacyState(f.db,'default','admin@example.com',key,{...saved,notes:{chat:[{id:'annotation',text:'Conversational note'}]},read:['chat']},1),{code:'operation_required'});
 await saveLegacyState(f.db,'default','admin@example.com',key,{},1);
 const after=JSON.parse(f.sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body);assert.deepEqual(after,saved);assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);f.sql.close();
});

test('all Inbox flags, conversation messages and notes require commands without losing old omission repairs',()=>{
 const chat={id:'chat',company:'santa-clara',kind:'group',messages:[{id:'imported',text:'Original'}]};
 const saved={...before,spaces:[chat,space],notes:{...before.notes,chat:[{id:'annotation',text:'Original'}]},read:['chat'],unread:[],pinned:['chat']};
 for(const patch of [{spaces:[]},{spaces:[{...chat,messages:[]} ,space]},{notes:{}},{notes:{...saved.notes,chat:[]}},{read:[]},{unread:['chat']},{pinned:[]},{spaces:null},{notes:null},{read:null},{unread:null},{pinned:null}])assert.throws(()=>protectOperationFields(key,saved,{...saved,...patch}),{code:'operation_required'});
 assert.deepEqual(protectOperationFields(key,saved,{}),saved);
 assert.deepEqual(protectOperationFields(key,saved,{futureMetadata:'untouched'}),{...saved,futureMetadata:'untouched'});
 for(const field of ['spaces','notes','read','unread','pinned'])assert.throws(()=>protectOperationFields(key,{}, {[field]:field==='notes'?{chat:[note]}:field==='spaces'?[chat]:['chat']}),{code:'operation_required'});
});
