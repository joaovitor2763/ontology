import test from "node:test";
import assert from "node:assert/strict";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { saveLegacyState } from "../src/server/operations/legacy-authorization.ts";
import { CLIENTS_INITIAL } from "../src/modules/clients/infrastructure/snapshot.ts";
import { DELIVERY_INITIAL, projectDelivery } from "../src/modules/delivery/infrastructure/snapshot.ts";
import { ENGAGEMENT_INITIAL } from "../src/modules/engagement/infrastructure/snapshot.ts";
import { STAKEHOLDERS_INITIAL } from "../src/modules/clients/infrastructure/stakeholders-snapshot.ts";
import { meetings } from "../src/modules/engagement/infrastructure/seed.ts";
const master = "master@example.com";
function setup() {
  const f = sqliteD1();
  const roster = { extraMembers: [{ id: "admin", email: "admin@example.com", access: "admin" }, { id: "master", email: master, access: "ai_master" }, { id: "manager", email: "manager@example.com", access: "gestor" }, { id: "reader", email: "reader@example.com", access: "leitor" }] };
  const clients = { ...CLIENTS_INITIAL, allocationsMigrated: true, allocations: [{ id: "a", company: "santa-clara", memberId: "master", role: "consultor", percent: 50 }] };
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)").run(JSON.stringify(roster));
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,?)").run(JSON.stringify(clients));
  return { ...f, roster, clients };
}
test("legacy client writes require commands even for an allocated member or administrator", async () => {
  const {db,sql,clients}=setup();
  for(const email of [master,'admin@example.com'])for(const patch of [{clientEdits:{'santa-clara':{name:'Changed'}}},{clientEdits:{'banco-litoral':{leadId:'master'}}},{extraClients:[{slug:'new-client',name:'New'}]},{configs:{'santa-clara':{name:'Changed'}}}]) {
    await assert.rejects(saveLegacyState(db,'default',email,'ontology.clients.v3',{...clients,...patch},1),{code:'operation_required'});
  }
  assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);
  assert.equal(sql.prepare("SELECT version FROM state_documents WHERE key='ontology.clients.v3'").get().version,1);
  sql.close();
});
test("legacy execution snapshots cannot change a seeded task even for admin", async () => {
  const {db,sql}=setup(),task=projectDelivery(DELIVERY_INITIAL).tasks.find(t=>t.company==='santa-clara');
  for(const email of [master,'admin@example.com'])for(const patch of [{taskPatches:{[task.id]:{title:'Changed'}}},{statusMap:{[task.id]:'entregue'}},{extraTasks:[{id:'forged',company:'santa-clara'}]}]) {
    await assert.rejects(saveLegacyState(db,'default',email,'ontology.delivery.v2',{...DELIVERY_INITIAL,...patch},0),{code:'operation_required'});
  }
  assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);
  assert.equal(sql.prepare("SELECT count(*) n FROM state_documents WHERE key='ontology.delivery.v2'").get().n,0);
  sql.close();
});
test("stakeholder changes require the client's scope; meetings and knowledge require commands", async () => {
  const { db, sql } = setup();
  const contacts = structuredClone(STAKEHOLDERS_INITIAL);
  const contact = contacts.contacts.find(c => c.company === "banco-litoral");
  contact.name = "Changed";
  await assert.rejects(saveLegacyState(db, "default", master, "ontology.stakeholders.v1", contacts, 0), { code: "operation_required" });
  const meeting = meetings.find(m => m.company === "banco-litoral");
  await assert.rejects(saveLegacyState(db, "default", master, "ontology.engagement.v2", { ...ENGAGEMENT_INITIAL, meetingEdits: { [meeting.id]: { ...meeting, title: "Changed" } } }, 0), { code: "operation_required" });

  await assert.rejects(saveLegacyState(db, 'default', master, 'ontology.knowledge.v2', { ontologyDrafts: { 'banco-litoral': { title: 'Denied' } } }, 0), { code: 'operation_required' });
  const allowedContacts = structuredClone(STAKEHOLDERS_INITIAL);
  allowedContacts.contacts.find(c => c.company === 'santa-clara').name = 'Allowed';
  await assert.rejects(saveLegacyState(db, 'default', master, 'ontology.stakeholders.v1', allowedContacts, 0),{code:'operation_required'});
  assert.equal(sql.prepare("SELECT count(*) n FROM operation_events").get().n, 0);
  sql.close();
});
test("workspace alert rules are admin-only; readers, unknown fields and unknown entity references fail closed", async () => {
  const { db, sql, roster, clients } = setup();
  await assert.rejects(saveLegacyState(db, "default", "manager@example.com", "ontology.workspace.v3", { ...roster, alertRules: { x: 1 } }, 1), { code: "operation_required" });
  await assert.rejects(saveLegacyState(db, "default", "reader@example.com", "ontology.clients.v3", clients, 1), { code: "permission_denied" });
  await assert.rejects(saveLegacyState(db, "default", "admin@example.com", "ontology.clients.v3", { ...clients, futurePolicy: {} }, 1), { code: "invalid_snapshot" });
  await assert.rejects(saveLegacyState(db, "default", "admin@example.com", "ontology.delivery.v2", { ...DELIVERY_INITIAL, statusMap: { missing: "entregue" } }, 0), { code: "operation_required" });
  sql.close();
});
test("a concurrent permission change aborts the legacy document, history and events together", async () => {
  const { db, sql, roster } = setup();
  const originalBatch = db.batch;
  db.batch = async statements => {
    roster.deactivatedIds = ["admin"];
    sql.prepare("UPDATE state_documents SET body=?,version=2 WHERE key='ontology.workspace.v3'").run(JSON.stringify(roster));
    return originalBatch(statements);
  };
  await assert.rejects(saveLegacyState(db, "default", "admin@example.com", "ontology.workspace.v3", { ...roster, currentUserId:"admin" }, 1), { code: "version_conflict" });
  assert.equal(sql.prepare("SELECT count(*) n FROM operation_events").get().n, 0);
  assert.equal(sql.prepare("SELECT version FROM state_documents WHERE key='ontology.clients.v3'").get().version, 1);
  sql.close();
});
test('legacy meetings preserve omitted action links and reject creation, replacement, removal and duplicate actions',async()=>{
 const {db,sql}=setup();const key='ontology.engagement.v2';
 const meeting={id:'fixture-meeting',company:'santa-clara',title:'Reunião',startsAt:'2026-09-17T12:00:00Z',actions:[{text:'Fazer',ownerId:'master',dueAt:'2026-09-20',deliveryId:'linked-task'}]};
 const state={...ENGAGEMENT_INITIAL,extraMeetings:[meeting]};sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(key,JSON.stringify(state));
 for(const actions of [[{...meeting.actions[0],deliveryId:'other'}],[{...meeting.actions[0],deliveryId:null}],[],[...meeting.actions,{id:'fake',text:'Fake',deliveryId:'linked-task'}],[{...meeting.actions[0],id:'same'},{...meeting.actions[0],id:'same'}]]){
  await assert.rejects(saveLegacyState(db,'default','admin@example.com',key,{...state,extraMeetings:[{...meeting,actions}]},1),{code:'operation_required'});
 }
 await assert.rejects(saveLegacyState(db,'default','admin@example.com',key,{...state,removedMeetings:[meeting.id]},1),{code:'operation_required'});
 const {deliveryId,...action}=meeting.actions[0];assert.equal(deliveryId,'linked-task');
 await saveLegacyState(db,'default','admin@example.com',key,{...state,extraTemplates:[{id:'template',title:'Allowed'}],extraMeetings:[{...meeting,actions:[action]}]},1);
 const after=JSON.parse(sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body);assert.equal(after.extraMeetings[0].actions[0].deliveryId,'linked-task');assert.equal(after.extraMeetings[0].actions[0].id,undefined);assert.equal(after.extraMeetings[0].actions[0].done,undefined);
 assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n,1);sql.close();
});
test('seed action links cannot be forged while normal capture actions remain editable',async()=>{
 const {db,sql}=setup();const meeting=meetings.find(m=>m.company==='santa-clara');
 const fake={...meeting,actions:[{id:'forged',text:'Fake',deliveryId:'foreign-task'}]};
 await assert.rejects(saveLegacyState(db,'default',master,'ontology.engagement.v2',{...ENGAGEMENT_INITIAL,meetingEdits:{[meeting.id]:fake}},0),{code:'operation_required'});
 const fresh={...meeting,id:'capture',actions:[{id:'decision-a',text:'Próximo passo',ownerId:'master',dueAt:'2026-09-20'}]};
 await assert.rejects(saveLegacyState(db,'default',master,'ontology.engagement.v2',{...ENGAGEMENT_INITIAL,extraMeetings:[fresh]},0),{code:'operation_required'});assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);sql.close();
});
test('non-seed meeting edits cannot mask an altered extra meeting action link',async()=>{
 const {db,sql}=setup(),key='ontology.engagement.v2';
 const meeting={id:'nonseed',company:'santa-clara',title:'Reunião',startsAt:'2026-09-17T12:00:00Z',actions:[{id:'action',text:'Fazer',deliveryId:'original'}]};
 const before={...ENGAGEMENT_INITIAL,extraMeetings:[meeting]};
 sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(key,JSON.stringify(before));
 // Read model ignores this edit: the forged link in the extra remains visible.
 const forged={...meeting,actions:[{...meeting.actions[0],deliveryId:'forged'}]};
 await assert.rejects(saveLegacyState(db,'default','admin@example.com',key,{...before,extraMeetings:[forged],meetingEdits:{nonseed:meeting}},1),{code:'operation_required'});
 const unlinked={...meeting,actions:[{id:'new',text:'New'}]};
 await assert.rejects(saveLegacyState(db,'default','admin@example.com',key,{...before,extraMeetings:[unlinked],meetingEdits:{nonseed:meeting}},1),{code:'operation_required'});
 assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);assert.equal(sql.prepare('SELECT version FROM state_documents WHERE key=?').get(key).version,1);sql.close();
});
test('idless linked actions reject positional identity changes but explicit IDs support reorder',async()=>{
 const {db,sql}=setup(),key='ontology.engagement.v2';
 const first={text:'Primeira',ownerId:'master',dueAt:'2026-09-20',deliveryId:'linked-task'},second={text:'Segunda',ownerId:'master',dueAt:'2026-09-21'};
 const meeting={id:'positional',company:'santa-clara',title:'Reunião',startsAt:'2026-09-17T12:00:00Z',actions:[first,second]};
 const before={...ENGAGEMENT_INITIAL,extraMeetings:[meeting]};
 sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(key,JSON.stringify(before));
 const {deliveryId,...withoutLink}=first;assert.equal(deliveryId,'linked-task');
 for(const actions of [[second,withoutLink],[{text:'Inserida',ownerId:'master',dueAt:'2026-09-19'},withoutLink,second],[{...withoutLink,text:'Outra ação'},second],[{...withoutLink,ownerId:'admin'},second],[{...withoutLink,dueAt:'2026-09-22'},second]]) {
  await assert.rejects(saveLegacyState(db,'default','admin@example.com',key,{...before,extraMeetings:[{...meeting,actions}]},1),{code:'operation_required'});
 }
 const omitted={...meeting,actions:[withoutLink,second]};
 await saveLegacyState(db,'default','admin@example.com',key,{...before,extraMeetings:[omitted]},1);
 const saved=JSON.parse(sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body);
 assert.equal(saved.extraMeetings[0].actions[0].deliveryId,'linked-task');assert.equal(saved.extraMeetings[0].actions[0].id,undefined);
 const reordered={...omitted,actions:[{...second,id:'positional-a2'},{...withoutLink,id:'positional-a1'}]};
 await assert.rejects(saveLegacyState(db,'default','admin@example.com',key,{...saved,extraMeetings:[reordered]},2),{code:'operation_required'});sql.close();
});
test('legacy RSVP fields reject forged or stale values while omission preserves replies and artifacts',async()=>{
 const {db,sql}=setup(),key='ontology.engagement.v2';
 const meeting={id:'rsvp',company:'santa-clara',title:'Reunião',startsAt:'2026-09-17T12:00:00Z',actions:[],google:{eventId:'event',responses:{'guest@example.com':'accepted'},responsesAt:'2026-09-17T12:00:00Z',recordingUrl:'https://drive.google.com/test',transcriptUrl:'https://docs.google.com/document/d/test'}};
 const before={...ENGAGEMENT_INITIAL,extraMeetings:[meeting]};
 sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(key,JSON.stringify(before));
 for(const patch of [{responses:{}},{responses:{'guest@example.com':'declined'}},{responsesAt:'2026-09-16T00:00:00Z'},{responses:null}]) {
  await assert.rejects(saveLegacyState(db,'default','admin@example.com',key,{...before,extraMeetings:[{...meeting,google:{...meeting.google,...patch,transcriptUrl:'https://docs.google.com/document/d/test'}}]},1),{code:'operation_required'});
 }
 const unchanged={...meeting,google:{eventId:'event',recordingUrl:'https://drive.google.com/test',transcriptUrl:'https://docs.google.com/document/d/test'}};
 await saveLegacyState(db,'default','admin@example.com',key,{...before,extraTemplates:[{id:'template',title:'Allowed'}],extraMeetings:[unchanged]},1);
 const after=JSON.parse(sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body).extraMeetings[0];
 assert.deepEqual(after.google.responses,meeting.google.responses);assert.equal(after.google.responsesAt,meeting.google.responsesAt);assert.equal(after.google.transcriptUrl,unchanged.google.transcriptUrl);assert.equal(after.google.recordingUrl,unchanged.google.recordingUrl);
 assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n,1);sql.close();
});
test('legacy new meeting cannot invent RSVP state even without Google scheduling markers',async()=>{
 const {db,sql}=setup();
 await assert.rejects(saveLegacyState(db,'default',master,'ontology.engagement.v2',{...ENGAGEMENT_INITIAL,extraMeetings:[{id:'fake-replies',company:'santa-clara',title:'Fake',actions:[],google:{responses:{x:'accepted'},responsesAt:'now'}}]},0),{code:'operation_required'});
 assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);sql.close();
});
test('legacy snapshots cannot forge artifact metadata and omitted fields preserve authoritative links',async()=>{
 const {db,sql}=setup(),key='ontology.engagement.v2';
 const fields={recordingUrl:'https://drive.google.com/recording',transcriptUrl:'https://docs.google.com/document/d/transcript',transcriptDocId:'doc-authoritative',artifactStatus:'ready',lastArtifactCheckAt:'2026-09-17T12:00:00Z',syncedAt:'2026-09-17T12:00:00Z'};
 const meeting={id:'artifacts',company:'santa-clara',title:'Reunião',startsAt:'2026-09-17T12:00:00Z',actions:[],google:{eventId:'event',...fields}};
 const before={...ENGAGEMENT_INITIAL,extraMeetings:[meeting]};
 sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(key,JSON.stringify(before));
 for(const field of Object.keys(fields)) for(const value of ['forged',null]) {
  await assert.rejects(saveLegacyState(db,'default','admin@example.com',key,{...before,extraMeetings:[{...meeting,google:{...meeting.google,[field]:value}}]},1),{code:'operation_required'});
 }
 const incoming={...meeting,google:{eventId:'event'}};
 await saveLegacyState(db,'default','admin@example.com',key,{...before,extraTemplates:[{id:'template',title:'Allowed'}],extraMeetings:[incoming]},1);
 const saved=JSON.parse(sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body).extraMeetings[0];
 assert.deepEqual(saved.google,meeting.google);assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n,1);sql.close();
});
test('seed edits cannot invent artifacts and extra meeting edits do not mask authoritative artifact fields',async()=>{
 const {db,sql}=setup(),key='ontology.engagement.v2';const seed=meetings.find(m=>m.company==='santa-clara');
 await assert.rejects(saveLegacyState(db,'default','admin@example.com',key,{...ENGAGEMENT_INITIAL,meetingEdits:{[seed.id]:{...seed,google:{...(seed.google??{}),transcriptDocId:'forged'}}}},0),{code:'operation_required'});
 const meeting={id:'extra-artifact',company:'santa-clara',title:'Reunião',startsAt:'2026-09-17T12:00:00Z',actions:[],google:{eventId:'event',transcriptDocId:'original'}};
 const before={...ENGAGEMENT_INITIAL,extraMeetings:[meeting]};sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(key,JSON.stringify(before));
 await assert.rejects(saveLegacyState(db,'default','admin@example.com',key,{...before,extraMeetings:[{...meeting,google:{...meeting.google,transcriptDocId:'forged'}}],meetingEdits:{[meeting.id]:meeting}},1),{code:'operation_required'});
 assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);sql.close();
});

