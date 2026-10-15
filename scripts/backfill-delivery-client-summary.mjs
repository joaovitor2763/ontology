/**
 * Grava `delivery_client_summary` (0042, com a coluna `board` de 0043) para as
 * fatias da geração ativa que estão sem resumo, com resumo defasado ou sem a
 * parte do quadro. Seguro por padrão:
 *
 *   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     scripts/backfill-delivery-client-summary.mjs --workspace=WORKSPACE --database=YOUR_D1_DATABASE
 *     [--env=staging] [--persist-to=/caminho/absoluto] [--apply] [--remote --allow-remote]
 *
 * - Sem `--apply` só mostra o plano (dry-run).
 * - Sem `--remote` usa o D1 local do Wrangler. `--remote` é recusado sem
 *   `--allow-remote` (e, para staging, `--env=staging --workspace=staging`).
 * - Cada linha é um CAS na revisão/encarnação da fatia lida; rodar de novo é
 *   idempotente e repara o que uma escrita concorrente deixou defasado.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { decodeStateBody } from '../src/server/state-body.ts';
import { planSummaryBackfill, summaryBackfillSql } from '../src/server/delivery-client-summary-backfill.ts';

const option = (name, fallback) =>
  process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const flag = name => process.argv.includes(`--${name}`);
const database = option('database', ''), workspace = option('workspace', 'default');
const environment = option('env'), persistTo = option('persist-to');
const remote = flag('remote'), apply = flag('apply');
const known = new Set(['--remote', '--allow-remote', '--apply', '--dry-run', '--local']);
if (process.argv.slice(2).some(arg => !known.has(arg) &&
    !/^--(database|workspace|env|persist-to)=/.test(arg)) ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(database) || !/^[a-zA-Z0-9._-]{1,100}$/.test(workspace) ||
    (environment !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(environment)) ||
    (persistTo !== undefined && (remote || !persistTo.startsWith('/'))) ||
    (apply && flag('dry-run')) || (remote && flag('local'))) {
  console.error('Uso: [--workspace=ID] [--database=DB] [--env=staging] [--persist-to=/abs] [--apply] [--remote --allow-remote]');
  process.exit(2);
}
if (flag('allow-remote') && !remote) {
  console.error('--allow-remote só vale junto com --remote.');
  process.exit(2);
}
if (remote && !flag('allow-remote')) {
  console.error('Recusado: --remote altera um banco publicado. Repita com --allow-remote depois de conferir --env e --workspace.');
  process.exit(2);
}
const wrangler = join(process.cwd(), 'node_modules/.bin/wrangler');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const ws = quote(workspace);
const location = [...(remote ? ['--remote'] : ['--local']),
  ...(persistTo ? ['--persist-to', persistTo] : []), ...(environment ? ['--env', environment] : [])];
function query(sql) {
  const output = execFileSync(wrangler, ['d1', 'execute', database, ...location, '--command', sql, '--json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const response = JSON.parse(output);
  if (!response[0]?.success) throw new Error('D1 query failed');
  return response[0].results;
}

const meta = query(`SELECT generation,expected_clients FROM delivery_client_shadow_meta
  WHERE workspace_id=${ws} AND mode='active'`)[0];
if (!meta) {
  console.log(JSON.stringify({ database, workspace, action: 'none', reason: 'execução não está em active' }));
  process.exit(0);
}
const slices = [];
for (let last = ''; ;) {
  const page = query(`SELECT company,revision,incarnation,body,body_sha256 FROM delivery_client_snapshots
    WHERE workspace_id=${ws} AND generation=${quote(meta.generation)} AND company>${quote(last)}
    ORDER BY company LIMIT 50`);
  for (const row of page) {
    const snapshot = await decodeStateBody(row.body);
    if (createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') !== row.body_sha256)
      throw new Error(`Hash da fatia difere (${row.company}); nada foi gravado.`);
    slices.push({ company: row.company, revision: row.revision, incarnation: row.incarnation, snapshot });
  }
  if (page.length < 50) break;
  last = page.at(-1).company;
}
if (slices.length !== meta.expected_clients)
  throw new Error(`Contagem de fatias (${slices.length}) difere do marcador (${meta.expected_clients}).`);
const documents = new Map(await Promise.all(query(`SELECT key,body FROM state_documents
  WHERE workspace_id=${ws} AND key IN ('ontology.clients.v3','ontology.catalog.v2')`)
  .map(async row => [row.key, await decodeStateBody(row.body)])));
const existing = query(`SELECT company,authority_generation,source_revision,source_incarnation,inputs,body,board
  FROM delivery_client_summary WHERE workspace_id=${ws}`);
const plan = planSummaryBackfill({ generation: meta.generation, slices,
  clientsRaw: documents.get('ontology.clients.v3'), catalogRaw: documents.get('ontology.catalog.v2'), existing });
const count = state => plan.filter(row => row.state === state).length;
const summary = { database, environment: remote ? environment ?? 'production' : 'local', workspace,
  generation: meta.generation, clients: plan.length, current: count('current'), missing: count('missing'),
  stale: count('stale'), failed: plan.filter(row => row.state === 'failed').map(row => row.company),
  largestBodyBytes: Math.max(0, ...plan.map(row => Buffer.byteLength(row.body ?? ''))),
  largestBoardBytes: Math.max(0, ...plan.map(row => Buffer.byteLength(row.board ?? ''))) };
const pending = plan.filter(row => row.state === 'missing' || row.state === 'stale');
if (!apply || !pending.length) {
  console.log(JSON.stringify({ ...summary, action: apply ? 'nothing-to-do' : 'dry-run' }));
  process.exit(0);
}
// Um comando grande demais para o D1 importado vai sem a coluna do quadro (0043): o
// resumo vale para carteira, fila e contador, e só o quadro projeta a fatia desse cliente.
const withoutBoard = [];
const statements = pending.map(row => {
  const statement = summaryBackfillSql(workspace, meta.generation, row);
  if (Buffer.byteLength(statement) <= 95_000 || row.board === null) return statement;
  withoutBoard.push(row.company);
  row.board = null;
  return summaryBackfillSql(workspace, meta.generation, row);
});
if (statements.some(statement => Buffer.byteLength(statement) > 95_000))
  throw new Error('Um resumo excede o tamanho seguro de comando do D1 importado.');
// Um comando por vez pela API de consultas (`--command`). `--file` no D1 remoto entra
// em modo de importação e deixa o banco indisponível para o app enquanto roda.
for (const statement of statements)
  execFileSync(wrangler, ['d1', 'execute', database, ...location, '--command', statement, '--yes'],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
// Confere o que ficou gravado: linha igual ao calculado, ou fatia que andou (CAS recusou).
const after = new Map(query(`SELECT company,authority_generation,source_revision,source_incarnation,inputs,body,board
  FROM delivery_client_summary WHERE workspace_id=${ws}`).map(row => [row.company, row]));
const heads = new Map(query(`SELECT company,revision,incarnation FROM delivery_client_snapshots
  WHERE workspace_id=${ws} AND generation=${quote(meta.generation)}`).map(row => [row.company, row]));
let written = 0, moved = 0;
for (const row of pending) {
  const stored = after.get(row.company), head = heads.get(row.company);
  if (stored?.authority_generation === meta.generation && stored.source_revision === row.revision &&
      stored.source_incarnation === row.incarnation && stored.inputs === row.inputs && stored.body === row.body &&
      (stored.board ?? null) === (row.board ?? null)) written++;
  else if (head?.revision !== row.revision || head?.incarnation !== row.incarnation) moved++;
  else throw new Error(`Resumo gravado difere do calculado (${row.company}).`);
}
console.log(JSON.stringify({ ...summary, action: 'applied', written, movedDuringRun: moved, withoutBoard }));
