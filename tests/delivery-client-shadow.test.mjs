import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { commitOperation } from '../src/server/operations/transaction.ts';
import { deliveryMapOrder, partitionClientDelivery } from '../src/server/delivery-client-slices.ts';
import { projectClients } from '../src/modules/clients/infrastructure/snapshot.ts';
import { decodeStateBody } from '../src/server/state-body.ts';
import { readClientShadowSnapshot } from '../src/server/operations/delivery-client-shadow-read.ts';
import { readActiveDeliveryCompatibility } from '../src/server/operations/delivery-compatibility-read.ts';
import { DELIVERY_INITIAL, projectDelivery } from '../src/modules/delivery/infrastructure/snapshot.ts';
import { getDoc } from '../src/server/db.ts';
import { freshDocumentSnapshot, loadDocuments } from '../src/server/operations/request-context.ts';
import { readStateBatch } from '../src/server/operations/state-batch.ts';
import { executeDeliveryCommand } from '../src/server/operations/delivery.ts';
import { readCollection } from '../src/server/operations/collection-reads.ts';
import { rollbackClientAuthority } from '../src/server/operations/delivery-client-rollback.ts';
import { activateClientAuthority } from '../src/server/operations/delivery-client-activate.ts';
import { effectiveDeliveryRows } from '../src/server/delivery-effective.ts';
import { readEffectiveDeliveryPage } from '../src/server/operations/delivery-effective-read.ts';
import { issueIntegrationCredential, revokeIntegrationCredential } from '../src/server/operations/credentials.ts';
import { resolveOperationPrincipal } from '../src/server/operations/principal.ts';
import { apiResponse } from '../src/server/operations/http.ts';

const DELIVERY = 'ontology.delivery.v2', CLIENTS = 'ontology.clients.v3';
const task = (id, company) => ({ id, company, title: id, status: 'fila', ownerId: 'admin',
  dueAt: '2026-09-30', hours: 1, workstream: '', milestone: 1, completion: 'checklist', comments: [], history: [] });
function populated(raw = { extraTasks: [task('one-a', 'one'), task('two-a', 'two')] }, clients = {}) {
  const fixture = sqliteD1();
  for (const [key, value] of [[DELIVERY, raw], [CLIENTS, clients]])
    fixture.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', key, JSON.stringify(value));
  const partition = partitionClientDelivery(raw, projectClients(clients).enrollments);
  for (const slice of partition.slices)
    fixture.sql.prepare(`INSERT INTO delivery_client_snapshots
      (workspace_id,generation,company,revision,body,body_sha256,incarnation) VALUES('default','shadow',?,1,?,?,?)`)
      .run(slice.company, JSON.stringify(slice.snapshot),
        createHash('sha256').update(JSON.stringify(slice.snapshot)).digest('hex'),
        crypto.randomUUID());
  for (const row of raw.extraTasks)
    fixture.sql.prepare(`INSERT INTO delivery_entity_owners(workspace_id,generation,kind,id,company)
      VALUES('default','shadow','task',?,?)`).run(row.id, row.company);
  for (const [ordinal, row] of raw.extraTasks.entries())
    fixture.sql.prepare(`INSERT INTO delivery_client_array_order
      (workspace_id,generation,kind,id,ordinal,company)
      VALUES('default','shadow','extraTasks',?,?,?)`).run(row.id, ordinal, row.company);
  const mapOrder = deliveryMapOrder(raw);
  for (const [identity, ordinal] of mapOrder) {
    const [kind, id] = identity.split('\u0000');
    fixture.sql.prepare(`INSERT INTO delivery_client_map_order
      (workspace_id,generation,kind,id,ordinal) VALUES('default','shadow',?,?,?)`)
      .run(kind, id, ordinal);
  }
  fixture.sql.prepare(`INSERT INTO delivery_client_shadow_meta
    (workspace_id,generation,mode,source_delivery_version,source_clients_version,
     expected_clients,expected_owners,expected_orphans,expected_array_order,expected_map_order,updated_at)
    VALUES('default','shadow','shadow',1,1,2,?,0,?,?,'2026-09-27')`)
    .run(raw.extraTasks.length, raw.extraTasks.length, mapOrder.size);
  const commit = (key, guardKey, version, value) => commitOperation(fixture.db, {
    workspace: 'default', principal: 'member:admin', application: 'test',
    actor: { memberId: 'admin', email: 'admin@example.test', kind: 'session' },
    key, command: 'tasks.update', hash: key, id: crypto.randomUUID(),
    guards: [{ key: guardKey, version }], writes: [{ key: guardKey, value }],
    events: [], result: { data: {}, documents: [] },
  });
  return { ...fixture, raw, commit };
}

function completeOwnerIndex(f, raw) {
  const projected = projectDelivery(raw);
  const owners = [...projected.tasks.map(row => ['task', row.id, row.company]),
    ...projected.cycles.map(row => ['cycle', row.id, row.company])];
  f.sql.prepare("DELETE FROM delivery_entity_owners WHERE generation='shadow'").run();
  for (const [kind, id, company] of owners)
    f.sql.prepare(`INSERT INTO delivery_entity_owners(workspace_id,generation,kind,id,company)
      VALUES('default','shadow',?,?,?)`).run(kind, id, company);
  f.sql.prepare('UPDATE delivery_client_shadow_meta SET expected_owners=?').run(owners.length);
}

test('authority activation audits the shadow, fences stale versions and can roll back', async () => {
  const f = populated();
  try {
    completeOwnerIndex(f, f.raw);
    await attachClientPageHead(f, 'one');
    await attachClientPageHead(f, 'two');
    const expected = { generation: '00000000-0000-0000-0000-000000000001',
      deliveryVersion: 1, clientsVersion: 1, compatibilityVersion: 0,
      backupSha256: 'a'.repeat(64) };
    await assert.rejects(activateClientAuthority(f.db, 'default', expected),
      { code: 'version_conflict' });
    const activated = await activateClientAuthority(f.db, 'default',
      { ...expected, generation: 'shadow' }).catch(error => error);
    assert.equal(activated.code, 'invalid_cutover');
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET generation=? WHERE workspace_id='default'")
      .run(expected.generation);
    for (const table of ['delivery_client_snapshots', 'delivery_entity_owners',
      'delivery_client_array_order', 'delivery_client_map_order'])
      f.sql.prepare(`UPDATE ${table} SET generation=? WHERE generation='shadow'`).run(expected.generation);
    f.sql.prepare(`UPDATE delivery_client_effective_heads SET authority_generation=?
      WHERE authority_generation='shadow'`).run(expected.generation);
    const indexedStatus = f.sql.prepare(`SELECT status FROM delivery_effective_tasks
      WHERE workspace_id='default' AND company='one' AND id='one-a'`).get().status;
    f.sql.prepare(`UPDATE delivery_effective_tasks SET status='bloqueado'
      WHERE workspace_id='default' AND company='one' AND id='one-a'`).run();
    await assert.rejects(activateClientAuthority(f.db, 'default', expected),
      { code: 'execution_snapshot_incomplete' });
    f.sql.prepare(`UPDATE delivery_effective_tasks SET status=?
      WHERE workspace_id='default' AND company='one' AND id='one-a'`).run(indexedStatus);
    assert.equal(f.sql.prepare(`SELECT COUNT(*) AS n FROM delivery_client_shadow_meta m
      WHERE m.workspace_id='default' AND m.generation=? AND m.mode='shadow'
        AND m.source_delivery_version=1 AND m.source_clients_version=1
        AND m.compatibility_version=0 AND m.expected_orphans=0
        AND EXISTS (SELECT 1 FROM state_documents d WHERE d.workspace_id=m.workspace_id
          AND d.key='ontology.delivery.v2' AND d.version=1)
        AND EXISTS (SELECT 1 FROM state_documents c WHERE c.workspace_id=m.workspace_id
          AND c.key='ontology.clients.v3' AND c.version=1)`).get(expected.generation).n, 1);
    const racingDb = { ...f.db, prepare(query) {
      const statement = f.db.prepare(query);
      if (!query.startsWith('UPDATE delivery_client_shadow_meta\n    SET mode='))
        return statement;
      return { bind(...values) {
        const bound = statement.bind(...values);
        return { async first() {
          f.sql.prepare(`UPDATE state_documents SET version=version+1
            WHERE workspace_id='default' AND key='ontology.clients.v3'`).run();
          return bound.first();
        } };
      } };
    } };
    await assert.rejects(activateClientAuthority(racingDb, 'default', expected),
      { code: 'version_conflict' });
    assert.equal(f.sql.prepare('SELECT mode FROM delivery_client_shadow_meta').get().mode, 'shadow');
    f.sql.prepare(`UPDATE state_documents SET version=1
      WHERE workspace_id='default' AND key='ontology.clients.v3'`).run();
    const result = await activateClientAuthority(f.db, 'default', expected);
    assert.equal(result.compatibilityVersion, 2);
    assert.equal(result.audit.clients, 2);
    assert.equal(f.sql.prepare('SELECT mode FROM delivery_client_shadow_meta').get().mode, 'active');
    await assert.rejects(activateClientAuthority(f.db, 'default', expected),
      { code: 'version_conflict' });
    assert.deepEqual(await rollbackClientAuthority(f.db, 'default', 2, 'maintenance'),
      { version: 2 });
    assert.equal(f.sql.prepare('SELECT mode FROM delivery_client_shadow_meta').get().mode, 'shadow');
  } finally { f.sql.close(); }
});

