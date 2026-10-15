import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { executeMeetingArtifactsCommand } from '../src/server/operations/meeting-artifacts.ts';
import { seal } from '../src/server/google.ts';
const person={id:'admin',email:'admin@example.test',access:'admin'};
const meeting={id:'meeting',company:'alpha',title:'Reunião fixture',startsAt:new Date(Date.now()-3600000).toISOString(),durationMin:30,attendeeIds:[],guests:[],summary:'Resumo',notes:'Originais',actions:[],decisions:[],organizerEmail:person.email,google:{eventId:'event',calendarId:'primary',organizer:person.email,etag:'old-etag',meetLink:'https://meet.google.com/abc-defg-hij',responses:{'guest@example.test':'accepted'},responsesAt:'2026-01-01T00:00:00Z'}};
function fakeR2(){const objects=new Map();return{objects,async get(key){const bytes=objects.get(key);if(!bytes)return null;return{text:async()=>new TextDecoder().decode(bytes),json:async()=>JSON.parse(new TextDecoder().decode(bytes)),arrayBuffer:async()=>bytes.slice().buffer};},async put(key,value,options){if(options?.onlyIf?.etagDoesNotMatch==='*'&&objects.has(key))return null;const bytes=typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value);objects.set(key,bytes.slice());return{key,etag:'fixture',size:bytes.length};}};}
async function fixture(override={}){const f=sqliteD1(),bucket=fakeR2(),env={DB:f.db,FILES:bucket,GOOGLE_ENABLED:'true',GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:crypto.randomUUID(),GOOGLE_TOKEN_KEY:crypto.randomUUID()};
 const put=(key,value)=>f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?) ON CONFLICT(workspace_id,key) DO UPDATE SET version=version+1,body=excluded.body").run(key,JSON.stringify(value));
 put('ontology.workspace.v3',{extraMembers:[person,{id:'other',email:'other@example.test',access:'admin'}]});put('ontology.clients.v3',{extraClients:[{slug:'alpha',name:'Alpha'}]});put('ontology.engagement.v2',{extraMeetings:[{...structuredClone(meeting),...override}]});
 f.sql.prepare("INSERT INTO google_connections(workspace_id,user_email,account_email,scopes,refresh_token_enc,status,created_at,updated_at) VALUES('default',?,?,?,?,'connected','now','now')").run(person.email,person.email,'calendar',await seal(env.GOOGLE_TOKEN_KEY,crypto.randomUUID()));
 const principal={id:'member:admin',kind:'session',email:person.email,memberId:'admin',access:'admin',application:'web',scopes:null,companies:null,guards:[]};
 return{...f,bucket,env,put,principal,run:(key=crypto.randomUUID(),actor=principal,versions={})=>executeMeetingArtifactsCommand(env,actor,{meetingId:'meeting'},key,versions),read:(key='ontology.engagement.v2')=>{const row=f.sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key);return row?JSON.parse(row.body):undefined;},count:table=>f.sql.prepare(`SELECT count(*) n FROM ${table}`).get().n};
}
function google(t,options={}){let calls=0; t.mock.method(globalThis,'fetch',async(url,init)=>{
 const path=String(url);if(path.includes('oauth2.googleapis'))return Response.json({access_token:crypto.randomUUID()});assert.equal(init?.method,undefined,'Google artifacts only read');calls++;
 if(path.includes('/conferenceRecords?')){options.onRead?.();return Response.json({conferenceRecords:options.missing?[]:[{name:'conferenceRecords/r',startTime:meeting.startsAt,...(options.pending?{}:{endTime:new Date().toISOString()})}]});}
 if(new URL(path).pathname.endsWith('/recordings'))return Response.json({recordings:options.recording===false?[]:[{name:'rec',state:'FILE_GENERATED',driveDestination:{exportUri:'https://drive.google.com/recording'}}]});
 if(new URL(path).pathname.endsWith('/transcripts'))return Response.json({transcripts:[{name:'conferenceRecords/r/transcripts/t',state:options.processing?'STARTED':'FILE_GENERATED',docsDestination:{exportUri:'https://docs.google.com/transcript'}}]});
 if(new URL(path).pathname.endsWith('/participants'))return Response.json({participants:[{name:'speaker',signedinUser:{displayName:'Pessoa fixture'}}]});
 if(path.includes('/entries'))return Response.json({transcriptEntries:[{participant:'speaker',text:options.text?.()??'Texto integral',startTime:meeting.startsAt}],...(options.truncated?{nextPageToken:'next'}:{})});
 throw Error(`Unexpected fixture path ${path}`);
 });return()=>calls;}