test('diagnosis snapshots preserve omitted command data and reject creation, correction and restoration atomically', async () => {
  const { db, sql } = setup();
  const key = 'ontology.engagement.v2';
  const state = structuredClone(ENGAGEMENT_INITIAL);
  for (const [kind, plural] of [['pain', 'Pains'], ['solution', 'Solutions'], ['hypothesis', 'Hypotheses']]) {
    const row = { id: `fixture-${kind}`, company: 'santa-clara', title: 'Original', history: [{ by: 'admin', text: 'Original' }] };
    state[`extra${plural}`] = [row];
    state[`${kind}Edits`] = { [row.id]: { ...row, title: 'Corrected' } };
    state[`removed${plural}`] = [row.id];
  }
  sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(key, JSON.stringify(state));
  const fields = ['extraPains', 'painEdits', 'removedPains', 'extraSolutions', 'solutionEdits', 'removedSolutions', 'extraHypotheses', 'hypothesisEdits', 'removedHypotheses'];
  for (const field of fields) {
    const cleared = field.endsWith('Edits') ? {} : [];
    await assert.rejects(saveLegacyState(db, 'default', 'admin@example.com', key, { ...state, [field]: cleared }, 1), { code: 'operation_required' });
    await assert.rejects(saveLegacyState(db, 'default', 'admin@example.com', key, { ...state, [field]: null }, 1), { code: 'operation_required' });
  }
  await assert.rejects(saveLegacyState(db, 'default', 'admin@example.com', key, { ...state, painEdits: { ...state.painEdits, 'fixture-pain': { ...state.painEdits['fixture-pain'], title: 'Forged', history: [] } } }, 1), { code: 'operation_required' });
  assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n, 0);
  assert.equal(sql.prepare('SELECT version FROM state_documents WHERE key=?').get(key).version, 1);
  const omitted = { ...state };
  for (const field of fields) delete omitted[field];
  await saveLegacyState(db, 'default', 'admin@example.com', key, { ...omitted, extraTemplates: [{id:'template',title:'Allowed'}] }, 1);
  const saved = JSON.parse(sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body);
  for (const field of fields) assert.deepEqual(saved[field], state[field]);
  assert.equal(saved.extraTemplates[0].id, 'template');
  assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n, 1);
  sql.close();
});

