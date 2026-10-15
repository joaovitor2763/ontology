import { Buffer } from 'node:buffer';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { Delivery } from '../modules/delivery/domain/models.ts';
import { boardTaskOf, compactCycle, type BoardCycle, type BoardTask }
  from '../modules/delivery/infrastructure/execution-board-wire.ts';
import type { ClientExecutionPlan } from '../modules/delivery/infrastructure/client-projection.ts';
import { BOARD_PACKED_FIELDS, planStillHolds, unpackTasks, type ClientSummary, type SummaryBoard,
  type SummaryContext } from './delivery-client-summary.ts';

/**
 * Coluna `board` de `delivery_client_summary` (0043), formato 2: tudo o que o
 * quadro global lê de um cliente (`SummaryBoard`), com a identidade da fatia
 * para a qual foi calculado (geração, revisão, encarnação), os `inputs` e o
 * plano da projeção — em JSON comprimido (deflate cru) e em base64, com o
 * prefixo `BOARD_PREFIX`. O quadro lê **só** esta coluna (nem o corpo do
 * resumo nem a fatia) e a confere sozinha: identidade igual à da fatia lida e
 * `planStillHolds` com o cadastro e o catálogo da resposta.
 *
 * O formato 1 (JSON simples, só os campos do quadro que faltavam no corpo)
 * deixou de ser lido: o SQL do quadro manda a fatia no lugar de uma coluna sem
 * o prefixo (`delivery-alert-source.ts`), e o backfill a regrava. Um Worker
 * anterior (rollback) não entende o formato 2 (`JSON.parse` falha) e projeta a
 * fatia; o que ele regrava sem conhecer a coluna deixa a identidade dela
 * diferente da linha, e o quadro projeta a fatia também.
 */
export type SliceIdentity = { generation: string; revision: number; incarnation: string };
type StoredBoard = SummaryBoard & { g: string; r: number; i: string; inputs: string; plan: ClientExecutionPlan };

export const BOARD_PREFIX = '!g4-board-v2:';

/**
 * Corpo + coluna acima disso ficam sem a coluna: o backfill grava o SQL em texto
 * (limite seguro de 95 KB por comando) e a linha do D1 não deve crescer sem teto.
 * O mesmo corte vale para o escritor e para o backfill, então a linha sem
 * coluna conta como atual nos dois.
 */
export const BOARD_COLUMN_LIMIT = 90_000;

/** O JSON guardado na coluna (antes de comprimir), ou `null` sem a parte do quadro. */
function boardPayload(identity: SliceIdentity, summary: ClientSummary) {
  if (!summary.board) return null;
  const stored: StoredBoard = { g: identity.generation, r: identity.revision, i: identity.incarnation,
    inputs: summary.inputs, plan: summary.body.plan, ...summary.board };
  return JSON.stringify(stored);
}

/** Texto da coluna para o resumo calculado; `null` quando o resumo não tem a parte do quadro. */
export function boardColumn(identity: SliceIdentity, summary: ClientSummary): string | null {
  const payload = boardPayload(identity, summary);
  if (payload === null) return null;
  const text = BOARD_PREFIX + deflateRawSync(payload).toString('base64');
  return text.length + JSON.stringify(summary.body).length > BOARD_COLUMN_LIMIT ? null : text;
}

/** O JSON de uma coluna no formato 2, ou `null` (ausente, outro formato, ilegível). */
export function boardColumnPayload(text: string | null | undefined): string | null {
  if (typeof text !== 'string' || !text.startsWith(BOARD_PREFIX)) return null;
  try {
    return inflateRawSync(Buffer.from(text.slice(BOARD_PREFIX.length), 'base64')).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * A coluna gravada é a que este resumo daria? Compara o conteúdo, não os bytes
 * comprimidos (outra versão do zlib pode comprimir o mesmo JSON de outro jeito).
 */
export function sameBoardColumn(stored: string | null | undefined, computed: string | null) {
  if (computed === null || stored === null || stored === undefined) return (stored ?? null) === computed;
  return stored === computed || boardColumnPayload(stored) === boardColumnPayload(computed);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const sameFields = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((field, index) => field === b[index]);

/**
 * O que o quadro mostra deste cliente, se a coluna é do formato 2, legível,
 * calculada para esta fatia (`identity`) e ainda vale para este cadastro e
 * este catálogo. `null` = o quadro projeta a fatia daquele cliente.
 */
export function readBoardColumn(text: string | null | undefined, identity: SliceIdentity,
  context: SummaryContext, client: { slug: string; journeyId?: string }):
  { tasks: BoardTask[]; cycles: BoardCycle[]; references: { id: string; company: string; title: string; dueAt: string }[] } | null {
  const payload = boardColumnPayload(text);
  if (payload === null) return null;
  let board: StoredBoard;
  try {
    board = JSON.parse(payload) as StoredBoard;
  } catch {
    return null;
  }
  if (!isObject(board) || board.g !== identity.generation || board.r !== identity.revision ||
    board.i !== identity.incarnation || typeof board.inputs !== 'string' || !isObject(board.plan) ||
    !isObject(board.tasks) || !Array.isArray(board.tasks.fields) || !Array.isArray(board.tasks.rows) ||
    !sameFields(board.tasks.fields, BOARD_PACKED_FIELDS) ||
    !board.tasks.rows.every(row => Array.isArray(row) && typeof row[0] === 'number') ||
    !Array.isArray(board.cycles) || !board.cycles.every(cycle => isObject(cycle) &&
      typeof cycle.id === 'string' && Array.isArray(cycle.taskIds) && Array.isArray(cycle.acceptance)) ||
    !Array.isArray(board.references) ||
    !planStillHolds(context, client, board.inputs, board.plan)) return null;
  const tasks = unpackTasks(client.slug, board.tasks).map(task => boardTaskOf(task as Partial<Delivery>));
  const references: { id: string; company: string; title: string; dueAt: string }[] = [];
  for (const row of board.references) {
    if (typeof row === 'number') {
      const task = Number.isInteger(row) ? tasks[row] : undefined;
      if (!task || typeof task.title !== 'string' || typeof task.dueAt !== 'string') return null;
      references.push({ id: task.id, company: client.slug, title: task.title, dueAt: task.dueAt });
    } else if (Array.isArray(row) && row.length === 3 && row.every(value => typeof value === 'string'))
      references.push({ id: row[0], company: client.slug, title: row[1], dueAt: row[2] });
    else return null;
  }
  return { tasks, references,
    cycles: board.cycles.map(cycle => compactCycle({ ...cycle, company: client.slug })) };
}
