import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { effectiveDeliveryRows } from '../src/server/delivery-effective.ts';
import { readEffectiveDeliveryPage } from '../src/server/operations/delivery-effective-read.ts';
import { readActiveGlobalCyclePage, readActiveGlobalTaskPage } from '../src/server/operations/delivery-global-effective-read.ts';
import { effectiveDeliveryStatements } from '../src/server/operations/delivery-effective-sync.ts';
import { clientEffectiveStatements, readClientEffectiveHead } from '../src/server/operations/delivery-client-effective-sync.ts';
import { deliveryRecordStatements } from '../src/server/operations/delivery-record-sync.ts';
import { commitOperation } from '../src/server/operations/transaction.ts';
import { apiResponse } from '../src/server/operations/http.ts';
import { partitionDeliverySnapshot } from '../src/server/delivery-records.ts';
import { serviceCycles } from '../src/modules/delivery/infrastructure/services.ts';

const key = 'ontology.delivery.v2';
const generation = 'test-generation';
const task = (id, company, status, dueAt) => ({ id, company, title: id, status, ownerId: 'admin', dueAt,
  hours: 1, workstream: '', milestone: 1, completion: 'checklist', comments: [], history: [] });
function populated(override) {
  const fixture = sqliteD1();
  const raw = override ?? { extraTasks: [task('a', 'one', 'fila', '2026-09-30'),
    task('b', 'one', 'em-curso', '2026-09-28'), task('c', 'two', 'fila', '2026-09-25')] };
  fixture.sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
    .run('default', key, JSON.stringify(raw));
  const rows = effectiveDeliveryRows(raw);
  for (const row of rows.tasks) fixture.sql.prepare(`INSERT INTO delivery_effective_tasks
    (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,due_at,owner_id,milestone,kind,body)
    VALUES('default',?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(generation, row.company, row.id, row.ordinal, row.enrollmentId, row.productId, row.status,
      row.dueAt, row.ownerId, row.milestone, row.kind, row.body);
  for (const row of rows.cycles) fixture.sql.prepare(`INSERT INTO delivery_effective_cycles
    (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,starts_at,ends_at,body)
    VALUES('default',?,?,?,?,?,?,?,?,?,?)`)
    .run(generation, row.company, row.id, row.ordinal, row.enrollmentId, row.productId, row.status,
      row.startsAt, row.endsAt, row.body);
  fixture.sql.prepare("INSERT INTO delivery_effective_meta(workspace_id,generation,source_version,expected_tasks,expected_cycles,updated_at) VALUES('default',?,1,?,?,'2026-09-26')")
    .run(generation, rows.tasks.length, rows.cycles.length);
  for (const company of new Set([...rows.tasks, ...rows.cycles].map(row => row.company)))
    fixture.sql.prepare("INSERT INTO delivery_client_revisions(workspace_id,generation,company,revision,task_count,cycle_count) VALUES('default',?,?,1,?,?)")
      .run(generation, company, rows.tasks.filter(row => row.company === company).length,
        rows.cycles.filter(row => row.company === company).length);
  return { ...fixture, raw };
}

function activeGlobal(raw) {
  const f = populated(raw);
  const projected = effectiveDeliveryRows(f.raw);
  const companies = [...new Set([...projected.tasks, ...projected.cycles].map(row => row.company))];
  f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,'{}')").run();
  f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
    (workspace_id,generation,mode,source_delivery_version,source_clients_version,
     expected_clients,expected_owners,expected_orphans,expected_array_order,updated_at,compatibility_version)
    VALUES('default','global-authority','active',1,1,?,?,0,?,'2026-09-27',41)`)
    .run(companies.length, projected.tasks.length + projected.cycles.length,
      (f.raw.extraTasks?.length ?? 0) + (f.raw.extraCycles?.length ?? 0));
  for (const [kind, rows] of [['task', projected.tasks], ['cycle', projected.cycles]])
    for (const row of rows) f.sql.prepare(`INSERT INTO delivery_entity_owners
      (workspace_id,generation,kind,id,company) VALUES('default','global-authority',?,?,?)`)
      .run(kind, row.id, row.company);
  for (const [kind, rows] of [['extraTasks', f.raw.extraTasks ?? []],
    ['extraCycles', f.raw.extraCycles ?? []]])
    for (const [ordinal, row] of rows.entries()) f.sql.prepare(`INSERT INTO delivery_client_array_order
      (workspace_id,generation,kind,id,ordinal,company)
      VALUES('default','global-authority',?,?,?,?)`)
      .run(kind, row.id, ordinal, row.company);
  for (const company of companies) {
    const slice = { extraTasks: (f.raw.extraTasks ?? []).filter(row => row.company === company),
      extraCycles: (f.raw.extraCycles ?? []).filter(row => row.company === company),
      cycleEdits: Object.fromEntries(Object.entries(f.raw.cycleEdits ?? {})
        .filter(([id]) => serviceCycles.find(cycle => cycle.id === id)?.company === company)) };
    f.sql.prepare(`INSERT INTO delivery_client_snapshots
      (workspace_id,generation,company,revision,body,body_sha256,incarnation)
      VALUES('default','global-authority',?,1,?,'test',?)`)
      .run(company, JSON.stringify(slice), `${company}-life`);
    const rows = effectiveDeliveryRows(slice, company);
    for (const row of rows.tasks) f.sql.prepare(`INSERT INTO delivery_effective_tasks
      (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,due_at,owner_id,milestone,kind,body)
      VALUES('default',?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(`projection-${company}`, row.company, row.id, row.ordinal, row.enrollmentId,
        row.productId, row.status, row.dueAt, row.ownerId, row.milestone, row.kind, row.body);
    for (const row of rows.cycles) f.sql.prepare(`INSERT INTO delivery_effective_cycles
      (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,starts_at,ends_at,body)
      VALUES('default',?,?,?,?,?,?,?,?,?,?)`)
      .run(`projection-${company}`, row.company, row.id, row.ordinal, row.enrollmentId,
        row.productId, row.status, row.startsAt, row.endsAt, row.body);
    f.sql.prepare(`INSERT INTO delivery_client_effective_heads
      (workspace_id,company,authority_generation,source_revision,source_incarnation,
       projection_generation,expected_tasks,expected_cycles,updated_at)
      VALUES('default',?,'global-authority',1,?,?,?,?,'2026-09-27')`)
      .run(company, `${company}-life`, `projection-${company}`, rows.tasks.length, rows.cycles.length);
  }
  return f;
}

test('active global due pages match the legacy sort, pagination and allowed clients', async () => {
  const f = activeGlobal();
  try {
    const legacy = effectiveDeliveryRows(f.raw).tasks.map(row => JSON.parse(row.body))
      .sort((a, b) => Number(!a.dueAt) - Number(!b.dueAt)
        || (a.dueAt ?? '').localeCompare(b.dueAt ?? '') || a.id.localeCompare(b.id));
    const first = await readActiveGlobalTaskPage(f.db, 'default', 0, 2, { sort: 'dueAt' }, null, 41);
    assert.deepEqual(first.data.map(row => row.id), legacy.slice(0, 2).map(row => row.id));
    assert.deepEqual(first.data, legacy.slice(0, 2));
    assert.equal(first.total, legacy.length);
    assert.equal(first.nextCursor, '2');
    const second = await readActiveGlobalTaskPage(f.db, 'default', 2, 2, { sort: 'dueAt' }, null, 41);
    assert.deepEqual(second.data, legacy.slice(2, 4));
    assert.equal(second.nextCursor, '4');
    const restricted = await readActiveGlobalTaskPage(f.db, 'default', 0, 10,
      { sort: 'dueAt', status: 'fila' }, ['two']);
    assert.deepEqual(restricted.data.map(row => row.id), ['c']);
    const empty = await readActiveGlobalTaskPage(f.db, 'default', 0, 10, { sort: 'dueAt' }, []);
    assert.deepEqual(empty.data, []);
    assert.equal(empty.total, 0);
    await assert.rejects(readActiveGlobalTaskPage(f.db, 'default', 0, 10,
      { sort: 'dueAt' }, null, 40), { code: 'snapshot_changed' });
  } finally { f.sql.close(); }
});

test('active global position pages preserve seed, playbook and interleaved extra order', async () => {
  const raw = { extraTasks: [task('extra-two-a', 'two', 'fila', '2026-09-30'),
    task('extra-one', 'one', 'em-curso', '2026-09-28'),
    task('extra-two-b', 'two', 'fila', '2026-09-25')] };
  const f = activeGlobal(raw);
  try {
    const expected = effectiveDeliveryRows(raw).tasks.map(row => JSON.parse(row.body));
    const collected = [];
    for (let cursor = 0; cursor < expected.length; cursor += 37) {
      const page = await readActiveGlobalTaskPage(f.db, 'default', cursor, 37, {}, null, 41);
      assert.equal(page.total, expected.length);
      collected.push(...page.data);
      assert.equal(page.nextCursor, cursor + 37 < expected.length ? String(cursor + 37) : null);
    }
    assert.deepEqual(collected, expected);
    assert.deepEqual(collected.slice(-3).map(row => row.id),
      ['extra-two-a', 'extra-one', 'extra-two-b']);
    const restricted = await readActiveGlobalTaskPage(f.db, 'default', 0, 10,
      { sort: 'position', status: 'fila' }, ['two'], 41);
    assert.deepEqual(restricted.data.map(row => row.id), ['extra-two-a', 'extra-two-b']);
    assert.equal(restricted.total, 2);
    f.sql.prepare("DELETE FROM delivery_client_array_order WHERE id='extra-one'").run();
    assert.equal(await readActiveGlobalTaskPage(f.db, 'default', 0, 100, {}, null), null);
    f.sql.prepare("UPDATE delivery_client_snapshots SET revision=2 WHERE company='two'").run();
    assert.equal(await readActiveGlobalTaskPage(f.db, 'default', 0, 100, {}, ['one']), null);
  } finally { f.sql.close(); }
});

test('active global due page falls back if any client head is stale', async () => {
  const f = activeGlobal();
  try {
    f.sql.prepare("UPDATE delivery_client_snapshots SET revision=2 WHERE company='two'").run();
    assert.equal(await readActiveGlobalTaskPage(f.db, 'default', 0, 10,
      { sort: 'dueAt' }, ['one']), null);
    f.sql.prepare("UPDATE delivery_client_snapshots SET revision=1,incarnation='new-life' WHERE company='two'").run();
    assert.equal(await readActiveGlobalTaskPage(f.db, 'default', 0, 10,
      { sort: 'dueAt' }, null), null);
  } finally { f.sql.close(); }
});

test('global due reader falls back when the client page omits a globally owned task', async () => {
  const raw = { extraTasks: [{ ...task('other-plan', 'santa-clara', 'fila', '2026-09-30'),
    kind: 'journey', journeyId: 'different-plan' }] };
  const f = activeGlobal(raw);
  try {
    assert.ok(effectiveDeliveryRows(raw).tasks.some(row => row.id === 'other-plan'));
    assert.ok(!effectiveDeliveryRows(raw, 'santa-clara').tasks
      .some(row => row.id === 'other-plan'));
    assert.equal(await readActiveGlobalTaskPage(f.db, 'default', 0, 10,
      { sort: 'dueAt' }, null), null);
  } finally { f.sql.close(); }
});

test('active global due page retries when the logical version changes between its two reads', async () => {
  const f = activeGlobal();
  try {
    const batch = f.db.batch.bind(f.db);
    let calls = 0;
    f.db.batch = async statements => {
      if (++calls === 2) f.sql.prepare("UPDATE delivery_client_shadow_meta SET compatibility_version=42").run();
      return batch(statements);
    };
    const page = await readActiveGlobalTaskPage(f.db, 'default', 0, 2,
      { sort: 'dueAt' }, null);
    assert.equal(page.snapshotVersion, 42);
    assert.equal(page.data.length, 2);
    assert.equal(calls, 4);
  } finally { f.sql.close(); }
});

test('active global due page stays within the D1 bind limit for 100 tasks and many allowed clients', async () => {
  const f = activeGlobal();
  try {
    const originalPrepare = f.db.prepare;
    f.db.prepare = query => {
      const statement = originalPrepare(query);
      const originalBind = statement.bind;
      statement.bind = function (...values) {
        assert.ok(values.length <= 100, `D1 bind limit exceeded: ${values.length}`);
        return originalBind.apply(this, values);
      };
      return statement;
    };
    const allowed = [...new Set(effectiveDeliveryRows(f.raw).tasks.map(row => row.company)),
      ...Array.from({ length: 110 }, (_, index) => `other-${index}`)];
    const page = await readActiveGlobalTaskPage(f.db, 'default', 0, 100,
      { sort: 'dueAt' }, allowed);
    assert.equal(page.data.length, 100);
    assert.ok(page.nextCursor);
  } finally { f.sql.close(); }
});

test('active global cycle pages preserve stable seed and cross-client extra order', async () => {
  const seed = serviceCycles[0], removedSeed = serviceCycles[1];
  const cycle = (id, company) => ({ id, company, name: id, goal: id,
    startsAt: seed.startsAt, endsAt: seed.endsAt, ownerId: 'admin',
    status: 'em-curso', taskIds: [], acceptance: [] });
  const raw = { extraTasks: [], extraCycles: [cycle('extra-two-a', 'two'),
    cycle('extra-one', 'one'), cycle('extra-two-b', 'two')],
    cycleEdits: { [seed.id]: { ...seed, name: 'Seed editado' },
      [removedSeed.id]: { ...removedSeed, removed: true } } };
  const f = activeGlobal(raw);
  try {
    const expected = effectiveDeliveryRows(raw).cycles.map(row => JSON.parse(row.body));
    const collected = [];
    for (let cursor = 0; cursor < expected.length; cursor += 17) {
      const page = await readActiveGlobalCyclePage(f.db, 'default', cursor, 17, {}, null, 41);
      assert.equal(page.total, expected.length);
      collected.push(...page.data);
      assert.equal(page.nextCursor, cursor + 17 < expected.length ? String(cursor + 17) : null);
    }
    assert.deepEqual(collected, expected);
    const tied = collected.filter(row => row.startsAt === seed.startsAt);
    assert.deepEqual(tied.slice(-3).map(row => row.id),
      ['extra-two-a', 'extra-one', 'extra-two-b']);
    assert.equal(collected.find(row => row.id === seed.id).name, 'Seed editado');
    assert.ok(!collected.some(row => row.id === removedSeed.id));
    const filtered = await readActiveGlobalCyclePage(f.db, 'default', 1, 1,
      { status: 'em-curso' }, ['one', 'two'], 41);
    assert.deepEqual(filtered.data.map(row => row.id), ['extra-one']);
    assert.equal(filtered.total, 3);
    await assert.rejects(readActiveGlobalCyclePage(f.db, 'default', 0, 10, {}, null, 40),
      { code: 'snapshot_changed' });
    const batch = f.db.batch.bind(f.db);
    let calls = 0;
    f.db.batch = async statements => {
      if (++calls === 2)
        f.sql.prepare('UPDATE delivery_client_shadow_meta SET compatibility_version=42').run();
      return batch(statements);
    };
    assert.equal((await readActiveGlobalCyclePage(f.db, 'default', 0, 2, {}, null))
      .snapshotVersion, 42);
    assert.equal(calls, 4);
    f.db.batch = batch;
    f.sql.prepare("DELETE FROM delivery_client_array_order WHERE id='extra-one'").run();
    assert.equal(await readActiveGlobalCyclePage(f.db, 'default', 0, 100, {}, null), null);
    f.sql.prepare("UPDATE delivery_client_snapshots SET revision=2 WHERE company='two'").run();
    assert.equal(await readActiveGlobalCyclePage(f.db, 'default', 0, 100, {}, ['one']), null);
  } finally { f.sql.close(); }
});

test('effective pages filter and sort only the authorized client slice, with a stable version', async () => {
  const f = populated();
  try {
    const first = await readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 0, 1,
      { sort: 'dueAt' }, 1);
    assert.deepEqual(first.data.map(row => row.id), ['b']);
    assert.equal(first.total, 2);
    assert.equal(first.nextCursor, '1');
    const second = await readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 1, 1,
      { sort: 'dueAt' }, first.snapshotVersion);
    assert.deepEqual(second.data.map(row => row.id), ['a']);
    assert.equal(second.nextCursor, null);
    const filtered = await readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 0, 10,
      { status: 'fila', dueFrom: '2026-09-29' });
    assert.deepEqual(filtered.data.map(row => row.id), ['a']);
    await assert.rejects(readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 0, 10, {}, 0),
      { code: 'snapshot_changed' });
    f.sql.prepare('UPDATE state_documents SET version=2 WHERE key=?').run(key);
    assert.equal(await readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 0, 10, {}), null);
  } finally { f.sql.close(); }
});

test('active client authority never serves the frozen global effective index', async () => {
  const f = populated();
  try {
    f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
      (workspace_id,generation,mode,source_delivery_version,source_clients_version,
       expected_clients,expected_owners,expected_orphans,expected_array_order,updated_at,compatibility_version)
      VALUES('default','active','active',1,0,0,0,0,0,'2026-09-27',41)`).run();
    assert.equal(await readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 0, 10, {}), null);
  } finally { f.sql.close(); }
});

