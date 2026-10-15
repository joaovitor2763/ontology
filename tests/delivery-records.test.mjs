import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionDeliverySnapshot, reconstructDeliverySnapshot } from '../src/server/delivery-records.ts';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { commitOperation } from '../src/server/operations/transaction.ts';
import { scopedDeliverySnapshot } from '../src/server/operations/delivery-record-read.ts';
import { historyObservations } from '../src/server/delivery-history.ts';
import { pageTaskHistory } from '../src/server/operations/task-history.ts';
import { deliveriesFor } from '../src/modules/delivery/infrastructure/queries.ts';
import { deliveries } from '../src/modules/delivery/infrastructure/seed.ts';
import { projectDelivery } from '../src/modules/delivery/infrastructure/snapshot.ts';

test('partição da execução preserva arrays, mapas, histórico e dados órfãos sem normalizar', () => {
  const raw = {
    cycleEdits: { 'old-cycle': { removed: true } },
    extraCycles: [{ id: 'cycle-a', company: 'cliente-a', enrollmentId: 'compra-a', taskIds: ['task-a'] }],
    statusMap: { 'task-a': 'em-curso', 'old-task': 'fila' },
    extraTasks: [{ id: 'task-a', company: 'cliente-a', enrollmentId: 'compra-a', title: 'Tarefa',
      history: [{ at: '2026-01-01', field: 'resumo', count: 80 }, { at: '2026-02-01', field: 'status', to: 'fila' }] }],
    taskPatches: { 'task-a': { history: [{ at: '2026-03-01', field: 'status', to: 'em-curso' }] }, 'old-task': { history: [] } },
    productPlans: { 'plan-a': { id: 'plan-a', title: 'Plano' } },
    companyJourney: { 'cliente-a': 'plan-a' },
    companyMilestone: { 'cliente-a': 1 },
    companyJourneyVersion: {},
  };
  const rows = partitionDeliverySnapshot(raw);
  assert.deepEqual(reconstructDeliverySnapshot(rows), raw);
  assert.equal(rows.find(row => row.kind === 'taskPatches' && row.id === 'task-a').company, 'cliente-a');
  assert.equal(rows.find(row => row.kind === 'taskPatches' && row.id === 'old-task').company, null);
  assert.deepEqual(JSON.parse(rows.find(row => row.kind === 'extraTasks').body).history, raw.extraTasks[0].history);
});

test('partição recusa formato desconhecido e IDs duplicados', () => {
  assert.throws(() => partitionDeliverySnapshot({ extraTasks: [], surprise: true }), /Unknown delivery fields/);
  assert.throws(() => partitionDeliverySnapshot({ extraTasks: [{ id: 'a', company: 'one' }, { id: 'a', company: 'two' }] }), /Duplicate/);
});

test('active reconstruction preserves order when legitimate removals leave ordinal gaps', () => {
  const records = partitionDeliverySnapshot({ extraCycles: [
    { id: 'first', company: 'one', taskIds: [] },
    { id: 'removed', company: 'two', taskIds: [] },
    { id: 'last', company: 'one', taskIds: [] },
  ] }).filter(row => row.id !== 'removed');
  assert.throws(() => reconstructDeliverySnapshot(records), /ordinal gap/);
  assert.deepEqual(reconstructDeliverySnapshot(records, { sparse: true }).extraCycles.map(cycle => cycle.id), ['first', 'last']);
});

test('overlays de tarefa do playbook mantêm o cliente no recorte relacional', () => {
  const playbookTask = deliveriesFor().find(task => !deliveries.some(seed => seed.id === task.id));
  assert.ok(playbookTask);
  const raw = { statusMap: { [playbookTask.id]: 'em-curso' },
    taskPatches: { [playbookTask.id]: { title: 'Título ajustado' } } };
  const rows = partitionDeliverySnapshot(raw);
  assert.equal(rows.find(row => row.kind === 'statusMap').company, playbookTask.company);
  assert.equal(rows.find(row => row.kind === 'taskPatches').company, playbookTask.company);
  const scoped = reconstructDeliverySnapshot(rows.filter(row => row.company === playbookTask.company), { sparse: true });
  assert.deepEqual(projectDelivery(scoped, playbookTask.company), projectDelivery(raw, playbookTask.company));
});

test('histórico duplicado entre tarefa e patch preserva multiplicidade real e resumo legado', async () => {
  const event = { field: 'status', at: '2026-01-01', to: 'fila' };
  const summary = { field: 'resumo', at: '2025-01-01', count: 10 };
  const rows = await historyObservations({ extraTasks: [{ id: 'task-a', history: [summary, event, event] }],
    taskPatches: { 'task-a': { history: [summary, event, event] } } });
  assert.equal(rows.length, 3);
  assert.equal(rows.filter(row => row.isLegacySummary).length, 1);
  assert.deepEqual(rows.filter(row => !row.isLegacySummary).map(row => row.occurrence), [1, 2]);
});