test('agenda snapshots cannot create, change or restore events and preserve omitted command records', async () => {
  const { db, sql } = setup();
  const key = 'ontology.engagement.v2';
  const row = { id: 'fixture-event', company: 'santa-clara', title: 'Original' };
  const state = { ...ENGAGEMENT_INITIAL, extraEvents: [row], eventEdits: { [row.id]: { ...row, title: 'Corrected' } }, removedEvents: [row.id] };
  sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(key, JSON.stringify(state));
  for (const patch of [{ extraEvents: [] }, { extraEvents: [...state.extraEvents, { ...row, id: 'forged' }] }, { eventEdits: {} }, { eventEdits: { [row.id]: { ...row, title: 'Forged' } } }, { removedEvents: [] }, { removedEvents: ['other'] }, { extraEvents: null }, { eventEdits: null }, { removedEvents: null }]) {
    await assert.rejects(saveLegacyState(db, 'default', 'admin@example.com', key, { ...state, ...patch }, 1), { code: 'operation_required' });
  }
  assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n, 0);
  assert.equal(sql.prepare('SELECT version FROM state_documents WHERE key=?').get(key).version, 1);
  const { extraEvents, eventEdits, removedEvents, ...omitted } = state;
  await saveLegacyState(db, 'default', 'admin@example.com', key, { ...omitted, extraTemplates: [{id:'template',title:'Allowed'}] }, 1);
  const saved = JSON.parse(sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body);
  assert.deepEqual(saved.extraEvents, extraEvents);
  assert.deepEqual(saved.eventEdits, eventEdits);
  assert.deepEqual(saved.removedEvents, removedEvents);
  assert.equal(saved.extraTemplates[0].id, 'template');
  assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n, 1);
  sql.close();
});

