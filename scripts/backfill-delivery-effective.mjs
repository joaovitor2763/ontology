/** Populate the effective read model without changing the authority document. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeStateBody } from '../src/server/state-body.ts';
import { effectiveDeliveryRows } from '../src/server/delivery-effective.ts';
import { projectDelivery } from '../src/modules/delivery/infrastructure/snapshot.ts';

const database = process.argv.find(arg => arg.startsWith('--database='))?.slice('--database='.length);
const workspace = process.argv.find(arg => arg.startsWith('--workspace='))?.slice('--workspace='.length);
const environment = process.argv.find(arg => arg.startsWith('--env='))?.slice('--env='.length);
const persistTo = process.argv.find(arg => arg.startsWith('--persist-to='))?.slice('--persist-to='.length);
const dryRun = process.argv.includes('--dry-run');
const remote = process.argv.includes('--remote'), local = process.argv.includes('--local');
if (remote === local || !/^[a-zA-Z0-9_-]{1,100}$/.test(database ?? '') ||
    !/^[a-zA-Z0-9._-]{1,100}$/.test(workspace ?? '') ||
    (environment !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(environment)) ||
    (persistTo !== undefined && (!local || !persistTo.startsWith('/'))) ||
    dryRun === process.argv.includes('--apply')) {
  console.error('Use --remote or --local [--persist-to=/absolute/path], --database=DB --workspace=ID [--env=staging], and exactly one of --dry-run or --apply.');
  process.exit(2);
}
const wrangler = join(process.cwd(), 'node_modules/.bin/wrangler');
const quote = value => value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const ws = quote(workspace);
const options = environment ? ['--env', environment] : [];
const location = [...(remote ? ['--remote'] : ['--local']), ...(persistTo ? ['--persist-to', persistTo] : [])];
function query(sql) {
  const output = execFileSync(wrangler, ['d1', 'execute', database, ...location, ...options, '--command', sql, '--json'],
    { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 });
  const response = JSON.parse(output);
  if (!response[0]?.success) throw new Error('D1 query failed');
  return response[0].results;
}
function executeFile(file) {
  execFileSync(wrangler, ['d1', 'execute', database, ...location, ...options, '--file', file, '--yes'],
    { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
}

const source = query(`SELECT version,body FROM state_documents WHERE workspace_id=${ws} AND key='ontology.delivery.v2'`)[0];
if (!source) throw new Error('Missing delivery document');
const raw = await decodeStateBody(source.body);
const rows = effectiveDeliveryRows(raw);
for (const company of new Set([...rows.tasks, ...rows.cycles].map(row => row.company))) {
  const scoped = projectDelivery(raw, company);
  assert.deepEqual(rows.tasks.filter(row => row.company === company).map(row => row.body),
    scoped.tasks.map(row => JSON.stringify(row)), 'Scoped task projection differs');
  assert.deepEqual(rows.cycles.filter(row => row.company === company).map(row => row.body),
    scoped.cycles.map(row => JSON.stringify(row)), 'Scoped cycle projection differs');
}
const digest = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
const summary = { database, environment: local ? 'local' : environment ?? 'production', workspace, sourceVersion: source.version,
  tasks: rows.tasks.length, cycles: rows.cycles.length, sourceSha256: digest };
if (dryRun) { console.log(JSON.stringify({ ...summary, mode: 'dry-run' })); process.exit(0); }
const active = query(`SELECT generation,source_version FROM delivery_effective_meta WHERE workspace_id=${ws}`)[0];
if (active?.source_version === source.version)
  throw new Error('Read model is already current');
// Each invocation imports into an isolated, invisible generation. A concurrent
// backfill can never replace rows after another invocation activates its own.
const generation = randomUUID(), generationSql = quote(generation);

const directory = mkdtempSync(join(tmpdir(), 'g4-effective-backfill-'));
try {
  const file = join(directory, 'effective.sql');
  const statements = [
    ...rows.tasks.map(row => `INSERT INTO delivery_effective_tasks
      (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,due_at,owner_id,milestone,kind,body)
      VALUES(${ws},${generationSql},${quote(row.company)},${quote(row.id)},${row.ordinal},${quote(row.enrollmentId)},${quote(row.productId)},${quote(row.status)},${quote(row.dueAt)},${quote(row.ownerId)},${row.milestone ?? 'NULL'},${quote(row.kind)},${quote(row.body)});`),
    ...rows.cycles.map(row => `INSERT INTO delivery_effective_cycles
      (workspace_id,generation,company,id,ordinal,enrollment_id,product_id,status,starts_at,ends_at,body)
      VALUES(${ws},${generationSql},${quote(row.company)},${quote(row.id)},${row.ordinal},${quote(row.enrollmentId)},${quote(row.productId)},${quote(row.status)},${quote(row.startsAt)},${quote(row.endsAt)},${quote(row.body)});`),
  ];
  const counts = new Map();
  for (const row of rows.tasks) { const count = counts.get(row.company) ?? { tasks: 0, cycles: 0 }; count.tasks++; counts.set(row.company, count); }
  for (const row of rows.cycles) { const count = counts.get(row.company) ?? { tasks: 0, cycles: 0 }; count.cycles++; counts.set(row.company, count); }
  statements.push(...[...counts].map(([company, count]) => `INSERT INTO delivery_client_revisions
    (workspace_id,generation,company,revision,task_count,cycle_count)
    VALUES(${ws},${generationSql},${quote(company)},1,${count.tasks},${count.cycles});`));
  if (statements.some(statement => Buffer.byteLength(statement) > 95_000))
    throw new Error('One effective row exceeds the safe D1 import statement size');
  writeFileSync(file, statements.join('\n'), { mode: 0o600 });
  executeFile(file);

  const compare = (kind, expected) => {
    const table = kind === 'tasks' ? 'delivery_effective_tasks' : 'delivery_effective_cycles';
    const actual = [];
    for (let offset = 0; offset < expected.length; offset += 100)
      actual.push(...query(`SELECT * FROM ${table} WHERE workspace_id=${ws} AND generation=${generationSql} ORDER BY company,ordinal,id LIMIT 100 OFFSET ${offset}`));
    const ordered = [...expected].sort((a, b) => a.company.localeCompare(b.company) || a.ordinal - b.ordinal || a.id.localeCompare(b.id));
    assert.equal(actual.length, ordered.length, `${kind} count differs`);
    for (let index = 0; index < ordered.length; index++) {
      const want = ordered[index], got = actual[index];
      assert.equal(got.company, want.company);
      assert.equal(got.id, want.id);
      assert.equal(got.ordinal, want.ordinal);
      assert.equal(got.body, want.body);
    }
  };
  compare('tasks', rows.tasks);
  compare('cycles', rows.cycles);
  const validated = `EXISTS (SELECT 1 FROM state_documents WHERE workspace_id=${ws} AND key='ontology.delivery.v2' AND version=${source.version})
    AND (SELECT COUNT(*) FROM delivery_effective_tasks WHERE workspace_id=${ws} AND generation=${generationSql})=${rows.tasks.length}
    AND (SELECT COUNT(*) FROM delivery_effective_cycles WHERE workspace_id=${ws} AND generation=${generationSql})=${rows.cycles.length}`;
  const activated = active
    ? query(`UPDATE delivery_effective_meta SET generation=${generationSql},source_version=${source.version},
        expected_tasks=${rows.tasks.length},expected_cycles=${rows.cycles.length},updated_at=${quote(new Date().toISOString())}
        WHERE workspace_id=${ws} AND generation=${quote(active.generation)} AND source_version=${active.source_version}
          AND ${validated} RETURNING source_version`)
    : query(`INSERT INTO delivery_effective_meta
        (workspace_id,generation,source_version,expected_tasks,expected_cycles,updated_at)
        SELECT ${ws},${generationSql},${source.version},${rows.tasks.length},${rows.cycles.length},${quote(new Date().toISOString())}
        WHERE ${validated} AND NOT EXISTS (SELECT 1 FROM delivery_effective_meta WHERE workspace_id=${ws})
        RETURNING source_version`);
  assert.equal(activated.length, 1, 'Source or active generation changed during backfill; imported generation remains inactive');
  console.log(JSON.stringify({ ...summary, generation, activated: true }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
