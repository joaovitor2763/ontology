/** Build the client allocation authorization index without changing its source document. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeStateBody } from '../src/server/state-body.ts';
import { clientAccessRows } from '../src/server/client-access.ts';

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
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
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
const source = query(`SELECT version,body FROM state_documents WHERE workspace_id=${ws} AND key='ontology.clients.v3'`)[0];
assert.ok(source, 'Clients source document is required');
const rows = [...clientAccessRows(await decodeStateBody(source.body))].sort(([a], [b]) => a.localeCompare(b));
const summary = { database, environment: local ? 'local' : environment ?? 'production', workspace,
  sourceVersion: source.version, companies: rows.length,
  allocations: rows.reduce((count, [, body]) => count + JSON.parse(body).length, 0),
  largestBodyBytes: Math.max(0, ...rows.map(([, body]) => Buffer.byteLength(body))) };
const generation = randomUUID(), gen = quote(generation);
const statements = rows.map(([company, body]) => `INSERT INTO client_access_allocations
  (workspace_id,generation,company,body) VALUES(${ws},${gen},${quote(company)},${quote(body)});`);
summary.maxImportStatementBytes = Math.max(0, ...statements.map(statement => Buffer.byteLength(statement)));
if (summary.maxImportStatementBytes > 95_000) throw new Error('One authorization row exceeds the safe D1 import statement size');
if (dryRun) { console.log(JSON.stringify({ ...summary, mode: 'dry-run' })); process.exit(0); }
const active = query(`SELECT generation,source_clients_version FROM client_access_meta WHERE workspace_id=${ws}`)[0];
if (active?.source_clients_version === source.version) throw new Error('Authorization index is already current');
const directory = mkdtempSync(join(tmpdir(), 'g4-access-backfill-'));
try {
  const file = join(directory, 'client-access.sql');
  writeFileSync(file, statements.join('\n'), { mode: 0o600 });
  execFileSync(wrangler, ['d1', 'execute', database, ...location, ...options, '--file', file, '--yes'],
    { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  const imported = query(`SELECT company,body FROM client_access_allocations
    WHERE workspace_id=${ws} AND generation=${gen} ORDER BY company`);
  assert.deepEqual(imported, rows.map(([company, body]) => ({ company, body })));
  const current = `EXISTS (SELECT 1 FROM state_documents WHERE workspace_id=${ws}
    AND key='ontology.clients.v3' AND version=${source.version})
    AND (SELECT COUNT(*) FROM client_access_allocations WHERE workspace_id=${ws}
      AND generation=${gen})=${rows.length}`;
  const now = quote(new Date().toISOString());
  const switched = active
    ? query(`UPDATE client_access_meta SET generation=${gen},source_clients_version=${source.version},
        expected_companies=${rows.length},updated_at=${now}
        WHERE workspace_id=${ws} AND generation=${quote(active.generation)}
          AND source_clients_version=${active.source_clients_version} AND ${current}
        RETURNING generation`)
    : query(`INSERT INTO client_access_meta
        (workspace_id,generation,source_clients_version,expected_companies,updated_at)
        SELECT ${ws},${gen},${source.version},${rows.length},${now}
        WHERE ${current} AND NOT EXISTS (SELECT 1 FROM client_access_meta WHERE workspace_id=${ws})
        RETURNING generation`);
  assert.equal(switched.length, 1, 'Source or active generation changed; imported generation remains invisible');
  console.log(JSON.stringify({ ...summary, generation, mode: 'indexed' }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
