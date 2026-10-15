import type { JourneyTemplate } from "../../catalog/domain/models.ts";
import type { Company } from "../../clients/domain/models.ts";
import type { Delivery } from "../domain/models.ts";
import type { ServiceCycle } from "../domain/services.ts";
import type { ExecutionSnapshot } from "./cycles.ts";

export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}
/** Incoming business dates stay between 2000 and 2100; stored legacy values are only checked when changed. */
export function validBoundedDate(value: string) {
  return validDate(value) && value >= "2000-01-01" && value <= "2100-12-31";
}
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
/** Anchored calendar months clamp the day, including January 31 and leap years. */
export function addMonths(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1, 12));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}
const clean = (value: string) => value.trim().toLocaleLowerCase("pt-BR");
export function planReferenceForDelivery(
  plan: JourneyTemplate,
  task: Pick<Delivery, "baseDeliveryId" | "title">,
) {
  const refs = plan.milestones.flatMap((m) => m.tasks ?? []);
  return (
    refs.find(
      (ref) =>
        ref.id === task.baseDeliveryId ||
        ref.legacyBaseDeliveryIds?.includes(task.baseDeliveryId ?? ""),
    ) ?? refs.find((ref) => clean(ref.title) === clean(task.title))
  );
}
export function provisionPlan<
  T extends ExecutionSnapshot & {
    companyJourney: Record<string, string>;
    companyMilestone: Record<string, number>;
  },
>(state: T, plan: JourneyTemplate, company: Company, at: string, enrollment?: { id: string; startsAt: string }): T {
  if (enrollment) company = { ...company, startedAt: enrollment.startsAt };
  if (!validDate(company.startedAt ?? ""))
    throw new Error("Informe uma data de início válida para o cliente.");
  if (!plan.autoCreateCycles) return state;
  const next: T = {
    ...state,
    extraTasks: [...state.extraTasks],
    extraCycles: [...state.extraCycles],
    taskPatches: { ...state.taskPatches },
    companyJourney: { ...state.companyJourney, [company.slug]: plan.id },
    companyMilestone: {
      ...state.companyMilestone,
      [company.slug]: state.companyMilestone[company.slug] ?? 1,
    },
  };
  // Recognized generated cycles from the old G4 product are consolidated into Kickoff.
  // Keep archived records (including acceptance/debrief) for history; unrelated manual cycles stay intact.
  if (!enrollment && plan.id === "g4-os-founding-companies") {
    const legacy = next.extraCycles.filter(
      (c) =>
        c.company === company.slug &&
        c.productId === plan.productId &&
        !c.removed &&
        ["g4os-pre-onboarding", "g4os-diagnostico"].includes(
          c.templateId ?? "",
        ),
    );
    const kickoff = next.extraCycles.find(
      (c) =>
        c.company === company.slug &&
        c.productId === plan.productId &&
        c.templateId === "g4os-onboarding" &&
        !c.removed,
    );
    if (legacy.length) {
      const kickoffId = kickoff?.id ?? `plan-${company.slug}-${plan.id}-m1`;
      const taskIds = [
        ...new Set([
          ...(kickoff?.taskIds ?? []),
          ...legacy.flatMap((c) => c.taskIds),
        ]),
      ].filter(id => !next.taskPatches[id]?.removed);
      for (const id of taskIds)
        next.taskPatches[id] = {
          ...next.taskPatches[id],
          milestone: 1,
          journeyId: plan.id,
        };
      next.extraCycles = next.extraCycles.map((c) =>
        legacy.some((old) => old.id === c.id) ? { ...c, removed: true } : c,
      );
      const merged: ServiceCycle = {
        ...(kickoff ?? legacy[0]),
        id: kickoffId,
        templateId: "g4os-onboarding",
        milestone: 1,
        removed: false,
        name: kickoff?.name ?? "Kickoff · Mês 1",
        taskIds,
        status:
          kickoff?.status === "concluido" &&
          legacy.some((c) => c.status !== "concluido")
            ? "em-curso"
            : (kickoff?.status ?? "planejado"),
        acceptance: [
          ...(kickoff?.acceptance ?? []),
          ...legacy.flatMap((c) => c.acceptance),
        ],
      };
      next.extraCycles = [
        ...next.extraCycles.filter((c) => c.id !== kickoffId),
        merged,
      ];
    }
  }
  for (const milestone of plan.milestones) {
    if (!milestone.period) continue;
    const cycleId = enrollment
      ? `enrollment-${enrollment.id}-m${milestone.n}`
      : `plan-${company.slug}-${plan.id}-m${milestone.n}`;
    const existing = next.extraCycles.find(
      (c) =>
        c.company === company.slug &&
        c.enrollmentId === enrollment?.id &&
        (c.id === cycleId ||
          (c.productId === plan.productId &&
            c.templateId === milestone.cycleTemplateId)) &&
        !c.removed,
    );
    const id = existing?.id ?? cycleId;
    const startsAt = addMonths(
      company.startedAt!,
      milestone.period.startMonth - 1,
    );
    const endsAt = addDays(
      addMonths(company.startedAt!, milestone.period.endMonth),
      -1,
    );
    const taskIds = (existing?.taskIds ?? []).filter(id => !next.taskPatches[id]?.removed);
    for (const ref of milestone.tasks ?? []) {
      const taskId = `${id}-${ref.id}`;
      // A removed model task stays removed even when the same plan is provisioned again.
      if (next.taskPatches[taskId]?.removed) continue;
      // Reuse completed/customized work from the previous kickoff instead of duplicating it.
      const previous = next.extraTasks.find(
        (t) =>
          t.company === company.slug &&
          t.enrollmentId === enrollment?.id &&
          (t.id === taskId ||
            ((t.productId === plan.productId || t.journeyId === plan.id) &&
              (t.baseDeliveryId === ref.id ||
                ref.legacyBaseDeliveryIds?.includes(t.baseDeliveryId ?? "") ||
                clean(t.title) === clean(ref.title)))),
      );
      if (previous) {
        if (next.taskPatches[previous.id]?.removed) continue;
        const live = { ...previous, ...next.taskPatches[previous.id] };
        if (live.milestone !== milestone.n || live.journeyId !== plan.id)
          next.taskPatches[previous.id] = {
            ...next.taskPatches[previous.id],
            milestone: milestone.n,
            journeyId: plan.id,
          };
        // Manual cycles retain ownership; assignment never links one delivery to two cycles.
        if (
          next.extraCycles.some(
            (c) => c.id !== id && !c.removed && c.taskIds.includes(previous.id),
          )
        )
          continue;
        if (!taskIds.includes(previous.id)) taskIds.push(previous.id);
        continue;
      }
      const period = ref.period ?? milestone.period;
      const start = addMonths(company.startedAt!, period.startMonth - 1);
      const due =
        ref.schedule?.mode === "date" && ref.schedule.base === "inicio"
          ? addDays(company.startedAt!, ref.schedule.offsetDays)
          : addDays(addMonths(company.startedAt!, period.endMonth), -1);
      const task: Delivery = {
        id: taskId,
        ...(enrollment ? { enrollmentId: enrollment.id } : {}),
        company: company.slug,
        productId: plan.productId,
        journeyId: plan.id,
        cycleTemplateId: milestone.cycleTemplateId,
        baseDeliveryId: ref.id,
        title: ref.title,
        description: ref.description,
        status: "fila",
        ownerId: /Customer Success|^CS$|Operações/.test(ref.ownerRole ?? "")
          ? company.csId || company.leadId
          : company.leadId,
        startsAt: start,
        dueAt: due,
        hours: ref.hours,
        workstream: milestone.name,
        milestone: milestone.n,
        completion: ref.completion,
        kind: "journey",
        responsibleRole: ref.ownerRole,
        party: ref.party,
        assignmentSource: "papel",
        requiresEvidence: ref.requiresEvidence,
        approvalRequired: ref.approvalRequired,
        deliverableTemplateId: ref.deliverableTemplateId,
        checklist: ref.checklistItems?.map((title, i) => ({
          id: `${taskId}-c${i + 1}`,
          title,
          done: false,
        })),
      };
      next.extraTasks.push(task);
      taskIds.push(task.id);
    }
    const cycle: ServiceCycle = existing
      ? {
          ...existing,
          milestone: milestone.n,
          taskIds,
          status:
            existing.status === "concluido" &&
            taskIds.length > existing.taskIds.length
              ? "em-curso"
              : existing.status,
        }
      : {
          id,
          ...(enrollment ? { enrollmentId: enrollment.id } : {}),
          company: company.slug,
          productId: plan.productId,
          templateId: milestone.cycleTemplateId,
          name: `${milestone.name} · ${milestone.stage}`,
          goal: milestone.goal ?? milestone.name,
          milestone: milestone.n,
          journeyVersion: plan.version,
          startsAt,
          endsAt,
          ownerId: company.leadId,
          status: "planejado",
          taskIds,
          acceptance: (milestone.exitCriteria ?? []).map((text, i) => ({
            id: `${id}-a${i + 1}`,
            text,
            done: false,
          })),
          createdAt: at,
          updatedAt: at,
        };
    next.extraCycles = [...next.extraCycles.filter((c) => c.id !== id), cycle];
  }
  return next;
}

