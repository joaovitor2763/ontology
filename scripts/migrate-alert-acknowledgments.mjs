/**
 * Move a ciência antiga (lista `hidden` do documento do workspace, que escondia
 * o alerta para toda a equipe) para `alert_acknowledgments`, uma linha por
 * pessoa. O autor de cada ID sai dos eventos e da auditoria de
 * `alerts.acknowledge` e `alerts.acknowledgeBatch`; IDs sem autor continuam em
 * `hidden`. Simulação por padrão (só contagens); `--apply` grava as linhas e
 * depois tira da lista, numa atualização condicionada à versão lida (CAS) e com
 * a entrada em `state_history`, como faz `putDoc`. Repetir é seguro.
 *
 *   node --experimental-strip-types scripts/migrate-alert-acknowledgments.mjs \
 *     --remote|--local [--persist-to=/abs] --database=DB --workspace=default [--env=staging] [--apply]
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeStateBody } from '../src/server/state-body.ts';
import { acknowledgmentInsertSql, planAlertAcknowledgmentMigration, sharedListUpdateSql } from '../src/server/alert-acknowledgment-migration.ts';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const database = arg('database'), workspace = arg('workspace'), environment = arg('env'), persistTo = arg('persist-to');
const remote = process.argv.includes('--remote'), local = process.argv.includes('--local');
const apply = process.argv.includes('--apply');
if (remote === local || !/^[a-zA-Z0-9_-]{1,100}$/.test(database ?? '') ||
    !/^[a-zA-Z0-9._-]{1,100}$/.test(workspace ?? '') ||
    (environment !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(environment)) ||
    (persistTo !== undefined && (!local || !persistTo.startsWith('/')))) {
  console.error('Use --remote or --local [--persist-to=/absolute/path], --database=DB --workspace=ID [--env=staging] and, to write, --apply.');
  process.exit(2);
}
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const ws = quote(workspace), wrangler = join(process.cwd(), 'node_modules/.bin/wrangler');
const location = remote ? ['--remote'] : ['--local', ...(persistTo ? ['--persist-to', persistTo] : [])];
const options = environment ? ['--env', environment] : [];
const BY = 'migration:alert-acknowledgments';
function execute(sql) {
  const output = execFileSync(wrangler, ['d1', 'execute', database, ...location, ...options, '--command', sql, '--json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const response = JSON.parse(output);
  if (!Array.isArray(response) || response.some(result => !result.success)) throw new Error('D1 query failed');
  return response;
}
const query = sql => execute(sql)[0].results;

const source = query(`SELECT key,version,body FROM state_documents WHERE workspace_id=${ws}
  AND key IN ('ontology.workspace.v3','ontology.workspace.v2') ORDER BY key DESC LIMIT 1`)[0];
assert.ok(source, 'Workspace document is required');
const document = await decodeStateBody(source.body);
const hidden = Array.isArray(document?.hidden) ? document.hidden.filter(id => typeof id === 'string') : [];
const types = `('alerts.acknowledge','alerts.acknowledgeBatch')`;
// Auditoria primeiro (tem o membro); eventos cobrem o que a auditoria não tem.
const audit = query(`SELECT id,action AS type,company,subject,data,created_at AS createdAt,actor_id AS memberId,
    principal_id AS principal FROM client_audit_log WHERE workspace_id=${ws} AND action IN ${types}`);
const audited = new Set(audit.map(row => row.id));
const events = query(`SELECT id,type,company,subject,data,created_at AS createdAt,actor AS principal
    FROM operation_events WHERE workspace_id=${ws} AND type IN ${types}`).filter(row => !audited.has(row.id));
const credentialOwners = new Map(query(`SELECT id,owner_member_id FROM integration_credentials WHERE workspace_id=${ws}`)
  .map(row => [row.id, row.owner_member_id]));
const plan = planAlertAcknowledgmentMigration({ hidden, sources: [...audit, ...events], credentialOwners });
const summary = { database, environment: local ? 'local' : environment ?? 'production', workspace,
  documentKey: source.key, documentVersion: source.version, auditRows: audit.length, eventRows: events.length,
  ...plan.counts };
if (!apply) { console.log(JSON.stringify({ ...summary, mode: 'dry-run' })); process.exit(0); }
if (!plan.rows.length) { console.log(JSON.stringify({ ...summary, mode: 'nothing-to-do' })); process.exit(0); }
if (typeof source.body !== 'string' || !source.body.startsWith('{'))
  throw new Error('Compressed workspace document: this script only rewrites plain JSON bodies');

// 1. Linhas por pessoa (idempotente). Se o passo 2 falhar, o alerta continua escondido pela lista antiga.
const directory = mkdtempSync(join(tmpdir(), 'g4-alert-acks-'));
try {
  const file = join(directory, 'alert-acknowledgments.sql');
  writeFileSync(file, acknowledgmentInsertSql(workspace, plan.rows).join('\n'), { mode: 0o600 });
  execFileSync(wrangler, ['d1', 'execute', database, ...location, ...options, '--file', file, '--yes'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
const stored = new Set(query(`SELECT member_id||char(0)||company||char(0)||alert_id AS k FROM alert_acknowledgments
  WHERE workspace_id=${ws}`).map(row => row.k));
const missing = plan.rows.filter(row => !stored.has(`${row.memberId}\u0000${row.company}\u0000${row.alertId}`)).length;
assert.equal(missing, 0, `${missing} acknowledgments were not stored; the shared list was not changed`);

// 2. Tira da lista compartilhada só o que foi atribuído, se o documento ainda é o que foi lido.
const next = source.version + 1, key = quote(source.key);
const results = execute(sharedListUpdateSql({ workspace, key: source.key, version: source.version,
  removed: plan.removed, now: new Date().toISOString(), by: BY }));
assert.equal(results[0].results.length, 1,
  'The workspace document changed since it was read; acknowledgments were stored, run again to update the shared list');
const after = await decodeStateBody(query(`SELECT body FROM state_documents WHERE workspace_id=${ws} AND key=${key}`)[0].body);
assert.deepEqual(after.hidden, plan.remaining, 'Shared list does not match the plan');
console.log(JSON.stringify({ ...summary, newDocumentVersion: next, mode: 'applied' }));
