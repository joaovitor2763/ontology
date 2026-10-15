import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { executeMeetingActionCommand } from '../src/server/operations/meeting-actions.ts';
import { executeSignalCommand } from '../src/server/operations/signals.ts';
import { signalId } from '../src/modules/engagement/domain/signals.ts';
import { readActiveDeliveryCompatibility } from '../src/server/operations/delivery-compatibility-read.ts';
import { decodeStateBody } from '../src/server/state-body.ts';

const DELIVERY = 'ontology.delivery.v2';
const ENGAGEMENT = 'ontology.engagement.v2';
function fixture() {
  const f = sqliteD1();
  const put = (key, value) => f.sql.prepare(`INSERT INTO state_documents
    (workspace_id,key,version,body) VALUES('default',?,1,?)`).run(key, JSON.stringify(value));
  put('ontology.workspace.v3', { extraMembers: [{ id: 'admin', name: 'Equipe',
    email: 'admin@example.test', access: 'admin' }] });
  put('ontology.clients.v3', { extraClients: [{ slug: 'alpha', name: 'Alpha' },
    { slug: 'beta', name: 'Beta' }], allocationsMigrated: true, allocations: [],
    enrollments: [{ id: 'purchase', company: 'alpha', productId: 'product', planId: 'private' }] });
  put('ontology.catalog.v2', { extraProducts: [{ id: 'product', name: 'Produto',
    description: '', cycles: [] }] });
  const physical = { productPlans: { private: { id: 'private', name: 'Plano particular', milestones: [] } } };
  put(DELIVERY, physical);
  const action = { id: 'action', text: 'Enviar relatório', ownerId: 'admin', dueAt: '2026-10-02' };
  put(ENGAGEMENT, { extraMeetings: [{ id: 'meeting', company: 'alpha', title: 'Reunião',
    kind: 'alinhamento', modality: 'presencial', startsAt: '2026-10-01T12:00:00-03:00',
    durationMin: 45, attendeeIds: ['admin'], guests: [], summary: '', notes: '',
    decisions: [], actions: [action], enrollmentIds: ['purchase'] }] });
  const message = { at: new Date().toISOString(), from: 'Cliente',
    text: 'Precisamos do relatório?', kind: 'message' };
  const thread = { id: 'thread', company: 'alpha', channel: 'whatsapp', title: 'Conversa',
    lastAt: message.at, preview: message.text, unread: 0, messages: [message] };
  put('ontology.relationship.v1', { spaces: [thread], notes: {} });
  const alpha = JSON.stringify(physical), beta = JSON.stringify({});
  for (const [company, body] of [['alpha', alpha], ['beta', beta]])
    f.sql.prepare(`INSERT INTO delivery_client_snapshots
      (workspace_id,generation,company,revision,body,body_sha256,incarnation)
      VALUES('default','compound-test',?,1,?,?,?)`)
      .run(company, body, createHash('sha256').update(body).digest('hex'), `${company}-incarnation`);
  f.sql.prepare(`INSERT INTO delivery_client_map_order
    (workspace_id,generation,kind,id,ordinal) VALUES('default','compound-test','productPlans','private',0)`).run();
  f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
    (workspace_id,generation,mode,source_delivery_version,source_clients_version,
     compatibility_version,expected_clients,expected_owners,expected_orphans,
     expected_array_order,expected_map_order,updated_at)
    VALUES('default','compound-test','active',1,1,41,2,0,0,0,1,'2026-09-27')`).run();
  const principal = { id: 'member:admin', kind: 'session', memberId: 'admin',
    email: 'admin@example.test', access: 'admin', application: 'web',
    scopes: null, companies: null, guards: [] };
  return { ...f, principal, signalId: signalId(thread.id, message),
    physical: f.sql.prepare(`SELECT version,body FROM state_documents WHERE key=?`).get(DELIVERY),
    slice: company => decodeStateBody(f.sql.prepare(`SELECT body FROM delivery_client_snapshots
      WHERE company=?`).get(company).body) };
}

test('active meeting conversion writes one client and engagement atomically without reconstructing all clients', async () => {
  const f = fixture();
  try {
    const original = f.db.prepare.bind(f.db);
    f.db.prepare = sql => {
      assert.doesNotMatch(sql, /SELECT company,body FROM delivery_client_snapshots/);
      return original(sql);
    };
    const run = key => executeMeetingActionCommand({ DB: f.db }, f.principal,
      { meetingId: 'meeting', actionId: 'action', enrollmentId: 'purchase' }, key);
    const made = await run('meeting-create');
    assert.equal(made.data.task.journeyId, 'private');
    assert.equal(made.documents.length, 1);
    assert.deepEqual(await run('meeting-create'), JSON.parse(JSON.stringify(made)));
    assert.deepEqual(f.sql.prepare(`SELECT version,body FROM state_documents WHERE key=?`).get(DELIVERY), f.physical);
    assert.equal((await f.slice('alpha')).extraTasks[0].id, made.data.task.id);
    assert.deepEqual(await f.slice('beta'), {});
    assert.equal(f.sql.prepare(`SELECT revision FROM delivery_client_snapshots WHERE company='alpha'`).get().revision, 2);
    assert.equal(f.sql.prepare(`SELECT count(*) n FROM delivery_entity_owners WHERE kind='task' AND id=?`).get(made.data.task.id).n, 1);
    f.db.prepare = original;
    assert.equal((await readActiveDeliveryCompatibility(f.db, 'default')).snapshot.extraTasks[0].id, made.data.task.id);
  } finally { f.sql.close(); }
});

test('active signal conversion keeps its linked task and review in the same guarded batch', async () => {
  const f = fixture();
  try {
    const input = { company: 'alpha', signalId: f.signalId, enrollmentId: 'purchase' };
    const run = key => executeSignalCommand({ DB: f.db }, f.principal,
      'signals.createTask', input, key);
    const made = await run('signal-create');
    assert.equal(made.data.task.journeyId, 'private');
    assert.equal(made.documents.length, 1);
    assert.deepEqual(await run('signal-create'), JSON.parse(JSON.stringify(made)));
    assert.deepEqual(f.sql.prepare(`SELECT version,body FROM state_documents WHERE key=?`).get(DELIVERY), f.physical);
    assert.equal((await f.slice('alpha')).extraTasks[0].id, made.data.task.id);
    assert.equal(f.sql.prepare(`SELECT count(*) n FROM operation_events WHERE type='task.created'`).get().n, 1);
  } finally { f.sql.close(); }
});

test('a concurrent update to the selected client rolls back the compound conversion', async () => {
  const f = fixture();
  try {
    const original = f.db.batch.bind(f.db);
    f.db.batch = statements => {
      f.sql.prepare(`UPDATE delivery_client_snapshots SET revision=revision+1 WHERE company='alpha'`).run();
      return original(statements);
    };
    await assert.rejects(executeMeetingActionCommand({ DB: f.db }, f.principal,
      { meetingId: 'meeting', actionId: 'action', enrollmentId: 'purchase' }, 'raced'),
      { code: 'version_conflict' });
    assert.equal(f.sql.prepare(`SELECT count(*) n FROM operation_receipts`).get().n, 0);
    assert.equal(f.sql.prepare(`SELECT count(*) n FROM operation_events`).get().n, 0);
    assert.equal((await f.slice('alpha')).extraTasks, undefined);
    assert.equal(f.sql.prepare(`SELECT body FROM state_documents WHERE key=?`).get(ENGAGEMENT).body.includes('deliveryId'), false);
  } finally { f.sql.close(); }
});
