import type { ServerEnv } from '../context.ts';
import { getDoc } from '../db.ts';
import { deliveriesFor } from '../../modules/delivery/infrastructure/queries.ts';
import { normalizeDeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';
import type { DeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';
import { readActiveAlertDelivery } from './delivery-alert-source.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { OperationError } from './errors.ts';

const DELIVERY = 'ontology.delivery.v2';

export function selectDocumentTaskTitles(ids: ReadonlySet<string>,
  state: Pick<DeliverySnapshot, 'statusMap' | 'extraTasks' | 'taskPatches'>) {
  return Object.fromEntries(deliveriesFor(undefined, state.statusMap,
    state.extraTasks, state.taskPatches)
    .filter(task => ids.has(task.id)).map(task => [task.id, task.title]));
}

/** Compact internal labels for the task links already present in the documents panel. */
export async function documentTaskTitles(
  env: ServerEnv, principal: OperationPrincipal, ids: unknown,
  ifVersion?: unknown, requireVersion?: unknown,
) {
  if (!env.DB) throw new OperationError(503, 'database_unavailable', 'Banco indisponível.');
  if (principal.kind !== 'session')
    throw new OperationError(403, 'session_required', 'Use sua sessão para consultar documentos.');
  if (!Array.isArray(ids) || ids.length > 1000 ||
      ids.some(id => typeof id !== 'string' || id.length > 180 ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(id)))
    throw new OperationError(400, 'invalid_task_ids', 'Vínculos de tarefa inválidos.');
  if ([ifVersion, requireVersion].some(version => version !== undefined &&
      (typeof version !== 'string' || version.length > 180)))
    throw new OperationError(400, 'invalid_version', 'Versão da consulta inválida.');
  const db = env.DB, workspace = env.WORKSPACE_ID || 'default';
  await authorizeOperation(db, workspace, principal,
    { action: 'clientes.ver', scope: 'documents:read' });
  const before = await taskTitleVersion(db, workspace);
  if (requireVersion !== undefined && requireVersion !== before)
    throw new OperationError(409, 'snapshot_changed', 'Os vínculos mudaram. Tente novamente.');
  if (ifVersion !== undefined && ifVersion === before)
    return { unchanged: true, snapshotVersion: before };
  const requested = new Set<string>(ids);
  if (!requested.size) return { titles: {}, snapshotVersion: before };
  const active = await readActiveAlertDelivery(db, workspace);
  const state = active ? {
    statusMap: Object.assign({}, ...active.slices.map(slice => slice.raw.statusMap ?? {})),
    taskPatches: Object.assign({}, ...active.slices.map(slice => slice.raw.taskPatches ?? {})),
    extraTasks: active.slices.flatMap(slice => slice.raw.extraTasks ?? []),
  } : normalizeDeliverySnapshot((await getDoc(db, workspace, DELIVERY))?.value as object);
  if (active && new Set(state.extraTasks.map(task => task.id)).size !== state.extraTasks.length)
    throw new OperationError(503, 'execution_snapshot_incomplete',
      'Os vínculos estão sendo atualizados. Tente novamente.');
  const titles = selectDocumentTaskTitles(requested, state);
  if (await taskTitleVersion(db, workspace) !== before)
    throw new OperationError(409, 'snapshot_changed', 'Os vínculos mudaram. Tente novamente.');
  return { titles, snapshotVersion: before };
}

async function taskTitleVersion(db: D1Database, workspace: string) {
  const row = await db.prepare(`SELECT m.mode,m.generation,m.compatibility_version,
      m.source_delivery_version,m.source_clients_version,
      m.expected_clients,
      (SELECT COUNT(*) FROM delivery_client_snapshots s
        WHERE s.workspace_id=m.workspace_id AND s.generation=m.generation) AS slices,
      d.version AS delivery_version,c.version AS clients_version
    FROM delivery_client_shadow_meta m
    LEFT JOIN state_documents d ON d.workspace_id=m.workspace_id AND d.key='ontology.delivery.v2'
    LEFT JOIN state_documents c ON c.workspace_id=m.workspace_id AND c.key='ontology.clients.v3'
    WHERE m.workspace_id=?`).bind(workspace).first<{
      mode: string; generation: string; compatibility_version: number;
      source_delivery_version: number; source_clients_version: number;
      expected_clients: number; slices: number;
      delivery_version: number | null; clients_version: number | null;
    }>();
  if (row?.mode === 'active') {
    if (row.delivery_version !== row.source_delivery_version ||
        row.clients_version !== row.source_clients_version ||
        row.slices !== row.expected_clients)
      throw new OperationError(503, 'execution_snapshot_incomplete',
        'Os vínculos estão sendo atualizados. Tente novamente.');
    return `active:${row.generation}:${row.compatibility_version}`;
  }
  if (row) return `legacy:${row.delivery_version ?? 0}`;
  const doc = await db.prepare(`SELECT version FROM state_documents
    WHERE workspace_id=? AND key=?`).bind(workspace, DELIVERY)
    .first<{ version: number }>();
  return `legacy:${doc?.version ?? 0}`;
}