test('imports immutable text and atomically links/version documents; preserves concurrent notes and RSVP',async t=>{
 const f=await fixture();try{let text='Versão inicial';const calls=google(t,{text:()=>text});const put=f.bucket.put;let edited=false;f.bucket.put=async(...args)=>{const result=await put(...args);if(args[0].includes('/meet-transcripts/')&&!edited){edited=true;const state=f.read();state.extraMeetings[0].notes='Editadas durante R2';state.extraMeetings[0].google.responses={'guest@example.test':'declined'};f.put('ontology.engagement.v2',state);}return result;};
 const first=await f.run('first',f.principal,{'ontology.engagement.v2':1});const id=first.data.meeting.google.transcriptDocId;assert.match(id,/^up-/);assert.match(first.data.note,/Sessão de /);assert.equal(first.data.meeting.notes,'Editadas durante R2');assert.equal(first.data.meeting.google.responses['guest@example.test'],'declined');assert.equal(first.data.meeting.google.etag,'old-etag');assert.equal(first.data.meeting.google.artifactStatus,'ready');
 const doc=f.read('ontology.documents.v3').extraDocs[0];assert.equal(doc.id,id);assert.equal(doc.version,1);assert.equal(doc.uploadedBy,'admin');const file=f.sql.prepare('SELECT * FROM files').get();assert.equal(file.status,'ready');assert.equal(file.company,'alpha');assert.match(await (await f.bucket.get(file.r2_key)).text(),/Versão inicial/);
 const readCount=calls();assert.deepEqual(await f.run('first'),JSON.parse(JSON.stringify(first)));const cached=await f.run('cached');assert.equal(cached.data.changed,false);assert.equal(cached.documents[0].updatedAt,f.sql.prepare("SELECT updated_at FROM state_documents WHERE key='ontology.engagement.v2'").get().updated_at);assert.equal(f.count('files'),1);assert.equal(f.read('ontology.documents.v3').extraDocs.length,1);assert.equal(calls(),readCount);
 const documents=f.read('ontology.documents.v3');documents.docEdits[id]={kind:'evidencia',relatedThreadId:'thread',relatedTaskId:'task',visibility:'cliente'};f.put('ontology.documents.v3',documents);text='Versão corrigida';f.sql.exec('DELETE FROM integration_cache');await f.run('new-version');const versions=f.read('ontology.documents.v3').extraDocs;assert.equal(versions.length,2);assert.equal(versions[0].version,2);assert.equal(versions[0].supersedesId,id);assert.equal(versions[0].kind,'evidencia');assert.equal(versions[0].relatedThreadId,'thread');assert.equal(versions[0].relatedTaskId,'task');assert.equal(versions[0].visibility,'cliente');assert.equal(versions[0].relatedMeetingId,'meeting');assert.equal(f.count('files'),2);assert.match(await (await f.bucket.get(file.r2_key)).text(),/Versão inicial/);
 }finally{f.sql.close();}
});
test('R2 success plus D1 conflict leaves no visible file/link; same key recovers without Google again',async t=>{
 const f=await fixture();try{const calls=google(t);const batch=f.db.batch;let conflict=true;f.db.batch=async statements=>{if(conflict){conflict=false;f.put('ontology.workspace.v3',{extraMembers:[person]});}return batch(statements);};
 await assert.rejects(f.run('recover'),{code:'version_conflict'});assert.equal(f.count('files'),0);assert.equal(f.read('ontology.documents.v3'),undefined);assert.equal(f.read().extraMeetings[0].google.transcriptDocId,undefined);assert.equal(f.count('operation_receipts'),0);assert.ok(f.bucket.objects.size>=2);
 const count=calls();f.sql.exec('DELETE FROM integration_cache');const saved=await f.run('recover');assert.ok(saved.data.meeting.google.transcriptDocId);assert.equal(calls(),count);assert.equal(f.count('files'),1);assert.equal(f.count('operation_receipts'),1);
 }finally{f.sql.close();}
});
test('an uncertain transcript upload resumes from its private envelope, without publishing partial data',async t=>{
 const f=await fixture();try{const calls=google(t),put=f.bucket.put;let fail=true;f.bucket.put=async(...args)=>{const result=await put(...args);if(fail&&args[0].includes('/meet-transcripts/')){fail=false;throw Error('lost R2 acknowledgement');}return result;};
 await assert.rejects(f.run('recover'),{code:'transcript_pending'});assert.equal(f.count('files'),0);assert.equal(f.read().extraMeetings[0].google.transcriptDocId,undefined);const count=calls();await f.run('recover');assert.equal(calls(),count);assert.equal(f.count('files'),1);
 }finally{f.sql.close();}
});
test('incomplete/not-found material retains seven-day semantics without a partial transcript',async t=>{
 for(const [options,override,status] of [[{missing:true},{},'pending'],[{missing:true},{startsAt:new Date(Date.now()-9*86400000).toISOString()},'not_generated'],[{pending:true},{},'pending'],[{processing:true,recording:false},{},'pending']]){
 const f=await fixture(override);try{google(t,options);const result=await f.run();assert.equal(result.data.meeting.google.artifactStatus,status);assert.equal(f.count('files'),0);assert.equal(f.read('ontology.documents.v3'),undefined);}finally{f.sql.close();t.mock.restoreAll();}
 }
});
test('truncated transcript refuses the entire import and never exposes files/documents',async t=>{
 const f=await fixture();try{google(t,{truncated:true});await assert.rejects(f.run(),/extens|págin|integral|limite/i);assert.equal(f.count('files'),0);assert.equal(f.count('operation_receipts'),0);assert.equal(f.read('ontology.documents.v3'),undefined);}finally{f.sql.close();}
});
test('auth revalidation and source identity changes reject cached/resumed work without publication',async t=>{
 const f=await fixture();try{const calls=google(t);await assert.rejects(f.run('service',{...f.principal,kind:'integration'}),{code:'organizer_delegation_required'});await assert.rejects(f.run('other',{...f.principal,id:'member:other',memberId:'other',email:'other@example.test'}),{code:'organizer_required'});assert.equal(calls(),0);await f.run('done');f.put('ontology.workspace.v3',{extraMembers:[{...person,access:'leitor'}]});await assert.rejects(f.run('done'),{code:'permission_denied'});}finally{f.sql.close();t.mock.restoreAll();}
 const changed=await fixture();try{google(t,{onRead:()=>{const state=changed.read();state.extraMeetings[0].google.etag='rescheduled';changed.put('ontology.engagement.v2',state);}});await assert.rejects(changed.run(),{code:'meeting_changed'});assert.equal(changed.count('files'),0);assert.equal(changed.count('operation_receipts'),0);}finally{changed.sql.close();}
});
