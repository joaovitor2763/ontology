import type { ServerEnv } from '../context.ts';
import { projectClientExecution } from '../../modules/delivery/infrastructure/client-projection.ts';
import { boardTaskOf, compactCycle, encodeBoardTasks, type BoardCycle, type BoardTask, type BoardTaskTable }
  from '../../modules/delivery/infrastructure/execution-board-wire.ts';
import { summaryContext } from '../delivery-client-summary.ts';
import { readBoardColumn } from '../delivery-client-summary-board.ts';
import { fetchSlices, readActiveAlertDeliveryWith, readActiveMarker, type ActiveMarker }
  from './delivery-alert-source.ts';
import { OperationError } from './errors.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { databaseOrigin, documentVersions, documentVersionsStatement, loadDocuments,
  sameVersions } from './request-context.ts';

const CLIENTS = 'ontology.clients.v3';
const CATALOG = 'ontology.catalog.v2';
const DELIVERY = 'ontology.delivery.v2';

/**
 * Forma das tarefas na resposta. `table` (`?formato=tabela`, o que o navegador
 * atual pede) é a tabela com dicionário de `execution-board-wire.ts`; sem o
 * parâmetro, objetos com os mesmos campos, para uma aba aberta antes da
 * publicação continuar funcionando. Cada forma tem o seu ETag.
 */
export type BoardWire = 'objects' | 'table';
type Reference = { id: string; company: string; title: string; dueAt: string };
type BoardView = { mode: 'active' | 'legacy'; tasks?: BoardTask[]; taskTable?: BoardTaskTable;
  cycles: BoardCycle[]; referenceTasks: Reference[]; compatibilityVersion: number | null;
  clientSnapshots: Record<string, string>; etag: string | null };

/**
 * O quadro do workspace inteiro, igual para toda pessoa autorizada (a rota não
 * recorta por pessoa: exige `clientes.ver` no workspace). `key` é o que o ETag
 * codifica — geração, versão lógica da execução e versões de cadastro e
 * catálogo — e `null` fora de `active`. As formas da resposta e o JSON de cada
 * uma saem uma vez por quadro, sob demanda.
 */
type Board = { key: string | null; mode: 'active' | 'legacy'; tasks: BoardTask[]; cycles: BoardCycle[];
  referenceTasks: Reference[]; compatibilityVersion: number | null; clientSnapshots: Record<string, string>;
  views: Partial<Record<BoardWire, BoardView>>; json: Partial<Record<BoardWire, string>>;
  /** Ordem de início do cálculo no isolate (só no que foi guardado). */
  order?: number };
/** Contador de cálculos iniciados no isolate. */
let started = 0;

/**
 * Cache do isolate: o último quadro de cada workspace, por binding original do
 * D1 (como o contador de alertas), e os cálculos em andamento. Uma entrada só
 * serve a um pedido já autorizado cuja chave lida no banco é a dela: a mesma
 * condição do 304. Escrever uma fatia sobe a versão lógica; cadastro e
 * catálogo sobem a própria versão; o backfill dos resumos não muda a resposta.
 */
let boards = new WeakMap<D1Database, Map<string, Board>>();
let pending = new WeakMap<D1Database, Map<string, Promise<Board>>>();
/** Só para testes: esquece quadros guardados e cálculos em andamento. */
export function forgetExecutionBoards() {
  boards = new WeakMap();
  pending = new WeakMap();
}

const keyOf = (marker: Pick<ActiveMarker, 'generation' | 'compatibilityVersion' | 'clientsVersion' |
  'catalogVersion'>) =>
  `${marker.generation}:${marker.compatibilityVersion}:${marker.clientsVersion}:${marker.catalogVersion}`;
const tagOf = (wire: BoardWire, key: string) => `"g4-board${wire === 'table' ? '-tabela' : ''}:${key}"`;