test('signals reject forged attribution, task links and reopening through legacy snapshots without writes', async () => {
  const { db, sql } = setup();
  const key = 'ontology.engagement.v2';
  const state = { ...ENGAGEMENT_INITIAL, signalReviews: { signal: { by: 'admin', at: '2026-09-17T12:00:00Z', deliveryId: 'task-original' } }, signalClassifications: { signal: { priority: 'alta' } } };
  sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(key, JSON.stringify(state));
  for (const patch of [{ signalReviews: {} }, { signalReviews: { signal: { ...state.signalReviews.signal, deliveryId: 'forged' } } }, { signalReviews: { signal: { ...state.signalReviews.signal, by: 'other' } } }, { signalReviews: null }, { signalClassifications: {} }, { signalClassifications: { signal: { priority: 'baixa' } } }, { signalClassifications: null }]) {
    await assert.rejects(saveLegacyState(db, 'default', 'admin@example.com', key, { ...state, ...patch }, 1), { code: 'operation_required' });
  }
  const { signalReviews, signalClassifications, ...omitted } = state;
  const template = { id: 'template', title: 'Allowed' };
  await assert.rejects(saveLegacyState(db, 'default', master, key, { ...omitted, extraTemplates: [template] }, 1), { code: 'permission_denied' });
  assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n, 0);
  assert.equal(sql.prepare('SELECT version FROM state_documents WHERE key=?').get(key).version, 1);
  await saveLegacyState(db, 'default', 'admin@example.com', key, { ...omitted, extraTemplates: [template] }, 1);
  const saved = JSON.parse(sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body);
  assert.deepEqual(saved.signalReviews, signalReviews);
  assert.deepEqual(saved.signalClassifications, signalClassifications);
  assert.deepEqual(saved.extraTemplates, [template]);
  sql.close();
});