async function attachClientPageHead(f, company) {
  const slice = await readClientShadowSnapshot(f.db, 'default', company);
  const { incarnation } = f.sql.prepare(`SELECT incarnation FROM delivery_client_snapshots
    WHERE workspace_id='default' AND generation='shadow' AND company=?`).get(company);
  const generation = `page-${company}`;
  const rows = effectiveDeliveryRows(slice.snapshot, company);
  for (const row of rows.tasks) f.sql.prepare(`INSERT INTO delivery_effective_tasks
    (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,due_at,
     owner_id,milestone,kind,body) VALUES('default',?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(generation, company, row.id, row.ordinal, row.enrollmentId, row.productId,
      row.status, row.dueAt, row.ownerId, row.milestone, row.kind, row.body);
  for (const row of rows.cycles) f.sql.prepare(`INSERT INTO delivery_effective_cycles
    (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,starts_at,
     ends_at,body) VALUES('default',?,?,?,?,?,?,?,?,?,?)`)
    .run(generation, company, row.id, row.ordinal, row.enrollmentId, row.productId,
      row.status, row.startsAt, row.endsAt, row.body);
  f.sql.prepare(`INSERT INTO delivery_client_effective_heads
    (workspace_id,company,authority_generation,source_revision,source_incarnation,projection_generation,
     expected_tasks,expected_cycles,updated_at) VALUES('default',?,'shadow',?,?,?,?,?,'2026-09-27')`)
    .run(company, slice.revision, incarnation, generation, rows.tasks.length, rows.cycles.length);
}

test('shadow dual-write increments only the changed client and keeps owner index atomic', async () => {
  const f = populated();
  try {
    assert.equal((await readClientShadowSnapshot(f.db, 'default', 'one')).revision, 1);
    const next = { extraTasks: [{ ...f.raw.extraTasks[0], title: 'Changed' },
      f.raw.extraTasks[1], task('one-b', 'one')] };
    await f.commit('change-one', DELIVERY, 1, next);
    const rows = f.sql.prepare(`SELECT company,revision,body FROM delivery_client_snapshots
      WHERE generation='shadow' ORDER BY company`).all();
    assert.deepEqual(rows.map(row => [row.company, row.revision]), [['one', 2], ['two', 1]]);
    assert.equal((await decodeStateBody(rows[0].body)).extraTasks[0].title, 'Changed');
    assert.equal(f.sql.prepare(`SELECT company FROM delivery_entity_owners
      WHERE generation='shadow' AND id='one-b'`).get().company, 'one');
    assert.equal(f.sql.prepare(`SELECT ordinal FROM delivery_client_array_order
      WHERE generation='shadow' AND id='one-b'`).get().ordinal, 2);
    assert.equal(f.sql.prepare('SELECT expected_array_order FROM delivery_client_shadow_meta').get().expected_array_order, 3);
    assert.equal(f.sql.prepare('SELECT source_delivery_version FROM delivery_client_shadow_meta').get().source_delivery_version, 2);
    assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version, 1);
    assert.equal((await readClientShadowSnapshot(f.db, 'default', 'one')).snapshot.extraTasks[0].title, 'Changed');
    await f.commit('change-clients', CLIENTS, 1, { extraClients: [{ slug: 'three', name: 'Three' }] });
    assert.equal(f.sql.prepare('SELECT source_clients_version FROM delivery_client_shadow_meta').get().source_clients_version, 2);
    assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='three'").get().revision, 1);
    assert.equal(f.sql.prepare('SELECT expected_clients FROM delivery_client_shadow_meta').get().expected_clients, 3);
    assert.equal(f.sql.prepare('SELECT expected_owners FROM delivery_client_shadow_meta').get().expected_owners, 3);
  } finally { f.sql.close(); }
});

test('active compatibility rebuilds the exact legacy order with a logical version', async () => {
  const f = populated({ extraTasks: [task('two-a', 'two'), task('one-a', 'one')],
    statusMap: { 'two-a': 'em-curso', 'one-a': 'fila' } });
  try {
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const result = await readActiveDeliveryCompatibility(f.db, 'default');
    assert.equal(result.version, 41);
    assert.deepEqual(result.snapshot, { ...DELIVERY_INITIAL, ...f.raw });
    assert.equal(JSON.stringify(result.snapshot), JSON.stringify({ ...DELIVERY_INITIAL, ...f.raw }));
    assert.equal(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(DELIVERY).version, 1);
    assert.equal(await readActiveDeliveryCompatibility(f.db, 'other'), null);
  } finally { f.sql.close(); }
});

test('document reads return active client authority with its logical version', async () => {
  const f = populated();
  try {
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    for (const doc of [await getDoc(f.db, 'default', DELIVERY),
      (await loadDocuments(f.db, 'default', [DELIVERY, CLIENTS]))[0],
      (await freshDocumentSnapshot(f.db, 'default', [CLIENTS, DELIVERY]))[1]]) {
      assert.equal(doc.version, 41);
      assert.deepEqual(doc.value, { ...DELIVERY_INITIAL, ...f.raw });
    }
    assert.equal(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(DELIVERY).version, 1);
  } finally { f.sql.close(); }
});

test('scoped active reads use the logical version and return empty for a client without a slice', async () => {
  const f = populated();
  try {
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const one = await readClientShadowSnapshot(f.db, 'default', 'one');
    assert.equal(one.sourceVersion, 41);
    assert.equal(one.snapshot.extraTasks[0].id, 'one-a');
    const empty = await readClientShadowSnapshot(f.db, 'default', 'three');
    assert.equal(empty.sourceVersion, 41);
    assert.deepEqual(empty.snapshot, {});
    f.sql.prepare('UPDATE delivery_client_shadow_meta SET source_clients_version=0').run();
    await assert.rejects(readClientShadowSnapshot(f.db, 'default', 'one'),
      { code: 'execution_snapshot_incomplete' });
  } finally { f.sql.close(); }
});

test('state bootstrap returns the active client snapshot and logical version', async () => {
  const f = populated();
  try {
    f.sql.prepare(`INSERT INTO state_documents(workspace_id,key,version,body)
      VALUES('default','ontology.workspace.v3',1,?)`)
      .run(JSON.stringify({ extraMembers: [{ id: 'admin', email: 'admin@example.test', access: 'admin' }], hidden: [] }));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const env = { DB: f.db, AUTH_MODE: 'dev', DEV_USER_EMAIL: 'admin@example.test' };
    const url = 'https://delivery.test/api/state?keys=ontology.delivery.v2';
    const response = await readStateBatch(new Request(url), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.documents[0].version, 41);
    assert.deepEqual(body.documents[0].value, { ...DELIVERY_INITIAL, ...f.raw });
    const prepare = f.db.prepare.bind(f.db);
    f.db.prepare = query => {
      if (query.includes('SELECT company,body FROM delivery_client_snapshots'))
        throw new Error('Unchanged state reconstructed all client slices');
      return prepare(query);
    };
    const unchanged = await (await readStateBatch(new Request(`${url}&versions=ontology.delivery.v2:41`), env)).json();
    f.db.prepare = prepare;
    assert.deepEqual(unchanged.unchanged, [DELIVERY]);
    assert.deepEqual(unchanged.documents, []);
    f.sql.prepare('UPDATE delivery_client_shadow_meta SET compatibility_version=42').run();
    const updated = await (await readStateBatch(new Request(`${url}&versions=ontology.delivery.v2:41`), env)).json();
    assert.deepEqual(updated.unchanged, []);
    assert.equal(updated.documents[0].version, 42, 'the logical revision wins over the frozen physical version');
    const withAlerts = await (await readStateBatch(new Request(`${url}&versions=ontology.delivery.v2:42&with=alerts`), env)).json();
    assert.deepEqual(withAlerts.unchanged, [DELIVERY]);
    assert.ok(withAlerts.alerts === null || typeof withAlerts.alerts?.count === 'number');
    await rollbackClientAuthority(f.db, 'default', 42, 'test:state-revalidation');
    const reverted = await (await readStateBatch(new Request(`${url}&versions=ontology.delivery.v2:41`), env)).json();
    assert.equal(reverted.documents[0].version, 42, 'shadow authority returns the restored physical revision');
  } finally { f.sql.close(); }
});

test('active bridge commits a client slice without touching the frozen global document', async () => {
  const f = populated();
  try {
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    await attachClientPageHead(f, 'one');
    const frozen = f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY);
    const next = { extraTasks: [{ ...f.raw.extraTasks[0], title: 'Changed',
      history: [{ field: 'title', at: '2026-09-27T10:00:00Z', to: 'Changed' }] }, f.raw.extraTasks[1]] };
    await f.commit('active-one', DELIVERY, 41, next);
    assert.deepEqual(f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY), frozen);
    const current = await getDoc(f.db, 'default', DELIVERY);
    assert.equal(current.version, 42);
    assert.equal(current.value.extraTasks[0].title, 'Changed');
    assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='one'").get().revision, 2);
    assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='two'").get().revision, 1);
    assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version, 42);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM delivery_task_history WHERE task_id='one-a'").get().n, 1);
    const page = await readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 0, 10, {});
    assert.equal(page.data.find(row => row.id === 'one-a').title, 'Changed');
    assert.equal(page.snapshotVersion, 42);
    await f.commit('active-one', DELIVERY, 41, next);
    assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version, 42);
    await assert.rejects(f.commit('active-stale', DELIVERY, 41, next), { code: 'version_conflict' });
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='active-stale'").get().n, 0);
  } finally { f.sql.close(); }
});

test('active bridge advances raw deadline dependencies with the client revision', async () => {
  const raw = { extraTasks: [
    { ...task('one-a', 'one'), deadline: { mode: 'task', taskId: 'two-a' } },
    task('two-a', 'two'),
  ] };
  const f = populated(raw);
  try {
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    for (const company of ['one', 'two']) {
      const slice = f.sql.prepare(`SELECT revision,incarnation FROM delivery_client_snapshots
        WHERE company=?`).get(company);
      f.sql.prepare(`INSERT INTO delivery_client_deadline_heads
        (workspace_id,company,authority_generation,source_revision,source_incarnation,
         projection_generation,expected_dependencies,updated_at)
        VALUES('default',?,'shadow',?,?,?,?,'now')`)
        .run(company, slice.revision, slice.incarnation, 'deadlines', company === 'one' ? 1 : 0);
    }
    f.sql.prepare(`INSERT INTO delivery_client_deadline_dependencies
      (workspace_id,projection_generation,company,source_task_id,target_task_id)
      VALUES('default','deadlines','one','one-a','two-a')`).run();
    const next = { extraTasks: [
      { ...raw.extraTasks[0], deadline: { mode: 'task', taskId: 'new-target' } },
      raw.extraTasks[1],
    ] };
    await f.commit('deadline-change', DELIVERY, 41, next);
    assert.deepEqual({ ...f.sql.prepare(`SELECT source_revision,expected_dependencies
      FROM delivery_client_deadline_heads WHERE company='one'`).get() },
    { source_revision: 2, expected_dependencies: 1 });
    assert.equal(f.sql.prepare(`SELECT target_task_id FROM delivery_client_deadline_dependencies
      WHERE company='one' AND source_task_id='one-a'`).get().target_task_id, 'new-target');
    assert.equal(f.sql.prepare(`SELECT source_revision FROM delivery_client_deadline_heads
      WHERE company='two'`).get().source_revision, 1);
  } finally { f.sql.close(); }
});

test('active API comment updates one client, replays safely and preserves exact reconstruction', async () => {
  const clients = { extraClients: ['one', 'two'].map(slug => ({ slug, name: slug,
    status: 'ativo', startedAt: '2026-01-01', leadId: 'admin', csId: 'admin', milestone: 1 })) };
  const f = populated({ extraTasks: [task('one-a', 'one'), task('two-a', 'two')] }, clients);
  try {
    f.sql.prepare(`INSERT INTO state_documents(workspace_id,key,version,body)
      VALUES('default','ontology.workspace.v3',1,?)`).run(JSON.stringify({
      extraMembers: [{ id: 'admin', name: 'Admin', email: 'admin@example.test', access: 'admin' }],
    }));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    await attachClientPageHead(f, 'one');
    const frozen = f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY);
    const token = await issueIntegrationCredential(f.db, 'default', 'admin@example.test', {
      name: 'Test', ownerEmail: 'admin@example.test', scopes: ['delivery:write'],
      companies: ['one'], expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const env = { DB: f.db };
    const principal = await resolveOperationPrincipal(new Request('https://delivery.test', {
      headers: { authorization: `Bearer ${token.token}` },
    }), env);
    const run = (key, text, versions = {}) => executeDeliveryCommand(env, principal,
      'tasks.comment', { taskId: 'one-a', text }, key, versions);
    const prepared = [];
    const originalPrepare = f.db.prepare;
    f.db.prepare = query => { prepared.push(query); return originalPrepare(query); };
    let result;
    try { result = await run('first-comment', 'Observação'); }
    finally { f.db.prepare = originalPrepare; }
    // O resumo (0042) se certifica pela própria fatia (`INSERT … SELECT`), não é uma leitura dela.
    assert.equal(prepared.filter(query => query.includes('delivery_client_snapshots') &&
      !query.includes('INSERT INTO delivery_client_summary')).length, 2,
      'one joined client read and one scoped update are expected');
    assert.equal(prepared.filter(query => query.includes('INSERT INTO delivery_client_summary')).length, 1);
    assert.ok(!prepared.some(query => query.includes('delivery_client_array_order') ||
      query.includes('delivery_client_orphans') ||
      query.includes('SELECT company,body FROM delivery_client_snapshots')),
    'the command must not reconstruct the workspace');
    assert.equal(result.data.task.comments.at(-1).text, 'Observação');
    assert.deepEqual(result.documents, []);
    assert.deepEqual(f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY), frozen);
    assert.deepEqual(f.sql.prepare('SELECT company,revision FROM delivery_client_snapshots ORDER BY company')
      .all().map(row => [row.company, row.revision]), [['one', 2], ['two', 1]]);
    assert.deepEqual(Object.values(f.sql.prepare('SELECT compatibility_version,expected_map_order FROM delivery_client_shadow_meta').get()), [42, 1]);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM delivery_client_map_order WHERE kind='taskPatches' AND id='one-a'").get().n, 1);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM delivery_task_history WHERE task_id='one-a'").get().n, 1);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_events WHERE type='tasks.comment'").get().n, 1);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM client_audit_log WHERE command='tasks.comment'").get().n, 1);
    assert.equal((await readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 0, 10, {}))
      .data.find(row => row.id === 'one-a').comments.at(-1).text, 'Observação');
    const reconstructed = await getDoc(f.db, 'default', DELIVERY);
    assert.equal(reconstructed.version, 42);
    assert.equal(reconstructed.value.taskPatches['one-a'].comments.length, 1);
    await run('first-comment', 'Observação');
    assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version, 42);
    await assert.rejects(run('stale-comment', 'Novo', { [DELIVERY]: 41 }), { code: 'version_conflict' });
    await run('second-comment', 'Segunda');
    assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version, 43);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM delivery_client_map_order WHERE kind='taskPatches' AND id='one-a'").get().n, 1);
    assert.equal((await getDoc(f.db, 'default', DELIVERY)).value.taskPatches['one-a'].comments.length, 2);
    await assert.rejects(executeDeliveryCommand(env, principal,
      'tasks.comment', { taskId: 'two-a', text: 'Fora do escopo' }, 'other-client'),
    { code: 'client_not_allowed' });
    const historyBeforeFailure = f.sql.prepare("SELECT COUNT(*) AS n FROM delivery_task_history WHERE task_id='one-a'").get().n;
    f.sql.exec(`CREATE TRIGGER fail_fast_comment BEFORE UPDATE ON delivery_client_snapshots
      BEGIN SELECT RAISE(ABORT,'injected_fast_comment_failure'); END`);
    await assert.rejects(run('failed-comment', 'Falha'), /injected_fast_comment_failure/);
    f.sql.exec('DROP TRIGGER fail_fast_comment');
    assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version, 43);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM delivery_task_history WHERE task_id='one-a'").get().n, historyBeforeFailure);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='failed-comment'").get().n, 0);
    const originalBatch = f.db.batch;
    f.db.batch = async statements => {
      f.db.batch = originalBatch;
      f.sql.prepare('UPDATE delivery_client_shadow_meta SET compatibility_version=compatibility_version+1').run();
      return originalBatch(statements);
    };
    await assert.rejects(run('raced-comment', 'Concorrente', { [DELIVERY]: 43 }),
      { code: 'version_conflict' });
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='raced-comment'").get().n, 0);
    assert.equal((await getDoc(f.db, 'default', DELIVERY)).value.taskPatches['one-a'].comments.length, 2);
    const prior = f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='one'").get();
    const recreated = structuredClone((await readClientShadowSnapshot(f.db, 'default', 'one')).snapshot);
    recreated.extraTasks[0].title = 'Cliente recriado';
    const recreatedBody = JSON.stringify(recreated);
    const recreatedHash = createHash('sha256').update(recreatedBody).digest('hex');
    const originalReadPrepare = f.db.prepare;
    let replaced = false;
    f.db.prepare = query => {
      const prepared = originalReadPrepare(query);
      if (!query.includes('o.company,s.revision,s.incarnation')) return prepared;
      const originalBind = prepared.bind;
      prepared.bind = (...args) => {
        const bound = originalBind.call(prepared, ...args);
        const originalFirst = bound.first;
        bound.first = async () => {
          const found = await originalFirst();
          if (!replaced) {
            replaced = true;
            f.sql.prepare("DELETE FROM delivery_client_snapshots WHERE company='one'").run();
            f.sql.prepare(`INSERT INTO delivery_client_snapshots
              (workspace_id,generation,company,revision,body,body_sha256,incarnation)
              VALUES('default','shadow','one',?,?,?,?)`)
              .run(prior.revision, recreatedBody, recreatedHash, crypto.randomUUID());
          }
          return found;
        };
        return bound;
      };
      return prepared;
    };
    try {
      await assert.rejects(run('recreated-comment', 'Não sobrescrever'), { code: 'version_conflict' });
    } finally { f.db.prepare = originalReadPrepare; }
    assert.equal(replaced, true);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='recreated-comment'").get().n, 0);
    assert.equal((await readClientShadowSnapshot(f.db, 'default', 'one')).snapshot.extraTasks[0].title, 'Cliente recriado');
    f.sql.prepare("DELETE FROM delivery_entity_owners WHERE kind='task' AND id='one-a'").run();
    assert.equal((await run('first-comment', 'Observação')).data.task.id, 'one-a',
      'replay survives removal of the task after the original commit');
    await revokeIntegrationCredential(f.db, 'default', 'admin@example.test', token.id);
    await assert.rejects(run('first-comment', 'Observação'), { code: 'invalid_token' });
  } finally { f.sql.close(); }
});

test('active API task edits share domain rules and commit separate client revisions without global reads', async () => {
  const f = populated({ extraTasks: [{ ...task('one-a', 'one'), journeyId: 'private' }, task('two-a', 'two')],
    productPlans: { private: { id: 'private', title: 'Plano privado' } } }, {
    extraClients: ['one', 'two'].map(slug => ({ slug, name: slug, status: 'ativo' })),
  });
  try {
    f.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', 'ontology.workspace.v3', JSON.stringify({
        extraMembers: [{ id: 'admin', name: 'Admin', email: 'admin@example.test', access: 'admin' }],
      }));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    await attachClientPageHead(f, 'one');
    const frozen = f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY);
    const token = await issueIntegrationCredential(f.db, 'default', 'admin@example.test', {
      name: 'Task edits', ownerEmail: 'admin@example.test', scopes: ['delivery:write'],
      companies: ['one', 'two'], expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const env = { DB: f.db };
    const principal = await resolveOperationPrincipal(new Request('https://delivery.test', {
      headers: { authorization: `Bearer ${token.token}` },
    }), env);
    const prepared = [];
    const originalPrepare = f.db.prepare;
    f.db.prepare = query => {
      const statement = originalPrepare(query), bind = statement.bind;
      statement.bind = (...args) => {
        prepared.push({ query, args });
        return bind.call(statement, ...args);
      };
      return statement;
    };
    try {
      const [one, two] = await Promise.all([
        executeDeliveryCommand(env, principal, 'tasks.update',
          { taskId: 'one-a', patch: { title: 'Primeiro' } }, 'edit-one'),
        executeDeliveryCommand(env, principal, 'tasks.update',
          { taskId: 'two-a', patch: { title: 'Segundo' } }, 'edit-two'),
      ]);
      assert.equal(one.data.task.title, 'Primeiro');
      assert.equal(two.data.task.title, 'Segundo');
    } finally { f.db.prepare = originalPrepare; }
    assert.ok(!prepared.some(({ args }) => args.includes(DELIVERY)),
    'scoped task edits must not read the global delivery body');
    assert.deepEqual(f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY), frozen);
    assert.deepEqual(f.sql.prepare('SELECT company,revision FROM delivery_client_snapshots ORDER BY company')
      .all().map(row => [row.company, row.revision]), [['one', 2], ['two', 2]]);
    assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version, 43);
    assert.equal((await getDoc(f.db, 'default', DELIVERY)).value.taskPatches['one-a'].title, 'Primeiro');
    assert.equal((await getDoc(f.db, 'default', DELIVERY)).value.taskPatches['two-a'].title, 'Segundo');
    assert.equal((await readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 0, 10, {}))
      .data.find(row => row.id === 'one-a').title, 'Primeiro');
    const replay = await executeDeliveryCommand(env, principal, 'tasks.update',
      { taskId: 'one-a', patch: { title: 'Primeiro' } }, 'edit-one');
    assert.equal(replay.data.task.title, 'Primeiro');
    assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='one'").get().revision, 2);
    const added = await executeDeliveryCommand(env, principal, 'tasks.checklist',
      { taskId: 'one-a', action: 'add', title: 'Validar' }, 'check-add');
    const item = added.data.task.checklist[0];
    await assert.rejects(executeDeliveryCommand(env, principal, 'tasks.complete',
      { taskId: 'one-a' }, 'early-complete'), { code: 'invalid_input' });
    await executeDeliveryCommand(env, principal, 'tasks.checklist',
      { taskId: 'one-a', action: 'set', itemId: item.id, done: true }, 'check-done');
    const completed = await executeDeliveryCommand(env, principal, 'tasks.complete',
      { taskId: 'one-a' }, 'complete-one');
    assert.equal(completed.data.task.status, 'entregue');
    assert.equal((await getDoc(f.db, 'default', DELIVERY)).value.taskPatches['one-a'].status, 'entregue');
    await assert.rejects(executeDeliveryCommand(env, principal, 'tasks.update',
      { taskId: 'one-a', patch: { dueAt: '2026-10-01' } }, 'late-due'), { code: 'invalid_input' });
    const blocked = await executeDeliveryCommand(env, principal, 'tasks.blocker',
      { taskId: 'two-a', blocker: { reason: 'Aguardando retorno' } }, 'block-two');
    assert.equal(blocked.data.task.blockers, 'Aguardando retorno');
    const versionBeforeFailure = f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version;
    f.sql.exec(`CREATE TRIGGER fail_scoped_task BEFORE UPDATE ON delivery_client_snapshots
      WHEN OLD.company='two' BEGIN SELECT RAISE(ABORT,'injected_scoped_failure'); END`);
    await assert.rejects(executeDeliveryCommand(env, principal, 'tasks.update',
      { taskId: 'two-a', patch: { title: 'Não gravar' } }, 'failed-two'), /injected_scoped_failure/);
    f.sql.exec('DROP TRIGGER fail_scoped_task');
    assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version,
      versionBeforeFailure);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='failed-two'").get().n, 0);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_events WHERE type='tasks.update'").get().n, 2);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM client_audit_log WHERE command='tasks.update'").get().n, 2);
    await assert.rejects(executeDeliveryCommand(env, principal, 'tasks.update',
      { taskId: 'one-a', patch: { journeyId: 'orphan' } }, 'orphan-plan'),
    { code: 'execution_ownership_ambiguous' });
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='orphan-plan'").get().n, 0);
    for (const [command, key, input] of [
      ['tasks.update', 'shared-plan-update', { taskId: 'two-a', patch: { journeyId: 'private' } }],
      ['tasks.complete', 'shared-plan-complete', { taskId: 'two-a', patch: { journeyId: 'private' } }],
      ['tasks.create', 'shared-plan-create', { company: 'two', task: {
        title: 'Referência indevida', ownerId: 'admin', dueAt: '2026-10-01', journeyId: 'private',
      } }],
    ]) {
      await assert.rejects(executeDeliveryCommand(env, principal, command, input, key),
        { code: 'execution_ownership_ambiguous' });
      assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key=?').get(key).n, 0);
    }
    f.sql.prepare("UPDATE delivery_client_snapshots SET body_sha256='bad' WHERE company='two'").run();
    await assert.rejects(executeDeliveryCommand(env, principal, 'tasks.update',
      { taskId: 'two-a', patch: { title: 'Não gravar' } }, 'corrupt-two'),
    { code: 'execution_snapshot_incomplete' });
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='corrupt-two'").get().n, 0);
  } finally { f.sql.close(); }
});

test('active API creation and cycle changes keep global order and owner indexes reversible', async () => {
  const f = populated({ extraTasks: [task('one-a', 'one'), task('two-a', 'two')] }, {
    extraClients: ['one', 'two'].map(slug => ({ slug, name: slug, status: 'ativo' })),
  });
  try {
    f.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', 'ontology.workspace.v3', JSON.stringify({
        extraMembers: [{ id: 'admin', name: 'Admin', email: 'admin@example.test', access: 'admin' }],
      }));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const frozen = f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY);
    const token = await issueIntegrationCredential(f.db, 'default', 'admin@example.test', {
      name: 'Creation', ownerEmail: 'admin@example.test', scopes: ['delivery:write'],
      companies: ['one'], expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const env = { DB: f.db };
    const principal = await resolveOperationPrincipal(new Request('https://delivery.test', {
      headers: { authorization: `Bearer ${token.token}` },
    }), env);
    const created = await executeDeliveryCommand(env, principal, 'tasks.create',
      { company: 'one', task: { title: 'Nova', ownerId: 'admin', dueAt: '2026-10-01' } }, 'create-one');
    assert.equal(f.sql.prepare("SELECT company FROM delivery_entity_owners WHERE kind='task' AND id=?")
      .get(created.data.task.id).company, 'one');
    const cycle = await executeDeliveryCommand(env, principal, 'cycles.save', {
      company: 'one', cycle: { name: 'Ciclo', goal: 'Entrega', startsAt: '2026-09-27',
        endsAt: '2026-10-31', ownerId: 'admin', taskIds: [], acceptance: [{ text: 'Aceite' }] },
      tasks: [{ title: 'Gerada', ownerId: 'admin', dueAt: '2026-10-02' }],
    }, 'create-cycle');
    const generated = cycle.data.tasks[0];
    assert.equal(f.sql.prepare("SELECT company FROM delivery_entity_owners WHERE kind='cycle' AND id=?")
      .get(cycle.data.cycle.id).company, 'one');
    const combined = await getDoc(f.db, 'default', DELIVERY);
    assert.deepEqual(combined.value.extraTasks.map(row => row.id),
      [generated.id, 'one-a', 'two-a', created.data.task.id]);
    assert.equal(combined.value.extraCycles[0].id, cycle.data.cycle.id);
    await executeDeliveryCommand(env, principal, 'cycles.remove',
      { cycleId: cycle.data.cycle.id }, 'remove-cycle');
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM delivery_entity_owners WHERE kind='cycle' AND id=?")
      .get(cycle.data.cycle.id).n, 0);
    assert.deepEqual(f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY), frozen);
    assert.equal((await getDoc(f.db, 'default', DELIVERY)).value.extraCycles.length, 0);
    assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version, 44);
    assert.equal(f.sql.prepare('SELECT expected_array_order FROM delivery_client_shadow_meta').get().expected_array_order, 4);
  } finally { f.sql.close(); }
});

test('session scoped task commands confirm a client revision without a global document', async () => {
  const f = populated({ extraTasks: [task('one-a', 'one'), task('two-a', 'two')] }, {
    extraClients: ['one', 'two'].map(slug => ({ slug, name: slug, status: 'ativo' })),
  });
  try {
    f.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', 'ontology.workspace.v3', JSON.stringify({
        extraMembers: [{ id: 'admin', name: 'Admin', email: 'admin@example.test', access: 'admin' }],
      }));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const frozen = f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY);
    const principal = { id: 'member:admin', kind: 'session', memberId: 'admin',
      email: 'admin@example.test', access: 'admin', application: 'web', scopes: null,
      companies: null, guards: [] };
    const env = { DB: f.db };
    const first = await readClientShadowSnapshot(f.db, 'default', 'one');
    const original = first.clientSnapshot;
    const input = { taskId: 'one-a', patch: { title: 'Atualizada' } };
    const result = await executeDeliveryCommand(env, principal, 'tasks.update', input,
      'session-scoped-task', {}, false, original);
    assert.deepEqual(result.documents, []);
    assert.equal(result.clientSnapshot, original.replace(/:1$/, ':2'));
    assert.equal(result.data.task.title, 'Atualizada');
    assert.deepEqual(await executeDeliveryCommand(env, principal, 'tasks.update', input,
      'session-scoped-task', {}, false, original), result);
    await assert.rejects(executeDeliveryCommand(env, principal, 'tasks.update',
      { taskId: 'one-a', patch: { title: 'Outra' } }, 'session-scoped-stale', {}, false, original),
    { code: 'snapshot_changed' });
    const planChange = await executeDeliveryCommand(env, principal, 'tasks.update',
      { taskId: 'one-a', patch: { journeyId: 'service-delivery' } },
      'session-scoped-plan', {}, false, result.clientSnapshot);
    assert.equal(planChange.data.task.journeyId, 'service-delivery');
    assert.equal(planChange.clientSnapshot, original.replace(/:1$/, ':3'));
    assert.deepEqual(f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY), frozen);
    assert.equal((await getDoc(f.db, 'default', DELIVERY)).value.extraTasks.find(row => row.id === 'one-a').title,
      'Atualizada');
  } finally { f.sql.close(); }
});

test('active task plan change refuses to orphan a private plan', async () => {
  const privatePlan = { id: 'private-only', name: 'Privado', description: '', milestones: [
    { n: 1, name: 'Início', stage: 'Execução', owner: 'Equipe' },
  ] };
  const f = populated({ extraTasks: [{ ...task('one-a', 'one'), journeyId: 'private-only' }],
    productPlans: { 'private-only': privatePlan } }, {
    extraClients: [{ slug: 'one', name: 'Um', status: 'ativo' }],
  });
  try {
    f.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', 'ontology.workspace.v3', JSON.stringify({
        extraMembers: [{ id: 'admin', name: 'Admin', email: 'admin@example.test', access: 'admin' }],
      }));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const principal = { id: 'member:admin', kind: 'session', memberId: 'admin',
      email: 'admin@example.test', access: 'admin', application: 'web', scopes: null,
      companies: null, guards: [] };
    const before = f.sql.prepare("SELECT revision,body FROM delivery_client_snapshots WHERE company='one'").get();
    const marker = (await readClientShadowSnapshot(f.db, 'default', 'one')).clientSnapshot;
    await assert.rejects(executeDeliveryCommand({ DB: f.db }, principal, 'tasks.update',
      { taskId: 'one-a', patch: { journeyId: 'service-delivery' } },
      'orphan-task-plan', {}, false, marker), { code: 'scoped_command_unavailable' });
    assert.deepEqual(f.sql.prepare("SELECT revision,body FROM delivery_client_snapshots WHERE company='one'").get(), before);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='orphan-task-plan'").get().n, 0);
  } finally { f.sql.close(); }
});

test('active task plan change rejects a public ID owned as a private plan by another client', async () => {
  const privatePlan = { id: 'service-delivery', name: 'Privado homônimo', description: '', milestones: [
    { n: 1, name: 'Início', stage: 'Execução', owner: 'Equipe' },
  ] };
  const f = populated({ extraTasks: [task('one-a', 'one'), task('one-b', 'one'),
    { ...task('two-a', 'two'), journeyId: 'service-delivery' }],
    taskPatches: { 'one-b': { journeyId: 'service-delivery' } },
    productPlans: { 'service-delivery': privatePlan } }, {
    extraClients: ['one', 'two'].map(slug => ({ slug, name: slug, status: 'ativo' })),
  });
  try {
    f.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', 'ontology.workspace.v3', JSON.stringify({
        extraMembers: [{ id: 'admin', name: 'Admin', email: 'admin@example.test', access: 'admin' }],
      }));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const principal = { id: 'member:admin', kind: 'session', memberId: 'admin',
      email: 'admin@example.test', access: 'admin', application: 'web', scopes: null,
      companies: null, guards: [] };
    const before = f.sql.prepare("SELECT revision,body FROM delivery_client_snapshots WHERE company='one'").get();
    const marker = (await readClientShadowSnapshot(f.db, 'default', 'one')).clientSnapshot;
    await assert.rejects(executeDeliveryCommand({ DB: f.db }, principal, 'tasks.update',
      { taskId: 'one-a', patch: { journeyId: 'service-delivery' } },
      'colliding-task-plan', {}, false, marker), { code: 'scoped_command_unavailable' });
    assert.deepEqual(f.sql.prepare("SELECT revision,body FROM delivery_client_snapshots WHERE company='one'").get(), before);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='colliding-task-plan'").get().n, 0);
  } finally { f.sql.close(); }
});

test('active task plan claim aborts if the global private-plan index can change before commit', async () => {
  const f = populated({ extraTasks: [task('one-a', 'one')] }, {
    extraClients: [{ slug: 'one', name: 'Um', status: 'ativo' }],
  });
  try {
    f.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', 'ontology.workspace.v3', JSON.stringify({
        extraMembers: [{ id: 'admin', name: 'Admin', email: 'admin@example.test', access: 'admin' }],
      }));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const principal = { id: 'member:admin', kind: 'session', memberId: 'admin',
      email: 'admin@example.test', access: 'admin', application: 'web', scopes: null,
      companies: null, guards: [] };
    const before = f.sql.prepare("SELECT revision,body FROM delivery_client_snapshots WHERE company='one'").get();
    const batch = f.db.batch.bind(f.db);
    f.db.batch = async statements => {
      f.sql.prepare('UPDATE delivery_client_shadow_meta SET compatibility_version=compatibility_version+1').run();
      return batch(statements);
    };
    await assert.rejects(executeDeliveryCommand({ DB: f.db }, principal, 'tasks.update',
      { taskId: 'one-a', patch: { journeyId: 'service-delivery' } },
      'racing-task-plan'), { code: 'version_conflict' });
    assert.deepEqual(f.sql.prepare("SELECT revision,body FROM delivery_client_snapshots WHERE company='one'").get(), before);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='racing-task-plan'").get().n, 0);
  } finally { f.sql.close(); }
});

test('browser task edits and comments without a marker stay in the client slice across retries', async () => {
  const f = populated({ extraTasks: [task('one-a', 'one'), task('two-a', 'two')] }, {
    extraClients: ['one', 'two'].map(slug => ({ slug, name: slug, status: 'ativo' })),
  });
  try {
    f.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', 'ontology.workspace.v3', JSON.stringify({
        extraMembers: [{ id: 'admin', name: 'Admin', email: 'admin@example.test', access: 'admin' }],
      }));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const frozen = f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY);
    const principal = { id: 'member:admin', kind: 'session', memberId: 'admin',
      email: 'admin@example.test', access: 'admin', application: 'web', scopes: null,
      companies: null, guards: [] };
    const env = { DB: f.db },input = { taskId: 'one-a', patch: { title: 'Atualizada' } };
    const first = await executeDeliveryCommand(env, principal, 'tasks.update', input, 'browser-task');
    assert.deepEqual(first.documents, []);
    assert.ok(first.clientSnapshot);
    assert.deepEqual(await executeDeliveryCommand(env, principal, 'tasks.update', input, 'browser-task'), first);
    const comment = await executeDeliveryCommand(env, principal, 'tasks.comment',
      { taskId: 'one-a', text: 'Comentário' }, 'browser-comment');
    assert.deepEqual(comment.documents, []);
    assert.ok(comment.clientSnapshot);
    assert.equal((await getDoc(f.db, 'default', DELIVERY)).value.extraTasks
      .find(row => row.id === 'one-a').comments.at(-1).text, 'Comentário');
    assert.deepEqual(f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY), frozen);
    assert.equal((await readClientShadowSnapshot(f.db, 'default', 'two')).revision, 1);
  } finally { f.sql.close(); }
});

test('session scoped bulk edits only one client and preserve the frozen global document', async () => {
  const f = populated({ extraTasks: [task('one-a', 'one'), task('one-b', 'one'), task('two-a', 'two')] }, {
    extraClients: ['one', 'two'].map(slug => ({ slug, name: slug, status: 'ativo' })),
  });
  try {
    f.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', 'ontology.workspace.v3', JSON.stringify({
        extraMembers: [{ id: 'admin', name: 'Admin', email: 'admin@example.test', access: 'admin' }],
      }));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const frozen = f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY);
    const principal = { id: 'member:admin', kind: 'session', memberId: 'admin',
      email: 'admin@example.test', access: 'admin', application: 'web', scopes: null,
      companies: null, guards: [] };
    const env = { DB: f.db };
    const marker = (await readClientShadowSnapshot(f.db, 'default', 'one')).clientSnapshot;
    const result = await executeDeliveryCommand(env, principal, 'tasks.update',
      { taskIds: ['one-a', 'one-b'], patch: { status: 'em-curso' } },
      'scoped-bulk-one', {}, false, marker);
    assert.deepEqual(result.documents, []);
    assert.equal(result.clientSnapshot, marker.replace(/:1$/, ':2'));
    assert.deepEqual(result.data.tasks.map(row => row.status), ['em-curso', 'em-curso']);
    assert.equal((await readClientShadowSnapshot(f.db, 'default', 'two')).clientSnapshot.split(':').at(-1), '1');
    await assert.rejects(executeDeliveryCommand(env, principal, 'tasks.update',
      { taskIds: ['one-a', 'two-a'], patch: { status: 'revisao' } },
      'scoped-bulk-mixed', {}, false, result.clientSnapshot),
    { code: 'invalid_input' });
    const legacy = await executeDeliveryCommand(env, principal, 'tasks.update',
      { taskIds: ['one-a', 'two-a'], patch: { status: 'revisao' } },
      'legacy-bulk-mixed');
    assert.deepEqual(legacy.data.tasks.map(row => row.status), ['revisao', 'revisao']);
    assert.deepEqual(f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY), frozen);
  } finally { f.sql.close(); }
});

test('unmarked task batch for one client uses its active slice and replays without global reconstruction', async () => {
  const f = populated({ extraTasks: [task('one-a', 'one'), task('one-b', 'one'), task('two-a', 'two')] }, {
    extraClients: ['one', 'two'].map(slug => ({ slug, name: slug, status: 'ativo' })),
  });
  try {
    f.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', 'ontology.workspace.v3', JSON.stringify({
        extraMembers: [{ id: 'admin', name: 'Admin', email: 'admin@example.test', access: 'admin' }],
      }));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const frozen = f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY);
    const principal = { id: 'member:admin', kind: 'session', memberId: 'admin',
      email: 'admin@example.test', access: 'admin', application: 'web', scopes: null,
      companies: null, guards: [] };
    const prepare = f.db.prepare.bind(f.db);
    f.db.prepare = query => {
      if (/SELECT company,body FROM delivery_client_snapshots\s+WHERE workspace_id=\? AND generation=\? ORDER BY company/.test(query))
        throw new Error('Unexpected global execution reconstruction');
      return prepare(query);
    };
    const env = { DB: f.db }, input = { taskIds: ['one-a', 'one-b'], patch: { status: 'em-curso' } };
    const result = await executeDeliveryCommand(env, principal, 'tasks.update', input, 'unmarked-bulk');
    assert.deepEqual(result.documents, []);
    assert.deepEqual(result.data.tasks.map(row => row.status), ['em-curso', 'em-curso']);
    assert.deepEqual(await executeDeliveryCommand(env, principal, 'tasks.update', input, 'unmarked-bulk'), result);
    assert.equal((await readClientShadowSnapshot(f.db, 'default', 'one')).revision, 2);
    assert.equal((await readClientShadowSnapshot(f.db, 'default', 'two')).revision, 1);
    assert.deepEqual(f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY), frozen);
  } finally { f.sql.close(); }
});

test('first standalone task in an empty client appends after other clients tasks', async () => {
  const f = populated({ extraTasks: [task('two-a', 'two')] }, {
    extraClients: ['one', 'two'].map(slug => ({ slug, name: slug, status: 'ativo' })),
  });
  try {
    const empty = JSON.stringify({});
    f.sql.prepare(`INSERT INTO delivery_client_snapshots
      (workspace_id,generation,company,revision,body,body_sha256,incarnation)
      VALUES('default','shadow','one',1,?,?,?)`)
      .run(empty, createHash('sha256').update(empty).digest('hex'), crypto.randomUUID());
    f.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', 'ontology.workspace.v3', JSON.stringify({
        extraMembers: [{ id: 'admin', name: 'Admin', email: 'admin@example.test', access: 'admin' }],
      }));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const principal = { id: 'member:admin', kind: 'session', memberId: 'admin',
      email: 'admin@example.test', access: 'admin', application: 'web', scopes: null,
      companies: null, guards: [] };
    const marker = (await readClientShadowSnapshot(f.db, 'default', 'one')).clientSnapshot;
    const created = await executeDeliveryCommand({ DB: f.db }, principal, 'tasks.create',
      { company: 'one', task: { title: 'Nova', ownerId: 'admin', dueAt: '2026-10-01' } },
      'first-standalone-one', {}, false, marker);
    assert.deepEqual((await getDoc(f.db, 'default', DELIVERY)).value.extraTasks.map(row => row.id),
      ['two-a', created.data.task.id]);
  } finally { f.sql.close(); }
});

test('REST command forwards the client snapshot header to the scoped writer', async () => {
  const f = populated({ extraTasks: [task('one-a', 'one')] }, {
    extraClients: [{ slug: 'one', name: 'One', status: 'ativo' }],
  });
  try {
    f.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', 'ontology.workspace.v3', JSON.stringify({
        extraMembers: [{ id: 'admin', name: 'Admin', email: 'admin@example.test', access: 'admin' }],
      }));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41,expected_clients=1").run();
    const token = await issueIntegrationCredential(f.db, 'default', 'admin@example.test', {
      name: 'Scoped REST', ownerEmail: 'admin@example.test', scopes: ['delivery:write'],
      companies: ['one'], expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const marker = (await readClientShadowSnapshot(f.db, 'default', 'one')).clientSnapshot;
    const request = new Request('https://delivery.test/api/v1/commands', { method: 'POST',
      headers: { authorization: `Bearer ${token.token}`, 'content-type': 'application/json',
        'idempotency-key': 'rest-scoped-task', 'x-client-snapshot': marker },
      body: JSON.stringify({ command: 'tasks.update', input: {
        taskId: 'one-a', patch: { title: 'Via REST' },
      } }),
    });
    const response = await apiResponse(request, { DB: f.db }, ['commands']);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.task.title, 'Via REST');
    assert.equal(body.clientSnapshot, marker.replace(/:1$/, ':2'));
    assert.deepEqual(body.documents, []);
    const unsupported = await apiResponse(new Request('https://delivery.test/api/v1/commands', {
      method: 'POST', headers: { authorization: `Bearer ${token.token}`,
        'content-type': 'application/json', 'idempotency-key': 'unsupported-snapshot',
        'x-client-snapshot': marker },
      body: JSON.stringify({ command: 'workspace.settings.update', input: {} }),
    }), { DB: f.db }, ['commands']);
    assert.equal(unsupported.status, 400);
    assert.equal((await unsupported.json()).error.code, 'invalid_filter');
  } finally { f.sql.close(); }
});

test('client execution snapshot exposes only the authorized active slice', async () => {
  const f = populated({ extraTasks: [task('one-a', 'one'), task('two-a', 'two')] }, {
    extraClients: ['one', 'two'].map(slug => ({ slug, name: slug, status: 'ativo' })),
  });
  try {
    f.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', 'ontology.workspace.v3', JSON.stringify({
        extraMembers: [{ id: 'admin', name: 'Admin', email: 'admin@example.test', access: 'admin' }],
      }));
    const credential = await issueIntegrationCredential(f.db, 'default', 'admin@example.test', {
      name: 'Scoped read', ownerEmail: 'admin@example.test', scopes: ['delivery:read'],
      companies: ['one'], expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const get = company => apiResponse(new Request(
      `https://delivery.test/api/v1/clients/${company}/execution-snapshot`,
      { headers: { authorization: `Bearer ${credential.token}` } }),
    { DB: f.db }, ['clients', company, 'execution-snapshot']);
    const shadow = await get('one');
    assert.equal(shadow.status, 200);
    assert.deepEqual((await shadow.json()).data, { mode: 'legacy' });
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const active = await get('one');
    assert.equal(active.status, 200);
    const body = (await active.json()).data;
    assert.equal(body.mode, 'active');
    assert.match(body.clientSnapshot, /^shadow:/);
    assert.deepEqual(body.snapshot.extraTasks.map(row => row.id), ['one-a']);
    assert.equal((await get('two')).status, 403);
  } finally { f.sql.close(); }
});

