/** Read-only integrity gate for the persisted client generation. Prints counts only. */
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { decodeStateBody } from '../src/server/state-body.ts';
import { partitionDeliverySnapshot, reconstructDeliverySnapshot } from '../src/server/delivery-records.ts';
import { DELIVERY_INITIAL, projectDelivery } from '../src/modules/delivery/infrastructure/snapshot.ts';

const database = process.argv.find(arg => arg.startsWith('--database='))?.slice(11);
const workspace = process.argv.find(arg => arg.startsWith('--workspace='))?.slice(12);
const environment = process.argv.find(arg => arg.startsWith('--env='))?.slice(6);
const persistTo = process.argv.find(arg => arg.startsWith('--persist-to='))?.slice(13);
const remote = process.argv.includes('--remote'), local = process.argv.includes('--local');
if (remote === local || !/^[a-zA-Z0-9_-]{1,100}$/.test(database ?? '') ||
    !/^[a-zA-Z0-9._-]{1,100}$/.test(workspace ?? '') ||
    (environment !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(environment)) ||
    (persistTo !== undefined && (!local || !persistTo.startsWith('/')))) {
  console.error('Use --remote or --local [--persist-to=/absolute/path], --database=DB --workspace=ID [--env=staging].');
  process.exit(2);
}
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const ws = quote(workspace), wrangler = join(process.cwd(), 'node_modules/.bin/wrangler');
const location = remote ? ['--remote'] : ['--local', ...(persistTo ? ['--persist-to', persistTo] : [])];
const options = environment ? ['--env', environment] : [];
function query(sql) {
  const output = execFileSync(wrangler, ['d1', 'execute', database, ...location, ...options,
    '--command', sql, '--json'], { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 });
  const response = JSON.parse(output);
  if (!response[0]?.success) throw new Error('D1 query failed');
  return response[0].results;
}
function marker() {
  return query(`SELECT m.generation,m.mode,m.source_delivery_version,m.source_clients_version,
      m.expected_clients,m.expected_owners,m.expected_orphans,m.expected_array_order,
      m.expected_map_order,m.compatibility_version,
      d.version AS actual_delivery_version,c.version AS actual_clients_version
    FROM delivery_client_shadow_meta m
    JOIN state_documents d ON d.workspace_id=m.workspace_id AND d.key='ontology.delivery.v2'
    JOIN state_documents c ON c.workspace_id=m.workspace_id AND c.key='ontology.clients.v3'
    WHERE m.workspace_id=${ws}`)[0];
}
const before = marker();
assert.ok(before, 'Client shadow marker and both source documents are required');
assert.ok(before.mode === 'shadow' || before.mode === 'active', 'Unknown delivery authority');
assert.equal(before.source_delivery_version, before.actual_delivery_version, 'Execution shadow is stale');
assert.equal(before.source_clients_version, before.actual_clients_version, 'Client shadow is stale');
const gen = quote(before.generation);
const source = before.mode === 'shadow' ? query(`SELECT body FROM state_documents
  WHERE workspace_id=${ws} AND key='ontology.delivery.v2' AND version=${before.source_delivery_version}`)[0] : null;
assert.ok(before.mode === 'active' || source, 'Execution source changed during audit');
const raw = source ? await decodeStateBody(source.body) : null;
const snapshots = query(`SELECT company,body,body_sha256 FROM delivery_client_snapshots
  WHERE workspace_id=${ws} AND generation=${gen} ORDER BY company`);
assert.equal(snapshots.length, before.expected_clients, 'Client snapshot count differs');
const records = [], scoped = [];
for (const row of snapshots) {
  const snapshot = await decodeStateBody(row.body);
  const plain = JSON.stringify(snapshot);
  assert.equal(createHash('sha256').update(plain).digest('hex'), row.body_sha256,
    'A persisted client snapshot hash differs');
  records.push(...partitionDeliverySnapshot(snapshot));
  scoped.push({ company: row.company, snapshot });
}
const orders = query(`SELECT kind,id,ordinal FROM delivery_client_array_order
  WHERE workspace_id=${ws} AND generation=${gen}`);
