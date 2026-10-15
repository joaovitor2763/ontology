import type { Delivery } from '../domain/models.ts';
import type { ServiceCycle } from '../domain/services.ts';
import type { TaskOverride } from '../domain/task-overrides.ts';

/** Removal is a tombstone for both model-derived and manually created tasks. */
export function taskRemovalError(task: Delivery, tasks: Delivery[], cycles: ServiceCycle[]) {
  if (cycles.some(cycle => cycle.taskIds.includes(task.id) && cycle.status === 'concluido'))
    return 'Reabra o ciclo antes de excluir esta tarefa.';
  if (tasks.some(row => row.id !== task.id && row.deadline?.mode === 'task' && row.deadline.taskId === task.id))
    return 'Esta tarefa define o prazo de outras tarefas. Ajuste essas dependências antes de excluir.';
  return null;
}
export function removeDeliveryTask<T extends {
  extraTasks: Delivery[]; taskPatches: Record<string, TaskOverride>;
  extraCycles: ServiceCycle[]; cycleEdits: Record<string, ServiceCycle>;
}>(state: T, task: Delivery, tasks: Delivery[], cycles: ServiceCycle[], actor: string, at: string): T {
  const problem = taskRemovalError(task, tasks, cycles);
  if (problem) throw new Error(problem);
  const next = { ...state, extraCycles: [...state.extraCycles], cycleEdits: { ...state.cycleEdits },
    taskPatches: { ...state.taskPatches, [task.id]: { ...state.taskPatches[task.id], ...task, removed: true, removedAt: at, removedBy: actor } } };
  for (const cycle of cycles.filter(row => row.taskIds.includes(task.id))) {
    const updated = { ...cycle, taskIds: cycle.taskIds.filter(id => id !== task.id), updatedAt: at };
    if (next.extraCycles.some(row => row.id === cycle.id)) next.extraCycles = next.extraCycles.map(row => row.id === cycle.id ? updated : row);
    if (next.cycleEdits[cycle.id] || !next.extraCycles.some(row => row.id === cycle.id)) next.cycleEdits[cycle.id] = updated;
  }
  return next;
}
