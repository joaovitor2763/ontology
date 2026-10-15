import type { ProductEnrollment } from '../../modules/clients/domain/product-enrollments.ts';
import { enrollmentRemovalError } from '../../modules/clients/domain/product-enrollments.ts';
import { projectClients, type ClientsSnapshot } from '../../modules/clients/infrastructure/snapshot.ts';
import type { DeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';
import { partitionClientDelivery } from '../delivery-client-slices.ts';
import { noSurvivingDeadlineDependencies } from './delivery-client-deadline-dependencies.ts';
import { activeTaskStatements, ClientScopeRequiresBridge } from './delivery-client-task-write.ts';
import * as v from './input.ts';

export async function certifiedClientRemoval(
  db: D1Database, workspace: string, delivery: DeliverySnapshot,
  enrollmentId: string, version: number,
) {
  const removedTaskIds = delivery.extraTasks.filter(task => task.enrollmentId === enrollmentId)
    .map(task => task.id);
  return noSurvivingDeadlineDependencies(db, workspace, removedTaskIds, version);
}

export async function assertEnrollmentRemovalAllowed(
  db: D1Database, workspace: string, company: string,
  clients: ClientsSnapshot, enrollment: ProductEnrollment,
) {
  const issue = enrollmentRemovalError(enrollment);
  if (issue) v.invalid(issue);
  if (clients.enrollments.some(candidate => candidate.previousEnrollmentId === enrollment.id))
    v.invalid('Esta contratação é a origem de uma renovação. Cancele-a para preservar o histórico da relação.');
  if (projectClients(clients).allocations.some(allocation => allocation.enrollmentId === enrollment.id))
    v.invalid('Remova primeiro as pessoas alocadas especificamente a esta contratação.');
  const referencedSale = await db.prepare(`SELECT 1 AS linked FROM client_audit_log audit
    WHERE audit.workspace_id=? AND audit.company=? AND audit.action='enrollment.created'
      AND audit.subject=? AND EXISTS (SELECT 1 FROM external_references reference
        WHERE reference.workspace_id=audit.workspace_id AND reference.entity_id=audit.operation_id
          AND reference.kind='sale') LIMIT 1`)
    .bind(workspace, company, enrollment.id).first<{ linked: number }>();
  if (referencedSale)
    v.invalid('Esta contratação pertence a uma venda com referência de integração. Cancele-a para preservar a conciliação externa.');
}

export async function activeClientRemovalStatements(
  db: D1Database, workspace: string, company: string,
  slice: Parameters<typeof activeTaskStatements>[2], before: DeliverySnapshot,
  after: DeliverySnapshot, enrollments: readonly ProductEnrollment[],
  removedEnrollmentPlanId: string | undefined, clientsVersion: number,
): Promise<D1PreparedStatement[] | null> {
  const partition = partitionClientDelivery(after,
    enrollments.filter(enrollment => enrollment.company === company));
  const removedPlans = Object.keys(before.productPlans)
    .filter(id => !Object.hasOwn(after.productPlans, id));
  if (partition.unassigned.length || partition.sharedPlanIds.length ||
      partition.slices.some(row => row.company !== company) ||
      removedPlans.some(id => id !== removedEnrollmentPlanId)) return null;
  try {
    return await activeTaskStatements(db, workspace, slice, after, 600,
      'enrollments.remove', new Set(), false, clientsVersion, false, new Set(removedPlans));
  } catch (error) {
    if (error instanceof ClientScopeRequiresBridge) return null;
    throw error;
  }
}

export async function activeClientRebuildStatements(
  db: D1Database, workspace: string, company: string,
  slice: Parameters<typeof activeTaskStatements>[2], before: DeliverySnapshot,
  after: DeliverySnapshot, enrollments: readonly ProductEnrollment[],
  oldPlanId: string | undefined,
  result: { enrollment: ProductEnrollment; cycles: string[]; tasks: string[] },
  clientsVersion: number,
): Promise<D1PreparedStatement[] | null> {
  const newPlanId = result.enrollment.planId;
  if (!oldPlanId || !newPlanId) return null;
  const partition = partitionClientDelivery(after,
    enrollments.filter(enrollment => enrollment.company === company));
  const addedPlans = Object.keys(after.productPlans)
    .filter(id => !Object.hasOwn(before.productPlans, id));
  const removedPlans = Object.keys(before.productPlans)
    .filter(id => !Object.hasOwn(after.productPlans, id));
  if (partition.unassigned.length || partition.sharedPlanIds.length ||
      partition.slices.some(row => row.company !== company) || removedPlans.length ||
      addedPlans.some(id => id !== newPlanId) || addedPlans.length > 1 ||
      (oldPlanId === newPlanId && addedPlans.length) ||
      (oldPlanId !== newPlanId && addedPlans.length !== 1)) return null;
  try {
    return await activeTaskStatements(db, workspace, slice, after, 600,
      'enrollments.rebuild', new Set(addedPlans), false, clientsVersion, false,
      new Set(), new Set(oldPlanId === newPlanId ? [oldPlanId] : []),
      { enrollmentId: result.enrollment.id, extraCycles: result.cycles,
        extraTasks: result.tasks });
  } catch (error) {
    if (error instanceof ClientScopeRequiresBridge) return null;
    throw error;
  }
}

export async function activeClientLifecycleStatements(
  db: D1Database, workspace: string, company: string,
  slice: Parameters<typeof activeTaskStatements>[2], before: DeliverySnapshot,
  after: DeliverySnapshot, enrollments: readonly ProductEnrollment[],
  command: 'enrollments.remove' | 'enrollments.rebuild',
  oldPlanId: string | undefined, result: unknown, clientsVersion: number,
) {
  return command === 'enrollments.remove'
    ? activeClientRemovalStatements(db, workspace, company, slice, before, after,
      enrollments, oldPlanId, clientsVersion)
    : activeClientRebuildStatements(db, workspace, company, slice, before, after,
      enrollments, oldPlanId,
      result as { enrollment: ProductEnrollment; cycles: string[]; tasks: string[] }, clientsVersion);
}