test('active SQL pages follow one client revision and fall back when its head is stale', async () => {
  const f = populated();
  try {
    f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,'{}')").run();
    f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
      (workspace_id,generation,mode,source_delivery_version,source_clients_version,
       expected_clients,expected_owners,expected_orphans,expected_array_order,updated_at,compatibility_version)
      VALUES('default','authority','active',1,1,1,2,0,2,'2026-09-27',41)`).run();
    const before = { extraTasks: f.raw.extraTasks.filter(row => row.company === 'one') };
    f.sql.prepare(`INSERT INTO delivery_client_snapshots
      (workspace_id,generation,company,revision,body,body_sha256,incarnation)
      VALUES('default','authority','one',5,?,'test','first-life')`).run(JSON.stringify(before));
    f.sql.prepare(`INSERT INTO delivery_effective_tasks
      SELECT workspace_id,'projection',company,id,ordinal,enrollment_id,product_id,
        status,due_at,owner_id,milestone,kind,body FROM delivery_effective_tasks
      WHERE generation=? AND company='one'`).run(generation);
    f.sql.prepare(`INSERT INTO delivery_client_effective_heads
      (workspace_id,company,authority_generation,source_revision,source_incarnation,projection_generation,
       expected_tasks,expected_cycles,updated_at)
      VALUES('default','one','authority',5,'first-life','projection',2,0,'2026-09-27')`).run();
    const first = await readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 0, 1,
      { sort: 'dueAt' }, 41);
    assert.deepEqual(first.data.map(row => row.id), ['b']);
    assert.equal(first.total, 2);
    assert.equal(first.snapshotVersion, 41);
    assert.equal(first.clientSnapshot, 'authority:first-life:5');
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET compatibility_version=42 WHERE workspace_id='default'").run();
    const otherClientChanged = await readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 1, 1,
      { sort: 'dueAt' }, undefined, first.clientSnapshot);
    assert.deepEqual(otherClientChanged.data.map(row => row.id), ['a']);
    assert.equal(otherClientChanged.snapshotVersion, 42);
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET compatibility_version=41 WHERE workspace_id='default'").run();
    const after = { extraTasks: before.extraTasks.map(row => row.id === 'a'
      ? { ...row, title: 'Updated' } : row) };
    const head = await readClientEffectiveHead(f.db, 'default', 'one');
    const projectionWrites = clientEffectiveStatements(f.db, 'default', 'one',
      'authority', 5, 'first-life', before, after, head, 20);
    assert.equal(projectionWrites.length, 2);
    await f.db.batch([
      f.db.prepare(`UPDATE delivery_client_snapshots SET revision=6,body=?
        WHERE workspace_id='default' AND generation='authority' AND company='one' AND revision=5`)
        .bind(JSON.stringify(after)),
      ...projectionWrites,
      f.db.prepare("UPDATE delivery_client_shadow_meta SET compatibility_version=42 WHERE workspace_id='default'"),
    ]);
    const page = await readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 0, 10, {}, 42);
    assert.equal(page.data.find(row => row.id === 'a').title, 'Updated');
    assert.equal(page.total, 2);
    assert.equal(page.clientSnapshot, 'authority:first-life:6');
    await assert.rejects(readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 0, 1,
      {}, undefined, first.clientSnapshot), { code: 'snapshot_changed' });
    await assert.rejects(readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 0, 1, {}, 41),
      { code: 'snapshot_changed' });
    f.sql.prepare("UPDATE delivery_client_snapshots SET revision=7 WHERE company='one'").run();
    assert.equal(await readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 0, 10, {}), null);
  } finally { f.sql.close(); }
});

test('a recreated client cannot reuse an old SQL page at the same revision and row count', async () => {
  const f = populated();
  try {
    f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,'{}')").run();
    f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
      (workspace_id,generation,mode,source_delivery_version,source_clients_version,
       expected_clients,expected_owners,expected_orphans,expected_array_order,updated_at,compatibility_version)
      VALUES('default','authority','active',1,1,1,1,0,1,'2026-09-27',41)`).run();
    const oldBody = { extraTasks: [task('a', 'one', 'fila', '2026-09-30')] };
    f.sql.prepare(`INSERT INTO delivery_client_snapshots
      (workspace_id,generation,company,revision,body,body_sha256,incarnation)
      VALUES('default','authority','one',1,?,'test','old-life')`).run(JSON.stringify(oldBody));
    f.sql.prepare(`INSERT INTO delivery_effective_tasks
      SELECT workspace_id,'projection',company,id,ordinal,enrollment_id,product_id,
        status,due_at,owner_id,milestone,kind,body FROM delivery_effective_tasks
      WHERE generation=? AND company='one' AND id='a'`).run(generation);
    f.sql.prepare(`INSERT INTO delivery_client_effective_heads
      (workspace_id,company,authority_generation,source_revision,source_incarnation,
       projection_generation,expected_tasks,expected_cycles,updated_at)
      VALUES('default','one','authority',1,'old-life','projection',1,0,'2026-09-27')`).run();
    assert.equal((await readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 0, 10, {})).total, 1);
    f.sql.prepare("DELETE FROM delivery_client_snapshots WHERE generation='authority' AND company='one'").run();
    const newBody = { extraTasks: [task('new-a', 'one', 'fila', '2026-10-01')] };
    f.sql.prepare(`INSERT INTO delivery_client_snapshots
      (workspace_id,generation,company,revision,body,body_sha256,incarnation)
      VALUES('default','authority','one',1,?,'test','new-life')`).run(JSON.stringify(newBody));
    assert.equal(await readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 0, 10, {}), null);
    const head = await readClientEffectiveHead(f.db, 'default', 'one');
    assert.deepEqual(clientEffectiveStatements(f.db, 'default', 'one', 'authority', 1,
      'new-life', newBody, newBody, head, 20), []);
  } finally { f.sql.close(); }
});