test('active cycle edits and tasks created inside a cycle preserve cross-client order', async () => {
  const f = populated({ extraTasks: [task('two-a', 'two')] }, {
    extraClients: ['one', 'two'].map(slug => ({ slug, name: slug, status: 'ativo' })),
  });
  try {
    const empty = JSON.stringify({});
    f.sql.prepare(`INSERT INTO delivery_client_snapshots
      (workspace_id,generation,company,revision,body,body_sha256,incarnation)
      VALUES('default','shadow','one',1,?,?,?)`)
      .run(empty, createHash('sha256').update(empty).digest('hex'), crypto.randomUUID());
    f.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', 'ontology.workspace.v3', JSON.stringify({
        extraMembers: [{ id: 'admin', name: 'Admin', email: 'admin@example.test', access: 'admin' }],
      }));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const frozen = f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY);
    const token = await issueIntegrationCredential(f.db, 'default', 'admin@example.test', {
      name: 'Order', ownerEmail: 'admin@example.test', scopes: ['delivery:write'],
      companies: ['one', 'two'], expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const env = { DB: f.db };
    const principal = await resolveOperationPrincipal(new Request('https://delivery.test', {
      headers: { authorization: `Bearer ${token.token}` },
    }), env);
    const createCycle = (company, key) => executeDeliveryCommand(env, principal, 'cycles.save', {
      company, cycle: { name: company, goal: 'Entrega', startsAt: '2026-09-27',
        endsAt: '2026-10-31', ownerId: 'admin', taskIds: [], acceptance: [{ text: 'Aceite' }] },
    }, key);
    const first = (await createCycle('one', 'order-cycle-one')).data.cycle;
    const second = (await createCycle('two', 'order-cycle-two')).data.cycle;
    const beforeEdit = (await readClientShadowSnapshot(f.db, 'default', 'one')).clientSnapshot;
    const edited = await executeDeliveryCommand(env, principal, 'cycles.save',
      { cycleId: first.id, cycle: { goal: 'Entrega atualizada' } },
      'order-cycle-edit', {}, false, beforeEdit);
    assert.equal(edited.clientSnapshot, beforeEdit.replace(/:\d+$/, match => `:${Number(match.slice(1)) + 1}`));
    assert.deepEqual((await getDoc(f.db, 'default', DELIVERY)).value.extraCycles.map(row => row.id),
      [second.id, first.id]);
    const created = await executeDeliveryCommand(env, principal, 'tasks.create',
      { cycleId: first.id, task: { title: 'Nova', ownerId: 'admin', dueAt: '2026-10-01' } },
      'order-task-in-cycle', {}, false, edited.clientSnapshot);
    assert.equal(created.clientSnapshot, edited.clientSnapshot.replace(/:\d+$/, match => `:${Number(match.slice(1)) + 1}`));
    assert.deepEqual((await getDoc(f.db, 'default', DELIVERY)).value.extraTasks.map(row => row.id),
      [created.data.task.id, 'two-a']);
    assert.deepEqual(f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY), frozen);
  } finally { f.sql.close(); }
});

