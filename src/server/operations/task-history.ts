import type { ServerEnv } from '../context.ts';
import { getDoc } from '../db.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
import { projectDelivery } from '../../modules/delivery/infrastructure/snapshot.ts';
import { scopedDeliverySnapshot } from './delivery-record-read.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { OperationError } from './errors.ts';

type HistoryRow = { entry_id: string; entry_json: string; event_at: string | null; is_legacy_summary: number };
type HistoryCursor = [string, string];

function decodeCursor(value?: string): HistoryCursor | null {
  if (value === undefined) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw new Error('Invalid cursor');
    const decoded = JSON.parse(atob(value.replaceAll('-', '+').replaceAll('_', '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '='))) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 2 ||
      !decoded.every(item => typeof item === 'string' && item.length <= 200)) throw new Error('Invalid cursor');
    return decoded as HistoryCursor;
  } catch {
    throw new OperationError(400, 'invalid_cursor', 'Cursor inválido.');
  }
}

function encodeCursor(row: HistoryRow) {
  return btoa(JSON.stringify([row.event_at ?? '', row.entry_id]))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function pageTaskHistory(db: D1Database, workspace: string, taskId: string,
  input: { cursor?: string; limit?: number } = {}) {
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new OperationError(400, 'invalid_limit', 'Informe um limite inteiro de 1 a 100.');
  const cursor = decodeCursor(input.cursor);
  const rows = (await db.prepare(`SELECT entry_id,entry_json,event_at,is_legacy_summary
    FROM delivery_task_history WHERE workspace_id=? AND task_id=?
    ${cursor ? "AND (COALESCE(event_at,'')<? OR (COALESCE(event_at,'')=? AND entry_id<?))" : ''}
    ORDER BY COALESCE(event_at,'') DESC,entry_id DESC LIMIT ?`)
    .bind(workspace, taskId, ...(cursor ? [cursor[0], cursor[0], cursor[1]] : []), limit + 1)
    .all<HistoryRow>()).results;
  const page = rows.slice(0, limit);
  return {
    data: page.map(row => ({ id: row.entry_id, entry: JSON.parse(row.entry_json) as unknown,
      at: row.event_at, legacySummary: row.is_legacy_summary === 1 })),
    nextCursor: rows.length > limit ? encodeCursor(page.at(-1)!) : null,
  };
}

export async function readTaskHistory(env: ServerEnv, principal: OperationPrincipal,
  input: { company: string; taskId: string; cursor?: string; limit?: number }) {
  if (!env.DB) throw new OperationError(503, 'database_unavailable', 'Banco indisponível.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.company) || !input.taskId || input.taskId.length > 200)
    throw new OperationError(422, 'invalid_input', 'Informe o cliente e a tarefa.');
  const workspace = env.WORKSPACE_ID || 'default';
  await authorizeOperation(env.DB, workspace, principal,
    { action: 'clientes.ver', scope: 'delivery:read', company: input.company });
  const clients = projectClients((await getDoc(env.DB, workspace, 'ontology.clients.v3'))?.value ?? {});
  if (!clients.allClients.some(client => client.slug === input.company))
    throw new OperationError(404, 'not_found', 'Cliente não encontrado.');
  const state = await scopedDeliverySnapshot(env.DB, workspace, input.company)
    ?? (await getDoc(env.DB, workspace, 'ontology.delivery.v2'))?.value ?? {};
  if (!projectDelivery(state).tasks.some(task => task.id === input.taskId && task.company === input.company))
    throw new OperationError(404, 'not_found', 'Tarefa não encontrada neste cliente.');
  return pageTaskHistory(env.DB, workspace, input.taskId, input);
}
