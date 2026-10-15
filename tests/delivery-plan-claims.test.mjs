import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { clientPlanClaimStatements, deliveryPlanClaims,
  readClientPlanClaimHead, unclaimedPrivatePlan } from '../src/server/operations/delivery-client-plan-claims.ts';

function fixture() {
  const f = sqliteD1();
  f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
    (workspace_id,generation,mode,source_delivery_version,source_clients_version,
     compatibility_version,expected_clients,expected_owners,expected_orphans,
     expected_array_order,expected_map_order,updated_at)
    VALUES('default','authority','active',1,1,8,2,0,0,0,0,'now')`).run();
  for (const company of ['alpha', 'beta']) {
    f.sql.prepare(`INSERT INTO delivery_client_snapshots
      (workspace_id,generation,company,revision,body,body_sha256,incarnation)
      VALUES('default','authority',?,1,'{}','hash',?)`).run(company,`inc-${company}`);
    f.sql.prepare(`INSERT INTO delivery_client_plan_claim_heads
      (workspace_id,company,authority_generation,source_revision,source_incarnation,
       projection_generation,expected_claims,updated_at)
      VALUES('default',?,'authority',1,?,'projection',0,'now')`)
      .run(company,`inc-${company}`);
  }
  return f;
}

test('raw claims include removed tasks and selection, but never effective task patches', () => {
  const raw = { companyJourney: { alpha: 'selected', beta: 'elsewhere' },
    extraTasks: [
      { company: 'alpha', journeyId: 'private', removed: true },
      { company: 'alpha', journeyId: 'private' },
      { company: 'beta', journeyId: 'foreign' },
    ],
    taskPatches: { task: { journeyId: 'patch-only' } } };
  assert.deepEqual(deliveryPlanClaims(raw, 'alpha'), ['private', 'selected']);
  assert.deepEqual(deliveryPlanClaims(raw, 'beta'), ['elsewhere', 'foreign']);
});

test('private plan gate needs every current head and rejects foreign raw claims', async () => {
  const f = fixture(); try {
    const gate = () => unclaimedPrivatePlan(f.db, 'default', 'alpha', 'enrollment-first', 8);
    assert.equal(await gate(), true);
    f.sql.prepare(`INSERT INTO delivery_client_plan_claims
      VALUES('default','projection','beta','enrollment-first')`).run();
    f.sql.prepare(`UPDATE delivery_client_plan_claim_heads
      SET expected_claims=1 WHERE company='beta'`).run();
    assert.equal(await gate(), false);
    f.sql.prepare(`DELETE FROM delivery_client_plan_claims WHERE company='beta'`).run();
    assert.equal(await gate(), false, 'an incomplete projection cannot certify absence');
    f.sql.prepare(`UPDATE delivery_client_plan_claim_heads
      SET expected_claims=0 WHERE company='beta'`).run();
    assert.equal(await gate(), true);
    f.sql.prepare(`UPDATE delivery_client_plan_claim_heads
      SET source_revision=0 WHERE company='beta'`).run();
    assert.equal(await gate(), false, 'a stale revision cannot certify absence');
    f.sql.prepare(`UPDATE delivery_client_plan_claim_heads
      SET source_revision=1 WHERE company='beta'`).run();
    f.sql.prepare(`UPDATE delivery_client_shadow_meta SET expected_clients=3`).run();
    assert.equal(await gate(), false, 'new clients require certified coverage');
  } finally { f.sql.close(); }
});

test('private plan gate rejects private map identity, stale logical version and head ABA', async () => {
  const f = fixture(); try {
    const gate = version => unclaimedPrivatePlan(f.db, 'default', 'alpha', 'enrollment-first', version);
    assert.equal(await gate(7), false);
    f.sql.prepare(`UPDATE delivery_client_shadow_meta SET expected_map_order=1`).run();
    assert.equal(await gate(8), false);
    f.sql.prepare(`INSERT INTO delivery_client_map_order
      VALUES('default','authority','productPlans','enrollment-first',0)`).run();
    assert.equal(await gate(8), false);
    f.sql.prepare(`DELETE FROM delivery_client_map_order`).run();
    f.sql.prepare(`UPDATE delivery_client_shadow_meta SET expected_map_order=0`).run();
    f.sql.prepare(`UPDATE delivery_client_snapshots SET incarnation='new-inc'
      WHERE company='beta'`).run();
    assert.equal(await gate(8), false);
  } finally { f.sql.close(); }
});

test('claim writer advances raw references atomically and leaves stale heads stale', async () => {
  const f = fixture(); try {
    const before = { companyJourney: { alpha: 'selected' } };
    f.sql.prepare(`INSERT INTO delivery_client_plan_claims
      VALUES('default','projection','alpha','selected')`).run();
    f.sql.prepare(`UPDATE delivery_client_plan_claim_heads
      SET expected_claims=1 WHERE company='alpha'`).run();
    const after = { companyJourney: { alpha: 'next' },
      extraTasks: [{ company: 'alpha', journeyId: 'new', removed: true }] };
    const head = await readClientPlanClaimHead(f.db, 'default', 'alpha');
    const statements = clientPlanClaimStatements(f.db, 'default', 'alpha', 'authority',
      1, 'inc-alpha', before, after, head, 10);
    assert.equal(statements.length, 4);
    await f.db.batch(statements);
    assert.deepEqual(f.sql.prepare(`SELECT plan_id FROM delivery_client_plan_claims
      WHERE company='alpha' ORDER BY plan_id`).all().map(row => row.plan_id), ['new', 'next']);
    assert.equal(f.sql.prepare(`SELECT source_revision FROM delivery_client_plan_claim_heads
      WHERE company='alpha'`).get().source_revision, 2);
    assert.deepEqual(clientPlanClaimStatements(f.db, 'default', 'alpha', 'authority',
      1, 'inc-alpha', before, after,
      await readClientPlanClaimHead(f.db, 'default', 'alpha'), 10), []);
    assert.deepEqual(clientPlanClaimStatements(f.db, 'default', 'alpha', 'authority',
      1, 'inc-alpha', before, after, { ...head, actual_claims: 0 }, 10), []);
    assert.deepEqual(clientPlanClaimStatements(f.db, 'default', 'alpha', 'authority',
      1, 'inc-alpha', before, after, head, 10, new Set(['wrong-plan'])), []);
  } finally { f.sql.close(); }
});