test('active client fallback keeps a page stable across other clients and rejects its own revision change', async () => {
  const f = populated();
  try {
    f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)")
      .run(JSON.stringify({ extraMembers: [{ id: 'admin', email: 'admin@example.test', access: 'admin' }] }));
    f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,?)")
      .run(JSON.stringify({ extraClients: [{ slug: 'one', name: 'One', status: 'ativo' }] }));
    f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
      (workspace_id,generation,mode,source_delivery_version,source_clients_version,
       expected_clients,expected_owners,expected_orphans,expected_array_order,updated_at,compatibility_version)
      VALUES('default','authority','active',1,1,1,2,0,2,'2026-09-27',41)`).run();
    const body = JSON.stringify({ extraTasks: f.raw.extraTasks.filter(row => row.company === 'one') });
    f.sql.prepare(`INSERT INTO delivery_client_snapshots
      (workspace_id,generation,company,revision,body,body_sha256,incarnation)
      VALUES('default','authority','one',5,?,'test','active-one')`).run(body);
    const env = { DB: f.db, AUTH_MODE: 'dev', DEV_USER_EMAIL: 'admin@example.test' };
    const get = async suffix => {
      const response = await apiResponse(new Request(`https://app.example/api/v1/tasks${suffix}`, {
        headers: { origin: 'https://app.example' },
      }), env, ['tasks']);
      return { status: response.status, body: await response.json() };
    };
    const first = await get('?company=one&limit=1');
    assert.equal(first.status, 200);
    assert.equal(first.body.clientSnapshot, 'authority:active-one:5');
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET compatibility_version=42 WHERE workspace_id='default'").run();
    const next = await get(`?company=one&cursor=1&limit=1&expectedClientSnapshot=${first.body.clientSnapshot}`);
    assert.equal(next.status, 200);
    assert.equal(next.body.snapshotVersion, 42);
    assert.deepEqual(next.body.data.map(row => row.id), ['b']);
    f.sql.prepare("UPDATE delivery_client_snapshots SET revision=6 WHERE company='one'").run();
    const stale = await get(`?company=one&expectedClientSnapshot=${first.body.clientSnapshot}`);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.details.clientSnapshot, 'authority:active-one:6');
  } finally { f.sql.close(); }
});

