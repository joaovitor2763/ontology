/** Read-only inventory for the client-scoped execution cutover. Prints counts only. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { decodeStateBody } from '../src/server/state-body.ts';
import { partitionDeliverySnapshot, reconstructDeliverySnapshot } from '../src/server/delivery-records.ts';
import { DELIVERY_INITIAL, projectDelivery } from '../src/modules/delivery/infrastructure/snapshot.ts';
import { projectClients } from '../src/modules/clients/infrastructure/snapshot.ts';
import { partitionClientDelivery } from '../src/server/delivery-client-slices.ts';

const database = process.argv.find(arg => arg.startsWith('--database='))?.slice(11);
const workspace = process.argv.find(arg => arg.startsWith('--workspace='))?.slice(12);
const environment = process.argv.find(arg => arg.startsWith('--env='))?.slice(6);
const persistTo = process.argv.find(arg => arg.startsWith('--persist-to='))?.slice(13);
const remote = process.argv.includes('--remote');
const local = process.argv.includes('--local');
if (remote === local || !/^[a-zA-Z0-9_-]{1,100}$/.test(database ?? '') ||
    !/^[a-zA-Z0-9._-]{1,100}$/.test(workspace ?? '') ||
    (environment !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(environment)) ||
    (persistTo !== undefined && (!local || !persistTo.startsWith('/')))) {
  console.error('Use --remote or --local [--persist-to=/absolute/path], --database=DB --workspace=ID [--env=staging].');
  process.exit(2);
}
const wrangler = join(process.cwd(), 'node_modules/.bin/wrangler');
const quote = value => `'${value.replaceAll("'", "''")}'`;
const location = remote ? ['--remote'] : ['--local', ...(persistTo ? ['--persist-to', persistTo] : [])];
const options = environment ? ['--env', environment] : [];
function query(sql) {
  const output = execFileSync(wrangler, ['d1', 'execute', database, ...location, ...options, '--command', sql, '--json'],
    { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 });
  const response = JSON.parse(output);
  if (!response[0]?.success) throw new Error('D1 query failed');
  return response[0].results;
}
const docs = query(`SELECT key,version,body FROM state_documents WHERE workspace_id=${quote(workspace)}
  AND key IN ('ontology.delivery.v2','ontology.clients.v3')`);
const deliveryDoc = docs.find(doc => doc.key === 'ontology.delivery.v2');
const clientsDoc = docs.find(doc => doc.key === 'ontology.clients.v3');
assert.ok(deliveryDoc && clientsDoc, 'Both execution and client documents are required');
const raw = await decodeStateBody(deliveryDoc.body);
const clients = projectClients(await decodeStateBody(clientsDoc.body));
const records = partitionDeliverySnapshot(raw);
const slugs = new Set([...clients.allClients.map(client => client.slug),
  ...records.flatMap(row => row.company ? [row.company] : [])]);
const nullOwnership = Object.fromEntries([...new Set(records.filter(row => !row.company).map(row => row.kind))]
  .sort().map(kind => [kind, records.filter(row => row.kind === kind && !row.company).length]));
const planOwners = new Map();
for (const enrollment of clients.enrollments) if (enrollment.planId) {
  const owners = planOwners.get(enrollment.planId) ?? new Set();
  owners.add(enrollment.company); planOwners.set(enrollment.planId, owners);
}
for (const [company, planId] of Object.entries(raw.companyJourney ?? {})) {
  const owners = planOwners.get(planId) ?? new Set();
  owners.add(company); planOwners.set(planId, owners);
}
const privatePlanIds = Object.keys(raw.productPlans ?? {});
const selectedPlanIds = new Set(Object.values(raw.companyJourney ?? {}));
const clientPartition = partitionClientDelivery(raw, clients.enrollments);
const sliceBytes = clientPartition.slices.map(slice => Buffer.byteLength(JSON.stringify(slice.snapshot)));
assert.deepEqual(reconstructDeliverySnapshot([
  ...clientPartition.slices.flatMap(slice => slice.records), ...clientPartition.unassigned,
]), { ...DELIVERY_INITIAL, ...raw }, 'Client partition cannot reconstruct the raw execution document');
const duplicates = rows => rows.length - new Set(rows.map(row => row.id)).size;
let scopedMismatches = 0;
const mismatchTypes = { taskCount: 0, taskValues: 0, cycleCount: 0, cycleValues: 0 };
for (const company of slugs) {
  const scoped = clientPartition.slices.find(slice => slice.company === company)?.snapshot ??
    reconstructDeliverySnapshot([], { sparse: true });
  const globalProjection = projectDelivery(raw, company);
  const localProjection = projectDelivery(scoped, company);
  if (JSON.stringify(globalProjection) !== JSON.stringify(localProjection)) {
    scopedMismatches++;
    for (const [kind, countKey, valuesKey] of [
      ['tasks', 'taskCount', 'taskValues'], ['cycles', 'cycleCount', 'cycleValues'],
    ]) {
      if (globalProjection[kind].length !== localProjection[kind].length) mismatchTypes[countKey]++;
      else if (JSON.stringify(globalProjection[kind]) !== JSON.stringify(localProjection[kind])) mismatchTypes[valuesKey]++;
    }
  }
}
const projected = projectDelivery(raw);
const taskCompanies = new Map(projected.tasks.map(task => [task.id, task.company]));
const nullResolvable = Object.fromEntries(Object.keys(nullOwnership).map(kind => [kind,
  records.filter(row => row.kind === kind && !row.company && taskCompanies.has(row.id)).length]));
console.log(JSON.stringify({
  database, environment: local ? 'local' : environment ?? 'production', workspace,
  deliveryVersion: deliveryDoc.version, clientsVersion: clientsDoc.version,
  clients: slugs.size, rawRecords: records.length, effectiveTasks: projected.tasks.length,
  effectiveCycles: projected.cycles.length, nullOwnership, nullResolvable,
  clientSlices: clientPartition.slices.length,
  maxClientSnapshotBytes: Math.max(0, ...sliceBytes),
  unassignedAfterPlanOwnership: Object.fromEntries([...new Set(clientPartition.unassigned.map(row => row.kind))]
    .sort().map(kind => [kind, clientPartition.unassigned.filter(row => row.kind === kind).length])),
  sharedPlansAfterOwnership: clientPartition.sharedPlanIds.length,
  privatePlans: privatePlanIds.length,
  plansInCompanySelection: privatePlanIds.filter(id => selectedPlanIds.has(id)).length,
  plansWithOneOwner: privatePlanIds.filter(id => planOwners.get(id)?.size === 1).length,
  plansWithSeveralOwners: privatePlanIds.filter(id => (planOwners.get(id)?.size ?? 0) > 1).length,
  plansWithoutOwner: privatePlanIds.filter(id => !planOwners.get(id)?.size).length,
  duplicateTaskIds: duplicates(projected.tasks), duplicateCycleIds: duplicates(projected.cycles),
  scopedProjectionMismatches: scopedMismatches, mismatchTypes,
}));
