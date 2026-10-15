/** Restores every task history entry still observable in retained raw D1 snapshots. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeStateBody } from '../src/server/state-body.ts';
import { historyObservations } from '../src/server/delivery-history.ts';

const sourcePath = process.argv.find(arg => arg.startsWith('--source='))?.slice('--source='.length);
const database = process.argv.find(arg => arg.startsWith('--database='))?.slice('--database='.length);
const workspace = process.argv.find(arg => arg.startsWith('--workspace='))?.slice('--workspace='.length);
const dryRun = process.argv.includes('--dry-run');
if (!sourcePath || !/^[a-zA-Z0-9._-]{1,100}$/.test(workspace ?? '') ||
    (!dryRun && (!process.argv.includes('--remote') || !process.argv.includes('--apply') ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(database ?? '')))) {
  console.error('Use --source=/private/export.sqlite --workspace=ID --dry-run or add --database=DB --remote --apply.');
  process.exit(2);
}
const db = new DatabaseSync(sourcePath, { readOnly: true });
const seen = new Map();
const versions = [];
try {
  const rows = db.prepare("SELECT version,body FROM state_history WHERE workspace_id=? AND key='ontology.delivery.v2' ORDER BY version");
  for (const row of rows.iterate(workspace)) {
    versions.push(row.version);
    const snapshot = await decodeStateBody(row.body);
    for (const observation of await historyObservations(snapshot)) {
      const identity = `${observation.taskId}\u0000${observation.entryHash}\u0000${observation.occurrence}`;
      const prior = seen.get(identity);
      if (prior) prior.last = row.version;
      else seen.set(identity, { ...observation, first: row.version, last: row.version });
    }
  }
} finally { db.close(); }
assert.ok(versions.length > 0);
const summary = { versions: versions.length, oldest: versions[0], newest: versions.at(-1),
  tasks: new Set([...seen.values()].map(row => row.taskId)).size, entries: seen.size,
  legacySummaries: [...seen.values()].filter(row => row.isLegacySummary).length };
if (dryRun) { console.log(JSON.stringify(summary)); process.exit(0); }
const quote = value => value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const workspaceSql = quote(workspace);
const wrangler = join(process.cwd(), 'node_modules/.bin/wrangler');
const before = JSON.parse(execFileSync(wrangler, ['d1','execute',database,'--remote','--command',
  `SELECT COUNT(*) AS total FROM delivery_task_history WHERE workspace_id=${workspaceSql}`,'--json'],
{ encoding:'utf8',maxBuffer:2*1024*1024 }))[0]?.results?.[0]?.total;
if (before !== 0) throw new Error('O destino já tem histórico. Não execute um backfill que pode duplicar eventos.');
const directory = mkdtempSync(join(tmpdir(), 'g4-delivery-history-'));
try {
  const file = join(directory, 'history.sql');
  const statements = [...seen.values()].map(row => {
    const id = `legacy:${row.entryHash}:${row.occurrence}`;
    return `INSERT INTO delivery_task_history(workspace_id,task_id,entry_id,entry_hash,occurrence,entry_json,event_at,is_legacy_summary,source_first_version,source_last_version) VALUES(${workspaceSql},${quote(row.taskId)},${quote(id)},${quote(row.entryHash)},${row.occurrence},${quote(row.entryJson)},${quote(row.eventAt)},${row.isLegacySummary ? 1 : 0},${row.first},${row.last}) ON CONFLICT(workspace_id,task_id,entry_id) DO UPDATE SET source_first_version=MIN(source_first_version,excluded.source_first_version),source_last_version=MAX(source_last_version,excluded.source_last_version);`;
  });
  if (statements.some(statement => Buffer.byteLength(statement) > 95_000))
    throw new Error('History entry exceeds D1 SQL import capacity');
  writeFileSync(file, statements.join('\n'), { mode: 0o600 });
  execFileSync(wrangler, ['d1','execute',database,'--remote','--file',file,'--yes'],
    { encoding:'utf8',maxBuffer:2*1024*1024 });
  const output = execFileSync(wrangler, ['d1','execute',database,'--remote','--command',
    `SELECT COUNT(*) AS total FROM delivery_task_history WHERE workspace_id=${workspaceSql}`,'--json'],
    { encoding:'utf8',maxBuffer:2*1024*1024 });
  const count = JSON.parse(output)[0]?.results?.[0]?.total;
  assert.equal(count, seen.size);
  console.log(JSON.stringify({ ...summary, validated: true }));
} finally { rmSync(directory, { recursive:true,force:true }); }