test('a command that only reads delivery guards its logical version in active mode', async () => {
  const f = populated();
  try {
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const other = 'ontology.engagement.v2';
    f.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', other, '{}');
    const commit = (key, version) => commitOperation(f.db, {
      workspace: 'default', principal: 'member:admin', application: 'test',
      actor: { memberId: 'admin', email: 'admin@example.test', kind: 'session' },
      key, command: 'documents.test', hash: key, id: crypto.randomUUID(),
      guards: [{ key: DELIVERY, version }, { key: other, version: 1 }],
      writes: [{ key: other, value: { changed: true } }], events: [], result: { data: {} },
    });
    await commit('protected-read', 41);
    assert.equal(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(other).version, 2);
    assert.equal(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(DELIVERY).version, 1);
    await assert.rejects(commit('stale-read', 40), { code: 'version_conflict' });
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='stale-read'").get().n, 0);
  } finally { f.sql.close(); }
});

test('clients-only active writes repartition atomically and reject an orphaned plan', async () => {
  const f = populated({ extraTasks: [task('one-a', 'one'), task('two-a', 'two')],
    productPlans: { private: { id: 'private', title: 'Private' } } },
  { enrollments: [{ id: 'purchase', company: 'one', planId: 'private' }] });
  try {
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    await f.commit('active-move-plan', CLIENTS, 1,
      { enrollments: [{ id: 'purchase', company: 'two', planId: 'private' }] });
    assert.equal(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(CLIENTS).version, 2);
    assert.equal(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(DELIVERY).version, 1);
    assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version, 42);
    assert.equal((await readClientShadowSnapshot(f.db, 'default', 'two')).snapshot.productPlans.private.id, 'private');
    await assert.rejects(f.commit('active-orphan-plan', CLIENTS, 2, { enrollments: [] }),
      { code: 'execution_ownership_ambiguous' });
    assert.equal(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(CLIENTS).version, 2);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='active-orphan-plan'").get().n, 0);
  } finally { f.sql.close(); }
});

