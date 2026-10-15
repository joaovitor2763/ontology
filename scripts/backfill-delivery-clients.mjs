/** Build and verify client execution snapshots in an invisible D1 generation. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeStateBody, encodeCompressedStateBody } from '../src/server/state-body.ts';
import { deliveryMapOrder, partitionClientDelivery } from '../src/server/delivery-client-slices.ts';
import { partitionDeliverySnapshot, reconstructDeliverySnapshot } from '../src/server/delivery-records.ts';
import { DELIVERY_INITIAL, projectDelivery } from '../src/modules/delivery/infrastructure/snapshot.ts';
import { projectClients } from '../src/modules/clients/infrastructure/snapshot.ts';

const database = process.argv.find(arg => arg.startsWith('--database='))?.slice(11);
const workspace = process.argv.find(arg => arg.startsWith('--workspace='))?.slice(12);
const environment = process.argv.find(arg => arg.startsWith('--env='))?.slice(6);
const persistTo = process.argv.find(arg => arg.startsWith('--persist-to='))?.slice(13);
const remote = process.argv.includes('--remote'), local = process.argv.includes('--local');
const dryRun = process.argv.includes('--dry-run'), apply = process.argv.includes('--apply');
if (remote === local || dryRun === apply || !/^[a-zA-Z0-9_-]{1,100}$/.test(database ?? '') ||
    !/^[a-zA-Z0-9._-]{1,100}$/.test(workspace ?? '') ||
    (environment !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(environment)) ||
    (persistTo !== undefined && (!local || !persistTo.startsWith('/')))) {
  console.error('Use --remote or --local [--persist-to=/absolute/path], --database=DB --workspace=ID [--env=staging], and --dry-run or --apply.');
  process.exit(2);
}
const quote = value => value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const ws = quote(workspace), wrangler = join(process.cwd(), 'node_modules/.bin/wrangler');
const location = remote ? ['--remote'] : ['--local', ...(persistTo ? ['--persist-to', persistTo] : [])];
const options = environment ? ['--env', environment] : [];
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
const digest = body => createHash('sha256').update(body).digest('hex');
const bodyChunks = body => body.match(/.{1,50000}/g) ?? [''];
const docs = query(`SELECT key,version,body FROM state_documents WHERE workspace_id=${ws}
  AND key IN ('ontology.delivery.v2','ontology.clients.v3')`);
const deliveryDoc = docs.find(doc => doc.key === 'ontology.delivery.v2');
const clientsDoc = docs.find(doc => doc.key === 'ontology.clients.v3');
assert.ok(deliveryDoc && clientsDoc, 'Both source documents are required');
const raw = await decodeStateBody(deliveryDoc.body);
const clients = projectClients(await decodeStateBody(clientsDoc.body));
const partition = partitionClientDelivery(raw, clients.enrollments);
const arrayOrder = partition.slices.flatMap(slice => slice.records
  .filter(row => row.kind === 'extraTasks' || row.kind === 'extraCycles')
  .map(row => ({ kind: row.kind, id: row.id, ordinal: row.ordinal, company: slice.company })));
const mapOrder = [...deliveryMapOrder(raw)].map(([identity, ordinal]) => {
  const [kind, id] = identity.split('\u0000');
  return { kind, id, ordinal };
});
const encodedOrphans = await Promise.all(partition.unassigned.map(async row =>
  ({ ...row, encodedBody: await encodeCompressedStateBody(JSON.parse(row.body)) })));
assert.deepEqual(reconstructDeliverySnapshot([
  ...partition.slices.flatMap(slice => slice.records), ...partition.unassigned,
]), { ...DELIVERY_INITIAL, ...raw }, 'Client partition must reconstruct the source exactly');
const byCompany = new Map(partition.slices.map(slice => [slice.company, slice.snapshot]));
const effective = projectDelivery(raw);
const owners = [
  ...effective.tasks.map(task => ({ kind: 'task', id: task.id, company: task.company })),
  ...effective.cycles.map(cycle => ({ kind: 'cycle', id: cycle.id, company: cycle.company })),
];
assert.equal(new Set(owners.map(row => `${row.kind}\u0000${row.id}`)).size, owners.length, 'Effective IDs must have one owner');
const companies = [...new Set([
  ...clients.allClients.map(client => client.slug), ...byCompany.keys(), ...owners.map(row => row.company),
])].sort();
const snapshots = await Promise.all(companies.map(async company => {
  const snapshot = byCompany.get(company) ?? reconstructDeliverySnapshot([], { sparse: true });
  assert.deepEqual(projectDelivery(snapshot, company), projectDelivery(raw, company),
    `Client projection differs for ${company}`);
  const plain = JSON.stringify(snapshot);
  return { company, plain, body: await encodeCompressedStateBody(snapshot), hash: digest(plain) };
}));
const summary = {
  database, environment: local ? 'local' : environment ?? 'production', workspace,
  deliveryVersion: deliveryDoc.version, clientsVersion: clientsDoc.version,
  clients: snapshots.length, owners: owners.length, orphans: partition.unassigned.length,
  arrayOrder: arrayOrder.length, mapOrder: mapOrder.length,
  sharedPlans: partition.sharedPlanIds.length,
  largestClientBytes: Math.max(0, ...snapshots.map(row => Buffer.byteLength(row.plain))),
};
const generation = randomUUID(), gen = quote(generation);
const snapshotStatements = row => {
  const [first, ...rest] = bodyChunks(row.body);
  return [`INSERT INTO delivery_client_snapshots
    (workspace_id,generation,company,revision,body,body_sha256,incarnation)
    VALUES(${ws},${gen},${quote(row.company)},1,${quote(first)},${quote(row.hash)},${quote(randomUUID())});`,
  ...rest.map(chunk => `UPDATE delivery_client_snapshots SET body=body||${quote(chunk)}
    WHERE workspace_id=${ws} AND generation=${gen} AND company=${quote(row.company)};`)];
};
const orphanStatements = row => {
  const [first, ...rest] = bodyChunks(row.encodedBody);
  return [`INSERT INTO delivery_client_orphans
    (workspace_id,generation,kind,id,ordinal,body)
    VALUES(${ws},${gen},${quote(row.kind)},${quote(row.id)},${row.ordinal ?? 'NULL'},${quote(first)});`,
  ...rest.map(chunk => `UPDATE delivery_client_orphans SET body=body||${quote(chunk)}
    WHERE workspace_id=${ws} AND generation=${gen} AND kind=${quote(row.kind)} AND id=${quote(row.id)};`)];
};
const statements = [
  ...snapshots.flatMap(snapshotStatements),
  ...owners.map(row => `INSERT INTO delivery_entity_owners(workspace_id,generation,kind,id,company)
    VALUES(${ws},${gen},${quote(row.kind)},${quote(row.id)},${quote(row.company)});`),
  ...arrayOrder.map(row => `INSERT INTO delivery_client_array_order
    (workspace_id,generation,kind,id,ordinal,company)
    VALUES(${ws},${gen},${quote(row.kind)},${quote(row.id)},${row.ordinal},${quote(row.company)});`),
  ...mapOrder.map(row => `INSERT INTO delivery_client_map_order
    (workspace_id,generation,kind,id,ordinal)
    VALUES(${ws},${gen},${quote(row.kind)},${quote(row.id)},${row.ordinal});`),
  ...encodedOrphans.flatMap(orphanStatements),
];
const maxImportStatementBytes = Math.max(0, ...statements.map(statement => Buffer.byteLength(statement)));
if (maxImportStatementBytes > 95_000)
  throw new Error(`An import statement exceeds the safe D1 size (${maxImportStatementBytes} bytes)`);
summary.maxImportStatementBytes = maxImportStatementBytes;
if (dryRun) { console.log(JSON.stringify({ ...summary, mode: 'dry-run' })); process.exit(0); }
const active = query(`SELECT generation,mode,source_delivery_version,source_clients_version,expected_map_order
  FROM delivery_client_shadow_meta WHERE workspace_id=${ws}`)[0];
if (active?.mode === 'active') throw new Error('Refusing to replace an authoritative client generation');
if (active?.source_delivery_version === deliveryDoc.version &&
    active?.source_clients_version === clientsDoc.version &&
    active?.expected_map_order === mapOrder.length)
  throw new Error('Client shadow is already current');
const directory = mkdtempSync(join(tmpdir(), 'g4-client-backfill-'));
try {
  const file = join(directory, 'client-shadow.sql');
  writeFileSync(file, statements.join('\n'), { mode: 0o600 });
  executeFile(file);
  const imported = query(`SELECT company,body,body_sha256 FROM delivery_client_snapshots
    WHERE workspace_id=${ws} AND generation=${gen} ORDER BY company`);
  assert.equal(imported.length, snapshots.length, 'Imported client count differs');
  const persistedRecords = [];
  for (let index = 0; index < snapshots.length; index++) {
    const expected = snapshots[index], actual = imported[index];
    assert.equal(actual.company, expected.company);
    assert.equal(actual.body_sha256, expected.hash);
    const decoded = await decodeStateBody(actual.body);
    assert.deepEqual(decoded, JSON.parse(expected.plain));
    persistedRecords.push(...partitionDeliverySnapshot(decoded));
  }
  const importedOwners = query(`SELECT kind,id,company FROM delivery_entity_owners
    WHERE workspace_id=${ws} AND generation=${gen} ORDER BY kind,id`);
  assert.deepEqual(importedOwners, [...owners].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)));
  const importedOrder = query(`SELECT kind,id,ordinal,company FROM delivery_client_array_order
    WHERE workspace_id=${ws} AND generation=${gen} ORDER BY kind,id`);
  assert.deepEqual(importedOrder, [...arrayOrder].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)));
  const ordinals = new Map(importedOrder.map(row => [`${row.kind}\u0000${row.id}`, row.ordinal]));
  for (const row of persistedRecords) if (row.kind === 'extraTasks' || row.kind === 'extraCycles') {
    const ordinal = ordinals.get(`${row.kind}\u0000${row.id}`);
    assert.ok(Number.isSafeInteger(ordinal), `Missing persisted ordinal for ${row.kind}/${row.id}`);
    row.ordinal = ordinal;
  }
  const importedMapOrder = query(`SELECT kind,id,ordinal FROM delivery_client_map_order
    WHERE workspace_id=${ws} AND generation=${gen} ORDER BY kind,id`);
  assert.deepEqual(importedMapOrder, [...mapOrder].sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)));
  const mapOrdinals = new Map(importedMapOrder.map(row => [`${row.kind}\u0000${row.id}`, row.ordinal]));
  const importedOrphans = query(`SELECT kind,id,ordinal,body FROM delivery_client_orphans
    WHERE workspace_id=${ws} AND generation=${gen} ORDER BY kind,id`);
  assert.equal(importedOrphans.length, partition.unassigned.length);
  for (const row of importedOrphans) persistedRecords.push({
    kind: row.kind, id: row.id, ordinal: row.ordinal,
    body: JSON.stringify(await decodeStateBody(row.body)),
  });
  for (const row of persistedRecords) if (row.kind !== 'extraTasks' && row.kind !== 'extraCycles') {
    const ordinal = mapOrdinals.get(`${row.kind}\u0000${row.id}`);
    assert.ok(Number.isSafeInteger(ordinal), `Missing persisted map ordinal for ${row.kind}/${row.id}`);
    row.ordinal = ordinal;
  }
  assert.deepEqual(reconstructDeliverySnapshot(persistedRecords),
    { ...DELIVERY_INITIAL, ...raw }, 'Persisted client rows cannot rebuild the source');
  assert.equal(JSON.stringify(reconstructDeliverySnapshot(persistedRecords)),
    JSON.stringify({ ...DELIVERY_INITIAL, ...raw }), 'Persisted map order differs from source');
  const validation = `EXISTS (SELECT 1 FROM state_documents WHERE workspace_id=${ws}
      AND key='ontology.delivery.v2' AND version=${deliveryDoc.version})
    AND EXISTS (SELECT 1 FROM state_documents WHERE workspace_id=${ws}
      AND key='ontology.clients.v3' AND version=${clientsDoc.version})
    AND (SELECT COUNT(*) FROM delivery_client_snapshots WHERE workspace_id=${ws}
      AND generation=${gen})=${snapshots.length}
    AND (SELECT COUNT(*) FROM delivery_entity_owners WHERE workspace_id=${ws}
      AND generation=${gen})=${owners.length}
    AND (SELECT COUNT(*) FROM delivery_client_orphans WHERE workspace_id=${ws}
      AND generation=${gen})=${partition.unassigned.length}
    AND (SELECT COUNT(*) FROM delivery_client_array_order WHERE workspace_id=${ws}
      AND generation=${gen})=${arrayOrder.length}
    AND (SELECT COUNT(*) FROM delivery_client_map_order WHERE workspace_id=${ws}
      AND generation=${gen})=${mapOrder.length}`;
  const now = quote(new Date().toISOString());
  const activated = active
    ? query(`UPDATE delivery_client_shadow_meta SET generation=${gen},mode='shadow',
        source_delivery_version=${deliveryDoc.version},source_clients_version=${clientsDoc.version},
        compatibility_version=compatibility_version+1,
        expected_clients=${snapshots.length},expected_owners=${owners.length},
        expected_map_order=${mapOrder.length},
        expected_orphans=${partition.unassigned.length},expected_array_order=${arrayOrder.length},updated_at=${now}
        WHERE workspace_id=${ws} AND generation=${quote(active.generation)} AND mode='shadow'
          AND source_delivery_version=${active.source_delivery_version}
          AND source_clients_version=${active.source_clients_version}
          AND ${validation} RETURNING generation`)
    : query(`INSERT INTO delivery_client_shadow_meta
        (workspace_id,generation,mode,source_delivery_version,source_clients_version,compatibility_version,
         expected_clients,expected_owners,expected_orphans,expected_array_order,expected_map_order,updated_at)
        SELECT ${ws},${gen},'shadow',${deliveryDoc.version},${clientsDoc.version},${deliveryDoc.version},
          ${snapshots.length},${owners.length},${partition.unassigned.length},${arrayOrder.length},${mapOrder.length},${now}
        WHERE ${validation} AND NOT EXISTS (SELECT 1 FROM delivery_client_shadow_meta
          WHERE workspace_id=${ws}) RETURNING generation`);
  assert.equal(activated.length, 1, 'Source or shadow generation changed; imported generation remains invisible');
  console.log(JSON.stringify({ ...summary, generation, mode: 'shadow' }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