test('a command updates only changed effective rows and rolls back the whole batch on failure', async () => {
  const f = populated();
  try {
    const commit = (next, version) => commitOperation(f.db, {
      workspace: 'default', principal: 'member:admin', application: 'test',
      actor: { memberId: 'admin', email: 'admin@example.test', kind: 'session' },
      key: `effective-${version}`, command: 'tasks.update', hash: `hash-${version}`,
      id: crypto.randomUUID(), guards: [{ key, version }], writes: [{ key, value: next }],
      events: [], result: { data: {}, documents: [] },
    });
    const next = { ...f.raw, extraTasks: [
      { ...f.raw.extraTasks[0], dueAt: '2026-10-01' }, f.raw.extraTasks[1], f.raw.extraTasks[2],
      task('d', 'one', 'fila', '2026-10-02'),
    ] };
    await commit(next, 1);
    assert.equal(f.sql.prepare('SELECT source_version FROM delivery_effective_meta').get().source_version, 2);
    assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_revisions WHERE company='one'").get().revision, 2);
    assert.equal(f.sql.prepare("SELECT revision FROM delivery_client_revisions WHERE company='two'").get().revision, 1);
    assert.deepEqual((await readEffectiveDeliveryPage(f.db, 'default', 'one', 'tasks', 0, 10, {})).data.map(row => row.id), ['a','b','d']);
    f.sql.exec(`CREATE TRIGGER fail_effective_update BEFORE UPDATE ON delivery_effective_tasks
      BEGIN SELECT RAISE(ABORT,'injected_effective_failure'); END;`);
    const failed = { ...next, extraTasks: next.extraTasks.map(row => row.id === 'a' ? { ...row, dueAt: '2026-10-03' } : row) };
    await assert.rejects(commit(failed, 2), /injected_effective_failure/);
    assert.equal(f.sql.prepare('SELECT version FROM state_documents WHERE key=?').get(key).version, 2);
    assert.equal(f.sql.prepare('SELECT source_version FROM delivery_effective_meta').get().source_version, 2);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM operation_receipts WHERE idempotency_key='effective-2'").get().n, 0);
  } finally { f.sql.close(); }
});