test('creating a client certifies its first raw plan-claim projection in the same active batch', async () => {
  const f = populated();
  try {
    f.sql.prepare(`UPDATE delivery_client_shadow_meta
      SET mode='active',compatibility_version=41`).run();
    await f.commit('new-client-claim-head', CLIENTS, 1,
      { extraClients: [{ slug: 'three', name: 'Terceiro', startedAt: '2026-01-01' }] });
    const slice = f.sql.prepare(`SELECT revision,incarnation FROM delivery_client_snapshots
      WHERE company='three'`).get();
    const head = f.sql.prepare(`SELECT authority_generation,source_revision,
      source_incarnation,expected_claims FROM delivery_client_plan_claim_heads
      WHERE company='three'`).get();
    assert.deepEqual({ ...head }, { authority_generation: 'shadow',
      source_revision: slice.revision, source_incarnation: slice.incarnation,
      expected_claims: 0 });
    assert.equal(f.sql.prepare(`SELECT expected_clients FROM delivery_client_shadow_meta`).get()
      .expected_clients, 3);
  } finally { f.sql.close(); }
});

test('active bridge diffs the current slice even when the physical global body is frozen', async () => {
  const raw = { extraTasks: [task('one-a', 'one'), task('two-a', 'two')],
    companyJourney: { one: 'old-plan' } };
  const f = populated(raw);
  try {
    f.sql.prepare(`UPDATE delivery_client_shadow_meta
      SET mode='active',compatibility_version=41`).run();
    const row = f.sql.prepare(`SELECT body,incarnation FROM delivery_client_snapshots
      WHERE company='one'`).get();
    const current = JSON.parse(row.body);
    current.companyJourney.one = 'current-plan';
    const body = JSON.stringify(current);
    f.sql.prepare(`UPDATE delivery_client_snapshots
      SET body=?,body_sha256=? WHERE company='one'`).run(body,
      createHash('sha256').update(body).digest('hex'));
    f.sql.prepare(`INSERT INTO delivery_client_plan_claims
      VALUES('default','claims-one','one','current-plan')`).run();
    f.sql.prepare(`INSERT INTO delivery_client_plan_claim_heads
      (workspace_id,company,authority_generation,source_revision,source_incarnation,
       projection_generation,expected_claims,updated_at)
      VALUES('default','one','shadow',1,?,'claims-one',1,'now')`).run(row.incarnation);
    await f.commit('bridge-with-frozen-claims', DELIVERY, 41,
      { ...raw, companyJourney: { one: 'next-plan' } });
    assert.equal(f.sql.prepare(`SELECT revision FROM delivery_client_snapshots
      WHERE company='one'`).get().revision, 2);
    assert.equal(f.sql.prepare(`SELECT source_revision FROM delivery_client_plan_claim_heads
      WHERE company='one'`).get().source_revision, 2);
    assert.deepEqual(f.sql.prepare(`SELECT plan_id FROM delivery_client_plan_claims
      WHERE company='one'`).all().map(row => row.plan_id), ['next-plan']);
  } finally { f.sql.close(); }
});

