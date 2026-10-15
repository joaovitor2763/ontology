import test from "node:test";
import assert from "node:assert/strict";
import { protectOperationFields, supportedStateKey } from "../src/server/operations/legacy-state.ts";
test("snapshot keys reject invented versions, internal markers and writes to retired versions", () => {
  assert.equal(supportedStateKey("ontology.workspace.v999", true), false);
  assert.equal(supportedStateKey("ontology.integrationauth.v1"), false);
  assert.equal(supportedStateKey("ontology.clients.v2"), true);
  assert.equal(supportedStateKey("ontology.clients.v2", true), false);
  assert.equal(supportedStateKey("ontology.clients.v3", true), true);
});
test("old tabs preserve operation-owned enrollment and participation data", () => {
  const current = { enrollments: [{ id: "e1" }], participations: [{ id: "p1" }] };
  const next = protectOperationFields("ontology.clients.v3", current, {});
  assert.deepEqual(next, current);
  for (const field of ["enrollments", "participations"])
    assert.throws(() => protectOperationFields("ontology.clients.v3", current, { [field]: [] }), { code: "operation_required" });
  assert.deepEqual(protectOperationFields("ontology.clients.v3", null, { enrollments: [], participations: [] }), { enrollments: [], participations: [] });
});
test("pending meeting intents cannot change through legacy snapshots; complete meetings preserve unchanged content for unrelated updates", () => {
  const meeting = { id: "m", operationId: "op", schedulingStatus: "complete", title: "Call", startsAt: "2026-10-01T00:00:00Z", google: { eventId: "google", organizer: "a@example.com", etag: "v1" } };
  const current = { extraMeetings: [meeting] };
  const artifacts = { extraMeetings: [{ ...meeting, google: { ...meeting.google } }] };
  assert.deepEqual(protectOperationFields("ontology.engagement.v2", current, artifacts), artifacts);
  assert.throws(() => protectOperationFields("ontology.engagement.v2", current, { extraMeetings: [{ ...meeting, google: { eventId: "another" } }] }), { code: "operation_required" });
  assert.throws(() => protectOperationFields("ontology.engagement.v2", current, { extraMeetings: [] }), { code: "operation_required" });
  const pending = { extraMeetings: [{ ...meeting, schedulingStatus: "pending" }] };
  assert.throws(() => protectOperationFields("ontology.engagement.v2", pending, artifacts), { code: "operation_required" });
});

test('legacy snapshots cannot bypass catalog publication or replace private purchase plans and pins',()=>{
 assert.throws(()=>protectOperationFields('ontology.catalog.v2',{},{}),{code:'operation_required'});
 const current={productPlans:{purchase:{id:'purchase'}},companyJourneyVersion:{client:2},companyJourney:{client:'purchase'},companyMilestone:{client:2}};
 for(const field of ['productPlans','companyJourneyVersion','companyJourney','companyMilestone']) assert.throws(()=>protectOperationFields('ontology.delivery.v2',current,{[field]:{}}),{code:'operation_required'});
 assert.deepEqual(protectOperationFields('ontology.delivery.v2',current,{}),current);
});
test('complete meeting boundary preserves omitted records and rejects explicit content changes',()=>{
 const current={extraMeetings:[{id:'m',actions:[],summary:'Saved',notes:'Original'}],meetingEdits:{},notes:{m:'Override'}};
 const untouched=protectOperationFields('ontology.engagement.v2',current,{extraTemplates:[{id:'event'}]});assert.deepEqual(untouched,{...current,extraTemplates:[{id:'event'}]});
 for(const patch of [{extraMeetings:[]},{extraMeetings:[{...current.extraMeetings[0],summary:'Changed'}]},{meetingEdits:{seed:{id:'seed',actions:[]}}},{notes:{m:'Changed'}},{notes:{}}])assert.throws(()=>protectOperationFields('ontology.engagement.v2',current,{...current,...patch}),{code:'operation_required'});
 assert.throws(()=>protectOperationFields('ontology.engagement.v2',{}, {extraMeetings:[{id:'new',actions:[]}]}),{code:'operation_required'});
});

test('diagnosis cannot be bootstrapped through legacy snapshots, while empty old defaults remain valid', () => {
  const fields = ['extraPains', 'painEdits', 'removedPains', 'extraSolutions', 'solutionEdits', 'removedSolutions', 'extraHypotheses', 'hypothesisEdits', 'removedHypotheses'];
  for (const field of fields) {
    const empty = field.endsWith('Edits') ? {} : [];
    const changed = field.endsWith('Edits') ? { seed: { id: 'seed', title: 'Changed' } } : field.startsWith('removed') ? ['seed'] : [{ id: 'new', company: 'santa-clara' }];
    assert.throws(() => protectOperationFields('ontology.engagement.v2', {}, { [field]: changed }), { code: 'operation_required' });
    assert.deepEqual(protectOperationFields('ontology.engagement.v2', {}, { [field]: empty }), { [field]: empty });
  }
  assert.deepEqual(protectOperationFields('ontology.engagement.v2', {}, {}), {});
});

