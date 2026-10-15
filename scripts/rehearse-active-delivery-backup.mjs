/** Validate and roll back active client authority on a disposable restored D1 copy. */
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decodeStateBody } from '../src/server/state-body.ts';
import { projectDelivery } from '../src/modules/delivery/infrastructure/snapshot.ts';
import { readActiveDeliveryCompatibility } from '../src/server/operations/delivery-compatibility-read.ts';
import { rollbackClientAuthority } from '../src/server/operations/delivery-client-rollback.ts';

const source = process.argv.find(arg => arg.startsWith('--source='))?.slice(9);
const workspace = process.argv.find(arg => arg.startsWith('--workspace='))?.slice(12);
if (!source?.startsWith('/') || !/^[A-Za-z0-9._-]{1,100}$/.test(workspace ?? '')) {
  console.error('Use --source=/absolute/restored.sqlite --workspace=ID.');
  process.exit(2);
}
const directory = mkdtempSync(join(tmpdir(), 'g4-active-rehearsal-'));
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
  const marker = sql.prepare(`SELECT mode,compatibility_version,expected_clients,
    source_delivery_version,source_clients_version FROM delivery_client_shadow_meta
    WHERE workspace_id=?`).get(workspace);
  assert.equal(marker?.mode, 'active', 'Source must have active client authority');
  const physical = sql.prepare(`SELECT key,version FROM state_documents WHERE workspace_id=?
    AND key IN ('ontology.delivery.v2','ontology.clients.v3')`).all(workspace);
  assert.equal(physical.find(row => row.key === 'ontology.delivery.v2')?.version,
    marker.source_delivery_version);
  assert.equal(physical.find(row => row.key === 'ontology.clients.v3')?.version,
    marker.source_clients_version);
  const active = await readActiveDeliveryCompatibility(db, workspace);
  assert.equal(active?.version, marker.compatibility_version);
  const projected = projectDelivery(active.snapshot);
  await rollbackClientAuthority(db, workspace, marker.compatibility_version,
    'maintenance:backup-rehearsal');
  const restored = sql.prepare(`SELECT version,body FROM state_documents
    WHERE workspace_id=? AND key='ontology.delivery.v2'`).get(workspace);
  assert.equal(restored.version, marker.compatibility_version);
  assert.equal(JSON.stringify(await decodeStateBody(restored.body)),
    JSON.stringify(active.snapshot));
  assert.equal(sql.prepare('SELECT mode FROM delivery_client_shadow_meta WHERE workspace_id=?')
    .get(workspace).mode, 'shadow');
  assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  console.log(JSON.stringify({ result: 'ok', clients: marker.expected_clients,
    tasks: projected.tasks.length, cycles: projected.cycles.length,
    authorityVersion: marker.compatibility_version, integrity: 'ok', sourceUntouched: true }));
} finally {
  sql.close();
  rmSync(directory, { recursive: true, force: true });
}