test('client-only active edits keep execution indexes without rebuilding every slice', async () => {
  const f = populated();
  try {
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const original = f.db.prepare.bind(f.db);
    f.db.prepare = sql => {
      assert.doesNotMatch(sql, /SELECT company,body FROM delivery_client_snapshots/);
      return original(sql);
    };
    await f.commit('active-client-metadata', CLIENTS, 1,
      { archivedClients: ['one'], participations: [{ id: 'participation',
        company: 'one', enrollmentId: 'purchase', stakeholderId: 'contact' }] });
    assert.deepEqual({ ...f.sql.prepare(`SELECT source_clients_version,compatibility_version,
      expected_clients,expected_owners FROM delivery_client_shadow_meta`).get() },
      { source_clients_version: 2, compatibility_version: 42,
        expected_clients: 2, expected_owners: 2 });
    assert.equal(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(DELIVERY).version, 1);
    assert.equal(f.sql.prepare('SELECT revision FROM delivery_client_snapshots WHERE company=?').get('one').revision, 1);
    f.db.prepare = original;
    assert.equal((await readClientShadowSnapshot(f.db, 'default', 'one', true, true)).sourceVersion, 42);
  } finally { f.sql.close(); }
});

test('client-only fast path rolls back when the logical execution version changes', async () => {
  const f = populated();
  try {
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const batch = f.db.batch.bind(f.db);
    f.db.batch = async statements => {
      f.sql.prepare('UPDATE delivery_client_shadow_meta SET compatibility_version=42').run();
      return batch(statements);
    };
    await assert.rejects(f.commit('active-client-race', CLIENTS, 1,
      { archivedClients: ['one'] }), { code: 'version_conflict' });
    assert.equal(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(CLIENTS).version, 1);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='active-client-race'").get().n, 0);
  } finally { f.sql.close(); }
});

