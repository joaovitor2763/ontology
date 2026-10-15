import type { TaskOverride } from "../domain/task-overrides.ts";
import type { Delivery, DeliveryStatus } from "../domain/models.ts";
import type { ServiceCycle } from "../domain/services.ts";
import type { JourneyTemplate } from "../../catalog/domain/models.ts";
import { mergeLegacy, migrateTaskClears, migrateTaskCompletionDates, migrateTaskDeadlines, migrateTaskHistory, migrateDeliveryDates, migrateExecutionPlans } from "../../../shared/infrastructure/migration.ts";
import { resolveCycles } from "./cycles.ts";
import { deliveriesFor } from "./queries.ts";
export type DeliverySnapshot = {
  cycleEdits: Record<string, ServiceCycle>;
  extraCycles: ServiceCycle[];
  statusMap: Record<string, DeliveryStatus>;
  extraTasks: Delivery[];
  taskPatches: Record<string, TaskOverride>;
  productPlans: Record<string, JourneyTemplate>;
  companyJourney: Record<string, string>;
  companyMilestone: Record<string, number>;
  /** Published plan version each client follows; absent = latest published. */
  companyJourneyVersion: Record<string, number>;
};
export const DELIVERY_INITIAL: DeliverySnapshot = {
  cycleEdits: {},
  extraCycles: [],
  statusMap: {},
  extraTasks: [],
  taskPatches: {},
  productPlans: {},
  companyJourney: {},
  companyMilestone: {},
  companyJourneyVersion: {},
};

export function normalizeDeliverySnapshot(state: Partial<DeliverySnapshot> = {}): DeliverySnapshot {
  return migrateTaskHistory(migrateTaskCompletionDates(migrateTaskDeadlines(migrateDeliveryDates(migrateTaskClears(migrateExecutionPlans(mergeLegacy(DELIVERY_INITIAL, [state])))))));
}
export function projectDelivery(raw: Partial<DeliverySnapshot> = {}, company?: string, journeyId?: string) {
  const state = normalizeDeliverySnapshot(raw);
  return { cycles: resolveCycles(state).filter(c => !c.removed && (!company || c.company === company)),
    tasks: deliveriesFor(company, state.statusMap, state.extraTasks, state.taskPatches, journeyId) };
}
