import {
  initialCycleTemplates,
  initialProducts,
} from "../../catalog/infrastructure/products.ts";
import type { ExecutionSnapshot } from "../application/cycles";
import type { ServiceCycle } from "../domain/services";
import { serviceCycles } from "./services.ts";
export function resolveCycles(
  state: Pick<ExecutionSnapshot, "cycleEdits" | "extraCycles">,
): ServiceCycle[] {
  return [
    ...serviceCycles
      .filter((c) => !state.cycleEdits[c.id]?.removed)
      .map((c) => ({
        productId: initialProducts[c.company]?.[0],
        templateId: initialCycleTemplates[c.id],
        ...(state.cycleEdits[c.id] ?? c),
      })),
    ...state.extraCycles.filter((c) => !c.removed),
  ].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
