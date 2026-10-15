import { applyTaskOverride } from "../domain/task-overrides.ts";
import type { TaskOverride } from "../domain/task-overrides.ts";
import type { Delivery } from "../domain/models";
import { cycleError, type ServiceCycle } from "../domain/services.ts";

export type ExecutionSnapshot = {
  cycleEdits: Record<string, ServiceCycle>;
  extraCycles: ServiceCycle[];
  extraTasks: Delivery[];
  taskPatches: Record<string, TaskOverride>;
  statusMap: Record<string, Delivery["status"]>;
};
/** One transaction contains both the cycle and its customized delivery copies. */
export function saveCycleAggregate<T extends ExecutionSnapshot>(
  state: T,
  cycle: ServiceCycle,
  generated: Delivery[],
  reference: { cycles: ServiceCycle[]; deliveries: Delivery[] },
): T {
  const tasks = [
    ...reference.deliveries,
    ...state.extraTasks,
    ...generated,
  ].map((t) => ({
    ...applyTaskOverride(t, state.taskPatches[t.id]),
    status:
      state.statusMap[t.id] ?? state.taskPatches[t.id]?.status ?? t.status,
  }));
  const problem = cycleError(cycle, tasks);
  if (problem) throw new Error(problem);
  if (
    generated.some(
      (t) =>
        t.company !== cycle.company ||
        !cycle.taskIds.includes(t.id) ||
        state.extraTasks.some((x) => x.id === t.id),
    )
  )
    throw new Error("Revise as novas entregas do ciclo.");
  const otherCycles = [
    ...reference.cycles.map((c) => state.cycleEdits[c.id] ?? c),
    ...state.extraCycles,
  ].filter((c) => c.id !== cycle.id);
  if (
    cycle.taskIds.some((id) => otherCycles.some((c) => c.taskIds.includes(id)))
  )
    throw new Error("Uma entrega já está vinculada a outro ciclo.");
  if (
    tasks.some(
      (t) =>
        cycle.taskIds.includes(t.id) &&
        t.productId &&
        t.productId !== cycle.productId,
    )
  )
    throw new Error("Vincule entregas do mesmo produto.");
  return {
    ...state,
    extraTasks: [...generated, ...state.extraTasks],
    ...(reference.cycles.some((c) => c.id === cycle.id)
      ? { cycleEdits: { ...state.cycleEdits, [cycle.id]: cycle } }
      : {
          extraCycles: [
            ...state.extraCycles.filter((c) => c.id !== cycle.id),
            cycle,
          ],
        }),
  };
}

/** Retain removal identity so later preparation cannot recreate deliberately deleted execution. */
export function removeCycleAggregate<T extends ExecutionSnapshot>(state:T,cycle:ServiceCycle):T {
  return {...state,extraCycles:state.extraCycles.filter(c=>c.id!==cycle.id),cycleEdits:{...state.cycleEdits,[cycle.id]:{...cycle,removed:true}}};
}
