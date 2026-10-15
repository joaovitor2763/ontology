import { resolveTaskDeadlines } from "../../catalog/domain/task-deadlines.ts";
import type { Delivery } from "../domain/models.ts";
import { validTaskDate } from "../domain/delivery-policy.ts";
import type { ServiceCycle } from "../domain/services.ts";
import type { ExecutionSnapshot } from "./cycles.ts";
/** Shared projection and write validation keep chains consistent without changing closed history. */
export function scheduledExecution<T extends ExecutionSnapshot>(
  state: T,
  tasks: Delivery[],
  cycles: ServiceCycle[],
  clientStarts: Record<string, string | undefined>,
  enrollmentStarts: Record<string, string | undefined> = {},
): T {
  if (!tasks.some((t) => t.deadline && t.deadline.mode !== "fixed"))
    return state;
  const due = resolveExecutionDeadlines(tasks, cycles, clientStarts, enrollmentStarts);
  const patches = { ...state.taskPatches };
  let changed = false;
  for (const task of tasks)
    if (due[task.id] !== task.dueAt) {
      // A recalculated deadline before the planned start (or next to an invalid legacy
      // start such as 0002-…) carries the start with it. An empty fixed date stays empty.
      const early = task.startsAt && due[task.id] && (due[task.id] < task.startsAt || !validTaskDate(task.startsAt));
      patches[task.id] = { ...patches[task.id], dueAt: due[task.id], ...(early ? { startsAt: due[task.id] } : {}) };
      changed = true;
    }
  return changed ? { ...state, taskPatches: patches } : state;
}

/** The editor and persisted projection use the same purchase anchors and frozen history. */
export function resolveExecutionDeadlines(
  tasks: Delivery[],
  cycles: ServiceCycle[],
  clientStarts: Record<string, string | undefined>,
  enrollmentStarts: Record<string, string | undefined> = {},
): Record<string, string> {
  const context = Object.fromEntries(
    tasks.map((t) => [
      t.id,
      {
        cycleStart: cycles.find(
          (c) => c.taskIds.includes(t.id) && c.company === t.company,
        )?.startsAt,
        clientStart: t.enrollmentId ? enrollmentStarts[t.enrollmentId] : clientStarts[t.company],
      },
    ]),
  );
  return resolveTaskDeadlines(
    tasks.map((t) => ({
      ...t,
      frozen:
        t.status === "entregue" ||
        cycles.some(
          (c) => c.company === t.company && c.status === "concluido" && c.taskIds.includes(t.id),
        ),
    })),
    context,
  );
}
