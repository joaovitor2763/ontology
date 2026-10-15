import type { ServerEnv } from '../context.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
import { normalizeDeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';
import { resolveCycles } from '../../modules/delivery/infrastructure/cycles.ts';
import type { PortfolioSummary, HomeSummary, MemberWorkSummary } from '../../modules/clients/domain/portfolio-summary.ts';
import { clientProgress, nextOpenTask } from '../../modules/delivery/application/progress.ts';
import { operationalHealth } from '../../modules/clients/domain/health.ts';
import { primaryAlertFor } from '../../modules/workspace/domain/derived-alerts.ts';
import type { AlertSeverity } from '../../modules/workspace/domain/models.ts';
import { alertsFor } from '../../modules/workspace/infrastructure/queries.ts';
import { refreshNow } from '../../shared/lib/format.ts';
import { alertDocuments, projectAlerts, keys } from './alerts.ts';
import { unseenBy } from './alert-acknowledgments.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { prefetchDocuments, sameVersions, WORKSPACE_KEYS } from './request-context.ts';
import { prefetchClientAccess } from '../client-access.ts';
import { hasGoogleSessionCookie } from '../google-login.ts';
import { OperationError } from './errors.ts';
import { id } from './input.ts';

const rank: Record<AlertSeverity, number> = { critico: 0, atencao: 1, info: 2 };

/** Documentos que a carteira lê (a execução vem das fatias, nunca do documento global). */
const PORTFOLIO_KEYS = keys.filter(key => key !== 'ontology.delivery.v2');

/**
 * Antes de resolver quem pede: os documentos da carteira e a projeção de acesso
 * que a autorização vai consultar saem junto com a sessão e o roster. Só com
 * uma credencial na requisição (cookie ou Bearer); sem ela, nada é lido.
 */
export function warmPortfolioRead(request: Request, env: ServerEnv) {
  if (!env.DB || !(hasGoogleSessionCookie(request) || request.headers.has('authorization') ||
    (env.AUTH_MODE !== 'google' && request.headers.has('cookie')))) return;
  const workspace = env.WORKSPACE_ID || 'default';
  prefetchDocuments(env.DB, workspace, PORTFOLIO_KEYS);
  prefetchClientAccess(env.DB, workspace);
}

/** Compact, session-only portfolio projection from authoritative client slices. */
export async function readPortfolioSummary(env: ServerEnv, principal: OperationPrincipal,
  memberId?: string) {
  if (memberId !== undefined) memberId = id(memberId, 'membro');
  if (!env.DB) throw new OperationError(503, 'database_unavailable', 'Banco indisponível.');
  if (principal.kind !== 'session')
    throw new OperationError(403, 'session_required', 'Use sua sessão para ver a carteira.');
  const db = env.DB, workspace = env.WORKSPACE_ID || 'default';
  prefetchDocuments(db, workspace, PORTFOLIO_KEYS);
  // Fatias, versões e ciência saem em paralelo com a autorização (a mesma
  // pré-leitura do contador): nada é usado antes de ela terminar, e um erro da
  // leitura só aparece para quem foi autorizado.
  const expectedKey = principal.guards.find(guard => guard.key.startsWith('ontology.workspace.'))?.key ??
    WORKSPACE_KEYS[0];
  const read = (workspaceKey: string) => alertDocuments(db, workspace, workspaceKey, undefined,
    { withVersions: true, acknowledgedBy: principal.memberId });
  const early = read(expectedKey);
  early.catch(() => undefined);
  const authorized = await authorizeOperation(db, workspace, principal,
    { action: 'clientes.ver', scope: 'workspace:read' });
  const workspaceKey = authorized.find(guard => guard.key.startsWith('ontology.workspace.'))!.key;
  const { docs, effective, versions, acknowledged } = workspaceKey === expectedKey
    ? await early : await read(workspaceKey);
  // Versões, marcador e fatias vêm do mesmo lote (uma transação): se os
  // documentos usados não são os daquele instante, a carteira seria um retrato
  // misturado.
  const documentKeys = [keys[0], keys[2], keys[3], keys[4], workspaceKey];
  if (!sameVersions(versions!, documentKeys.map((key, index) =>
    [key, docs[[0, 2, 3, 4, 5][index]]] as const)))
    throw new OperationError(409, 'snapshot_changed', 'A carteira mudou. Tente novamente.');
  const clientState = projectClients(docs[0]?.value as object);
  const work = (docs[5]?.value ?? {}) as { hidden?: string[] };
  // Saúde é da equipe: só o arquivo compartilhado `hidden` tira risco dela.
  // Contagens e o alerta principal são a fila de quem pede.
  const hidden = new Set(work.hidden ?? []);
  const now = refreshNow();
  const { candidates, executions } = projectAlerts(docs, undefined, now, effective);
  const visible = candidates.filter(unseenBy(acknowledged!, work.hidden)).sort((a, b) =>
    rank[a.severity] - rank[b.severity] || b.openedAt.localeCompare(a.openedAt));
  const alertCounts = new Map<string, number>();
  for (const alert of visible)
    alertCounts.set(alert.company, (alertCounts.get(alert.company) ?? 0) + 1);
  const slices = effective ? new Map(effective.slices.map(row => [row.company, row.raw])) : null;
  const home: HomeSummary = {
    clients: {}, taskCounts: { fila: 0, 'em-curso': 0, revisao: 0, entregue: 0, bloqueado: 0 },
    openTasks: 0, blocked: 0, activeCycles: 0, inReview: 0, pendingAcceptance: [],
  };
  const progressByClient = new Map<string, ReturnType<typeof clientProgress>>();
  if (memberId) for (const client of clientState.clients) {
    const execution = executions.get(client.slug);
    if (!execution)
      throw new OperationError(503, 'execution_snapshot_incomplete', 'A execução está sendo atualizada. Tente novamente.');
    progressByClient.set(client.slug, clientProgress(execution.tasks, execution.cycles, now));
  }
  const rows: PortfolioSummary = memberId ? {} : Object.fromEntries(clientState.clients.map(client => {
    const execution = executions.get(client.slug);
    if (!execution)
      throw new OperationError(503, 'execution_snapshot_incomplete', 'A execução está sendo atualizada. Tente novamente.');
    const progress = clientProgress(execution.tasks, execution.cycles, now);
    progressByClient.set(client.slug, progress);
    const next = nextOpenTask(progress.open);
    const current = progress.currentCycle;
    const health = operationalHealth({
      today: now,
      openDeliveries: progress.all.map(task => ({ id: task.id, status: task.status,
        dueAt: task.dueAt, priority: task.priority, blockers: task.blockers, blocker: task.blocker })),
      currentCycle: current ? { status: current.status, endsAt: current.endsAt,
        acceptanceRequestedAt: current.acceptanceRequestedAt } : null,
      cycles: progress.cycles,
      nextStep: client.nextMilestone
        ? { text: client.nextMilestone, dueAt: client.nextMilestoneAt || undefined } : null,
      openRisks: alertsFor(client.slug, hidden).map(alert => ({ severity: alert.severity })),
    });
    const primary = primaryAlertFor(client.slug, visible, {
      today: now, health,
      nextStep: next ? { text: next.title, dueAt: next.dueAt } : null,
    });
    const activeCycle = current && current.status !== 'planejado' ? current : undefined;
    const homePrimary = primaryAlertFor(client.slug, visible, {
      today: now, health,
      nextStep: client.nextMilestone
        ? { text: client.nextMilestone, dueAt: client.nextMilestoneAt || undefined } : null,
    });
    for (const task of progress.planned) home.taskCounts[task.status] += 1;
    home.openTasks += progress.open.length;
    home.blocked += progress.blocked.length;
    const activeCycles = progress.cycles.filter(cycle =>
      cycle.status === 'em-curso' || cycle.status === 'em-aceite');
    home.activeCycles += activeCycles.length;
    home.inReview += activeCycles.filter(cycle => cycle.status === 'em-aceite').length;
    home.pendingAcceptance.push(...activeCycles.filter(cycle => cycle.status === 'em-aceite')
      .map(cycle => ({ id: cycle.id, company: cycle.company, name: cycle.name,
        endsAt: cycle.endsAt, acceptanceRequestedAt: cycle.acceptanceRequestedAt })));
    home.clients[client.slug] = {
      planned: progress.planned.length, done: progress.done.length, percent: progress.percent,
      currentCycle: current ? { id: current.id, name: current.name, status: current.status } : null,
      health,
      primary: homePrimary && homePrimary.kind !== 'sem-reuniao'
        ? { company: homePrimary.company, kind: homePrimary.kind, rank: homePrimary.rank,
          severity: homePrimary.severity, title: homePrimary.title,
          action: homePrimary.action, target: homePrimary.target } : null,
      nextTaskTitle: next?.title ?? null,
    };
    return [client.slug, {
      planned: progress.planned.length,
      done: progress.done.length,
      percent: progress.percent,
      nextTask: next ? { title: next.title, dueAt: next.dueAt } : null,
      cycle: activeCycle ? { id: activeCycle.id, name: activeCycle.name } : null,
      health,
      alertCount: alertCounts.get(client.slug) ?? 0,
      primary: primary ? { kind: primary.kind, severity: primary.severity,
        title: primary.title, action: primary.action } : null,
    }];
  }));
  const activeSlugs = new Set(clientState.clients.map(client => client.slug));
  for (const client of memberId ? [] : clientState.allClients) {
    if (activeSlugs.has(client.slug)) continue;
    // O resumo da revisão exata já traz esse ciclo (só depende da fatia).
    const summarized = effective?.archivedCycles?.has(client.slug);
    if (slices && !summarized && !slices.has(client.slug))
      throw new OperationError(503, 'execution_snapshot_incomplete', 'A execução está sendo atualizada. Tente novamente.');
    const cycle = summarized ? effective!.archivedCycles!.get(client.slug) ?? undefined
      : resolveCycles(normalizeDeliverySnapshot(slices?.get(client.slug) ?? docs[1]?.value as object))
        .find(row => row.company === client.slug && !row.removed &&
          (row.status === 'em-curso' || row.status === 'em-aceite'));
    const primary = primaryAlertFor(client.slug, visible, { today: now });
    rows[client.slug] = {
      planned: 0, done: 0, percent: 0, nextTask: null,
      cycle: cycle ? { id: cycle.id, name: cycle.name } : null,
      health: null,
      alertCount: alertCounts.get(client.slug) ?? 0,
      primary: primary ? { kind: primary.kind, severity: primary.severity,
        title: primary.title, action: primary.action } : null,
    };
  }
  home.pendingAcceptance.sort((a, b) => a.endsAt.localeCompare(b.endsAt));
  let member: MemberWorkSummary | undefined;
  if (memberId) {
    const activeClients = new Set(clientState.clients.map(client => client.slug));
    const allocated = new Set(clientState.allocations.filter(row =>
      row.memberId === memberId && activeClients.has(row.company))
      .map(row => row.company));
    const tasks = clientState.clients.flatMap(client => progressByClient.get(client.slug)?.open ?? [])
      .filter(task => task.ownerId === memberId)
      .sort((a, b) => Number(!a.dueAt) - Number(!b.dueAt) || a.dueAt.localeCompare(b.dueAt));
    member = {
      taskCount: tasks.length,
      hours: tasks.reduce((total, task) => total + task.hours, 0),
      tasks: tasks.slice(0, 6).map(task => ({ id: task.id, company: task.company,
        title: task.title, status: task.status, dueAt: task.dueAt, hours: task.hours })),
      alerts: visible.filter(alert => allocated.has(alert.company)),
      clients: Object.fromEntries(clientState.clients.filter(client => allocated.has(client.slug))
        .map(client => {
          const progress = progressByClient.get(client.slug)!;
          const cycle = progress.currentCycle;
          return [client.slug, { planned: progress.planned.length, done: progress.done.length,
            percent: progress.percent,
            cycle: cycle && cycle.status !== 'planejado' ? { id: cycle.id, name: cycle.name, status: cycle.status as 'em-curso' | 'em-aceite' } : null }];
        })),
    };
  }
  return { data: rows, home, ...(member ? { member } : {}) };
}
