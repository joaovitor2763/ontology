import type { CatalogSnapshot } from "../../catalog/infrastructure/snapshot.ts";
import { projectCatalog } from "../../catalog/infrastructure/snapshot.ts";
import { DEFAULT_JOURNEY_ID } from "../../catalog/infrastructure/journey.ts";
import { pinnedJourney } from "../../catalog/domain/publication.ts";
import type { JourneyTemplate } from "../../catalog/domain/models.ts";
import type { ProductEnrollment } from "../../clients/domain/product-enrollments.ts";
import type { Company } from "../../clients/domain/models.ts";
import {
  effectiveAssignedPlanId,
  effectiveAssignedPlanVersion,
} from "../application/plan-schedule.ts";
import { normalizeDeliverySnapshot, projectDelivery, type DeliverySnapshot } from "./snapshot.ts";
import { deliveriesFor } from "./queries.ts";
import { resolveCycles } from "./cycles.ts";
import { scheduledDeliverySnapshot } from "./scheduled-state.ts";

/**
 * How a client's plan was chosen, and which values outside the slice the
 * projection consulted. Together with the slice they determine the result:
 * the persisted per-client summary (server) stores them to prove it is still
 * current without projecting again.
 */
export type ClientExecutionPlan = {
  /** Effective plan id (`effectiveAssignedPlanId`) and the pin that applies to it. */
  planId: string;
  pinnedVersion?: number;
  /** Ids of the slice's private plans, in `projectCatalog` order. */
  privatePlanIds: string[];
  /** The plan the tasks are projected with (`pinnedJourney(...).id`). */
  followedId: string;
  /** Companies (`clientStarts`) and purchases (`enrollmentStarts`) the deadlines consulted. */
  companies: string[];
  enrollmentIds: string[];
};

/** Public journey ids, in the order `projectCatalog` lists them after private plans. */
export function publicJourneyIds(catalog: CatalogSnapshot) {
  return projectCatalog(catalog, {}).journeys.map(journey => journey.id);
}

/**
 * The plan a client follows: the effective plan when the catalog (private
 * plans first) has it, otherwise the first plan, then its pinned or latest
 * published version. Only the id matters to the projection.
 */
export function followedPlanId(
  catalog: CatalogSnapshot,
  privatePlanIds: string[],
  planId: string,
  pinnedVersion: number | undefined,
  publicIds: string[] = publicJourneyIds(catalog),
) {
  const ids = [...privatePlanIds, ...publicIds];
  if (!ids.length) throw new TypeError("No plan available to project the client.");
  const headId = ids.includes(planId) ? planId : ids[0];
  return pinnedJourney({ id: headId } as JourneyTemplate,
    catalog.journeyVersions[headId] ?? [], pinnedVersion).id;
}

/** The selected-plan and scheduled-date projection used by the portfolio UI.
 * A client slice can be projected independently because deadline references
 * cannot cross clients. Keep the purchase inference aligned with useCatalog. */
export function projectClientExecution(
  raw: Partial<DeliverySnapshot>,
  catalog: CatalogSnapshot,
  client: Pick<Company, "slug" | "journeyId" | "milestone">,
  enrollments: ProductEnrollment[],
  clientStarts: Record<string, string | undefined>,
  enrollmentStarts: Record<string, string | undefined>,
  includeReferences = false,
) {
  return projectClientExecutionWithPlan(raw, catalog, client, enrollments,
    clientStarts, enrollmentStarts, includeReferences).execution;
}

/** `projectClientExecution` and the plan/dependencies it used (same computation). */
export function projectClientExecutionWithPlan(
  raw: Partial<DeliverySnapshot>,
  catalog: CatalogSnapshot,
  client: Pick<Company, "slug" | "journeyId" | "milestone">,
  enrollments: ProductEnrollment[],
  clientStarts: Record<string, string | undefined>,
  enrollmentStarts: Record<string, string | undefined>,
  includeReferences = false,
) {
  const normalized = normalizeDeliverySnapshot(raw);
  let state = normalized;
  try {
    state = scheduledDeliverySnapshot(normalized, clientStarts, enrollmentStarts);
  } catch {
    // Client and execution documents hydrate independently in the browser.
    // Keep persisted dates if their references are not available yet.
  }
  const cycles = resolveCycles(state);
  const allTasks = deliveriesFor(undefined, state.statusMap, state.extraTasks, state.taskPatches);
  const assignedId = state.companyJourney[client.slug] ?? client.journeyId;
  const id = effectiveAssignedPlanId(
    { cycles, tasks: allTasks }, client.slug, assignedId, enrollments,
  ) ?? DEFAULT_JOURNEY_ID;
  const pinnedVersion = effectiveAssignedPlanVersion(assignedId, id, state.companyJourneyVersion[client.slug]);
  const privatePlanIds = Object.values(state.productPlans).map(plan => plan.id);
  const followedId = followedPlanId(catalog, privatePlanIds, id, pinnedVersion);
  const execution = {
    ...projectDelivery(state, client.slug, followedId),
    referenceTasks: includeReferences
      ? allTasks.filter(task => task.company === client.slug).map(task => ({
        id: task.id, company: task.company, title: task.title, dueAt: task.dueAt,
      }))
      : [],
  };
  // `resolveTaskDeadlines` reads a start (`clientStarts[task.company]` or
  // `enrollmentStarts[task.enrollmentId]`) only for a rule that is not fixed, task or
  // cycle based: those starts are the outside values the dates used.
  const fromStart = allTasks.filter(task => task.deadline &&
    !["fixed", "task", "cycle"].includes(task.deadline.mode));
  const plan: ClientExecutionPlan = { planId: id, pinnedVersion, privatePlanIds, followedId,
    companies: [...new Set(fromStart.filter(task => !task.enrollmentId).map(task => task.company))].sort(),
    enrollmentIds: [...new Set(fromStart.flatMap(task => task.enrollmentId ? [task.enrollmentId] : []))].sort() };
  return { execution, plan };
}
