import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { clientAccessRows, readClientAccess } from '../src/server/client-access.ts';
import { authorizeOperation } from '../src/server/operations/principal.ts';
import { commitOperation } from '../src/server/operations/transaction.ts';

const KEY = 'ontology.clients.v3';
const principal = { id: 'member:master', kind: 'session', email: 'master@example.test',
  memberId: 'master', access: 'ai_master', application: 'web', scopes: null, companies: null, guards: [] };
function fixture() {
  const f = sqliteD1();
  f.sql.prepare(`INSERT INTO state_documents(workspace_id,key,version,body)
    VALUES('default','ontology.workspace.v3',1,?)`).run(JSON.stringify({ extraMembers: [
    { id: 'master', email: principal.email, access: 'ai_master' }] }));
  const clients = { allocationsMigrated: true, allocations: [
    { company: 'alpha', memberId: 'master', role: 'lead' },
    { company: 'beta', memberId: 'other', role: 'lead', to: '2000-01-01' },
  ] };
  f.sql.prepare(`INSERT INTO state_documents(workspace_id,key,version,body)
    VALUES('default',?,1,?)`).run(KEY, JSON.stringify(clients));
  const rows = clientAccessRows(clients);
  for (const [company, body] of rows)
    f.sql.prepare(`INSERT INTO client_access_allocations(workspace_id,generation,company,body)
      VALUES('default','access-test',?,?)`).run(company, body);
  f.sql.prepare(`INSERT INTO client_access_meta
    (workspace_id,generation,source_clients_version,expected_companies,updated_at)
    VALUES('default','access-test',1,?,'2026-09-27')`).run(rows.size);
  const authorize = company => authorizeOperation(f.db, 'default', principal,
    { action: 'stakeholders.editar', scope: 'stakeholders:write', company });
  return { ...f, clients, authorize };
}

test('indexed authorization matches allocation dates without reading the client body', async () => {
  const f = fixture();
  try {
    const original = f.db.prepare.bind(f.db);
    f.db.prepare = sql => {
      const statement = original(sql), bind = statement.bind;
      statement.bind = function(...values) {
        if (sql.includes('state_documents') && sql.includes('body') && values.includes(KEY))
          throw new Error('Clients document body was loaded');
        return bind.apply(this, values);
      };
      return statement;
    };
    const guards = await f.authorize('alpha');
    assert.ok(guards.some(guard => guard.key === KEY && guard.version === 1));
    await assert.rejects(f.authorize('beta'), { code: 'permission_denied' });
    assert.deepEqual((await readClientAccess(f.db, 'default', 'alpha', '2026-09-27')).responsibleIds, ['master']);
  } finally { f.sql.close(); }
});

test('a stale access projection falls back and a revocation still invalidates the commit guard', async () => {
  const f = fixture();
  try {
    const guards = await f.authorize('alpha');
    f.sql.prepare('UPDATE state_documents SET version=2,body=? WHERE key=?')
      .run(JSON.stringify({ allocationsMigrated: true, allocations: [] }), KEY);
    assert.equal(await readClientAccess(f.db, 'default', 'alpha', '2026-09-27'), null);
    await assert.rejects(f.authorize('alpha'), { code: 'permission_denied' });
    await assert.rejects(commitOperation(f.db, {
      workspace: 'default', principal: principal.id, application: 'web', actor: principal,
      key: 'revoked', command: 'test', hash: 'revoked', id: crypto.randomUUID(),
      guards, writes: [], events: [], result: {},
    }), { code: 'version_conflict' });
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM operation_receipts').get().n, 0);
  } finally { f.sql.close(); }
});

test('client writes update only changed access rows and marker in the same transaction', async () => {
  const f = fixture();
  try {
    const next = { ...f.clients, allocations: [] };
    await commitOperation(f.db, {
      workspace: 'default', principal: principal.id, application: 'web', actor: principal,
      key: 'remove-allocation', command: 'allocations.remove', hash: 'remove-allocation',
      id: crypto.randomUUID(), guards: [{ key: KEY, version: 1 }],
      writes: [{ key: KEY, value: next }], events: [], result: {},
    });
    assert.equal(f.sql.prepare('SELECT source_clients_version FROM client_access_meta').get().source_clients_version, 2);
    assert.deepEqual(await readClientAccess(f.db, 'default', 'alpha', '2026-09-27'),
      { responsibleIds: [], version: 2 });
    await assert.rejects(f.authorize('alpha'), { code: 'permission_denied' });
  } finally { f.sql.close(); }
});
