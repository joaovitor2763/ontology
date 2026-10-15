import type { ReferenceTask, TaskSchedule } from "./models.ts";

/** Calendar arithmetic on date-only values; noon avoids DST shifting the day. */
export function addDays(value: string, days: number) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Human sentence for the editor and the cycle form. */
export function scheduleSummary(
  schedule: TaskSchedule | undefined,
  tasks: Pick<ReferenceTask, "id" | "title">[] = [],
): string {
  if (!schedule || schedule.mode === "none") return "Sem prazo automático";
  if (schedule.mode === "date") {
    const venda = schedule.base === "venda";
    if (schedule.offsetDays === 0)
      return venda ? "No dia da venda" : "No dia do início do ciclo";
    const after = venda ? "a data da venda" : "o início do ciclo";
    const before = venda ? "da data da venda" : "do início do ciclo";
    return schedule.offsetDays > 0
      ? `${plural(schedule.offsetDays, "dia", "dias")} após ${after}`
      : `${plural(Math.abs(schedule.offsetDays), "dia", "dias")} antes ${before}`;
  }
  const predecessor = tasks.find((t) => t.id === schedule.predecessorId);
  const name = predecessor ? `'${predecessor.title}'` : "outra tarefa";
  if (schedule.offsetDays === 0) return `No mesmo dia de ${name}`;
  return schedule.offsetDays > 0
    ? `${plural(schedule.offsetDays, "dia", "dias")} após ${name}`
    : `${plural(Math.abs(schedule.offsetDays), "dia", "dias")} antes de ${name}`;
}

export type ScheduleContext = {
  startsAt: string;
  saleAt?: string;
  /** Due dates already resolved for other reference tasks, by task id. */
  tasksDue: Record<string, string | undefined>;
};

/** Due date for one schedule, or null when it cannot be resolved yet. */
export function resolveDueDate(
  schedule: TaskSchedule | undefined,
  context: ScheduleContext,
): string | null {
  if (!schedule || schedule.mode === "none") return null;
  if (schedule.mode === "date") {
    const base =
      schedule.base === "venda"
        ? (context.saleAt ?? context.startsAt)
        : context.startsAt;
    if (!base) return null;
    return addDays(base, schedule.offsetDays);
  }
  const predecessorDue = context.tasksDue[schedule.predecessorId];
  return predecessorDue ? addDays(predecessorDue, schedule.offsetDays) : null;
}

/**
 * Resolves every task in dependency order. Tasks without a resolvable schedule
 * get null so the caller can spread them evenly.
 */
export function resolveAllDueDates(
  tasks: ReferenceTask[],
  context: Omit<ScheduleContext, "tasksDue">,
): Record<string, string | null> {
  const due: Record<string, string | undefined> = {};
  const result: Record<string, string | null> = {};
  let pending = tasks.slice();
  // Each pass resolves at least one task or the remainder has no valid base.
  for (let guard = 0; pending.length && guard <= tasks.length; guard += 1) {
    const next: ReferenceTask[] = [];
    for (const task of pending) {
      const schedule = task.schedule;
      const value = resolveDueDate(schedule, { ...context, tasksDue: due });
      if (value) {
        due[task.id] = value;
        result[task.id] = value;
      } else if (
        schedule?.mode === "task" &&
        pending.some((t) => t.id === schedule.predecessorId) &&
        !(schedule.predecessorId in result)
      ) {
        next.push(task);
      } else {
        result[task.id] = null;
      }
    }
    pending = next;
  }
  for (const task of pending) result[task.id] = null;
  return result;
}

/** Predecessors must exist, come earlier in the list and never form a cycle. */
export function validateSchedules(tasks: ReferenceTask[]): string | null {
  const index = new Map(tasks.map((t, i) => [t.id, i]));
  for (const task of tasks) {
    const schedule = task.schedule;
    if (!schedule) continue;
    if (
      (schedule.mode === "date" || schedule.mode === "task") &&
      (!Number.isInteger(schedule.offsetDays) ||
        Math.abs(schedule.offsetDays) > 365)
    )
      return `'${task.title}': o deslocamento deve ser um número inteiro de até 365 dias.`;
    if (schedule.mode !== "task") continue;
    if (schedule.predecessorId === task.id)
      return `'${task.title}' não pode depender de si mesma.`;
    const before = index.get(schedule.predecessorId);
    if (before === undefined)
      return `'${task.title}' depende de uma tarefa que não existe neste marco.`;
    if (before > (index.get(task.id) ?? 0))
      return `'${task.title}' depende de uma tarefa que vem depois dela. Reordene as tarefas.`;
  }
  // Cycle detection over the predecessor graph.
  const visiting = new Set<string>();
  const done = new Set<string>();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visit = (id: string): boolean => {
    if (done.has(id)) return true;
    if (visiting.has(id)) return false;
    visiting.add(id);
    const task = byId.get(id);
    const ok =
      !task?.schedule || task.schedule.mode !== "task"
        ? true
        : visit(task.schedule.predecessorId);
    visiting.delete(id);
    done.add(id);
    return ok;
  };
  for (const task of tasks)
    if (!visit(task.id))
      return "As dependências entre tarefas formam um ciclo. Revise os prazos.";
  return null;
}

export const scheduleModeLabel: Record<TaskSchedule["mode"], string> = {
  none: "Sem prazo automático",
  date: "A partir de uma data",
  task: "Após outra tarefa",
};

export const scheduleBaseLabel: Record<"inicio" | "venda", string> = {
  inicio: "Início do ciclo",
  venda: "Data da venda",
};
