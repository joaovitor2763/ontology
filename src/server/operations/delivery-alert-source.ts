import type { DeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';
import { decodeStateBody } from '../state-body.ts';
import { parseSummary, summaryContext, summaryExecution, type ClientSummary } from '../delivery-client-summary.ts';
import { OperationError } from './errors.ts';
import { BOARD_PREFIX } from '../delivery-client-summary-board.ts';

type Meta = { generation: string; compatibility_version: number;
  expected_clients: number; source_clients_version: number;
  current_clients_version: number | null };
type Marker = { compatibility_version: number; source_clients_version: number };
type SliceRow = { company: string; revision: number; incarnation: string; body: string | null;
  summary_inputs?: string | null; summary_body?: string | null; summary_board?: string | null };
type Head = Pick<SliceRow, 'company' | 'revision' | 'incarnation'>;
const PAGE_SIZE = 100;
/** Páginas lidas no primeiro lote (300 clientes numa ida; acima disso, uma ida por página). */
const FIRST_PAGES = 3;

export type ActiveAlertDelivery = { slices: { company: string; raw: DeliverySnapshot }[];
  heads: Head[]; generation: string; compatibilityVersion: number;
  /** `source_clients_version` do marcador na mesma transação das fatias. */
  sourceClientsVersion: number;
  /**
   * Só com `summaries`: resumos (0042) da revisão exata de cada fatia que não
   * veio com corpo. Ainda precisam de `settleSummaries` antes de valer.
   */
  summaries?: Map<string, ClientSummary | null>;
  /**
   * Só com `board`: a coluna `board` (0043, formato 2) de cada fatia que veio
   * sem corpo, para o quadro conferir (`readBoardColumn`).
   */
  summaryBoards?: Map<string, string>;
  /** Depois de `settleSummaries`: a execução de cada cliente ativo cujo resumo vale. */
  executions?: Map<string, { tasks: import('../../modules/delivery/domain/models.ts').Delivery[];
    cycles: import('../../modules/delivery/domain/services.ts').ServiceCycle[] }>;
  /** Depois de `settleSummaries`: o ciclo mostrado para cliente arquivado, pelo resumo. */
  archivedCycles?: Map<string, { id: string; name: string } | null> };

/** Reads authoritative client slices. Alert tasks depend on each client's selected plan,
 * which the generic effective-task index deliberately does not resolve. */
export async function readActiveAlertDelivery(db: D1Database, workspace: string,
  company?: string): Promise<ActiveAlertDelivery | null> {
  return (await readActiveAlertDeliveryWith(db, workspace, { company })).active;
}

/**
 * A leitura ativa numa ida só: marcador, primeira página de fatias e as
 * consultas de quem chama (`with`, normalmente as versões dos documentos que a
 * resposta combina com as fatias) vão no mesmo `db.batch`, que o D1 executa
 * como uma transação. Marcador, fatias e versões são, portanto, do mesmo
 * instante: não há "antes" e "depois" a conferir, e decodificar os corpos já
 * lidos não pede nova conferência.
 *
 * Até 300 clientes as páginas vão no mesmo lote (OFFSET, mesma transação); acima disso cada página seguinte vai num lote com o marcador (e as
 * mesmas consultas de quem chama): se `compatibility_version` mudou entre os
 * lotes, a leitura recomeça. `extra` são os resultados do **último** lote; as
 * versões nele valem para todas as fatias, porque o marcador não mudou desde a
 * primeira página.
 *
 * Fora do modo `active` devolve `active: null`, e `extra` continua valendo.
 */
export async function readActiveAlertDeliveryWith(db: D1Database, workspace: string,
  options: { company?: string; with?: D1PreparedStatement[]; summaries?: boolean;
    /**
     * Só o quadro: em vez do resumo, cada fatia vem com a coluna `board` no
     * formato 2 e **sem** o corpo; sem a coluna nesse formato, com o corpo.
     * Não se combina com `summaries`.
     */
    board?: boolean } = {}): Promise<{
    active: ActiveAlertDelivery | null; extra: D1Result[] }> {
  const { company } = options, extraStatements = options.with ?? [];
  const board = options.board ?? false, summaries = !board && (options.summaries ?? false);
  for (let attempt = 0; attempt < 3; attempt++) {
    // As primeiras páginas vão juntas no mesmo lote (OFFSET): até
    // `FIRST_PAGES × PAGE_SIZE` clientes custam uma ida, não uma por página.
    const pages = company ? 1 : FIRST_PAGES;
    const [metaResult, ...firstResults] = await db.batch([
      metaQuery(db, workspace),
      ...Array.from({ length: pages }, (_, index) =>
        firstPageQuery(db, workspace, company, summaries, board, index * PAGE_SIZE)),
      ...extraStatements,
    ]);
    const firstExtra = firstResults.slice(pages);
    const meta = (metaResult.results as Meta[])[0];
    if (!meta) return { active: null, extra: firstExtra };
    if (meta.current_clients_version !== meta.source_clients_version)
      throw incomplete();
    const rows = firstResults.slice(0, pages).flatMap(page => page.results as SliceRow[]);
    let extra = firstExtra, sourceClientsVersion = meta.source_clients_version, changed = false;
    // Só continua quando a última página do primeiro lote veio cheia.
    while (rows.length >= pages * PAGE_SIZE && rows.length % PAGE_SIZE === 0) {
      const [page, marker, ...pageExtra] = await db.batch([
        pageQuery(db, workspace, meta.generation, company, rows.at(-1)!.company, summaries, board),
        markerQuery(db, workspace, meta.generation),
        ...extraStatements,
      ]);
      const current = (marker.results as Marker[])[0];
      if (current?.compatibility_version !== meta.compatibility_version) {
        changed = true;
        break;
      }
      sourceClientsVersion = current.source_clients_version;
      extra = pageExtra;
      rows.push(...page.results as SliceRow[]);
      if (page.results.length < PAGE_SIZE) break;
    }
    if (changed) continue;
    if (rows.length !== (company ? 1 : meta.expected_clients)) throw incomplete();
    // Sem corpo = havia resumo da revisão exata; ilegível conta como `null` (a fatia é buscada depois).
    const found = summaries ? new Map(rows.filter(row => row.body === null).map(row =>
      [row.company, parseSummary(row.summary_inputs ?? null, row.summary_body ?? null)] as const))
      : undefined;
    const slices = await Promise.all(rows.filter(row => row.body !== null).map(async row => ({
      company: row.company, raw: await decodeStateBody(row.body!) as DeliverySnapshot })));
    return { active: { slices, heads: rows.map(({ company, revision, incarnation }) =>
      ({ company, revision, incarnation })), generation: meta.generation,
      compatibilityVersion: meta.compatibility_version, sourceClientsVersion,
      ...(found ? { summaries: found } : {}),
      ...(board ? { summaryBoards: new Map(rows.filter(row => row.body === null)
        .map(row => [row.company, row.summary_board ?? ''] as const)) } : {}) }, extra };
  }
  throw new OperationError(409, 'snapshot_changed',
    'Os alertas mudaram durante a leitura. Tente novamente.');
}

/**
 * Marcador ativo e versões de cadastro e catálogo num comando só: o que o ETag
 * de quadro e ciclos codifica. `null` fora de `active` ou com o marcador
 * atrás do cadastro (a leitura completa responderia 503).
 */
export type ActiveMarker = { generation: string; compatibilityVersion: number;
  clientsVersion: number; catalogVersion: number };
export async function readActiveMarker(db: D1Database, workspace: string): Promise<ActiveMarker | null> {
  const row = await db.prepare(`SELECT m.generation,m.compatibility_version,m.source_clients_version,
      (SELECT version FROM state_documents WHERE workspace_id=m.workspace_id
        AND key='ontology.clients.v3') AS clients_version,
      (SELECT version FROM state_documents WHERE workspace_id=m.workspace_id
        AND key='ontology.catalog.v2') AS catalog_version
    FROM delivery_client_shadow_meta m WHERE m.workspace_id=? AND m.mode='active'`)
    .bind(workspace).first<{ generation: string; compatibility_version: number;
      source_clients_version: number; clients_version: number | null;
      catalog_version: number | null }>();
  const clientsVersion = row?.clients_version ?? 0;
  return row && row.source_clients_version === clientsVersion ? { generation: row.generation,
    compatibilityVersion: row.compatibility_version, clientsVersion,
    catalogVersion: row.catalog_version ?? 0 } : null;
}

/** ETag das telas globais ainda vale? Fora de `active` nunca vale: a tela lê pelo caminho legado. */
export async function activeTagStillCurrent(db: D1Database, workspace: string, knownTag: string,
  tag: (generation: string, compatibilityVersion: number, clientsVersion: number,
    catalogVersion: number) => string) {
  const marker = await readActiveMarker(db, workspace);
  return !!marker && knownTag === tag(marker.generation, marker.compatibilityVersion,
    marker.clientsVersion, marker.catalogVersion);
}

function incomplete() {
  return new OperationError(503, 'execution_snapshot_incomplete',
    'A execução está sendo atualizada. Tente novamente.');
}

function metaQuery(db: D1Database, workspace: string) {
  return db.prepare(`SELECT m.generation,m.compatibility_version,
      m.expected_clients,m.source_clients_version,c.version AS current_clients_version
    FROM delivery_client_shadow_meta m
    LEFT JOIN state_documents c ON c.workspace_id=m.workspace_id
      AND c.key='ontology.clients.v3'
    WHERE m.workspace_id=? AND m.mode='active'`).bind(workspace);
}

function markerQuery(db: D1Database, workspace: string, generation: string) {
  return db.prepare(`SELECT compatibility_version,source_clients_version
    FROM delivery_client_shadow_meta
    WHERE workspace_id=? AND generation=? AND mode='active'`).bind(workspace, generation);
}

/**
 * Com `summaries`, cada fatia vem com o resumo (0042) da mesma geração,
 * revisão e encarnação e, nesse caso, **sem** o corpo: é o corpo que pesa no
 * fio e na decodificação. Sem resumo da revisão exata, vem o corpo, como antes.
 */
const BOARD_COLUMN = `substr(c.board,1,${BOARD_PREFIX.length})='${BOARD_PREFIX}'`;
const sliceColumns = (summaries: boolean, board = false) => board
  ? `s.company,s.revision,s.incarnation,CASE WHEN ${BOARD_COLUMN} THEN NULL ELSE s.body END AS body,
      CASE WHEN ${BOARD_COLUMN} THEN c.board END AS summary_board`
  : summaries
  ? `s.company,s.revision,s.incarnation,CASE WHEN c.company IS NULL THEN s.body END AS body,
      c.inputs AS summary_inputs,c.body AS summary_body`
  : 's.company,s.revision,s.incarnation,s.body';
const summaryJoin = (summaries: boolean) => summaries
  ? `LEFT JOIN delivery_client_summary c ON c.workspace_id=s.workspace_id AND c.company=s.company
      AND c.authority_generation=s.generation AND c.source_revision=s.revision
      AND c.source_incarnation=s.incarnation`
  : '';

/** Primeira página pela geração ativa do próprio marcador: não precisa conhecê-la antes. */
function firstPageQuery(db: D1Database, workspace: string, company: string | undefined, summaries = false,
  board = false, offset = 0) {
  return db.prepare(`SELECT ${sliceColumns(summaries, board)}
    FROM delivery_client_shadow_meta m
    JOIN delivery_client_snapshots s ON s.workspace_id=m.workspace_id
      AND s.generation=m.generation
    ${summaryJoin(summaries || board)}
    WHERE m.workspace_id=? AND m.mode='active' ${company ? 'AND s.company=?' : ''}
    ORDER BY s.company LIMIT ${PAGE_SIZE}${offset ? ` OFFSET ${offset}` : ''}`)
    .bind(workspace, ...(company ? [company] : []));
}

function pageQuery(db: D1Database, workspace: string, generation: string,
  company: string | undefined, lastCompany: string, summaries = false, board = false) {
  return db.prepare(`SELECT ${sliceColumns(summaries, board)}
    FROM delivery_client_snapshots s ${summaryJoin(summaries || board)}
    WHERE s.workspace_id=? AND s.generation=?
      ${company ? 'AND s.company=?' : ''} AND s.company>?
    ORDER BY s.company LIMIT ${PAGE_SIZE}`)
    .bind(workspace, generation, ...(company ? [company] : []), lastCompany);
}

/**
 * Confere os resumos lidos com o cadastro e o catálogo que a resposta usa
 * (`summaryExecution`) e busca, numa ida, o corpo das fatias cujo resumo não
 * vale para os clientes ativos (cadastro, contratação, início ou plano seguido
 * diferentes do que o resumo registrou). As fatias buscadas precisam estar na
 * revisão e encarnação do lote original; se alguma andou, devolve `null` e
 * quem chama relê tudo. Sem resumos (`summaries` ausente) nada muda.
 */
export async function settleSummaries(db: D1Database, workspace: string, active: ActiveAlertDelivery,
  clientsRaw: unknown, catalogRaw: unknown, company?: string,
): Promise<ActiveAlertDelivery | null> {
  if (!active.summaries) return active;
  const context = summaryContext(clientsRaw, catalogRaw);
  const executions: NonNullable<ActiveAlertDelivery['executions']> = new Map();
  const archivedCycles: NonNullable<ActiveAlertDelivery['archivedCycles']> = new Map();
  const needed = new Set<string>(), invalid = new Set<string>();
  for (const client of context.clientState.clients) {
    if (company && client.slug !== company || !active.summaries.has(client.slug)) continue;
    const summary = active.summaries.get(client.slug);
    const execution = summary ? summaryExecution(context, client, summary) : null;
    if (execution && !invalid.has(client.slug))
      executions.set(client.slug, execution);
    else { invalid.add(client.slug); executions.delete(client.slug); needed.add(client.slug); }
  }
  for (const [slug, summary] of active.summaries) {
    if (summary) archivedCycles.set(slug, summary.body.archivedCycle);
    else if (!context.clientState.clients.some(client => client.slug === slug)) needed.add(slug);
  }
  const fetched = await fetchSlices(db, workspace, active, needed);
  return fetched && { ...active, slices: [...active.slices, ...fetched], executions, archivedCycles };
}

/**
 * Os corpos de `needed`, numa ida, na revisão e encarnação do lote original;
 * `null` se alguma fatia andou (quem chama relê tudo).
 */
export async function fetchSlices(db: D1Database, workspace: string, active: ActiveAlertDelivery,
  needed: ReadonlySet<string>): Promise<ActiveAlertDelivery['slices'] | null> {
  if (!needed.size) return [];
  const heads = new Map(active.heads.map(head => [head.company, head]));
  const { results } = await db.prepare(`SELECT company,revision,incarnation,body
    FROM delivery_client_snapshots WHERE workspace_id=? AND generation=?
      AND company IN (SELECT value FROM json_each(?))`)
    .bind(workspace, active.generation, JSON.stringify([...needed])).all<SliceRow>();
  if (results.length !== needed.size || results.some(row => row.body === null ||
    heads.get(row.company)?.revision !== row.revision ||
    heads.get(row.company)?.incarnation !== row.incarnation)) return null;
  return Promise.all(results.map(async row =>
    ({ company: row.company, raw: await decodeStateBody(row.body!) as DeliverySnapshot })));
}
