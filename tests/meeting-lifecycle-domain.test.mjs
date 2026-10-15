import test from 'node:test';
import assert from 'node:assert/strict';
import {activeMeetingActions,removeMeetingAction,restoreMeetingAction} from '../src/modules/engagement/domain/meeting-lifecycle.ts';
import {ENGAGEMENT_INITIAL,projectMeetings,projectAllMeetings,removeMeetingSnapshot,restoreMeetingSnapshot} from '../src/modules/engagement/infrastructure/snapshot.ts';
import {meetings} from '../src/modules/engagement/infrastructure/seed.ts';
const meeting={id:'meeting',company:'client',startsAt:'2026-09-17T12:00:00Z',cancelledAt:'2026-09-16',notes:'Contexto',google:{eventId:'google',cancelled:true,transcriptDocId:'doc'},actions:[{text:'Primeira',deliveryId:'task',done:true},{text:'Segunda'}]};
test('action tombstones retain linked task and stable legacy IDs through JSON and restoration',()=>{
 const removed=removeMeetingAction(meeting,'meeting-a1','member','2026-09-17');
 assert.equal(meeting.actions[0].removedAt,undefined);assert.equal(removed.actions.length,2);assert.equal(removed.actions[0].deliveryId,'task');assert.equal(removed.actions[0].done,true);assert.equal(removed.actions[0].removedBy,'member');
 const loaded=JSON.parse(JSON.stringify(removed));assert.deepEqual(activeMeetingActions(loaded).map(a=>a.id),['meeting-a2']);assert.equal(removeMeetingAction(loaded,'meeting-a1','other','later'),loaded);
 const restored=restoreMeetingAction(loaded,'meeting-a1','2026-09-18');assert.equal(restored.actions[0].removedAt,undefined);assert.equal(restored.actions[0].removedBy,undefined);assert.equal(restored.actions[0].deliveryId,'task');assert.equal(restored.actions[0].done,true);assert.equal(activeMeetingActions(restored).length,2);assert.deepEqual(restored.google,meeting.google);assert.equal(restored.cancelledAt,meeting.cancelledAt);
 assert.throws(()=>removeMeetingAction(meeting,'missing','member','now'),/não encontrada/);
});
test('extra meeting deletion uses durable tombstone and restores latest content without reviving Google',()=>{
 const state={...ENGAGEMENT_INITIAL,extraMeetings:[meeting]};const removed=removeMeetingSnapshot(state,meeting,'member','removed');
 assert.equal(removed.extraMeetings.length,1);assert.ok(!projectMeetings(removed).some(m=>m.id===meeting.id));
 const hidden=projectAllMeetings(JSON.parse(JSON.stringify(removed))).find(m=>m.id===meeting.id);assert.equal(hidden.actions[0].deliveryId,'task');assert.equal(hidden.removedBy,'member');
 const updated={...hidden,notes:'Nota atual preservada'};
 const restored=restoreMeetingSnapshot(removed,updated,'restorer','restored');const visible=projectMeetings(restored).find(m=>m.id===meeting.id);
 assert.equal(visible.notes,updated.notes);assert.equal(visible.restoredBy,'restorer');assert.equal(visible.removedAt,undefined);assert.equal(visible.cancelledAt,meeting.cancelledAt);assert.deepEqual(visible.google,meeting.google);assert.equal(visible.actions[0].deliveryId,'task');assert.equal(restoreMeetingSnapshot(restored,visible,'other','later'),restored);
});
test('seed meeting tombstone and restore keep edits and never create a duplicate extra',()=>{
 const seed=projectMeetings().find(m=>m.id===meetings[0].id);const removed=removeMeetingSnapshot(ENGAGEMENT_INITIAL,seed,'member','removed');
 assert.equal(removed.extraMeetings.length,0);assert.ok(removed.meetingEdits[seed.id]);assert.equal(removeMeetingSnapshot(removed,seed,'other','later'),removed);
 const stored=projectMeetings(removed,{includeRemoved:true}).find(m=>m.id===seed.id);const restored=restoreMeetingSnapshot(removed,stored,'member','restored');
 assert.equal(restored.extraMeetings.length,0);assert.equal(projectMeetings(restored).filter(m=>m.id===seed.id).length,1);assert.deepEqual(projectMeetings(restored).find(m=>m.id===seed.id).actions,seed.actions);
});