test('a late backfill generation cannot replace active rows after a command', async () => {
  const f = populated();
  try {
    const next = { ...f.raw, extraTasks: f.raw.extraTasks.map(row => row.id === 'a'
      ? { ...row, title: 'CURRENT' } : row) };
    await commitOperation(f.db, { workspace: 'default', principal: 'member:admin', application: 'test',
      actor: { memberId: 'admin', email: 'admin@example.test', kind: 'session' },
      key: 'late-backfill-command', command: 'tasks.update', hash: 'late-backfill-command',
      id: crypto.randomUUID(), guards: [{ key, version: 1 }], writes: [{ key, value: next }],
      events: [], result: { data: {}, documents: [] } });
    const obsolete = effectiveDeliveryRows(f.raw).tasks.find(row => row.id === 'a');
    f.sql.prepare(`INSERT INTO delivery_effective_tasks
      (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,due_at,owner_id,milestone,kind,body)
      VALUES('default','late',?,?,?,?,?,?,?,?,?,?,?)`)
      .run(obsolete.company,obsolete.id,obsolete.ordinal,obsolete.enrollmentId,obsolete.productId,
        obsolete.status,obsolete.dueAt,obsolete.ownerId,obsolete.milestone,obsolete.kind,obsolete.body);
    assert.equal(f.sql.prepare('SELECT generation FROM delivery_effective_meta').get().generation, generation);
    const page = await readEffectiveDeliveryPage(f.db,'default','one','tasks',0,10,{});
    assert.equal(page.data.find(row => row.id === 'a').title, 'CURRENT');
  } finally { f.sql.close(); }
});