test('legacy ontology replacement fails without writes and omitted draft preserves command data',async()=>{
 const {db,sql}=setup();const key='ontology.knowledge.v2';const value={ontologyDrafts:{'santa-clara':{extraNodes:[{id:'node',label:'Saved'}],nodePatches:{},extraEdges:[],extraDomains:[],removedNodes:[],removedEdges:[]}}};
 sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(key,JSON.stringify(value));
 await assert.rejects(saveLegacyState(db,'default','admin@example.com',key,{ontologyDrafts:{}},1),{code:'operation_required'});
 assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);
 assert.equal(sql.prepare('SELECT version FROM state_documents WHERE key=?').get(key).version,1);
 await saveLegacyState(db,'default','admin@example.com',key,{},1);
 assert.deepEqual(JSON.parse(sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body),value);
 assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);sql.close();
});

test('legacy PUT cannot change plan selection or milestone even as admin, and omissions preserve them',async()=>{
 const {db,sql}=setup(),key='ontology.delivery.v2';
 const before={...DELIVERY_INITIAL,companyJourney:{'santa-clara':'founding'},companyMilestone:{'santa-clara':2}};
 sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?)").run(key,JSON.stringify(before));
 for(const patch of [{companyJourney:{}},{companyJourney:{'santa-clara':'other'}},{companyMilestone:{}},{companyMilestone:{'santa-clara':12}}]) {
  await assert.rejects(saveLegacyState(db,'default','admin@example.com',key,{...before,...patch},1),{code:'operation_required'});
 }
 assert.equal(sql.prepare("SELECT version FROM state_documents WHERE key=?").get(key).version,1);
 assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);
 const omitted={...before};delete omitted.companyJourney;delete omitted.companyMilestone;
 await saveLegacyState(db,'default','admin@example.com',key,omitted,1);
 const saved=JSON.parse(sql.prepare('SELECT body FROM state_documents WHERE key=?').get(key).body);
 assert.deepEqual(saved.companyJourney,before.companyJourney);assert.deepEqual(saved.companyMilestone,before.companyMilestone);
 sql.close();
});

