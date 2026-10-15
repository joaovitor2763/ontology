import { scheduledExecution } from "../application/task-deadlines.ts";
import { resolveCycles } from "./cycles.ts";
import { deliveriesFor } from "./queries.ts";
import type { DeliverySnapshot } from "./snapshot.ts";

/** Resolve dates before selecting a client's plan: a purchase can change that selection. */
export function scheduledDeliverySnapshot(
  state: DeliverySnapshot,
  clientStarts: Record<string, string | undefined>,
  enrollmentStarts: Record<string, string | undefined>,
): DeliverySnapshot {
  return scheduledExecution(
    state,
    deliveriesFor(undefined, state.statusMap, state.extraTasks, state.taskPatches),
    resolveCycles(state),
    clientStarts,
    enrollmentStarts,
  );
}
