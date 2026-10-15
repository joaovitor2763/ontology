import {
  instantiateDeliveries,
  templateError,
  type Product,
} from "../../catalog/domain/products.ts";
import type { JourneyTemplate } from "../../catalog/domain/models.ts";
import type { Company } from "../../clients/domain/models.ts";
import type { Delivery } from "../domain/models.ts";
import type { ServiceCycle } from "../domain/services.ts";
import type { ExecutionSnapshot } from "./cycles.ts";
import { addDays, validBoundedDate, validDate } from "./plan-execution.ts";

export type ProductExecution = {
  plan: JourneyTemplate;
  cycles: ServiceCycle[];
  tasks: Delivery[];
};
/** A private copy of the product: subsequent catalogue edits never rewrite client work. */
export function prepareProduct(
  product: Product,
  company: Company,
  at: string,
  enrollment?: { id: string; startsAt: string; planId?: string },
): ProductExecution {
  const startsAt = enrollment?.startsAt ?? company.startedAt;
  const namespace = enrollment?.planId ?? (enrollment ? `enrollment-${enrollment.id}` : `product-${company.slug}-${product.id}`);
  if (!validDate(startsAt ?? ""))
    throw new Error("Informe a data de início do cliente.");
  if (!product.cycles.length)
    throw new Error("Inclua pelo menos um ciclo no produto.");
  const plan: JourneyTemplate = {
    id: namespace,
    productId: product.id,
    name: product.name,
    description: product.description,
    milestones: [],
  };
  const cycles: ServiceCycle[] = [],
    tasks: Delivery[] = [];
  let start = startsAt!;
  for (const template of product.cycles) {
    const issue = templateError(template);
    if (issue) throw new Error(`${template.name}: ${issue}`);
    const id = `${namespace}-${template.id}`;
    const milestones = template.milestones?.length
      ? template.milestones
      : [{ id: "resultado", name: template.name }];
    const numbers = new Map<string, number>();
    for (const m of milestones) {
      const n = plan.milestones.length + 1;
      numbers.set(m.id, n);
      plan.milestones.push({
        n,
        name: m.name,
        stage: template.name,
        owner: "Responsável",
        goal: template.goal,
        cycleTemplateId: template.id,
        exitCriteria: template.acceptance,
      });
    }
    const generated = instantiateDeliveries(template.deliveries, {
      cycleId: id,
      company: company.slug,
      productId: product.id,
      templateId: template.id,
      startsAt: start,
      clientStartsAt: startsAt,
      ownerId: company.leadId,
    }).map((t, index) => ({
      ...t,
      ...(enrollment ? { enrollmentId: enrollment.id } : {}),
      startsAt: t.dueAt && t.dueAt < start ? t.dueAt : start,
      journeyId: plan.id,
      milestone: numbers.get(
        template.deliveries[index].milestoneId ?? milestones[0].id,
      )!,
    }));
    for (const task of generated) {
      if (task.checklist)
        task.checklist = task.checklist
          .filter((c) => c.title.trim())
          .map((c) => ({ ...c, title: c.title.trim() }));
    }
    tasks.push(...generated);
    const end = addDays(start, template.durationDays - 1);
    cycles.push({
      id,
      ...(enrollment ? { enrollmentId: enrollment.id } : {}),
      company: company.slug,
      productId: product.id,
      templateId: template.id,
      productVersion: product.version ?? 1,
      productBaseline: structuredClone(template),
      productOwnerBaseline: company.leadId,
      name: template.name,
      goal: template.goal,
      startsAt: start,
      endsAt: end,
      ownerId: company.leadId,
      status: "planejado",
      taskIds: generated.map((t) => t.id),
      acceptance: template.acceptance.map((text, i) => ({
        id: `${id}-a${i}`,
        text,
        done: false,
      })),
      createdAt: at,
      updatedAt: at,
    });
    start = addDays(end, 1);
  }
  return { plan, cycles, tasks };
}
/** Dates a person edited in the preparation stay between 2000 and 2100; generated ones follow the stored purchase start. */
export function editedDatesError(before: ProductExecution, after: ProductExecution): string | null {
  const edited = (pairs: [string | undefined, string | undefined][]) =>
    pairs.some(([old, next]) => next !== old && !validBoundedDate(next ?? ""));
  return after.cycles.some((c, i) => edited([[before.cycles[i]?.startsAt, c.startsAt], [before.cycles[i]?.endsAt, c.endsAt]])) ||
    after.tasks.some((t, i) => edited([[before.tasks[i]?.startsAt, t.startsAt], [before.tasks[i]?.dueAt, t.dueAt]]))
    ? "Informe datas entre 2000 e 2100." : null;
}
export function executionError(draft: ProductExecution): string | null {
  for (const c of draft.cycles) {
    if (
      !c.name.trim() ||
      !validDate(c.startsAt) ||
      !validDate(c.endsAt) ||
      c.endsAt < c.startsAt
    )
      return "Revise os nomes e as datas dos ciclos.";
    for (const t of draft.tasks.filter((t) => c.taskIds.includes(t.id))) {
      if (
        !t.title.trim() ||
        !validDate(t.startsAt ?? "") ||
        !validDate(t.dueAt) ||
        t.startsAt! > t.dueAt ||
        t.startsAt! < c.startsAt ||
        t.dueAt > c.endsAt
      )
        return `Revise as datas da entrega “${t.title}”; elas devem estar dentro do ciclo.`;
    }
  }
  return null;
}
/** Idempotent provisioning preserves dates, evidence, history and completed work. */
export function applyProduct<
  T extends ExecutionSnapshot & {
    companyJourney: Record<string, string>;
    companyMilestone: Record<string, number>;
  },
>(state: T, draft: ProductExecution): T {
  const issue = executionError(draft);
  if (issue) throw new Error(issue);
  const company = draft.cycles[0]?.company;
  if (!company) throw new Error("O produto não tem ciclos.");
  const existingCycles = [
    ...Object.values(state.cycleEdits),
    ...state.extraCycles,
  ];
  const accepted = draft.cycles.filter(
    (c) =>
      !existingCycles.some(
        (old) =>
          old.company === company &&
          old.productId === c.productId &&
          old.enrollmentId === c.enrollmentId &&
          (old.id === c.id || (c.productId !== undefined && c.templateId !== undefined && old.templateId === c.templateId)),
      ),
  );
  const ids = new Set(accepted.flatMap((c) => c.taskIds));
  return {
    ...state,
    extraCycles: [...state.extraCycles, ...accepted],
    extraTasks: [
      ...state.extraTasks,
      ...draft.tasks.filter(
        (t) =>
          ids.has(t.id) && !state.extraTasks.some((old) => old.id === t.id),
      ),
    ],
    companyJourney: { ...state.companyJourney, [company]: draft.plan.id },
    companyMilestone: {
      ...state.companyMilestone,
      [company]:
        state.companyJourney[company] === draft.plan.id
          ? (state.companyMilestone[company] ?? 1)
          : 1,
    },
  };
}