test('geração ativa acompanha somente registros alterados na mesma transação', async () => {
  const { db, sql } = sqliteD1();
  try {
    sql.prepare("INSERT INTO delivery_generations(workspace_id,generation,source_version,source_sha256,expected_records,status,created_at) VALUES('default',1,0,'initial',0,'active','2026-01-01')").run();
    const key = 'ontology.delivery.v2';
    const value = { extraTasks: [{ id: 'task-b', company: 'cliente-b', status: 'fila' },
      { id: 'task-a', company: 'cliente-a', status: 'fila', history: [{ field: 'status', at: '2026-01-01', to: 'fila' }] }], extraCycles: [], taskPatches: {} };
    const commit = (next, version) => ({ workspace: 'default', principal: 'member:actor', application: 'test',
      actor: { memberId: 'actor', email: 'actor@example.test', kind: 'session' }, key: `operation-${version}`,
      command: 'tasks.update', hash: `hash-${version}`, id: crypto.randomUUID(),
      guards: [{ key, version }], writes: [{ key, value: next }], events: [], result: { data: {}, documents: [] } });
    await commitOperation(db, commit(value, 0));
    assert.equal(sql.prepare("SELECT source_version FROM delivery_generations WHERE generation=1").get().source_version, 1);
    assert.deepEqual(JSON.parse(sql.prepare("SELECT body FROM delivery_records WHERE kind='extraTasks' AND id='task-a'").get().body), value.extraTasks[1]);
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM delivery_task_history WHERE task_id='task-a'").get().n, 1);
    const scoped = await scopedDeliverySnapshot(db, 'default', 'cliente-a');
    assert.deepEqual(scoped.extraTasks, [value.extraTasks[1]]);
    const updated = { ...value, extraTasks: [value.extraTasks[0], { ...value.extraTasks[1], status: 'em-curso',
      history: [...value.extraTasks[1].history, { field: 'status', at: '2026-01-02', from: 'fila', to: 'em-curso' }] }] };
    await commitOperation(db, commit(updated, 1));
    assert.equal(sql.prepare("SELECT source_version FROM delivery_generations WHERE generation=1").get().source_version, 2);
    assert.equal(JSON.parse(sql.prepare("SELECT body FROM delivery_records WHERE kind='extraTasks' AND id='task-a'").get().body).status, 'em-curso');
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM delivery_records WHERE generation=1").get().n, 2);
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM delivery_task_history WHERE task_id='task-a'").get().n, 2);
    const compacted = { ...updated, extraTasks: [updated.extraTasks[0], { ...updated.extraTasks[1],
      history: [{ field: 'resumo', at: '2026-01-01', count: 1 }, updated.extraTasks[1].history[1],
        { field: 'status', at: '2026-01-03', from: 'em-curso', to: 'revisao' }] }] };
    await commitOperation(db, commit(compacted, 2));
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM delivery_task_history WHERE task_id='task-a'").get().n, 3);
    assert.ok(sql.prepare("SELECT body FROM state_history WHERE key=? AND version=1").get(key));
    sql.prepare("UPDATE delivery_generations SET source_version=1 WHERE generation=1").run();
    assert.equal(await scopedDeliverySnapshot(db, 'default', 'cliente-a'), null);
  } finally { sql.close(); }
});

test('histórico paginado preserva eventos repetidos e entradas sem data', async () => {
  const { db, sql } = sqliteD1();
  try {
    const add = (id, at) => sql.prepare(`INSERT INTO delivery_task_history
      (workspace_id,task_id,entry_id,entry_hash,occurrence,entry_json,event_at,is_legacy_summary,source_first_version,source_last_version)
      VALUES('default','task-a',?,?,1,?,?,0,1,1)`)
      .run(id, id, JSON.stringify({ field: 'status', at, id }), at);
    add('entry-a', '2026-01-01');
    add('entry-b', '2026-01-01');
    add('entry-c', '2026-01-02');
    add('entry-undated', null);
    const ids = [];
    let cursor;
    do {
      const page = await pageTaskHistory(db, 'default', 'task-a', { limit: 2, cursor });
      ids.push(...page.data.map(entry => entry.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.deepEqual(ids, ['entry-c', 'entry-b', 'entry-a', 'entry-undated']);
    await assert.rejects(pageTaskHistory(db, 'default', 'task-a', { cursor: 'bad!' }), { code: 'invalid_cursor' });
    await assert.rejects(pageTaskHistory(db, 'default', 'task-a', { limit: 101 }), { code: 'invalid_limit' });
  } finally { sql.close(); }
});

test('geração defasada usa fallback sem perder novo evento de histórico', async () => {
  const { db, sql } = sqliteD1();
  try {
    const key = 'ontology.delivery.v2';
    const before = { extraTasks: [{ id: 'task-a', company: 'cliente-a', history: [] }] };
    sql.prepare('INSERT INTO state_documents(workspace_id,key,version,body) VALUES(?,?,1,?)')
      .run('default', key, JSON.stringify(before));
    sql.prepare("INSERT INTO delivery_generations(workspace_id,generation,source_version,source_sha256,expected_records,status,created_at) VALUES('default',1,0,'old',0,'active','2026-01-01')").run();
    const next = { extraTasks: [{ ...before.extraTasks[0], history: [{ field: 'status', at: '2026-09-26', to: 'em-curso' }] }] };
    await commitOperation(db, { workspace: 'default', principal: 'member:actor', application: 'test',
      actor: { memberId: 'actor', email: 'actor@example.test', kind: 'session' }, key: 'stale-history',
      command: 'tasks.update', hash: 'stale-history', id: crypto.randomUUID(),
      guards: [{ key, version: 1 }], writes: [{ key, value: next }], events: [], result: { data: {}, documents: [] } });
    assert.equal(sql.prepare('SELECT version FROM state_documents WHERE key=?').get(key).version, 2);
    assert.equal(sql.prepare('SELECT source_version FROM delivery_generations WHERE generation=1').get().source_version, 0);
    assert.equal(await scopedDeliverySnapshot(db, 'default', 'cliente-a'), null);
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM delivery_task_history WHERE task_id='task-a'").get().n, 1);
  } finally { sql.close(); }
});