test('large reorders leave the read model stale instead of exceeding D1 transaction limits', async () => {
  const f = populated();
  try {
    const cycles = Array.from({ length: 1100 }, (_, index) => ({ id: `cycle-${index}`, company: 'one',
      name: `Cycle ${index}`, startsAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      endsAt: '2030-12-31', taskIds: [] }));
    const previous = { ...f.raw, extraCycles: cycles };
    const next = { ...previous, extraCycles: cycles.map((cycle, index) =>
      index === 0 ? { ...cycle, startsAt: '2030-01-01' } : cycle) };
    const statements = await effectiveDeliveryStatements(f.db, 'default', 1, previous, next);
    assert.equal(statements.length, 0);
    f.sql.prepare('UPDATE state_documents SET version=2 WHERE key=?').run(key);
    assert.equal(await readEffectiveDeliveryPage(f.db, 'default', 'one', 'cycles', 0, 10, {}), null);
  } finally { f.sql.close(); }
});

test('effective mirror respects the remaining whole-command statement budget', async () => {
  const f = populated();
  try {
    const previous = { extraTasks: Array.from({ length: 250 }, (_, index) =>
      task(`bulk-${index}`, 'one', 'fila', '2026-09-30')), taskPatches: {} };
    f.sql.prepare('UPDATE state_documents SET body=? WHERE key=?').run(JSON.stringify(previous), key);
    const next = { extraTasks: previous.extraTasks.map(item => ({ ...item, dueAt: '2026-10-01',
      history: [{ field: 'dueAt', at: '2026-09-26T12:00:00Z', to: '2026-10-01' }] })),
      taskPatches: Object.fromEntries(previous.extraTasks.map(item =>
        [item.id, { dueAt: '2026-10-01' }])) };
    f.sql.prepare(`INSERT INTO delivery_generations
      (workspace_id,generation,source_version,source_sha256,expected_records,status,created_at)
      VALUES('default',1,1,'test',0,'active','2026-09-26')`).run();
    const prepare = f.db.prepare.bind(f.db);
    f.db.prepare = sql => Object.assign(prepare(sql), { sql });
    const statements = await deliveryRecordStatements(f.db, 'default', 1, next, 850);
    assert.ok(statements.length <= 850, `generated ${statements.length} statements`);
    assert.ok(statements.some(statement => statement.sql.includes('delivery_records')));
    assert.ok(!statements.some(statement => statement.sql.includes('delivery_effective_tasks')));
  } finally { f.sql.close(); }
});

