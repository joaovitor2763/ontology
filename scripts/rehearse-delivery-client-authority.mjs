/** Exercises activation, an active client write and rollback on a disposable copy
 * of a restored D1 SQLite backup. Prints counts only. Never edits --source. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decodeStateBody } from '../src/server/state-body.ts';
import { effectiveDeliveryRows } from '../src/server/delivery-effective.ts';
import { readActiveCompanySlice, activeTaskStatements } from '../src/server/operations/delivery-client-task-write.ts';
import { activateClientAuthority } from '../src/server/operations/delivery-client-activate.ts';
import { rollbackClientAuthority } from '../src/server/operations/delivery-client-rollback.ts';
import { commitOperation } from '../src/server/operations/transaction.ts';

const source = process.argv.find(arg => arg.startsWith('--source='))?.slice(9);
const workspace = process.argv.find(arg => arg.startsWith('--workspace='))?.slice(12);
if (!source || !/^[A-Za-z0-9._-]{1,100}$/.test(workspace ?? '')) {
  console.error('Use --source=/absolute/restored.sqlite --workspace=ID.');
  process.exit(2);
}
const directory = mkdtempSync(join(tmpdir(), 'g4-authority-rehearsal-'));
const copy = join(directory, 'rehearsal.sqlite');
copyFileSync(resolve(source), copy);
const sql = new DatabaseSync(copy);
const db = {
  prepare(query) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return sql.prepare(query).get(...args) ?? null; },
      async all() { return { results: sql.prepare(query).all(...args) }; },
      async run() {
        return /^\s*(?:SELECT|WITH\b)/i.test(query)
          ? { results: sql.prepare(query).all(...args), meta: {} }
          : { meta: sql.prepare(query).run(...args) };
      },
    };
  },
  async batch(statements) {
    sql.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      sql.exec('COMMIT');
      return results;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  },
};
try {
  const meta = sql.prepare(`SELECT generation,mode,source_delivery_version,source_clients_version,
    compatibility_version,expected_clients FROM delivery_client_shadow_meta WHERE workspace_id=?`)
    .get(workspace);
  assert.equal(meta?.mode, 'shadow', 'Source must be a shadow snapshot');
  const pageGeneration = randomUUID();
  const slices = sql.prepare(`SELECT company,body,revision,incarnation FROM delivery_client_snapshots
    WHERE workspace_id=? AND generation=? ORDER BY company`).all(workspace, meta.generation);
  assert.equal(slices.length, meta.expected_clients);
  let pages = 0;
  let selectedCompany;
  sql.exec('BEGIN IMMEDIATE');
  try {
    for (const row of slices) {
      const snapshot = await decodeStateBody(row.body);
      if (!selectedCompany && snapshot.extraTasks?.length) selectedCompany = row.company;
      const effective = effectiveDeliveryRows(snapshot, row.company);
      for (const task of effective.tasks) sql.prepare(`INSERT INTO delivery_effective_tasks
        (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,due_at,
         owner_id,milestone,kind,body) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(workspace, pageGeneration, row.company, task.id, task.ordinal,
          task.enrollmentId, task.productId, task.status, task.dueAt, task.ownerId,
          task.milestone, task.kind, task.body);
      for (const cycle of effective.cycles) sql.prepare(`INSERT INTO delivery_effective_cycles
        (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,starts_at,
         ends_at,body) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(workspace, pageGeneration, row.company, cycle.id, cycle.ordinal,
          cycle.enrollmentId, cycle.productId, cycle.status, cycle.startsAt,
          cycle.endsAt, cycle.body);
      sql.prepare(`INSERT INTO delivery_client_effective_heads
        (workspace_id,company,authority_generation,source_revision,source_incarnation,
         projection_generation,expected_tasks,expected_cycles,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,company) DO UPDATE SET
        authority_generation=excluded.authority_generation,source_revision=excluded.source_revision,
        source_incarnation=excluded.source_incarnation,projection_generation=excluded.projection_generation,
        expected_tasks=excluded.expected_tasks,expected_cycles=excluded.expected_cycles,
        updated_at=excluded.updated_at`)
        .run(workspace, row.company, meta.generation, row.revision, row.incarnation,
          pageGeneration, effective.tasks.length, effective.cycles.length, new Date().toISOString());
      pages += effective.tasks.length;
    }
    sql.exec('COMMIT');
  } catch (error) { sql.exec('ROLLBACK'); throw error; }
  const backupSha256 = createHash('sha256').update('disposable-restore').digest('hex');
  const active = await activateClientAuthority(db, workspace, {
    generation: meta.generation, deliveryVersion: meta.source_delivery_version,
    clientsVersion: meta.source_clients_version,
    compatibilityVersion: meta.compatibility_version, backupSha256,
  });
  assert.equal(active.audit.clients, slices.length);
  assert.ok(selectedCompany, 'The rehearsal needs one extra task');
  const current = await readActiveCompanySlice(db, workspace, selectedCompany);
  assert.ok(current);
  const first = current.snapshot.extraTasks?.[0];
  assert.ok(first, 'The rehearsal needs one extra task');
  const altered = { ...current.snapshot, extraTasks: current.snapshot.extraTasks.map(task =>
    task.id === first.id ? { ...task, title: `${task.title} [ensaio temporário]` } : task) };
  const statements = await activeTaskStatements(db, workspace, current, altered, 400, 'tasks.update');
  await commitOperation(db, { workspace, principal: 'maintenance:rehearsal', application: 'rehearsal',
    actor: { memberId: 'maintenance', email: 'maintenance@example.invalid', kind: 'session' },
    key: randomUUID(), command: 'tasks.update', hash: randomUUID(), id: randomUUID(),
    guards: [], writes: [], statements, events: [], result: { data: {}, documents: [] } });
  const changed = await readActiveCompanySlice(db, workspace, selectedCompany);
  assert.equal(changed.snapshot.extraTasks.find(task => task.id === first.id).title,
    `${first.title} [ensaio temporário]`);
  const currentVersion = sql.prepare(`SELECT compatibility_version FROM delivery_client_shadow_meta
    WHERE workspace_id=?`).get(workspace).compatibility_version;
  await rollbackClientAuthority(db, workspace, currentVersion, 'maintenance:rehearsal');
  const restored = sql.prepare(`SELECT version,body FROM state_documents WHERE workspace_id=?
    AND key='ontology.delivery.v2'`).get(workspace);
  const raw = await decodeStateBody(restored.body);
  assert.equal(raw.extraTasks.find(task => task.id === first.id).title,
    `${first.title} [ensaio temporário]`);
  assert.equal(sql.prepare(`SELECT mode FROM delivery_client_shadow_meta WHERE workspace_id=?`)
    .get(workspace).mode, 'shadow');
  assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  console.log(JSON.stringify({ result: 'ok', clients: slices.length, indexedTasks: pages,
    authorityVersion: active.compatibilityVersion, rollbackVersion: restored.version,
    integrity: 'ok', sourceUntouched: true }));
} finally {
  sql.close();
  rmSync(directory, { recursive: true, force: true });
}