test('initialized workspace reserves roster and settings while preserving session selection',async()=>{
 const {db,sql,roster}=setup();
 for(const patch of [{extraMembers:[]},{memberEdits:{admin:{access:'leitor'}}},{deactivatedIds:['admin']},{workspaceName:'Bypass'},{alertRules:{silentClientDays:99}}])await assert.rejects(saveLegacyState(db,'default','admin@example.com','ontology.workspace.v3',{...roster,...patch},1),{code:'operation_required'});
 assert.equal(sql.prepare('SELECT count(*) n FROM operation_events').get().n,0);
 await saveLegacyState(db,'default','admin@example.com','ontology.workspace.v3',{currentUserId:'admin'},1);
 const saved=JSON.parse(sql.prepare("SELECT body FROM state_documents WHERE key='ontology.workspace.v3'").get().body);
 assert.deepEqual(saved.extraMembers,roster.extraMembers);assert.equal(saved.currentUserId,'admin');
 sql.close();
});
test('existing empty-workspace initialization remains compatible, then roster snapshots are closed',async()=>{
 const {db,sql}=sqliteD1();
 try{
 const member={id:'member-first',name:'First',email:'first@example.com',access:'admin',org:'praxis',initials:'F',role:'Admin da plataforma',capacityHoursWeek:40};
 const initial={extraMembers:[member],currentUserId:member.id,workspaceName:'Ontology',hidden:[],memberEdits:{},deactivatedIds:[],alertRules:{}};
 await saveLegacyState(db,'default',member.email,'ontology.workspace.v3',initial,0);
 await assert.rejects(saveLegacyState(db,'default',member.email,'ontology.workspace.v3',{...initial,extraMembers:[{...member,name:'Overwrite'}]},1),{code:'operation_required'});
 const saved=JSON.parse(sql.prepare("SELECT body FROM state_documents WHERE key='ontology.workspace.v3'").get().body);
 assert.deepEqual(saved.extraMembers,[member]);
 }finally{sql.close();}
});

