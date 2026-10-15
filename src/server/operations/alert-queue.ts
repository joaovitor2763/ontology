import type { ServerEnv } from '../context.ts';
import type { AlertSeverity } from '../../modules/workspace/domain/models.ts';
import { refreshNow } from '../../shared/lib/format.ts';
import { unseenBy } from './alert-acknowledgments.ts';
import { alertAudience, alertDocuments, keys, projectAlerts } from './alerts.ts';
import { OperationError } from './errors.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { prefetchDocuments, sameVersions } from './request-context.ts';

const rank: Record<AlertSeverity, number> = { critico: 0, atencao: 1, info: 2 };

/**
 * Session-only alert queue. Active mode reads client slices, never the frozen document.
 * Without `company` it is the member's queue: AI Master and Visualização only get
 * the clients where they are allocated (`alertAudience`); with `company` it is that
 * client's queue for everyone who may see clients. Either way it leaves out what
 * the requesting member already acknowledged (`alert_acknowledgments`) and the
 * legacy team-wide `hidden` archive.
 */
export async function readAlertQueue(env: ServerEnv, principal: OperationPrincipal,
  company?: string) {
  if (!env.DB) throw new OperationError(503, 'database_unavailable', 'Banco indisponível.');
  if (principal.kind !== 'session')
    throw new OperationError(403, 'session_required', 'Use sua sessão para ver alertas.');
  const db = env.DB, workspace = env.WORKSPACE_ID || 'default';
  prefetchDocuments(db, workspace, keys.filter(key => key !== 'ontology.delivery.v2'));
  const authorized = await authorizeOperation(db, workspace, principal,
    { action: 'clientes.ver', scope: 'workspace:read', ...(company ? { company } : {}) });
  const workspaceKey = authorized.find(guard => guard.key.startsWith('ontology.workspace.'))!.key;
  const { docs, effective, versions, acknowledged } = await alertDocuments(db, workspace,
    workspaceKey, company, { withVersions: true, acknowledgedBy: principal.memberId });
  // Versões e fatias saem do mesmo lote: comparar aqui é o mesmo que conferir
  // depois da projeção, sem mais idas.
  const indexes = effective ? [0, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5];
  if (!sameVersions(versions!, indexes.map(index =>
    [index === 5 ? workspaceKey : keys[index], docs[index]] as const)))
    throw new OperationError(409, 'snapshot_changed', 'Os alertas mudaram. Tente novamente.');
  const { candidates, executions, work } = projectAlerts(docs, company, refreshNow(), effective);
  const unseen = unseenBy(acknowledged!, work.hidden);
  const audience = company ? null : alertAudience(docs, principal);
  const data = candidates.filter(alert => unseen(alert) &&
    (!audience || audience.has(alert.company))).sort((a, b) =>
    rank[a.severity] - rank[b.severity] || b.openedAt.localeCompare(a.openedAt));
  const relatedTasks = Object.fromEntries(data.flatMap(alert => {
    const task = alert.relatedDeliveryId && executions.get(alert.company)?.tasks.find(row =>
      row.id === alert.relatedDeliveryId);
    return task ? [[`${alert.company}\u0000${alert.id}`, { id: task.id, company: task.company,
      title: task.title, status: task.status }]] : [];
  }));
  return { data, relatedTasks, scope: audience ? 'allocated' as const : 'all' as const };
}
