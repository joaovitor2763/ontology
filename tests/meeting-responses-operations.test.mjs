import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { executeMeetingResponsesCommand } from '../src/server/operations/meeting-responses.ts';
import { seal } from '../src/server/google.ts';
const person={id:'admin',email:'admin@example.test',access:'admin'};
const meeting={id:'meeting',company:'alpha',title:'Reunião',startsAt:'2026-10-01T12:00:00-03:00',durationMin:45,attendeeIds:[],guests:[],summary:'Resumo original',notes:'Nota original',actions:[],decisions:[],organizerEmail:person.email,google:{eventId:'event',calendarId:'primary',organizer:person.email,etag:'old-etag',meetLink:'https://meet.google.com/abc-defg-hij',recordingUrl:'https://example.test/recording'}};
async function fixture(override={}){
 const f=sqliteD1(),env={DB:f.db,GOOGLE_ENABLED:'true',GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:crypto.randomUUID(),GOOGLE_TOKEN_KEY:crypto.randomUUID()};
 const put=(key,value)=>f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?) ON CONFLICT(workspace_id,key) DO UPDATE SET version=version+1,body=excluded.body").run(key,JSON.stringify(value));
 put('ontology.workspace.v3',{extraMembers:[person,{id:'other',email:'other@example.test',access:'admin'}]});put('ontology.engagement.v2',{extraMeetings:[{...structuredClone(meeting),...override}]});
 f.sql.prepare("INSERT INTO google_connections(workspace_id,user_email,account_email,scopes,refresh_token_enc,status,created_at,updated_at) VALUES('default',?,?,?,?,'connected','now','now')").run(person.email,person.email,'calendar',await seal(env.GOOGLE_TOKEN_KEY,crypto.randomUUID()));
 const principal={id:'member:admin',kind:'session',email:person.email,memberId:'admin',access:'admin',application:'web',scopes:null,companies:null,guards:[]};
 return{...f,put,env,principal,run:(key=crypto.randomUUID(),actor=principal,versions={})=>executeMeetingResponsesCommand(env,actor,{meetingId:'meeting'},key,versions),read:()=>JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.engagement.v2'").get().body),count:table=>f.sql.prepare(`SELECT count(*) n FROM ${table}`).get().n};
}
function google(t,load=()=>({status:'confirmed',etag:'external-new',hangoutLink:'https://meet.google.com/other',attendees:[{email:'GUEST@example.test',responseStatus:'accepted'}]})){
 let requests=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{if(String(url).includes('oauth2.googleapis'))return Response.json({access_token:crypto.randomUUID()});assert.equal(init?.method,undefined,'RSVP is read-only');assert.match(String(url),/calendar\/v3\/calendars\/primary\/events\/event$/);requests++;return Response.json(await load());});
 return()=>requests;
}
test('sync merges only RSVP fields after concurrent edits; cache timestamp and receipt prevent repeat writes',async t=>{
 const f=await fixture();try{
 const calls=google(t,()=>{const current=f.read();current.extraMeetings[0].notes='Editada durante Google';current.extraMeetings[0].actions=[{id:'action',text:'Preservada',ownerId:'admin',dueAt:'2026-10-02'}];f.put('ontology.engagement.v2',current);return{status:'cancelled',etag:'external-new',attendees:[{email:'GUEST@example.test',responseStatus:'declined'}]};});
 const saved=await f.run('first',f.principal,{'ontology.engagement.v2':1});assert.equal(saved.data.meeting.notes,'Editada durante Google');assert.equal(saved.data.meeting.actions[0].text,'Preservada');assert.equal(saved.data.meeting.google.etag,'old-etag');assert.equal(saved.data.meeting.google.meetLink,meeting.google.meetLink);assert.equal(saved.data.meeting.google.recordingUrl,meeting.google.recordingUrl);assert.equal(saved.data.meeting.cancelledAt,undefined);assert.equal(saved.data.meeting.google.cancelled,true);assert.equal(saved.data.meeting.google.responses['guest@example.test'],'declined');assert.equal(saved.data.changed,true);
 assert.deepEqual(await f.run('first'),JSON.parse(JSON.stringify(saved)));const second=await f.run('second');assert.equal(second.data.changed,false);assert.equal(second.data.cached,true);assert.equal(second.data.meeting.google.responsesAt,saved.data.meeting.google.responsesAt);assert.equal(calls(),1);assert.equal(f.count('operation_events'),1);assert.equal(f.count('operation_receipts'),2);
 }finally{f.sql.close();}
});
test('organizer, delegation and current role apply before network/cache and on receipt replay',async t=>{
 const f=await fixture();try{
 const calls=google(t);await assert.rejects(f.run('system',{...f.principal,kind:'integration'}),{code:'organizer_delegation_required'});await assert.rejects(f.run('other',{...f.principal,id:'member:other',memberId:'other',email:'other@example.test'}),{code:'organizer_required'});assert.equal(calls(),0);
 await f.run('good');f.put('ontology.workspace.v3',{extraMembers:[{...person,access:'leitor'}]});await assert.rejects(f.run('good'),{code:'permission_denied'});await assert.rejects(f.run('new'),{code:'permission_denied'});assert.equal(calls(),1);
 }finally{f.sql.close();}
});
test('missing event, cancellation, pending journal and wrong connected account make no external request',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Unexpected network');});
 for(const override of [{google:{}},{cancelledAt:'now'},{schedulingStatus:'pending'}]){const f=await fixture(override);try{await assert.rejects(f.run());assert.equal(f.count('operation_receipts'),0);}finally{f.sql.close();}}
 const f=await fixture();try{f.sql.prepare('UPDATE google_connections SET account_email=?').run('wrong@example.test');await assert.rejects(f.run(),{code:'google_account_mismatch'});f.sql.prepare('UPDATE google_connections SET account_email=?').run(person.email);f.sql.prepare("INSERT INTO meeting_operations(id,workspace_id,principal_id,meeting_id,company,command,desired,pending_meeting,calendar_input,status,created_at,updated_at) VALUES('pending','default','member:admin','meeting','alpha','meetings.update','{}','{}','{}','uncertain','now','now')").run();await assert.rejects(f.run(),{code:'meeting_operation_pending'});}finally{f.sql.close();}assert.equal(calls,0);
});
test('identity and permissions changed while Google responds are rejected without receipt or write',async t=>{
 for(const kind of ['event','role']){
 const f=await fixture();try{
 google(t,()=>{if(kind==='event'){const state=f.read();state.extraMeetings[0].google.eventId='replacement';f.put('ontology.engagement.v2',state);}else f.put('ontology.workspace.v3',{extraMembers:[{...person,access:'leitor'}]});return{attendees:[]};});
 await assert.rejects(f.run(),{code:kind==='event'?'meeting_changed':'permission_denied'});assert.equal(f.read().extraMeetings[0].google.responsesAt,undefined);assert.equal(f.count('operation_receipts'),0);assert.equal(f.count('operation_events'),0);
 }finally{f.sql.close();t.mock.restoreAll();}
 }
});
test('durable lease coalesces parallel refreshes and failed fetch cooldown does not claim success',async t=>{
 const f=await fixture();try{
 let release,entered;const pending=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});const calls=google(t,async()=>{entered();await pending;return{attendees:[]};});
 const first=f.run('first');await started;await assert.rejects(f.run('parallel'),{code:'responses_sync_busy'});release();await first;assert.equal(calls(),1);assert.equal(f.count('operation_receipts'),1);
 }finally{f.sql.close();t.mock.restoreAll();}
 const failed=await fixture();try{const calls=google(t,()=>{throw Error('fixture network failure');});await assert.rejects(failed.run('failure'),{code:'google_unavailable'});await assert.rejects(failed.run('retry'),{code:'responses_sync_busy'});assert.equal(calls(),1);assert.equal(failed.count('operation_receipts'),0);assert.equal(failed.read().extraMeetings[0].google.responsesAt,undefined);}finally{failed.sql.close();}
});
test('an older cached collection never replaces newer stored RSVP or emits an event',async t=>{
 const f=await fixture();try{
 const calls=google(t);const first=await f.run('first');
 const state=f.read(),newer=new Date(Date.parse(first.data.fetchedAt)+10000).toISOString();state.extraMeetings[0].google.responsesAt=newer;state.extraMeetings[0].google.responses={'guest@example.test':'tentative'};f.put('ontology.engagement.v2',state);
 const before=f.read(),second=await f.run('second');assert.equal(second.data.changed,false);assert.equal(second.data.meeting.google.responsesAt,newer);assert.equal(second.data.meeting.google.responses['guest@example.test'],'tentative');assert.deepEqual(f.read(),before);assert.equal(f.count('operation_events'),1);assert.equal(calls(),1);
 }finally{f.sql.close();}
});

test('a completed reschedule invalidates the in-flight collection and cache via local etag',async t=>{
 const f=await fixture();try{
  let changed=false;const calls=google(t,()=>{if(!changed){changed=true;const state=f.read();state.extraMeetings[0].google.etag='rescheduled-etag';state.extraMeetings[0].startsAt='2026-11-01T12:00:00-03:00';f.put('ontology.engagement.v2',state);}return{etag:'upstream-etag-never-adopted',attendees:[{email:'guest@example.test',responseStatus:'accepted'}]};});
  await assert.rejects(f.run('rescheduled'),{code:'meeting_changed'});assert.equal(f.read().extraMeetings[0].google.responsesAt,undefined);assert.equal(f.count('operation_receipts'),0);
  const fresh=await f.run('fresh');assert.equal(calls(),2);assert.equal(fresh.data.meeting.google.etag,'rescheduled-etag');assert.equal(fresh.data.meeting.google.responses['guest@example.test'],'accepted');
 }finally{f.sql.close();}
});
