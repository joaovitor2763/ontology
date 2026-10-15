/** Bounded, resumable shadow backfill. It never activates relational reads or deletes legacy state. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeStateBody } from '../src/server/state-body.ts';
import { partitionDeliverySnapshot, reconstructDeliverySnapshot } from '../src/server/delivery-records.ts';

const database = process.argv.find(arg => arg.startsWith('--database='))?.slice('--database='.length);
const workspace = process.argv.find(arg => arg.startsWith('--workspace='))?.slice('--workspace='.length);
const dryRun = process.argv.includes('--dry-run');
if (!process.argv.includes('--remote') || !/^[a-zA-Z0-9_-]{1,100}$/.test(database ?? '') ||
    !/^[a-zA-Z0-9._-]{1,100}$/.test(workspace ?? '') || dryRun === process.argv.includes('--apply')) {
  console.error('Use --remote --database=DB --workspace=ID with exactly one of --dry-run or --apply.');
  process.exit(2);
}

const wrangler = join(process.cwd(), 'node_modules/.bin/wrangler');
const sqlQuote = value => value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const workspaceSql = sqlQuote(workspace);
function query(sql) {
  const output = execFileSync(wrangler, ['d1', 'execute', database, '--remote', '--command', sql, '--json'],
    { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 });
  const response = JSON.parse(output);
  if (!response[0]?.success) throw new Error('D1 query failed');
  return response[0].results;
}
function executeFile(path) {
  execFileSync(wrangler, ['d1', 'execute', database, '--remote', '--file', path, '--yes'],
    { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
}

const source = query(`SELECT version,body FROM state_documents WHERE workspace_id=${workspaceSql} AND key='ontology.delivery.v2'`)[0];
if (!source) throw new Error('Missing legacy delivery document');
const raw = await decodeStateBody(source.body);
const records = partitionDeliverySnapshot(raw);
assert.deepEqual(reconstructDeliverySnapshot(records), raw);
const generation = source.version;
const sha = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
if (dryRun) { console.log(JSON.stringify({ database, workspace, generation, records: records.length, sha256: sha, mode: 'dry-run' })); process.exit(0); }
const existing = query(`SELECT source_sha256,status FROM delivery_generations WHERE workspace_id=${workspaceSql} AND generation=${generation}`)[0];
if (existing && (existing.source_sha256 !== sha || existing.status === 'active'))
  throw new Error('Generation conflict; refusing to overwrite');
const directory = mkdtempSync(join(tmpdir(), 'g4-delivery-backfill-'));
try {
  const file = join(directory, 'records.sql');
  const now = new Date().toISOString();
  const statements = [
    `INSERT OR IGNORE INTO delivery_generations(workspace_id,generation,source_version,source_sha256,expected_records,status,created_at) VALUES(${workspaceSql},${generation},${generation},${sqlQuote(sha)},${records.length},'loading',${sqlQuote(now)});`,
    ...records.map(row => `INSERT OR REPLACE INTO delivery_records(workspace_id,generation,kind,id,ordinal,company,enrollment_id,product_id,status,due_at,body) VALUES(${workspaceSql},${generation},${sqlQuote(row.kind)},${sqlQuote(row.id)},${row.ordinal ?? 'NULL'},${sqlQuote(row.company)},${sqlQuote(row.enrollmentId)},${sqlQuote(row.productId)},${sqlQuote(row.status)},${sqlQuote(row.dueAt)},${sqlQuote(row.body)});`),
  ];
  if (statements.some(statement => Buffer.byteLength(statement) > 95_000))
    throw new Error('One record exceeds D1 SQL import capacity; use a bound-parameter backfill');
  const sql = statements.join('\n');
  writeFileSync(file, sql, { mode: 0o600 });
  executeFile(file);

  const count = query(`SELECT COUNT(*) AS total FROM delivery_records WHERE workspace_id=${workspaceSql} AND generation=${generation}`)[0]?.total;
  assert.equal(count, records.length);
  const restored = [];
  for (let offset = 0; offset < records.length; offset += 200) {
    const page = query(`SELECT kind,id,ordinal,company,enrollment_id,product_id,status,due_at,body FROM delivery_records WHERE workspace_id=${workspaceSql} AND generation=${generation} ORDER BY kind,id LIMIT 200 OFFSET ${offset}`);
    restored.push(...page.map(row => ({ kind: row.kind, id: row.id, ordinal: row.ordinal,
      company: row.company, enrollmentId: row.enrollment_id, productId: row.product_id,
      status: row.status, dueAt: row.due_at, body: row.body })));
  }
  assert.equal(restored.length, records.length);
  assert.deepEqual(reconstructDeliverySnapshot(restored), raw);
  const current = query(`SELECT version FROM state_documents WHERE workspace_id=${workspaceSql} AND key='ontology.delivery.v2'`)[0];
  if (current?.version !== generation)
    throw new Error(`Legacy document advanced to version ${current?.version}; shadow generation ${generation} remains inactive`);
  const validated = query(`UPDATE delivery_generations SET status='validated',validated_at=${sqlQuote(new Date().toISOString())} WHERE workspace_id=${workspaceSql} AND generation=${generation} AND source_sha256=${sqlQuote(sha)} AND status IN ('loading','validated') AND EXISTS (SELECT 1 FROM state_documents WHERE workspace_id=${workspaceSql} AND key='ontology.delivery.v2' AND version=${generation}) RETURNING generation`);
  assert.equal(validated.length, 1, 'Legacy version changed before validation');
  console.log(JSON.stringify({ generation, records: restored.length, sha256: sha, validated: true }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
