import type { ServerEnv } from '../context.ts';
import { getDoc } from '../db.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
import { deliveriesFor } from '../../modules/delivery/infrastructure/queries.ts';
import { normalizeDeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';
import { readActiveAlertDeliveryWith } from './delivery-alert-source.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { documentVersions, documentVersionsStatement, prefetchDocuments } from './request-context.ts';
import { OperationError } from './errors.ts';

const CLIENTS = 'ontology.clients.v3';
const DELIVERY = 'ontology.delivery.v2';
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** On-demand task search. Active authority reads slices without rebuilding the global document. */
export async function searchTasks(env: ServerEnv, principal: OperationPrincipal, query: string) {
  if (!env.DB) throw new OperationError(503, 'database_unavailable', 'Banco indisponível.');
  if (principal.kind !== 'session')
    throw new OperationError(403, 'session_required', 'Use sua sessão para buscar tarefas.');
  const q = query.trim();
  if (q.length > 120) throw new OperationError(400, 'invalid_query', 'Busca muito longa.');
  const db = env.DB, workspace = env.WORKSPACE_ID || 'default';
  prefetchDocuments(db, workspace, [CLIENTS]);
  await authorizeOperation(db, workspace, principal,
    { action: 'clientes.ver', scope: 'workspace:read' });
  if (!q) return { data: [] };
  const clientDoc = await getDoc(db, workspace, CLIENTS);
  const clientNames = new Map(projectClients(clientDoc?.value as object).clients.map(client => [client.slug, client.name]));
  // Fatias, ordem global e versão do cadastro no mesmo lote (uma transação).
  const { active, extra: [order, versions] } = await readActiveAlertDeliveryWith(db, workspace, {
    with: [db.prepare(`SELECT o.id,o.company,o.ordinal FROM delivery_client_shadow_meta m
      JOIN delivery_client_array_order o ON o.workspace_id=m.workspace_id
        AND o.generation=m.generation
      WHERE m.workspace_id=? AND m.mode='active' AND o.kind='extraTasks'
      ORDER BY o.ordinal`).bind(workspace),
    documentVersionsStatement(db, workspace, [CLIENTS])],
  });
  if (active && (documentVersions(versions).get(CLIENTS) ?? 0) !== (clientDoc?.version ?? 0))
    throw new OperationError(409, 'snapshot_changed', 'A busca mudou. Tente novamente.');
  const slices = active?.slices.map(slice => ({ company: slice.company,
    state: normalizeDeliverySnapshot(slice.raw) }));
  let state;
  if (active && slices) {
    // The old search uses the global projection, including tasks from another
    // selected plan. Recompose its inputs without reading the frozen document.
    const extras = slices.flatMap(slice => slice.state.extraTasks.map(task =>
      ({ company: slice.company, task })));
    const orderRows = order.results as { id: string; company: string; ordinal: number }[];
    const byId = new Map(extras.map(row => [row.task.id, row]));
    const ordinals = new Set<number>(), ids = new Set<string>();
    const validOrder = orderRows.every(row => {
      if (!Number.isSafeInteger(row.ordinal) || ordinals.has(row.ordinal) ||
          ids.has(row.id) || byId.get(row.id)?.company !== row.company) return false;
      ordinals.add(row.ordinal);
      ids.add(row.id);
      return true;
    });
    if (byId.size !== extras.length || orderRows.length !== extras.length || !validOrder)
      throw new OperationError(503, 'execution_snapshot_incomplete',
        'A busca está sendo atualizada. Tente novamente.');
    state = {
      statusMap: Object.assign({}, ...slices.map(slice => slice.state.statusMap)),
      taskPatches: Object.assign({}, ...slices.map(slice => slice.state.taskPatches)),
      extraTasks: orderRows.map(row => byId.get(row.id)!.task),
    };
  } else {
    state = normalizeDeliverySnapshot((await getDoc(db, workspace, DELIVERY))?.value as object);
  }
  const needle = normalize(q);
  const found = deliveriesFor(undefined, state.statusMap, state.extraTasks, state.taskPatches)
    .filter(task => normalize(`${task.title} ${clientNames.get(task.company) ?? ''}`).includes(needle))
    .map(task => ({ id: task.id, title: task.title, company: task.company,
      kind: task.kind === 'request' ? 'request' as const : 'task' as const }));
  return { data: found.slice(0, 8) };
}
