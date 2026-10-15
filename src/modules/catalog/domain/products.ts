import { deadlineGraphError, resolveTaskDeadlines } from "./task-deadlines.ts";
import type { Delivery } from "../../delivery/domain/models.ts";

export type BaseDelivery = {
  deadline?: import("./task-deadlines").TaskDeadline;
  id: string;
  title: string;
  description: string;
  day: number;
  milestoneId?: string;
  hours: number;
  /** Optional policy copied from a reference task of the plan. */
  completion?: "checklist" | "deliverable";
  checklistItems?: string[];
  requiresEvidence?: boolean;
  approvalRequired?: boolean;
  deliverableTemplateId?: string;
  responsibleRole?: string;
  party?: "equipe" | "cliente" | "terceiro";
};
export type CycleTemplate = {
  id: string;
  name: string;
  goal: string;
  durationDays: number;
  milestones?: { id: string; name: string }[];
  deliveries: BaseDelivery[];
  acceptance: string[];
};
export type ProductServiceModel = "consultoria" | "implementacao" | "recorrente";
export type Product = {
  version?: number;
  id: string;
  name: string;
  description: string;
  cycles: CycleTemplate[];
  /** Classifies the client's service when this is the first unambiguous product purchased. */
  serviceModel?: ProductServiceModel;
  /** New clients of this product get the AI Master with the fewest clients, unless someone is chosen by hand. */
  autoAllocateLead?: boolean;
};

/** The active AI Master with the fewest clients; ties break by name. Managers and admins are not auto-allocated. */
export function suggestLead<
  T extends { id: string; name: string; access?: string },
>(members: T[], clientCount: (memberId: string) => number): T | undefined {
  const eligible = members.filter(
    (m) => (m.access ?? "ai_master") === "ai_master" || m.access === "membro",
  );
  return [...eligible].sort(
    (a, b) =>
      clientCount(a.id) - clientCount(b.id) ||
      a.name.localeCompare(b.name, "pt-BR"),
  )[0];
}
export function dateAfter(start: string, days: number) {
  const date = new Date(`${start}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function instantiateDeliveries(
  rows: BaseDelivery[],
  context: {
    cycleId: string;
    company: string;
    productId: string;
    templateId: string;
    startsAt: string;
    clientStartsAt?: string;
    ownerId: string;
  },
): Delivery[] {
  const dates = resolveTaskDeadlines(rows.map(row => ({ ...row, dueAt: dateAfter(context.startsAt, row.day - 1) })), Object.fromEntries(rows.map(row => [row.id, { cycleStart: context.startsAt, clientStart: context.clientStartsAt }])));
  return rows.map((row) => ({
    id: `${context.cycleId}-${row.id}`,
    company: context.company,
    productId: context.productId,
    cycleTemplateId: context.templateId,
    baseDeliveryId: row.id,
    title: row.title.trim(),
    description: row.description.trim(),
    status: "fila",
    ownerId: context.ownerId,
    dueAt: dates[row.id],
    deadline: row.deadline?.mode === "task" ? { ...row.deadline, taskId: `${context.cycleId}-${row.deadline.taskId}` } : row.deadline,
    hours: row.hours,
    workstream: "Tarefa de serviço",
    milestone: 0,
    completion: row.completion ?? "deliverable",
    kind: "journey",
    ...(row.responsibleRole
      ? {
          responsibleRole: row.responsibleRole,
          party: row.party ?? "equipe",
          assignmentSource: "papel" as const,
        }
      : {}),
    ...(row.requiresEvidence != null
      ? { requiresEvidence: row.requiresEvidence }
      : {}),
    ...(row.approvalRequired != null
      ? { approvalRequired: row.approvalRequired }
      : {}),
    ...(row.deliverableTemplateId
      ? {
          deliverableTemplateId: row.deliverableTemplateId,
          deliverable: row.deliverableTemplateId,
        }
      : {}),
    ...(row.checklistItems?.length
      ? {
          checklist: row.checklistItems.map((title, i) => ({
            id: `${context.cycleId}-${row.id}-c${i + 1}`,
            title,
            done: false,
          })),
        }
      : {}),
  }));
}
export function templateError(template: CycleTemplate): string | null {
  const deadlineIssue = deadlineGraphError(template.deliveries);
  if (deadlineIssue) return deadlineIssue;
  if (!template.name.trim() || !template.goal.trim())
    return "Informe nome e objetivo do modelo.";
  if (
    !Number.isInteger(template.durationDays) ||
    template.durationDays < 1 ||
    template.durationDays > 365
  )
    return "A duração deve ser de 1 a 365 dias.";
  if (
    template.milestones?.length &&
    (template.milestones.some((m) => !m.name.trim()) ||
      new Set(template.milestones.map((m) => m.id)).size !==
        template.milestones.length ||
      template.deliveries.some(
        (d) =>
          d.milestoneId &&
          !template.milestones!.some((m) => m.id === d.milestoneId),
      ))
  )
    return "Revise os marcos e o vínculo das tarefas.";
  if (!template.deliveries.length) return "Inclua pelo menos uma tarefa base.";
  if (
    new Set(template.deliveries.map((d) => d.id)).size !==
    template.deliveries.length
  )
    return "As tarefas precisam ter identificadores únicos.";
  if (
    template.deliveries.some(
      (d) =>
        !d.title.trim() ||
        ((!d.deadline || d.deadline.mode === "fixed") && (!Number.isInteger(d.day) || d.day < 1 || d.day > template.durationDays)) ||
        !Number.isFinite(d.hours) ||
        d.hours < 0,
    )
  )
    return "Revise os títulos, esforços e prazos das tarefas. O dia deve estar dentro do ciclo.";
  if (!template.acceptance.some((a) => a.trim()))
    return "Inclua pelo menos um critério de aceite.";
  return null;
}