/**
 * Session-only board projection from the same selected plan used by each client page.
 * Each client comes from the `board` column of its summary (0043, format 2) when it was
 * computed for the slice read and still holds for the registry and the catalog;
 * otherwise the slice is projected as before. Only `BOARD_TASK_FIELDS` travel: the
 * drawer, the acceptance and the completion modal load the complete client.
 *
 * O resultado é compartilhado: quem chama não altera o objeto devolvido.
 */
export async function readExecutionBoard(env: ServerEnv, principal: OperationPrincipal,
  knownTag?: string | null, wire: BoardWire = 'objects') {
  const outcome = await boardOutcome(env, principal, knownTag, wire);
  return 'board' in outcome ? viewOf(outcome.board, wire) : outcome;
}

/** O mesmo, com o corpo já serializado (a rota): um quadro guardado não é serializado de novo. */
export async function readExecutionBoardJson(env: ServerEnv, principal: OperationPrincipal,
  knownTag: string | null, wire: BoardWire) {
  const outcome = await boardOutcome(env, principal, knownTag, wire);
  if (!('board' in outcome)) return outcome;
  const { board } = outcome;
  const body = board.json[wire] ?? JSON.stringify(viewOf(board, wire));
  if (board.key) board.json[wire] = body;
  return { body, etag: board.key ? tagOf(wire, board.key) : null };
}

async function boardOutcome(env: ServerEnv, principal: OperationPrincipal, knownTag: string | null | undefined,
  wire: BoardWire): Promise<{ notModified: true; etag: string } | { board: Board }> {
  if (!env.DB) throw new OperationError(503, 'database_unavailable', 'Banco indisponível.');
  if (principal.kind !== 'session')
    throw new OperationError(403, 'session_required', 'Use sua sessão para ver a execução.');
  const db = env.DB, workspace = env.WORKSPACE_ID || 'default';
  // O marcador vai em paralelo com a autorização e só é usado depois dela.
  const marking = readActiveMarker(db, workspace);
  marking.catch(() => undefined);
  await authorizeOperation(db, workspace, principal, { action: 'clientes.ver', scope: 'workspace:read' });
  const marker = await marking;
  const key = marker && keyOf(marker);
  if (key && knownTag === tagOf(wire, key)) return { notModified: true, etag: knownTag };
  const origin = databaseOrigin(db), cached = key ? boards.get(origin)?.get(workspace) : undefined;
  if (cached && cached.key === key) return { board: cached };
  if (!key) return { board: await computeBoard(db, workspace) };
  let running = pending.get(origin);
  if (!running) pending.set(origin, (running = new Map()));
  const flight = JSON.stringify([workspace, key]);
  let work = running.get(flight);
  if (!work) {
    // Um cálculo mais antigo que termina depois não substitui o de um cálculo mais novo.
    const order = ++started;
    work = computeBoard(db, workspace).then(board => {
      let byWorkspace = boards.get(origin);
      if (!byWorkspace) boards.set(origin, (byWorkspace = new Map()));
      const current = byWorkspace.get(workspace);
      if (board.key && (!current || (current.order ?? 0) < order))
        byWorkspace.set(workspace, Object.assign(board, { order }));
      return board;
    });
    const flying = work;
    running.set(flight, flying);
    flying.finally(() => { if (running.get(flight) === flying) running.delete(flight); })
      .catch(() => undefined);
  }
  return { board: await work };
}

function viewOf(board: Board, wire: BoardWire): BoardView {
  const known = board.views[wire];
  if (known) return known;
  const rows = wire === 'table' ? { taskTable: encodeBoardTasks(board.tasks) } : { tasks: board.tasks };
  const view: BoardView = { mode: board.mode, ...rows, cycles: board.cycles,
    referenceTasks: board.referenceTasks, compatibilityVersion: board.compatibilityVersion,
    clientSnapshots: board.clientSnapshots, etag: board.key ? tagOf(wire, board.key) : null };
  if (board.key) board.views[wire] = view;
  return view;
}