test('a failed active slice write rolls back receipt, history and version together', async () => {
  const f = populated();
  try {
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    f.sql.exec(`CREATE TRIGGER fail_active_slice BEFORE UPDATE ON delivery_client_snapshots
      BEGIN SELECT RAISE(ABORT,'injected_slice_failure'); END`);
    const next = { extraTasks: [{ ...f.raw.extraTasks[0], title: 'Failure',
      history: [{ field: 'title', at: '2026-09-27T10:00:00Z', to: 'Failure' }] }, f.raw.extraTasks[1]] };
    await assert.rejects(f.commit('active-failure', DELIVERY, 41, next), /injected_slice_failure/);
    assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version, 41);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='active-failure'").get().n, 0);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM delivery_task_history WHERE task_id='one-a'").get().n, 0);
  } finally { f.sql.close(); }
});

test('active writes abort before the batch when the D1 statement budget is exceeded', async () => {
  const f = populated();
  try {
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const next = { extraTasks: [...f.raw.extraTasks,
      ...Array.from({ length: 450 }, (_, index) => task(`bulk-${index}`, 'one'))] };
    await assert.rejects(f.commit('active-too-large', DELIVERY, 41, next),
      { code: 'execution_write_too_large' });
    assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version, 41);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='active-too-large'").get().n, 0);
  } finally { f.sql.close(); }
});

test('switching authority while a command is prepared rejects the entire active batch', async () => {
  const f = populated();
  try {
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const batch = f.db.batch.bind(f.db);
    f.db.batch = async statements => {
      f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='shadow'").run();
      return batch(statements);
    };
    const next = { extraTasks: [{ ...f.raw.extraTasks[0], title: 'Should not persist' }, f.raw.extraTasks[1]] };
    await assert.rejects(f.commit('active-mode-race', DELIVERY, 41, next),
      { code: 'version_conflict' });
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='active-mode-race'").get().n, 0);
    assert.equal(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(DELIVERY).version, 1);
  } finally { f.sql.close(); }
});

test('rollback restores the current global document and resumes shadow writes atomically', async () => {
  const f = populated();
  try {
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const next = { extraTasks: [{ ...f.raw.extraTasks[0], title: 'Active change' }, f.raw.extraTasks[1]] };
    await f.commit('before-rollback', DELIVERY, 41, next);
    await assert.rejects(rollbackClientAuthority(f.db, 'default', 41, 'maintenance'),
      { code: 'version_conflict' });
    const virtual = (await getDoc(f.db, 'default', DELIVERY)).value;
    completeOwnerIndex(f, virtual);
    const restored = await rollbackClientAuthority(f.db, 'default', 42, 'maintenance');
    assert.equal(restored.version, 42);
    const physical = f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY);
    assert.equal(physical.version, 42);
    assert.deepEqual(await decodeStateBody(physical.body), virtual);
    assert.equal(f.sql.prepare('SELECT mode,source_delivery_version FROM delivery_client_shadow_meta').get().mode, 'shadow');
    assert.equal(f.sql.prepare('SELECT source_delivery_version FROM delivery_client_shadow_meta').get().source_delivery_version, 42);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM state_history WHERE key=? AND version=42").get(DELIVERY).n, 1);
    await f.commit('after-rollback', DELIVERY, 42,
      { extraTasks: [{ ...next.extraTasks[0], title: 'Shadow change' }, next.extraTasks[1]] });
    assert.equal(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(DELIVERY).version, 43);
    assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version, 43);
  } finally { f.sql.close(); }
});

test('rollback compares owners by identity even when SQLite and locale order differ', async () => {
  const raw = { extraTasks: [task('a-b', 'one'), task('a_b', 'one'), task('two-a', 'two')] };
  const f = populated(raw);
  try {
    completeOwnerIndex(f, { ...DELIVERY_INITIAL, ...raw });
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    assert.deepEqual(await rollbackClientAuthority(f.db, 'default', 41, 'maintenance'),
      { version: 41 });
    assert.equal(f.sql.prepare('SELECT mode FROM delivery_client_shadow_meta').get().mode, 'shadow');
  } finally { f.sql.close(); }
});

test('rollback failure leaves client authority active and the global body frozen', async () => {
  const f = populated();
  try {
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const frozen = f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY);
    completeOwnerIndex(f, { ...DELIVERY_INITIAL, ...f.raw });
    f.sql.exec(`CREATE TRIGGER fail_rollback_history BEFORE INSERT ON state_history
      WHEN NEW.key='ontology.delivery.v2' BEGIN SELECT RAISE(ABORT,'injected_rollback_failure'); END`);
    await assert.rejects(rollbackClientAuthority(f.db, 'default', 41, 'maintenance'),
      /injected_rollback_failure/);
    assert.equal(f.sql.prepare('SELECT mode FROM delivery_client_shadow_meta').get().mode, 'active');
    assert.deepEqual(f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY), frozen);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM delivery_compatibility_guards').get().n, 0);
  } finally { f.sql.close(); }
});

test('rollback refuses a client slice whose persisted hash is invalid', async () => {
  const f = populated();
  try {
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    completeOwnerIndex(f, { ...DELIVERY_INITIAL, ...f.raw });
    f.sql.prepare("UPDATE delivery_client_snapshots SET body_sha256='invalid' WHERE company='one'").run();
    await assert.rejects(rollbackClientAuthority(f.db, 'default', 41, 'maintenance'),
      { code: 'execution_snapshot_incomplete' });
    assert.equal(f.sql.prepare('SELECT mode FROM delivery_client_shadow_meta').get().mode, 'active');
    assert.equal(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(DELIVERY).version, 1);
  } finally { f.sql.close(); }
});

