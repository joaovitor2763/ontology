import type { Delivery } from "./models";
import type { ServiceCycle } from "./services";

/** What the policy needs to know about the delivery being changed. */
export type PolicyContext = {
  /** The delivery before the patch. */
  current?: Partial<Delivery>;
  /** Documents already linked to the delivery. */
  linkedDocuments?: number;
};

/** Calendar date between 2000 and 2100; partial years typed in a date field (0002-…) never pass. */
export function validTaskDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4)), parsed = new Date(`${value}T12:00:00Z`);
  return year >= 2000 && year <= 2100 && Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
}

/** Typing a date by hand is fixed data: a relative rule stops recalculating it. */
const fixedRule = (task: Partial<Pick<Delivery, "deadline">>) =>
  task.deadline && task.deadline.mode !== "fixed" ? { deadline: { mode: "fixed" as const } } : {};

/** Keep the planned interval valid when a person brings a task deadline forward. */
export function directDueDatePatch(task: Pick<Delivery, "startsAt"> & Partial<Pick<Delivery, "deadline">>, dueAt: string): Partial<Delivery> {
  return { dueAt, ...(dueAt && task.startsAt && (dueAt < task.startsAt || !validTaskDate(task.startsAt)) ? { startsAt: dueAt } : {}), ...fixedRule(task) };
}

/** Mirror of directDueDatePatch: a start after the deadline carries the deadline with it. */
export function directStartDatePatch(task: Pick<Delivery, "dueAt"> & Partial<Pick<Delivery, "deadline">>, startsAt: string | undefined): Partial<Delivery> {
  return startsAt && task.dueAt && (startsAt > task.dueAt.slice(0, 10) || !validTaskDate(task.dueAt.slice(0, 10)))
    ? { startsAt, dueAt: startsAt, ...fixedRule(task) } : { startsAt };
}

/** Planned start as read: a stored start after the deadline is shown (and later saved) as the deadline. */
export function plannedStart(startsAt: string | undefined, dueAt: string | undefined) {
  const due = dueAt?.slice(0, 10);
  return startsAt && due && /^\d{4}-\d{2}-\d{2}$/.test(due) && startsAt > due ? due : startsAt;
}

/** Only tasks whose planned interval changed are checked: an old inconsistent task never blocks unrelated work. */
export function changedScheduleError(before: Pick<Delivery, "id" | "startsAt" | "dueAt">[], after: (Pick<Delivery, "id" | "startsAt" | "dueAt"> & Partial<Pick<Delivery, "status">>)[]): string | null {
  const previous = new Map(before.map((task) => [task.id, task]));
  for (const task of after) {
    const old = previous.get(task.id);
    if (old && old.startsAt === task.startsAt && old.dueAt === task.dueAt) continue;
    const issue = deliveryPatchError({ dueAt: task.dueAt, ...(task.startsAt ? { startsAt: task.startsAt } : {}) }, undefined, { current: { status: "fila", ...task } });
    if (issue) return issue;
  }
  return null;
}

/**
 * Backlog: a task in "fila" may have no deadline (dueAt ""). Every other status needs one,
 * so the board's "A fazer" column only holds dated work. `status` and `dueAt` are read
 * from the patch first and then from the current task.
 */
export function isBacklogTask(task: Pick<Delivery, "status" | "dueAt">) {
  return task.status === "fila" && !task.dueAt;
}

function backlogError(patch: Partial<Delivery>, current?: Partial<Delivery>): string | null {
  const clearing = patch.dueAt !== undefined && !patch.dueAt.trim();
  const leaving = patch.status !== undefined && patch.status !== "fila";
  if (!clearing && !leaving) return null;
  const status = patch.status ?? current?.status;
  const dueAt = patch.dueAt ?? current?.dueAt;
  // Unknown deadline (partial context) is not judged here; only a known empty one is.
  if (status === "fila" || dueAt === undefined || dueAt.trim()) return null;
  // A patch that says nothing about the status and has no current task cannot prove it is in the backlog.
  if (clearing && status === undefined) return "Informe um prazo válido.";
  return status === "entregue"
    ? "Defina um prazo antes de concluir esta tarefa."
    : "Defina um prazo antes de tirar a tarefa do Backlog. Sem prazo, a tarefa só fica no Backlog.";
}

export function deliveryPatchError(
  patch: Partial<Delivery>,
  cycle?: ServiceCycle,
  context: PolicyContext = {},
): string | null {
  if (patch.title !== undefined && !patch.title.trim())
    return "Informe o título da tarefa.";
  if (
    patch.hours !== undefined &&
    (!Number.isFinite(patch.hours) || patch.hours < 0)
  )
    return "O esforço deve ser um número maior ou igual a zero.";
  const startsAt = Object.hasOwn(patch, "startsAt") ? patch.startsAt : context.current?.startsAt;
  if (
    (patch.startsAt !== undefined || patch.dueAt !== undefined) &&
    startsAt !== undefined
  ) {
    if (!validTaskDate(startsAt)) return "Informe uma data de início válida.";
    if (startsAt > ((patch.dueAt ?? context.current?.dueAt) || startsAt))
      return "O início não pode ser posterior ao prazo.";
  }
  const backlogIssue = backlogError(patch, context.current);
  if (backlogIssue) return backlogIssue;
  if (patch.dueAt) {
    if (!validTaskDate(patch.dueAt.slice(0, 10))) return "Informe um prazo válido.";
  }
  if (
    cycle?.status === "concluido" &&
    patch.status &&
    patch.status !== "entregue"
  )
    return "Reabra o ciclo antes de alterar o status desta tarefa.";
  if (patch.status === "entregue" && context.current?.status !== "entregue") {
    const checklist = patch.checklist ?? context.current?.checklist ?? [];
    const pending = checklist.filter((item) => !item.done).length;
    if (pending)
      return pending === 1
        ? "Conclua o item pendente do checklist antes de concluir."
        : `Conclua os ${pending} itens pendentes do checklist antes de concluir.`;
    const requires =
      patch.requiresEvidence ?? context.current?.requiresEvidence ?? false;
    const evidence = (patch.evidence ?? context.current?.evidence ?? "").trim();
    if (requires && !evidence && !(context.linkedDocuments ?? 0))
      return "Esta tarefa exige evidência: anexe um documento ou descreva o que foi entregue.";
  }
  return null;
}

/** A completion gesture must offer the checklist/evidence form before committing. */
export function requiresCompletionReview(
  current: Partial<Delivery> | undefined,
  patch: Partial<Delivery>,
) {
  return (
    patch.status === "entregue" &&
    current?.status !== "entregue" &&
    ((current?.checklist?.length ?? 0) > 0 ||
      !!(patch.requiresEvidence ?? current?.requiresEvidence))
  );
}