export type DateChange = { id: string; startsAt: string; endsAt: string };
export function updatePlanDates<T extends ExecutionSnapshot>(
  state: T,
  company: string,
  cycles: DateChange[],
  tasks: DateChange[],
): T {
  for (const row of [...cycles, ...tasks]) {
    if (
      !validDate(row.startsAt) ||
      !validDate(row.endsAt) ||
      row.endsAt < row.startsAt
    )
      throw new Error(
        "Informe início e fim válidos; o fim não pode ser anterior ao início.",
      );
  }
  const stored = (id: string, task: boolean) => {
    if (!task) return state.extraCycles.find((c) => c.id === id);
    const t = state.extraTasks.find((row) => row.id === id), patch = state.taskPatches[id];
    return { startsAt: patch?.startsAt ?? t?.startsAt, endsAt: patch?.dueAt ?? t?.dueAt };
  };
  for (const [rows, task] of [[cycles, false], [tasks, true]] as const)
    for (const row of rows) {
      const before = stored(row.id, task);
      if ((row.startsAt !== before?.startsAt && !validBoundedDate(row.startsAt)) || (row.endsAt !== before?.endsAt && !validBoundedDate(row.endsAt)))
        throw new Error("Informe datas entre 2000 e 2100.");
    }
  const cycleMap = new Map(cycles.map((c) => [c.id, c]));
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const patches = { ...state.taskPatches };
  for (const t of state.extraTasks) {
    const change = taskMap.get(t.id);
    if (change && t.company === company)
      patches[t.id] = {
        ...patches[t.id],
        startsAt: change.startsAt,
        dueAt: change.endsAt,
      };
  }
  return {
    ...state,
    taskPatches: patches,
    extraCycles: state.extraCycles.map((c) => {
      const change = cycleMap.get(c.id);
      return change && c.company === company
        ? { ...c, startsAt: change.startsAt, endsAt: change.endsAt }
        : c;
    }),
  };
}
