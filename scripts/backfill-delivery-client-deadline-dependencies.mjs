/** Build and certify raw deadline references for every active client slice. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeStateBody } from '../src/server/state-body.ts';
import { deliveryDeadlineDependencies } from '../src/server/operations/delivery-client-deadline-dependencies.ts';

const argument = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const database = argument('database'), workspace = argument('workspace');
const environment = argument('env'), persistTo = argument('persist-to');
const remote = process.argv.includes('--remote'), local = process.argv.includes('--local');
const dryRun = process.argv.includes('--dry-run');
if (remote === local || dryRun === process.argv.includes('--apply') ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(database ?? '') ||
    !/^[a-zA-Z0-9._-]{1,100}$/.test(workspace ?? '') ||
    (environment !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(environment)) ||
    (persistTo !== undefined && (!local || !persistTo.startsWith('/')))) {
  console.error('Use --remote or --local [--persist-to=/absolute/path], --database=DB --workspace=ID [--env=staging], and exactly one of --dry-run or --apply.');
  process.exit(2);
}
const wrangler = join(process.cwd(), 'node_modules/.bin/wrangler');
const quote = value => value === null || value === undefined ? 'NULL'
  : `'${String(value).replaceAll("'", "''")}'`;
const ws = quote(workspace);
const options = environment ? ['--env', environment] : [];
const location = [...(remote ? ['--remote'] : ['--local']),
  ...(persistTo ? ['--persist-to', persistTo] : [])];
function query(sql) {
  const output = execFileSync(wrangler,
    ['d1', 'execute', database, ...location, ...options, '--command', sql, '--json'],
    { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 });
  const response = JSON.parse(output);
  if (!response[0]?.success) throw new Error('D1 query failed');
  return response[0].results;
}
function executeFile(file) {
  execFileSync(wrangler,
    ['d1', 'execute', database, ...location, ...options, '--file', file, '--yes'],
    { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
}
const meta = query(`SELECT m.generation,m.mode,m.compatibility_version,m.expected_clients,
    m.source_delivery_version,m.source_clients_version,
    d.version AS delivery_version,c.version AS clients_version
  FROM delivery_client_shadow_meta m
  JOIN state_documents d ON d.workspace_id=m.workspace_id AND d.key='ontology.delivery.v2'
  JOIN state_documents c ON c.workspace_id=m.workspace_id AND c.key='ontology.clients.v3'
  WHERE m.workspace_id=${ws}`)[0];
if (!meta || meta.mode !== 'active' ||
    meta.delivery_version !== meta.source_delivery_version ||
    meta.clients_version !== meta.source_clients_version)
  throw new Error('Active client authority is absent or stale');
const generation = quote(meta.generation);
const slices = query(`SELECT company,revision,incarnation,body,body_sha256
  FROM delivery_client_snapshots WHERE workspace_id=${ws} AND generation=${generation}
  ORDER BY company`);
assert.equal(slices.length, meta.expected_clients, 'Client slice count differs');
const data = [];
for (const slice of slices) {
  const snapshot = await decodeStateBody(slice.body);
  assert.equal(createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    slice.body_sha256, 'Client slice hash differs');
  data.push({ company: slice.company, revision: slice.revision,
    incarnation: slice.incarnation,
    dependencies: deliveryDeadlineDependencies(snapshot, slice.company) });
}
const summary = { database, environment: local ? 'local' : environment ?? 'production',
  workspace, mode: meta.mode, authorityGeneration: meta.generation,
  compatibilityVersion: meta.compatibility_version, clients: data.length,
  dependencies: data.reduce((sum, slice) => sum + slice.dependencies.length, 0) };
if (dryRun) { console.log(JSON.stringify({ ...summary, action: 'dry-run' })); process.exit(0); }

const projection = randomUUID(), projectionSql = quote(projection);
const directory = mkdtempSync(join(tmpdir(), 'g4-client-deadlines-'));
try {
  const file = join(directory, 'dependencies.sql');
  const statements = data.flatMap(slice => slice.dependencies.map(dependency =>
    `INSERT INTO delivery_client_deadline_dependencies
      (workspace_id,projection_generation,company,source_task_id,target_task_id)
      VALUES(${ws},${projectionSql},${quote(slice.company)},
        ${quote(dependency.sourceTaskId)},${quote(dependency.targetTaskId)});`));
  if (statements.some(statement => Buffer.byteLength(statement) > 95_000))
    throw new Error('One deadline dependency exceeds the safe D1 import statement size');
  writeFileSync(file, statements.join('\n'), { mode: 0o600 });
  if (statements.length) executeFile(file);
  const persisted = [];
  for (let offset = 0; offset < summary.dependencies; offset += 100)
    persisted.push(...query(`SELECT company,source_task_id,target_task_id
      FROM delivery_client_deadline_dependencies
      WHERE workspace_id=${ws} AND projection_generation=${projectionSql}
      ORDER BY company,source_task_id LIMIT 100 OFFSET ${offset}`));
  assert.deepEqual(persisted, data.flatMap(slice => slice.dependencies.map(dependency =>
    ({ company: slice.company, source_task_id: dependency.sourceTaskId,
      target_task_id: dependency.targetTaskId }))), 'Persisted dependencies differ');
  const priorHeads = new Map(query(`SELECT company,authority_generation,source_revision,
      source_incarnation,projection_generation FROM delivery_client_deadline_heads
      WHERE workspace_id=${ws}`).map(row => [row.company, row]));
  let activated = 0;
  for (const slice of data) {
    const company = quote(slice.company), old = priorHeads.get(slice.company);
    const validated = `EXISTS (SELECT 1 FROM delivery_client_shadow_meta m
        JOIN state_documents d ON d.workspace_id=m.workspace_id
          AND d.key='ontology.delivery.v2' AND d.version=m.source_delivery_version
        JOIN state_documents c ON c.workspace_id=m.workspace_id
          AND c.key='ontology.clients.v3' AND c.version=m.source_clients_version
        JOIN delivery_client_snapshots s ON s.workspace_id=m.workspace_id
          AND s.generation=m.generation AND s.company=${company}
          AND s.revision=${slice.revision} AND s.incarnation=${quote(slice.incarnation)}
        WHERE m.workspace_id=${ws} AND m.generation=${generation} AND m.mode='active')
      AND (SELECT COUNT(*) FROM delivery_client_deadline_dependencies
        WHERE workspace_id=${ws} AND projection_generation=${projectionSql}
          AND company=${company})=${slice.dependencies.length}`;
    const now = quote(new Date().toISOString());
    const changed = old
      ? query(`UPDATE delivery_client_deadline_heads SET
          authority_generation=${generation},source_revision=${slice.revision},
          source_incarnation=${quote(slice.incarnation)},
          projection_generation=${projectionSql},expected_dependencies=${slice.dependencies.length},
          updated_at=${now}
        WHERE workspace_id=${ws} AND company=${company}
          AND authority_generation=${quote(old.authority_generation)}
          AND source_revision=${old.source_revision}
          AND source_incarnation=${quote(old.source_incarnation)}
          AND projection_generation=${quote(old.projection_generation)}
          AND ${validated} RETURNING source_revision`)
      : query(`INSERT INTO delivery_client_deadline_heads
          (workspace_id,company,authority_generation,source_revision,source_incarnation,
           projection_generation,expected_dependencies,updated_at)
        SELECT ${ws},${company},${generation},${slice.revision},
          ${quote(slice.incarnation)},${projectionSql},${slice.dependencies.length},${now}
        WHERE ${validated} AND NOT EXISTS
          (SELECT 1 FROM delivery_client_deadline_heads
            WHERE workspace_id=${ws} AND company=${company})
        RETURNING source_revision`);
    if (changed.length === 1) activated++;
  }
  if (activated !== data.length)
    throw new Error(`Only ${activated}/${data.length} client heads activated; concurrent changes remain on the safe fallback`);
  console.log(JSON.stringify({ ...summary, action: 'apply',
    projectionGeneration: projection, activated }));
} finally { rmSync(directory, { recursive: true, force: true }); }
