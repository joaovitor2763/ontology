import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionClientDelivery } from '../src/server/delivery-client-slices.ts';
import { reconstructDeliverySnapshot } from '../src/server/delivery-records.ts';
import { DELIVERY_INITIAL, projectDelivery } from '../src/modules/delivery/infrastructure/snapshot.ts';

test('client partition owns private plans through enrollments and preserves interleaved raw order', () => {
  const raw = {
    extraTasks: [
      { id: 'one-a', company: 'one', title: 'A', status: 'fila', dueAt: '2026-09-28' },
      { id: 'two-a', company: 'two', title: 'B', status: 'fila', dueAt: '2026-09-29' },
      { id: 'one-b', company: 'one', title: 'C', status: 'fila', dueAt: '2026-09-30' },
    ],
    extraCycles: [], cycleEdits: {}, statusMap: { 'one-a': 'em-curso' },
    taskPatches: { 'two-a': { title: 'Alterada' }, ghost: { title: 'Órfã' } },
    productPlans: { private: { id: 'private', name: 'Plano privado' } },
    companyJourney: {}, companyMilestone: {}, companyJourneyVersion: {},
  };
  const partition = partitionClientDelivery(raw, [{ company: 'one', planId: 'private' }]);
  assert.deepEqual(partition.slices.map(slice => slice.company), ['one', 'two']);
  assert.deepEqual(partition.sharedPlanIds, []);
  assert.deepEqual(partition.unassigned.map(row => `${row.kind}/${row.id}`), ['taskPatches/ghost']);
  assert.ok(partition.slices[0].snapshot.productPlans.private);
  assert.deepEqual(partition.slices[0].snapshot.extraTasks.map(task => task.id), ['one-a', 'one-b']);
  const merged = reconstructDeliverySnapshot([
    ...partition.slices.flatMap(slice => slice.records), ...partition.unassigned,
  ]);
  assert.deepEqual(merged, raw);
  for (const slice of partition.slices)
    assert.deepEqual(projectDelivery(slice.snapshot, slice.company), projectDelivery(raw, slice.company));
});

test('shared and unreferenced plans remain explicit instead of being assigned arbitrarily', () => {
  const raw = { productPlans: { shared: { id: 'shared' }, orphan: { id: 'orphan' } } };
  const partition = partitionClientDelivery(raw, [
    { company: 'one', planId: 'shared' }, { company: 'two', planId: 'shared' },
  ]);
  assert.deepEqual(partition.sharedPlanIds, ['shared']);
  assert.deepEqual(partition.unassigned.map(row => row.id), ['shared', 'orphan']);
  assert.deepEqual(reconstructDeliverySnapshot(partition.unassigned), { ...DELIVERY_INITIAL, ...raw });
});
