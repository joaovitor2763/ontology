import { addDays } from "./schedule.ts";
export type TaskDeadline =
  | { mode: "fixed" }
  | { mode: "cycle" | "client"; offsetDays: number }
  | { mode: "task"; taskId: string; offsetDays: number };
type Task = {
  id: string;
  company?: string;
  title?: string;
  dueAt: string;
  deadline?: TaskDeadline;
  frozen?: boolean;
};
const validDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;
export function deadlineGraphError(
  tasks: Pick<Task, "id" | "company" | "deadline">[],
): string | null {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visiting = new Set<string>(),
    done = new Set<string>();
  function visit(id: string): string | null {
    if (visiting.has(id))
      return "As dependências formam um ciclo. Uma tarefa não pode depender de si mesma, nem indiretamente.";
    if (done.has(id)) return null;
    const t = byId.get(id)!;
    const rule = t.deadline;
    if (!rule || rule.mode === "fixed") {
      done.add(id);
      return null;
    }
    if (!Number.isInteger(rule.offsetDays) || Math.abs(rule.offsetDays) > 3650)
      return "Use um deslocamento inteiro de até 3650 dias.";
    visiting.add(id);
    if (rule.mode === "task") {
      const parent = byId.get(rule.taskId);
      if (!parent || parent.company !== t.company)
        return "Escolha uma tarefa existente do mesmo cliente como referência.";
      const issue = visit(parent.id);
      if (issue) return issue;
    }
    visiting.delete(id);
    done.add(id);
    return null;
  }
  for (const t of tasks) {
    const issue = visit(t.id);
    if (issue) return issue;
  }
  return null;
}
export function resolveTaskDeadlines(
  tasks: Task[],
  context: Record<string, { cycleStart?: string; clientStart?: string }>,
): Record<string, string> {
  const issue = deadlineGraphError(tasks);
  if (issue) throw new Error(issue);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dates: Record<string, string> = {};
  function resolve(id: string): string {
    if (dates[id]) return dates[id];
    const task = byId.get(id)!;
    const rule = task.deadline;
    if (!rule || rule.mode === "fixed" || task.frozen)
      return (dates[id] = task.dueAt);
    const base =
      rule.mode === "task"
        ? resolve(rule.taskId)
        : rule.mode === "cycle"
          ? context[id]?.cycleStart
          : context[id]?.clientStart;
    if (!base || !validDate(base))
      throw new Error(
        `Informe ${rule.mode === "client" ? "o início do cliente" : rule.mode === "cycle" ? "o início do ciclo" : "o prazo da tarefa de referência"} para calcular o prazo de “${task.title ?? "Tarefa"}”.`,
      );
    return (dates[id] = addDays(base, rule.offsetDays));
  }
  for (const t of tasks) resolve(t.id);
  return dates;
}

export function deadlineSummary(rule: TaskDeadline | undefined, tasks: { id: string; title: string }[] = [], initialDay?: number) {
  if (!rule || rule.mode === 'fixed') return initialDay ? `Dia ${initialDay}` : 'Data fixa';
  const taskId = rule.mode === 'task' ? rule.taskId : undefined;
  const base = rule.mode === 'cycle' ? 'início do ciclo' : rule.mode === 'client' ? 'início do cliente' : `prazo de ${tasks.find(t=>t.id===taskId)?.title ?? 'outra tarefa'}`;
  return rule.offsetDays === 0 ? `No ${base}` : `${Math.abs(rule.offsetDays)} dias ${rule.offsetDays > 0 ? 'após o' : 'antes do'} ${base}`;
}
