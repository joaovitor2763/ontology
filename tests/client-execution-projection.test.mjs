import test from 'node:test';
import assert from 'node:assert/strict';
import { projectClientExecution } from '../src/modules/delivery/infrastructure/client-projection.ts';
import { normalizeCatalogSnapshot } from '../src/modules/catalog/infrastructure/snapshot.ts';

const client = { slug: 'new-client', journeyId: 'founding-companies', milestone: 1 };
const purchase = { id: 'purchase-one', company: client.slug,
  planId: 'service-delivery', startsAt: '2026-09-01', status: 'ativa' };
const task = (id, journeyId, extra = {}) => ({ id, company: client.slug,
  title: id, status: 'fila', ownerId: 'admin', dueAt: '2020-01-01',
  hours: 1, workstream: '', milestone: 1, completion: 'checklist',
  journeyId, enrollmentId: purchase.id, ...extra });

test('client projection follows the current purchase when a legacy plan choice is stale', () => {
  const raw = { companyJourney: { [client.slug]: 'founding-companies' },
    companyJourneyVersion: { [client.slug]: 1 }, extraTasks: [
      task('old-plan', 'founding-companies'), task('new-plan', 'service-delivery'),
    ] };
  const projected = projectClientExecution(raw, normalizeCatalogSnapshot(), client,
    [purchase], { [client.slug]: '2026-08-01' }, { [purchase.id]: purchase.startsAt });
  assert.deepEqual(projected.tasks.map(row => row.id), ['new-plan']);
});

test('client projection schedules a purchased task from its own start date', () => {
  const raw = { extraTasks: [task('relative', 'service-delivery',
    { dueAt: '2020-01-01', deadline: { mode: 'client', offsetDays: 2 } })] };
  const projected = projectClientExecution(raw, normalizeCatalogSnapshot(), client,
    [purchase], { [client.slug]: '2026-08-01' }, { [purchase.id]: purchase.startsAt });
  assert.equal(projected.tasks.find(row => row.id === 'relative')?.dueAt, '2026-09-03');
});