test('the real task comment uses active client authority without returning the global document', async () => {
  const clients = { extraClients: ['one', 'two'].map(slug => ({ slug, name: slug,
    status: 'ativo', startedAt: '2026-09-01', leadId: 'admin', csId: 'admin', milestone: 1 })) };
  const f = populated(undefined, clients);
  try {
    f.sql.prepare(`INSERT INTO state_documents(workspace_id,key,version,body)
      VALUES('default','ontology.workspace.v3',1,?)`)
      .run(JSON.stringify({ extraMembers: [{ id: 'admin', name: 'Admin',
        email: 'admin@example.test', access: 'admin' }] }));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const principal = { id: 'member:admin', kind: 'session', email: 'admin@example.test',
      memberId: 'admin', access: 'admin', application: 'web', scopes: null,
      companies: null, guards: [] };
    const result = await executeDeliveryCommand({ DB: f.db }, principal, 'tasks.comment',
      { taskId: 'one-a', text: 'Comentário de teste' }, 'active-real-command', {});
    assert.equal(result.data.task.comments.at(-1).text, 'Comentário de teste');
    assert.deepEqual(result.documents, []);
    assert.ok(result.clientSnapshot);
    assert.equal(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(DELIVERY).version, 1);
    assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version, 42);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_events WHERE type='tasks.comment'").get().n, 1);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM client_audit_log WHERE command='tasks.comment'").get().n, 1);
    const page = await readCollection(new Request('https://delivery.test/api/v1/tasks?company=one'),
      { DB: f.db }, 'default', principal, ['tasks']);
    assert.equal(page.snapshotVersion, 42);
    assert.equal(page.data.find(item => item.id === 'one-a').comments.at(-1).text, 'Comentário de teste');
  } finally { f.sql.close(); }
});

test('shadow mirrors a map reorder even when client bodies do not change', async () => {
  const raw = { extraTasks: [task('one-a', 'one'), task('two-a', 'two')],
    statusMap: { 'two-a': 'em-curso', 'one-a': 'fila' } };
  const f = populated(raw);
  try {
    const next = { ...raw, statusMap: { 'one-a': 'fila', 'two-a': 'em-curso' } };
    await f.commit('reorder-map', DELIVERY, 1, next);
    const positions = f.sql.prepare(`SELECT id,ordinal FROM delivery_client_map_order
      WHERE kind='statusMap' ORDER BY ordinal`).all();
    assert.deepEqual(positions.map(row => [row.id, row.ordinal]), [['one-a', 0], ['two-a', 1]]);
    assert.equal(f.sql.prepare('SELECT compatibility_version FROM delivery_client_shadow_meta').get().compatibility_version, 1);
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active'").run();
    const rebuilt = await readActiveDeliveryCompatibility(f.db, 'default');
    assert.equal(JSON.stringify(rebuilt.snapshot), JSON.stringify({ ...DELIVERY_INITIAL, ...next }));
  } finally { f.sql.close(); }
});

test('stale source leaves shadow marker stale while the legacy command succeeds', async () => {
  const f = populated();
  try {
    f.sql.prepare('UPDATE delivery_client_shadow_meta SET source_delivery_version=0').run();
    await f.commit('stale', DELIVERY, 1, { extraTasks: [task('one-new', 'one')] });
    assert.equal(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(DELIVERY).version, 2);
    assert.equal(f.sql.prepare('SELECT source_delivery_version FROM delivery_client_shadow_meta').get().source_delivery_version, 0);
    assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='one'").get().revision, 1);
    assert.equal(await readClientShadowSnapshot(f.db, 'default', 'one'), null);
  } finally { f.sql.close(); }
});

test('removing the final task of a non-client slice deletes its snapshot and count', async () => {
  const f = populated();
  try {
    await f.commit('remove-one', DELIVERY, 1, { extraTasks: [f.raw.extraTasks[1]] });
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM delivery_client_snapshots WHERE company='one'").get().n, 0);
    assert.equal(f.sql.prepare('SELECT expected_clients FROM delivery_client_shadow_meta').get().expected_clients, 1);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM delivery_entity_owners WHERE company='one'").get().n, 0);
  } finally { f.sql.close(); }
});

test('changing private plan ownership in the clients document moves both client slices', async () => {
  const raw = { extraTasks: [task('one-a', 'one'), task('two-a', 'two')],
    productPlans: { private: { id: 'private', title: 'Private' } } };
  const f = populated(raw, { enrollments: [{ id: 'purchase', company: 'one', planId: 'private' }] });
  try {
    await f.commit('move-plan', CLIENTS, 1,
      { enrollments: [{ id: 'purchase', company: 'two', planId: 'private' }] });
    const one = await readClientShadowSnapshot(f.db, 'default', 'one');
    const two = await readClientShadowSnapshot(f.db, 'default', 'two');
    assert.equal(one.snapshot.productPlans.private, undefined);
    assert.equal(two.snapshot.productPlans.private.id, 'private');
    assert.equal(one.revision, 2);
    assert.equal(two.revision, 2);
  } finally { f.sql.close(); }
});

test('client guard rejects wrong revision, generation and mode before any writes', async () => {
  const f = populated();
  try {
    const incarnation = f.sql.prepare("SELECT incarnation FROM delivery_client_snapshots WHERE company='one'").get().incarnation;
    const guard = (generation, revision, mode, expectedIncarnation = incarnation) => f.db.prepare(`INSERT INTO delivery_client_guards
      (transaction_id,workspace_id,company,generation,expected_revision,expected_mode,expected_incarnation)
      VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), 'default', 'one', generation, revision, mode, expectedIncarnation);
    for (const invalid of [['shadow', 2, 'shadow'], ['old', 1, 'shadow'], ['shadow', 1, 'active'],
      ['shadow', 1, 'shadow', 'previous-life']]) {
      await assert.rejects(f.db.batch([guard(...invalid),
        f.db.prepare("UPDATE delivery_client_snapshots SET revision=99 WHERE company='one'")]),
      /delivery_client_version_conflict/);
      assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='one'").get().revision, 1);
    }
    await f.db.batch([guard('shadow', 1, 'shadow'),
      f.db.prepare("UPDATE delivery_client_snapshots SET revision=2 WHERE company='one'"),
      f.db.prepare('DELETE FROM delivery_client_guards')]);
    assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_snapshots WHERE company='one'").get().revision, 2);
  } finally { f.sql.close(); }
});

test('active client authority blocks legacy global inserts, updates and deletes atomically', async () => {
  const f = populated();
  try {
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active'").run();
    await assert.rejects(f.commit('old-worker', DELIVERY, 1,
      { extraTasks: [task('stale', 'one')] }), { code: 'version_conflict' });
    assert.equal(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(DELIVERY).version, 1);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM operation_receipts').get().n, 0);
    assert.throws(() => f.sql.prepare('DELETE FROM state_documents WHERE key=?').run(DELIVERY),
      /delivery_global_write_disabled/);
    assert.throws(() => f.sql.prepare(`INSERT INTO state_documents(workspace_id,key,version,body)
      VALUES('default',?,1,'{}')`).run(DELIVERY), /delivery_global_write_disabled/);
    f.sql.prepare("INSERT INTO workspaces(id,name) VALUES('other','Other')").run();
    assert.doesNotThrow(() => f.sql.prepare(`INSERT INTO state_documents(workspace_id,key,version,body)
      VALUES('other',?,1,'{}')`).run(DELIVERY));
  } finally { f.sql.close(); }
});

test('active model task removal retains raw history, hides effective rows and leaves other clients unchanged', async () => {
  const f = populated({ extraTasks: [{...task('one-a', 'one'),baseDeliveryId:'model',comments:[{id:'c1',text:'Preservar',by:'admin',at:'2026-10-01'}]}, task('two-a', 'two')] }, {
    extraClients: ['one', 'two'].map(slug => ({ slug, name: slug, status: 'ativo' })),
  });
  try {
    f.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', 'ontology.workspace.v3', JSON.stringify({extraMembers:[{id:'admin',email:'admin@example.test',access:'admin'}]}));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET mode='active',compatibility_version=41").run();
    const frozen = f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY);
    const other = await readClientShadowSnapshot(f.db, 'default', 'two');
    const principal = {id:'member:admin',kind:'session',email:'admin@example.test',memberId:'admin',access:'admin',application:'web',scopes:null,companies:null,guards:[]};
    const run = () => executeDeliveryCommand({DB:f.db},principal,'tasks.remove',{taskId:'one-a'},'remove-active');
    const removed = await run();
    assert.equal(removed.data.removed,true);
    assert.ok(removed.clientSnapshot);
    assert.deepEqual(removed.documents,[]);
    const own = await readClientShadowSnapshot(f.db,'default','one');
    assert.equal(own.snapshot.extraTasks[0].id,'one-a');
    assert.equal(own.snapshot.taskPatches['one-a'].removed,true);
    assert.equal(own.snapshot.taskPatches['one-a'].removedBy,'admin');
    assert.equal(own.snapshot.taskPatches['one-a'].baseDeliveryId,'model');
    assert.equal(own.snapshot.taskPatches['one-a'].comments[0].text,'Preservar');
    assert.equal(projectDelivery(own.snapshot,'one').tasks.length,0);
    const unchanged = await readClientShadowSnapshot(f.db,'default','two');
    assert.deepEqual(unchanged.snapshot,other.snapshot);
    assert.equal(unchanged.clientSnapshot,other.clientSnapshot);
    assert.deepEqual(f.sql.prepare('SELECT version,body FROM state_documents WHERE key=?').get(DELIVERY),frozen);
    assert.deepEqual((await run()).data,removed.data);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM operation_events WHERE type='tasks.remove'").get().n,1);
    await assert.rejects(executeDeliveryCommand({DB:f.db},principal,'tasks.update',{taskId:'one-a',patch:{title:'Retornar'}},'removed-update'),{code:'task_not_found'});
  } finally { f.sql.close(); }
});