test('REST tasks list uses the validated page and preserves the company boundary', async () => {
  const f = populated();
  try {
    f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)")
      .run(JSON.stringify({ extraMembers: [{ id: 'admin', email: 'admin@example.test', access: 'admin' }] }));
    f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,?)")
      .run(JSON.stringify({ extraClients: ['one','two'].map(slug => ({ slug, name: slug, status: 'ativo' })) }));
    const env = { DB: f.db, AUTH_MODE: 'dev', DEV_USER_EMAIL: 'admin@example.test' };
    const get = async suffix => {
      const response = await apiResponse(new Request(`https://app.example/api/v1/tasks${suffix}`,
        { headers: { origin: 'https://app.example' } }), env, ['tasks']);
      return { status: response.status, body: await response.json() };
    };
    const page = await get('?company=one&status=fila&dueFrom=2026-09-29&limit=1');
    assert.equal(page.status, 200, JSON.stringify(page.body));
    assert.deepEqual(page.body.data.map(row => row.id), ['a']);
    assert.equal(page.body.total, 1);
    assert.equal(page.body.snapshotVersion, 1);
    assert.equal((await get('?company=one&expectedVersion=0')).status, 409);
    assert.equal((await get('?company=one&dueFrom=2026-09-31')).status, 400);
    assert.deepEqual((await get('?company=two')).body.data.map(row => row.id), ['c']);
  } finally { f.sql.close(); }
});

test('REST global task pages use active client rows and reject stale global cursors', async () => {
  const f = activeGlobal();
  try {
    f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)")
      .run(JSON.stringify({ extraMembers: [{ id: 'admin', email: 'admin@example.test', access: 'admin' }] }));
    f.sql.prepare("UPDATE state_documents SET body=? WHERE key='ontology.clients.v3'")
      .run(JSON.stringify({ extraClients: ['one', 'two'].map(slug => ({ slug, name: slug, status: 'ativo' })) }));
    const env = { DB: f.db, AUTH_MODE: 'dev', DEV_USER_EMAIL: 'admin@example.test' };
    const prepare = f.db.prepare.bind(f.db);
    f.db.prepare = query => {
      if (query.includes('SELECT company,body FROM delivery_client_snapshots'))
        throw new Error('Unexpected global reconstruction');
      return prepare(query);
    };
    const get = async query => {
      const response = await apiResponse(new Request(`https://app.example/api/v1/tasks?${query}`,
        { headers: { origin: 'https://app.example' } }), env, ['tasks']);
      return { status: response.status, body: await response.json() };
    };
    const page = await get('sort=dueAt&limit=2');
    const legacy = effectiveDeliveryRows(f.raw).tasks.map(row => JSON.parse(row.body))
      .sort((a, b) => Number(!a.dueAt) - Number(!b.dueAt)
        || (a.dueAt ?? '').localeCompare(b.dueAt ?? '') || a.id.localeCompare(b.id));
    assert.equal(page.status, 200, JSON.stringify(page.body));
    assert.deepEqual(page.body.data, legacy.slice(0, 2));
    assert.equal(page.body.total, legacy.length);
    assert.equal(page.body.snapshotVersion, 41);
    assert.equal((await get('sort=dueAt&cursor=2&expectedVersion=40')).status, 409);
    const original = await get('limit=2');
    assert.equal(original.status, 200, JSON.stringify(original.body));
    assert.deepEqual(original.body.data, effectiveDeliveryRows(f.raw).tasks
      .slice(0, 2).map(row => JSON.parse(row.body)));
    assert.equal(original.body.snapshotVersion, 41);
    assert.equal((await get('sort=position&cursor=2&expectedVersion=40')).status, 409);
  } finally { f.sql.close(); }
});

