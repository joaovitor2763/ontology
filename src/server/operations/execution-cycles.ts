import type { ServerEnv } from '../context.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
import { normalizeCatalogSnapshot, projectCatalog } from '../../modules/catalog/infrastructure/snapshot.ts';
import { pinnedJourney } from '../../modules/catalog/domain/publication.ts';
import { DEFAULT_JOURNEY_ID } from '../../modules/catalog/infrastructure/journey.ts';
import { effectiveAssignedPlanId, effectiveAssignedPlanVersion } from '../../modules/delivery/application/plan-schedule.ts';
import { normalizeDeliverySnapshot, projectDelivery } from '../../modules/delivery/infrastructure/snapshot.ts';
import { scheduledDeliverySnapshot } from '../../modules/delivery/infrastructure/scheduled-state.ts';
import { activeTagStillCurrent, readActiveAlertDeliveryWith } from './delivery-alert-source.ts';
import { OperationError } from './errors.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { documentVersions, documentVersionsStatement, loadDocuments, prefetchDocuments,
  sameVersions } from './request-context.ts';

const CLIENTS = 'ontology.clients.v3';
const CATALOG = 'ontology.catalog.v2';

/** Global cycles include archived clients and tasks outside the selected plan.
 * The response carries only task fields used by progress and the calendar;
 * editing loads the complete client slice on demand. */
export async function readExecutionCycles(env: ServerEnv, principal: OperationPrincipal,
  knownTag?: string | null) {
  if (!env.DB) throw new OperationError(503, 'database_unavailable', 'Banco indisponível.');
  if (principal.kind !== 'session')
    throw new OperationError(403, 'session_required', 'Use sua sessão para ver os ciclos.');
  const db = env.DB, workspace = env.WORKSPACE_ID || 'default';
  // Com ETag, a resposta mais comum é 304: nenhum corpo de documento.
  if (!knownTag) prefetchDocuments(db, workspace, [CLIENTS, CATALOG]);
  await authorizeOperation(db, workspace, principal,
    { action: 'clientes.ver', scope: 'workspace:read' });
  if (knownTag && await activeTagStillCurrent(db, workspace, knownTag, cyclesTag))
    return { notModified: true as const, etag: knownTag };
  const { active, extra } = await readActiveAlertDeliveryWith(db, workspace,
    { with: [documentVersionsStatement(db, workspace, [CLIENTS, CATALOG])] });
  if (!active) return { mode: 'legacy' as const, etag: null };
  const [clientsDoc, catalogDoc] = await loadDocuments(db, workspace, [CLIENTS, CATALOG]);
  // Versões e marcador vieram no lote das fatias: conferir aqui equivale a
  // conferir depois da projeção.
  if (!sameVersions(documentVersions(extra[0]), [[CLIENTS, clientsDoc], [CATALOG, catalogDoc]]) ||
    active.sourceClientsVersion !== (clientsDoc?.version ?? 0))
    throw new OperationError(409, 'snapshot_changed', 'A execução mudou. Tente novamente.');
  const clientState = projectClients(clientsDoc?.value as object);
  const catalog = normalizeCatalogSnapshot(catalogDoc?.value as object);
  const starts = Object.fromEntries(clientState.allClients.map(c => [c.slug, c.startedAt]));
  const enrollmentStarts = Object.fromEntries(clientState.enrollments.map(e => [e.id, e.startsAt]));
  const slices = new Map(active.slices.map(row => [row.company, row.raw]));
  const tasks: { id: string; company: string; title: string; status: string; dueAt: string }[] = [];
  const cycles: ReturnType<typeof projectDelivery>['cycles'] = [];
  const milestoneNames: Record<string, string> = {};
  for (const client of clientState.allClients) {
    const raw = slices.get(client.slug);
    if (!raw) throw new OperationError(503, 'execution_snapshot_incomplete',
      'A execução está sendo atualizada. Tente novamente.');
    const normalized = normalizeDeliverySnapshot(raw);
    let state = normalized;
    try { state = scheduledDeliverySnapshot(normalized, starts, enrollmentStarts); }
    catch { /* match the client page: retain persisted dates if a legacy reference is invalid */ }
    const all = projectDelivery(state);
    const projected = {
      cycles: all.cycles.filter(cycle => cycle.company === client.slug),
      tasks: all.tasks.filter(task => task.company === client.slug),
    };
    const assigned = state.companyJourney[client.slug] ?? client.journeyId;
    const planId = effectiveAssignedPlanId({ cycles: projected.cycles, tasks: projected.tasks },
      client.slug, assigned, clientState.enrollments) ?? DEFAULT_JOURNEY_ID;
    const journeys = projectCatalog(catalog, state.productPlans).journeys;
    const head = journeys.find(plan => plan.id === planId) ?? journeys[0];
    const followed = pinnedJourney(head, catalog.journeyVersions[head.id] ?? [],
      effectiveAssignedPlanVersion(assigned, planId,
        state.companyJourneyVersion[client.slug]));
    for (const cycle of projected.cycles) {
      const milestone = followed.milestones.find(item => item.n === cycle.milestone);
      if (milestone) milestoneNames[cycle.id] = milestone.name;
    }
    cycles.push(...projected.cycles);
    tasks.push(...projected.tasks.map(task => ({
      id: task.id, company: task.company, title: task.title,
      status: task.status, dueAt: task.dueAt,
    })));
  }
  const clientSnapshots = Object.fromEntries(active.heads.map(head => [head.company,
    `${active.generation}:${head.incarnation}:${head.revision}`]));
  const etag = cyclesTag(active.generation, active.compatibilityVersion,
    clientsDoc?.version ?? 0, catalogDoc?.version ?? 0);
  return { mode: 'active' as const, cycles, tasks, milestoneNames, clientSnapshots,
    compatibilityVersion: active.compatibilityVersion, etag };
}

function cyclesTag(generation: string, compatibilityVersion: number,
  clientsVersion: number, catalogVersion: number) {
  return `"g4-cycles:${generation}:${compatibilityVersion}:${clientsVersion}:${catalogVersion}"`;
}