test("a legacy write reads only the documents its key needs and guards exactly those", async () => {
  const { db, sql } = setup();
  const engagement = { ...ENGAGEMENT_INITIAL, extraTemplates: [] };
  sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.engagement.v2',1,?)").run(JSON.stringify(engagement));
  sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.relationship.v1',1,'{}')").run();
  sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.delivery.v2',1,?)").run(JSON.stringify(DELIVERY_INITIAL));
  sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.catalog.v2',1,'{}')").run();
  const read = [];
  const guarded = [];
  const watched = {
    ...db,
    prepare(query) {
      const statement = db.prepare(query);
      return {
        ...statement,
        bind(...values) {
          const bound = statement.bind(...values);
          if (/SELECT .*FROM state_documents/.test(query)) read.push(...values.slice(1));
          if (/INSERT INTO operation_guards/.test(query))
            for (let i = 2; i < values.length; i += 4) guarded.push(values[i]);
          return { ...bound, bind: bound.bind.bind(bound), first: () => bound.first(), all: () => bound.all(), run: () => bound.run() };
        },
      };
    },
  };
  const template = { id: "t1", name: "Convite", channel: "email", body: "Olá" };
  await saveLegacyState(watched, "default", "admin@example.com", "ontology.engagement.v2", { ...engagement, extraTemplates: [template] }, 1);
  assert.deepEqual(new Set(read), new Set([
    "ontology.workspace.v3", "ontology.workspace.v2",
    "ontology.engagement.v2", "ontology.clients.v3", "ontology.relationship.v1",
  ]), "a execução e o catálogo não entram numa gravação de engajamento");
  assert.deepEqual(new Set(guarded), new Set([
    "ontology.engagement.v2", "ontology.workspace.v3", "ontology.clients.v3", "ontology.relationship.v1",
  ]), "só o que a decisão leu vira guarda de versão");
  assert.equal(JSON.parse(sql.prepare("SELECT body FROM state_documents WHERE key='ontology.engagement.v2'").get().body).extraTemplates.length, 1);
  sql.close();
});

test('an empty first-run autosave is a no-op and cannot prevent the designated session initialization',async()=>{
 const {db,sql}=sqliteD1();
 assert.deepEqual(await saveLegacyState(db,'default','first@example.com','ontology.workspace.v3',{},0),{version:0});
 assert.equal(sql.prepare('SELECT count(*) n FROM state_documents').get().n,0);
 const member={id:'first',email:'first@example.com',name:'First',access:'admin'};
 await saveLegacyState(db,'default',member.email,'ontology.workspace.v3',{extraMembers:[member]},0);
 assert.equal(sql.prepare("SELECT version FROM state_documents WHERE key='ontology.workspace.v3'").get().version,1);
});