/** Lê e monta o quadro; marcador, fatias, colunas e versões vêm do mesmo lote. */
async function computeBoard(db: D1Database, workspace: string): Promise<Board> {
  // Uma fatia que andou entre o lote e a busca dos corpos que faltam faz reler tudo uma vez.
  for (let attempt = 0; attempt < 2; attempt++) {
    // Versões de cadastro e catálogo (e da execução legada) no mesmo lote das
    // fatias: a comparação abaixo vale pelo quadro inteiro.
    // Cadastro e catálogo em paralelo com o lote (não antes da autorização: um
    // pedido que acerta o cache não precisa deles).
    const [read, documents] = await Promise.all([
      readActiveAlertDeliveryWith(db, workspace, { board: true,
        with: [documentVersionsStatement(db, workspace, [CLIENTS, CATALOG, DELIVERY])] }),
      loadDocuments(db, workspace, [CLIENTS, CATALOG]),
    ]);
    const documentKeys = read.active ? [CLIENTS, CATALOG] : [CLIENTS, CATALOG, DELIVERY];
    const docs = read.active ? documents : [...documents, ...await loadDocuments(db, workspace, [DELIVERY])];
    if (!sameVersions(documentVersions(read.extra[0]), documentKeys.map((key, index) =>
      [key, docs[index]] as const)) ||
      (read.active && read.active.sourceClientsVersion !== (docs[0]?.version ?? 0)))
      throw new OperationError(409, 'snapshot_changed', 'A execução mudou. Tente novamente.');
    const context = summaryContext(docs[0]?.value, docs[1]?.value);
    const { clientState, catalog, clientStarts, enrollmentStarts } = context;
    const active = read.active;
    // A coluna só vale para a fatia lida (identidade) e para este cadastro e catálogo.
    const parts = new Map<object, NonNullable<ReturnType<typeof readBoardColumn>>>();
    const needed = new Set<string>();
    if (active) {
      const heads = new Map(active.heads.map(head => [head.company, head]));
      const sliced = new Set(active.slices.map(row => row.company));
      for (const client of clientState.clients) {
        const head = heads.get(client.slug), text = active.summaryBoards?.get(client.slug);
        if (!head || text === undefined) continue;
        const part = readBoardColumn(text, { generation: active.generation, revision: head.revision,
          incarnation: head.incarnation }, context, client);
        if (part) parts.set(client, part);
        else if (!sliced.has(client.slug)) needed.add(client.slug);
      }
    }
    const fetched = active ? await fetchSlices(db, workspace, active, needed) : [];
    if (!fetched) continue;
    const slices = active ? new Map([...active.slices, ...fetched].map(row => [row.company, row.raw])) : null;
    const tasks: BoardTask[] = [], cycles: BoardCycle[] = [], referenceTasks: Reference[] = [];
    for (const client of clientState.clients) {
      const part = parts.get(client);
      if (part) {
        tasks.push(...part.tasks);
        referenceTasks.push(...part.references);
        cycles.push(...part.cycles);
        continue;
      }
      if (slices && !slices.has(client.slug))
        throw new OperationError(503, 'execution_snapshot_incomplete',
          'A execução está sendo atualizada. Tente novamente.');
      const execution = projectClientExecution(
        slices?.get(client.slug) ?? (docs[2]?.value as object ?? {}), catalog, client,
        clientState.enrollments, clientStarts, enrollmentStarts, true);
      tasks.push(...execution.tasks.map(boardTaskOf));
      referenceTasks.push(...execution.referenceTasks);
      cycles.push(...execution.cycles.map(compactCycle));
    }
    const clientSnapshots = active ? Object.fromEntries(active.heads.map(head => [head.company,
      `${active.generation}:${head.incarnation}:${head.revision}`])) : {};
    return { key: active ? keyOf({ generation: active.generation,
      compatibilityVersion: active.compatibilityVersion, clientsVersion: docs[0]?.version ?? 0,
      catalogVersion: docs[1]?.version ?? 0 }) : null,
    mode: active ? 'active' : 'legacy', tasks, cycles, referenceTasks,
    compatibilityVersion: active?.compatibilityVersion ?? null, clientSnapshots, views: {}, json: {} };
  }
  throw new OperationError(409, 'snapshot_changed', 'A execução mudou. Tente novamente.');
}