assert.equal(orders.length, before.expected_array_order, 'Array order count differs');
const ordinal = new Map(orders.map(row => [`${row.kind}\u0000${row.id}`, row.ordinal]));
const mapOrders = query(`SELECT kind,id,ordinal FROM delivery_client_map_order
  WHERE workspace_id=${ws} AND generation=${gen}`);
assert.equal(mapOrders.length, before.expected_map_order, 'Map order count differs');
const mapOrdinal = new Map(mapOrders.map(row => [`${row.kind}\u0000${row.id}`, row.ordinal]));
for (const row of records) if (row.kind === 'extraTasks' || row.kind === 'extraCycles') {
  const position = ordinal.get(`${row.kind}\u0000${row.id}`);
  assert.ok(Number.isSafeInteger(position), 'An array record has no original position');
  row.ordinal = position;
}
const orphans = query(`SELECT kind,id,ordinal,body FROM delivery_client_orphans
  WHERE workspace_id=${ws} AND generation=${gen}`);
assert.equal(orphans.length, before.expected_orphans, 'Orphan count differs');
for (const row of orphans) records.push({ kind: row.kind, id: row.id, ordinal: row.ordinal,
  body: JSON.stringify(await decodeStateBody(row.body)) });
for (const row of records) if (row.kind !== 'extraTasks' && row.kind !== 'extraCycles') {
  const position = mapOrdinal.get(`${row.kind}\u0000${row.id}`);
  assert.ok(Number.isSafeInteger(position), 'A map record has no original position');
  row.ordinal = position;
}
const owners = query(`SELECT kind,id,company FROM delivery_entity_owners
  WHERE workspace_id=${ws} AND generation=${gen}`);
assert.equal(owners.length, before.expected_owners, 'Owner count differs');
// Active client removals preserve global positions of surviving records.
// Gaps are legitimate; shadow backfills still require the original dense order.
const rebuilt = reconstructDeliverySnapshot(records, { sparse: before.mode === 'active' });
const effective = projectDelivery(raw ?? rebuilt);
const expectedOwners = [...effective.tasks.map(task => ['task', task.id, task.company]),
  ...effective.cycles.map(cycle => ['cycle', cycle.id, cycle.company])]
  .sort((a, b) => a.join('\u0000').localeCompare(b.join('\u0000')));
if (!isDeepStrictEqual(owners.map(row => [row.kind, row.id, row.company])
  .sort((a, b) => a.join('\u0000').localeCompare(b.join('\u0000'))), expectedOwners))
  throw new Error('Effective owner index differs');
if (raw && !isDeepStrictEqual(rebuilt, { ...DELIVERY_INITIAL, ...raw }))
  throw new Error('Persisted client snapshots cannot reconstruct the execution source');
if (raw && JSON.stringify(rebuilt) !== JSON.stringify({ ...DELIVERY_INITIAL, ...raw }))
  throw new Error('Persisted client snapshots changed raw map order');
for (const row of scoped) if (!isDeepStrictEqual(projectDelivery(row.snapshot, row.company),
  projectDelivery(raw ?? rebuilt, row.company))) throw new Error('A client projection differs from the source');
if (!isDeepStrictEqual(marker(), before)) throw new Error('A source or generation changed during audit; retry');
console.log(JSON.stringify({ database, environment: local ? 'local' : environment ?? 'production',
  workspace, mode: before.mode, deliveryVersion: before.mode === 'active'
    ? before.compatibility_version : before.source_delivery_version,
  clientsVersion: before.source_clients_version, clients: snapshots.length,
  owners: owners.length, arrayOrder: orders.length, mapOrder: mapOrders.length,
  orphans: orphans.length,
  rawRecords: records.length, effectiveTasks: effective.tasks.length,
  effectiveCycles: effective.cycles.length, equivalent: true,
  serializationEquivalent: raw !== null ? true : null }));
