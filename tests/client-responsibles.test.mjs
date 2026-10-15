import test from 'node:test';
import assert from 'node:assert/strict';

import { projectClients } from '../src/modules/clients/infrastructure/snapshot.ts';

const today = '2026-09-29';
const enrollment = (id, productId, extra = {}) => ({ id, company: 'client', productId, status: 'ativa', ...extra });
const allocation = (memberId, extra = {}) => ({ id: memberId, company: 'client', memberId, role: 'responsavel', percent: 30, ...extra });
const context = (allocations, enrollments = []) => ({ clients: [{ slug: 'client', leadId: 'legacy' }], allocations, enrollments });
const ids = (value, productId) => (productId ? responsibilityIndex(value, today, productId).product : responsibilityIndex(value, today).client).get('client') ?? [];

test('responsible filter never resurrects a removed allocation through legacy leadId', () => {
  const client = { slug: 'client', leadId: 'legacy', csId: 'cx' };
  const migrated = projectClients({ extraClients: [client], allocationsMigrated: true, allocations: [] });
  assert.deepEqual(ids(migrated), []);
  const historical = projectClients({ extraClients: [client] });
  assert.deepEqual(ids(historical), ['legacy']);
  assert.deepEqual(ids(context([allocation('current')])), ['current']);
});

test('only current responsible allocations count, including the boundary dates', () => {
  const value = context([
    allocation('boundary', { from: today, to: today }),
    allocation('past', { to: '2026-09-28' }),
    allocation('future', { from: '2026-09-30' }),
    allocation('cx', { role: 'cs' }),
    allocation('missing', { enrollmentId: 'missing' }),
    allocation('cancelled', { enrollmentId: 'cancelled' }),
    allocation('archived', { enrollmentId: 'archived' }),
    allocation('other', { company: 'other' }),
  ], [enrollment('cancelled', 'p', { status: 'cancelada' }), enrollment('archived', 'p', { archivedAt: today })]);
  assert.deepEqual(ids(value), ['boundary']);
});

test('product and responsible must belong to the same purchase, independently from general', () => {
  const value = context([
    allocation('general'), allocation('specific', { enrollmentId: 'a' }),
  ], [enrollment('a', 'product-a'), enrollment('b', 'product-b')]);
  assert.deepEqual(ids(value), ['general']);
  assert.deepEqual(ids(value, 'product-a'), ['specific']);
  assert.deepEqual(ids(value, 'product-b'), [NO_RESPONSIBLE]);
  assert.deepEqual(ids(value, 'absent'), []);
  value.allocations.push(allocation('specific', { id: 'second', enrollmentId: 'b' }));
  assert.deepEqual(ids(value), ['general']);
});

test('a future product owner is not yet assigned and does not change the general owner', () => {
  const value = context([
    allocation('general'), allocation('future', { enrollmentId: 'a', from: '2026-10-01' }),
  ], [enrollment('a', 'product-a')]);
  assert.deepEqual(ids(value, 'product-a'), [NO_RESPONSIBLE]);
  assert.deepEqual(ids(value), ['general']);
});

test('client reassignment preserves archived purchases, other roles and dedication; repeated assignment is stable', async () => {
  const { setClientResponsible } = await import('../src/modules/clients/domain/set-responsible.ts');
  const rows = [allocation('general'), allocation('specific', { enrollmentId: 'a', percent: 17 }),
    allocation('historical', { enrollmentId: 'old' }), allocation('cx', { role: 'cs' })];
  const enrollments = [enrollment('a', 'p'), enrollment('old', 'p', { archivedAt: today })];
  const input = { company: 'client', memberId: 'new' }, at = `${today}T12:00:00Z`;
  const next = setClientResponsible(rows, enrollments, input, at, today);
  assert.equal(next.find(row => row.id === 'historical').memberId, 'historical');
  assert.equal(next.find(row => row.role === 'cs').memberId, 'cx');
  assert.equal(next.find(row => row.role === 'responsavel' && !row.enrollmentId).memberId, 'new');
  assert.equal(next.find(row => row.enrollmentId === 'a').memberId, 'specific');
  assert.equal(next.find(row => row.enrollmentId === 'a').percent, 17);
  assert.deepEqual(setClientResponsible(next, enrollments, input, '2026-09-30T12:00:00Z', '2026-09-30'), next);
  assert.throws(() => setClientResponsible(rows, enrollments, {...input,enrollmentId:'old'}, at, today), /contratação atual/);
});

import { responsibilityIndex, matchesResponsible, NO_RESPONSIBLE } from '../src/modules/clients/domain/responsibility-filters.ts';
test('independent filters keep general and product responsibility separate, including no responsible', () => {
  const value = context([allocation('general'), allocation('specific', { enrollmentId: 'a' })], [enrollment('a', 'product-a'), enrollment('b', 'product-b')]);
  const a = responsibilityIndex(value, today, 'product-a'), b = responsibilityIndex(value, today, 'product-b');
  assert.deepEqual(a.client.get('client'), ['general']);
  assert.deepEqual(a.product.get('client'), ['specific']);
  assert.deepEqual(b.product.get('client'), [NO_RESPONSIBLE]);
  assert.equal(matchesResponsible(a.client.get('client'), ['specific']), false);
  assert.equal(matchesResponsible(b.product.get('client'), ['general']), false);
  assert.equal(matchesResponsible(b.product.get('client'), [NO_RESPONSIBLE]), true);
  assert.equal(matchesResponsible([], [NO_RESPONSIBLE]), true);
});
test('removing responsibility only clears the selected level', async () => {
  const { setClientResponsible } = await import('../src/modules/clients/domain/set-responsible.ts');
  const rows = [allocation('general'), allocation('specific', {enrollmentId:'a'}), allocation('cx', {role:'cs'})];
  const enrollments = [enrollment('a','p')], at = `${today}T12:00:00Z`;
  const noGeneral = setClientResponsible(rows, enrollments, {company:'client',memberId:null}, at, today);
  assert.deepEqual(noGeneral, rows.slice(1));
  assert.deepEqual(setClientResponsible(rows,enrollments,{company:'client',memberId:null,enrollmentId:'a'},at,today),[rows[0],rows[2]]);
});

test('reassignment activates the single expired or scheduled role now; same active member keeps dates', async () => {
  const { setClientResponsible } = await import('../src/modules/clients/domain/set-responsible.ts');
  const { upsertAllocation } = await import('../src/modules/clients/domain/allocation.ts');
  const at = `${today}T12:00:00Z`, input = {company:'client',memberId:'general'};
  for (const dates of [{to:'2026-09-28'},{from:'2026-10-01'}]) {
    const old=allocation('general',{...dates,percent:17});
    const next=setClientResponsible([old],[],input,at,today);
    assert.equal(next.length,1);assert.equal(next[0].from,today);assert.equal(next[0].to,undefined);
    assert.equal(next[0].id,old.id);assert.equal(next[0].percent,17);
  }
  const active=[allocation('general',{from:'2026-09-01',to:'2026-10-01'})];
  assert.equal(setClientResponsible(active,[],input,at,today),active);
  // The allocation writer keeps one singular role per scope, even when dated.
  const replaced=upsertAllocation(active,allocation('scheduled',{from:'2026-10-02'}));
  assert.equal(replaced.length,1);assert.equal(replaced[0].memberId,'scheduled');
});