test('REST global cycle pages avoid global execution reconstruction', async () => {
  const raw = { extraTasks: [], extraCycles: [{ id: 'extra-global', company: 'one',
    name: 'Extra', goal: 'Entrega', startsAt: '2026-08-17', endsAt: '2026-08-28',
    ownerId: 'admin', status: 'em-curso', taskIds: [], acceptance: [] }] };
  const f = activeGlobal(raw);
  try {
    f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)")
      .run(JSON.stringify({ extraMembers: [{ id: 'admin', email: 'admin@example.test', access: 'admin' }] }));
    f.sql.prepare("UPDATE state_documents SET body=? WHERE key='ontology.clients.v3'")
      .run(JSON.stringify({ extraClients: [{ slug: 'one', name: 'One', status: 'ativo' }] }));
    const prepare = f.db.prepare.bind(f.db);
    f.db.prepare = query => {
      if (query.includes('SELECT company,body FROM delivery_client_snapshots'))
        throw new Error('Unexpected global reconstruction');
      return prepare(query);
    };
    const env = { DB: f.db, AUTH_MODE: 'dev', DEV_USER_EMAIL: 'admin@example.test' };
    const get = async query => {
      const response = await apiResponse(new Request(`https://app.example/api/v1/cycles?${query}`,
        { headers: { origin: 'https://app.example' } }), env, ['cycles']);
      return { status: response.status, body: await response.json() };
    };
    const page = await get('limit=2');
    assert.equal(page.status, 200, JSON.stringify(page.body));
    assert.deepEqual(page.body.data, effectiveDeliveryRows(raw).cycles
      .slice(0, 2).map(row => JSON.parse(row.body)));
    assert.equal(page.body.snapshotVersion, 41);
    assert.equal((await get('limit=2&cursor=2&expectedVersion=40')).status, 409);
    // Keep the guard for detail reads too: the compatibility reconstruction
    // queries all client bodies, while an indexed detail needs only one.
    const detail = await apiResponse(new Request(`https://app.example/api/v1/cycles/${serviceCycles[0].id}`,
      { headers: { origin: 'https://app.example' } }), env, ['cycles', serviceCycles[0].id]);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).data.id, serviceCycles[0].id);
    const taskId = effectiveDeliveryRows(raw).tasks[0].id;
    const taskDetail = await apiResponse(new Request(`https://app.example/api/v1/tasks/${taskId}`,
      { headers: { origin: 'https://app.example' } }), env, ['tasks', taskId]);
    assert.equal(taskDetail.status, 200);
    assert.equal((await taskDetail.json()).data.id, taskId);
    const scopedOut = await apiResponse(new Request(`https://app.example/api/v1/cycles/${serviceCycles[0].id}?company=wrong`,
      { headers: { origin: 'https://app.example' } }), env, ['cycles', serviceCycles[0].id]);
    assert.equal(scopedOut.status, 404);
    const unknown = await apiResponse(new Request('https://app.example/api/v1/cycles/missing',
      { headers: { origin: 'https://app.example' } }), env, ['cycles', 'missing']);
    assert.equal(unknown.status, 404);
  } finally { f.sql.close(); }
});

test('fallback labels a scoped snapshot with the version read alongside it', async () => {
  const f = populated();
  try {
    f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.workspace.v3',1,?)")
      .run(JSON.stringify({ extraMembers: [{ id: 'admin', email: 'admin@example.test', access: 'admin' }] }));
    f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default','ontology.clients.v3',1,?)")
      .run(JSON.stringify({ extraClients: ['one','two'].map(slug => ({ slug, name: slug, status: 'ativo' })) }));
    f.sql.prepare('UPDATE delivery_effective_meta SET source_version=0').run();
    const records = partitionDeliverySnapshot(f.raw);
    f.sql.prepare(`INSERT INTO delivery_generations
      (workspace_id,generation,source_version,source_sha256,expected_records,status,created_at)
      VALUES('default',1,1,'test',?,'active','2026-09-26')`).run(records.length);
    for (const row of records) f.sql.prepare(`INSERT INTO delivery_records
      (workspace_id,generation,kind,id,ordinal,company,enrollment_id,product_id,status,due_at,body)
      VALUES('default',1,?,?,?,?,?,?,?,?,?)`).run(row.kind,row.id,row.ordinal,row.company,
        row.enrollmentId,row.productId,row.status,row.dueAt,row.body);
    const prepare = f.db.prepare.bind(f.db);
    let advanced = false;
    f.db.prepare = sql => {
      const statement = prepare(sql);
      if (sql.includes('WITH active AS')) {
        const all = statement.all.bind(statement);
        statement.all = async () => {
          const result = await all();
          if (!advanced) {
            advanced = true;
            const next = { ...f.raw, extraTasks: f.raw.extraTasks.map(row => ({ ...row, title: 'NEW' })) };
            f.sql.prepare('UPDATE state_documents SET version=2,body=? WHERE key=?').run(JSON.stringify(next),key);
          }
          return result;
        };
      }
      return statement;
    };
    const env = { DB: f.db, AUTH_MODE: 'dev', DEV_USER_EMAIL: 'admin@example.test' };
    const response = await apiResponse(new Request('https://app.example/api/v1/tasks?company=one&expectedVersion=2'),
      env, ['tasks']);
    assert.equal(advanced, true);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.details.snapshotVersion, 1);
  } finally { f.sql.close(); }
});
