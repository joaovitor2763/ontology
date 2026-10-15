import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEngagementSnapshot,resolveSignalReview,reopenSignalReview,signalReviewState } from '../src/modules/engagement/infrastructure/snapshot.ts';
test('legacy signal reviews remain resolved; reopen and resolve preserve linked task identity',()=>{
 const legacy={by:'member-fixture',at:'2026-01-01T00:00:00Z',deliveryId:'task-fixture'};
 const state=normalizeEngagementSnapshot({signalReviews:{'signal-fixture':legacy}});
 assert.deepEqual(state.signalReviews['signal-fixture'],legacy);
 const reopened=reopenSignalReview(legacy,'2026-01-02T00:00:00Z');
 assert.deepEqual(signalReviewState(legacy),{resolvedAt:legacy.at,resolvedBy:legacy.by,deliveryId:legacy.deliveryId});
 assert.deepEqual(signalReviewState(reopened),{resolvedAt:undefined,resolvedBy:undefined,deliveryId:legacy.deliveryId});
 assert.deepEqual(reopened,{...legacy,reopenedAt:'2026-01-02T00:00:00Z'});
 assert.deepEqual(normalizeEngagementSnapshot({signalReviews:{'signal-fixture':reopened}}).signalReviews['signal-fixture'],reopened);
 assert.deepEqual(resolveSignalReview(reopened,'another-fixture','2026-01-03T00:00:00Z','new-task-must-not-replace'),{by:'another-fixture',at:'2026-01-03T00:00:00Z',deliveryId:'task-fixture'});
 assert.equal(reopenSignalReview(undefined,'2026-01-02T00:00:00Z'),undefined);
});