test('agenda initialization accepts empty old defaults but refuses invented seed edits and events', () => {
  for (const [field, empty, changed] of [['extraEvents', [], [{ id: 'new' }]], ['eventEdits', {}, { seed: { id: 'seed' } }], ['removedEvents', [], ['seed']]]) {
    assert.deepEqual(protectOperationFields('ontology.engagement.v2', {}, { [field]: empty }), { [field]: empty });
    assert.throws(() => protectOperationFields('ontology.engagement.v2', {}, { [field]: changed }), { code: 'operation_required' });
  }
});

test('signals cannot be initialized through legacy snapshots except for empty old defaults', () => {
  for (const field of ['signalReviews', 'signalClassifications']) {
    assert.deepEqual(protectOperationFields('ontology.engagement.v2', {}, { [field]: {} }), { [field]: {} });
    assert.throws(() => protectOperationFields('ontology.engagement.v2', {}, { [field]: { invented: { deliveryId: 'task' } } }), { code: 'operation_required' });
  }
});

test('document commands own metadata, versions and removal while old snapshots preserve omissions',()=>{
 const saved={extraDocs:[{id:'up-one',supersedesId:'up-old',uploadedBy:'admin'}],docEdits:{'up-one':{reviewHistory:[{by:'admin'}]}},removedDocIds:['up-old']};
 assert.deepEqual(protectOperationFields('ontology.documents.v3',saved,{}),saved);
 for(const patch of [{extraDocs:[]},{extraDocs:[{id:'forged'}]},{docEdits:{}},{removedDocIds:[]},{extraDocs:null}])assert.throws(()=>protectOperationFields('ontology.documents.v3',saved,{...saved,...patch}),{code:'operation_required'});
});

test('ontology commands own drafts including layout and removed graph elements',()=>{
 const saved={ontologyDrafts:{client:{extraNodes:[{id:'node'}],nodePatches:{node:{networkPosition:{x:1,y:2}}},removedNodes:['old'],removedEdges:['edge']}}};
 assert.deepEqual(protectOperationFields('ontology.knowledge.v2',saved,{}),saved);
 for(const ontologyDrafts of [{},null,{client:{}},{client:{...saved.ontologyDrafts.client,nodePatches:{}}}])assert.throws(()=>protectOperationFields('ontology.knowledge.v2',saved,{ontologyDrafts}),{code:'operation_required'});
 assert.deepEqual(protectOperationFields('ontology.knowledge.v2',{}, {ontologyDrafts:{}}),{ontologyDrafts:{}});
 assert.throws(()=>protectOperationFields('ontology.knowledge.v2',{},saved),{code:'operation_required'});
});

test("client archive and allocations are command owned and survive omitted legacy fields",()=>{
 const before={archivedClients:['old'],allocations:[{id:'a',company:'old',memberId:'member',role:'consultor',percent:50}],allocationsMigrated:true,assignments:{old:{leadId:'member',csId:'cs'}}};
 const next=protectOperationFields('ontology.clients.v3',before,{});for(const field of Object.keys(before))assert.deepEqual(next[field],before[field]);
 for(const patch of [{archivedClients:[]},{allocations:[]},{allocationsMigrated:false},{assignments:{}}])assert.throws(()=>protectOperationFields('ontology.clients.v3',before,{...before,...patch}),{code:'operation_required'});
});

test('omitted legacy client and contact fields preserve stored data',()=>{
 const client={extraClients:[{slug:'saved'}],clientEdits:{saved:{name:'Saved'}},configs:{saved:{name:'Service'}}};
 assert.deepEqual(protectOperationFields('ontology.clients.v3',client,{}),{...client,enrollments:[],participations:[]});
 const contacts={contacts:[{id:'saved',name:'Saved'}]};
 assert.deepEqual(protectOperationFields('ontology.stakeholders.v1',contacts,{}),contacts);
 assert.throws(()=>protectOperationFields('ontology.stakeholders.v1',contacts,{contacts:[]}),{code:'operation_required'});
});

test('execution fields cannot bypass commands and omitted fields retain recorded history',()=>{
 const before={cycleEdits:{c:{id:'c'}},extraCycles:[{id:'new'}],statusMap:{t:'entregue'},extraTasks:[{id:'t',history:[{by:'actor'}]}],taskPatches:{t:{evidence:'Saved',history:[{by:'actor'}]}}};
 assert.deepEqual(protectOperationFields('ontology.delivery.v2',before,{}),before);
 for(const [field,value] of Object.entries(before))assert.throws(()=>protectOperationFields('ontology.delivery.v2',before,{[field]:Array.isArray(value)?[]:{}}),{code:'operation_required'});
 assert.throws(()=>protectOperationFields('ontology.delivery.v2',{}, {extraTasks:[{id:'forged'}]}),{code:'operation_required'});
});
