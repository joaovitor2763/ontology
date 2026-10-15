import type { ProductEnrollment } from "../../clients/domain/product-enrollments.ts";
import type { Company } from "../../clients/domain/models.ts";
import type { JourneyTemplate } from "../../catalog/domain/models.ts";
import { instantiateDeliveries } from "../../catalog/domain/products.ts";
import type { Delivery, DeliveryStatus } from "../domain/models.ts";
import type { ServiceCycle } from "../domain/services.ts";
import type { TaskOverride } from "../domain/task-overrides.ts";
import { plannedStart } from "../domain/delivery-policy.ts";
import { addDays, provisionPlan } from "./plan-execution.ts";

type EnrollmentExecutionState = {
  cycleEdits: Record<string, ServiceCycle>;
  extraCycles: ServiceCycle[];
  statusMap: Record<string, DeliveryStatus>;
  extraTasks: Delivery[];
  taskPatches: Record<string, TaskOverride>;
  productPlans: Record<string, JourneyTemplate>;
  companyJourney: Record<string, string>;
  companyMilestone: Record<string, number>;
  companyJourneyVersion: Record<string, number>;
};

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameIds(actual: string[], expected: string[]) {
  const wanted = new Set(expected);
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && actual.every((id) => wanted.has(id));
}

/**
 * Extra cycles/tasks are the persisted preparation draft itself. Changes made
 * before provisioning do not produce patches, so compare every editable field
 * with the immutable product baseline before allowing destructive cleanup.
 */
function productPreparationIsPristine(
  enrollment: Pick<ProductEnrollment, "id" | "company" | "productId" | "startsAt">,
  plan: JourneyTemplate,
  cycles: ServiceCycle[],
  tasks: Delivery[],
) {
  if (!enrollment.startsAt) return false;
  const templateIds = [...new Set(plan.milestones.flatMap(milestone => milestone.cycleTemplateId ? [milestone.cycleTemplateId] : []))];
  let startsAt = enrollment.startsAt;
  for (const templateId of templateIds) {
    const cycle = cycles.find(row => row.templateId === templateId);
    const baseline = cycle?.productBaseline;
    if (!cycle || !baseline) return false;
    const endsAt = addDays(startsAt, baseline.durationDays - 1);
    if (
      cycle.company !== enrollment.company ||
      cycle.productId !== enrollment.productId ||
      !cycle.productOwnerBaseline ||
      cycle.ownerId !== cycle.productOwnerBaseline ||
      cycle.name !== baseline.name ||
      cycle.goal !== baseline.goal ||
      cycle.startsAt !== startsAt ||
      cycle.endsAt !== endsAt ||
      !sameValue(cycle.acceptance, baseline.acceptance.map((text, index) => ({
        id: `${cycle.id}-a${index}`,
        text,
        done: false,
      })))
    ) return false;

    const generated = instantiateDeliveries(baseline.deliveries, {
      cycleId: cycle.id,
      company: enrollment.company,
      productId: enrollment.productId,
      templateId,
      startsAt,
      clientStartsAt: enrollment.startsAt,
      ownerId: cycle.productOwnerBaseline,
    });
    const planMilestones = plan.milestones.filter(milestone => milestone.cycleTemplateId === templateId);
    const baselineMilestones = baseline.milestones?.length
      ? baseline.milestones
      : [{ id: "resultado", name: baseline.name }];
    const milestoneById = new Map(baselineMilestones.map((milestone, index) => [milestone.id, planMilestones[index]?.n]));
    for (const [index, expected] of generated.entries()) {
      const actual = tasks.find(task => task.id === expected.id);
      const source = baseline.deliveries[index];
      const milestone = milestoneById.get(source.milestoneId ?? baselineMilestones[0].id);
      if (!actual || !sameValue(
        {
          company: actual.company,
          productId: actual.productId,
          cycleTemplateId: actual.cycleTemplateId,
          baseDeliveryId: actual.baseDeliveryId,
          title: actual.title,
          description: actual.description,
          status: actual.status,
          ownerId: actual.ownerId,
          startsAt: plannedStart(actual.startsAt, actual.dueAt),
          dueAt: actual.dueAt,
          deadline: actual.deadline ?? { mode: "fixed" },
          hours: actual.hours,
          workstream: actual.workstream,
          milestone: actual.milestone,
          completion: actual.completion,
          deliverable: actual.deliverable,
          kind: actual.kind,
          journeyId: actual.journeyId,
          enrollmentId: actual.enrollmentId,
          responsibleRole: actual.responsibleRole,
          party: actual.party,
          assignmentSource: actual.assignmentSource,
          requiresEvidence: actual.requiresEvidence,
          approvalRequired: actual.approvalRequired,
          deliverableTemplateId: actual.deliverableTemplateId,
          checklist: actual.checklist?.map(item => ({ title: item.title, done: item.done })),
        },
        {
          company: expected.company,
          productId: expected.productId,
          cycleTemplateId: expected.cycleTemplateId,
          baseDeliveryId: expected.baseDeliveryId,
          title: expected.title,
          description: expected.description,
          status: expected.status,
          ownerId: expected.ownerId,
          startsAt: plannedStart(startsAt, expected.dueAt),
          dueAt: expected.dueAt,
          deadline: expected.deadline ?? { mode: "fixed" },
          hours: expected.hours,
          workstream: expected.workstream,
          milestone,
          completion: expected.completion,
          deliverable: expected.deliverable,
          kind: expected.kind,
          journeyId: plan.id,
          enrollmentId: enrollment.id,
          responsibleRole: expected.responsibleRole,
          party: expected.party,
          assignmentSource: expected.assignmentSource,
          requiresEvidence: expected.requiresEvidence,
          approvalRequired: expected.approvalRequired,
          deliverableTemplateId: expected.deliverableTemplateId,
          checklist: expected.checklist?.map(item => ({ title: item.title.trim(), done: false })),
        },
      )) return false;
    }
    startsAt = addDays(endsAt, 1);
  }
  return true;
}

function automaticPlanPreparationIsPristine(
  enrollment: Pick<ProductEnrollment, "id" | "company" | "startsAt">,
  plan: JourneyTemplate,
  cycles: ServiceCycle[],
  tasks: Delivery[],
  company: Company | undefined,
) {
  if (!company || !enrollment.startsAt) return false;
  const expected = provisionPlan<EnrollmentExecutionState>({
    cycleEdits: {},
    extraCycles: [],
    statusMap: {},
    extraTasks: [],
    taskPatches: {},
    companyJourney: {},
    companyMilestone: {},
    productPlans: {},
    companyJourneyVersion: {},
  }, plan, company, "baseline", { id: enrollment.id, startsAt: enrollment.startsAt });
  if (expected.extraCycles.length !== cycles.length || expected.extraTasks.length !== tasks.length) return false;
  for (const baseline of expected.extraCycles) {
    const actual = cycles.find(cycle => cycle.id === baseline.id);
    if (!actual || !sameValue(
      {
        enrollmentId: actual.enrollmentId,
        company: actual.company,
        productId: actual.productId,
        templateId: actual.templateId,
        name: actual.name,
        goal: actual.goal,
        milestone: actual.milestone,
        journeyVersion: actual.journeyVersion,
        startsAt: actual.startsAt,
        endsAt: actual.endsAt,
        ownerId: actual.ownerId,
        status: actual.status,
        taskIds: actual.taskIds,
        acceptance: actual.acceptance,
      },
      {
        enrollmentId: baseline.enrollmentId,
        company: baseline.company,
        productId: baseline.productId,
        templateId: baseline.templateId,
        name: baseline.name,
        goal: baseline.goal,
        milestone: baseline.milestone,
        journeyVersion: baseline.journeyVersion,
        startsAt: baseline.startsAt,
        endsAt: baseline.endsAt,
        ownerId: baseline.ownerId,
        status: baseline.status,
        taskIds: baseline.taskIds,
        acceptance: baseline.acceptance,
      },
    )) return false;
  }
  for (const baseline of expected.extraTasks) {
    const actual = tasks.find(task => task.id === baseline.id);
    if (!actual || !sameValue(
      {
        enrollmentId: actual.enrollmentId,
        company: actual.company,
        productId: actual.productId,
        journeyId: actual.journeyId,
        cycleTemplateId: actual.cycleTemplateId,
        baseDeliveryId: actual.baseDeliveryId,
        title: actual.title,
        description: actual.description,
        status: actual.status,
        ownerId: actual.ownerId,
        startsAt: plannedStart(actual.startsAt, actual.dueAt),
        dueAt: actual.dueAt,
        deadline: actual.deadline ?? { mode: "fixed" },
        hours: actual.hours,
        workstream: actual.workstream,
        milestone: actual.milestone,
        completion: actual.completion,
        deliverable: actual.deliverable,
        kind: actual.kind,
        responsibleRole: actual.responsibleRole,
        party: actual.party,
        assignmentSource: actual.assignmentSource,
        requiresEvidence: actual.requiresEvidence,
        approvalRequired: actual.approvalRequired,
        deliverableTemplateId: actual.deliverableTemplateId,
        checklist: actual.checklist?.map(item => ({ title: item.title, done: item.done })),
      },
      {
        enrollmentId: baseline.enrollmentId,
        company: baseline.company,
        productId: baseline.productId,
        journeyId: baseline.journeyId,
        cycleTemplateId: baseline.cycleTemplateId,
        baseDeliveryId: baseline.baseDeliveryId,
        title: baseline.title,
        description: baseline.description,
        status: baseline.status,
        ownerId: baseline.ownerId,
        startsAt: plannedStart(baseline.startsAt, baseline.dueAt),
        dueAt: baseline.dueAt,
        deadline: baseline.deadline ?? { mode: "fixed" },
        hours: baseline.hours,
        workstream: baseline.workstream,
        milestone: baseline.milestone,
        completion: baseline.completion,
        deliverable: baseline.deliverable,
        kind: baseline.kind,
        responsibleRole: baseline.responsibleRole,
        party: baseline.party,
        assignmentSource: baseline.assignmentSource,
        requiresEvidence: baseline.requiresEvidence,
        approvalRequired: baseline.approvalRequired,
        deliverableTemplateId: baseline.deliverableTemplateId,
        checklist: baseline.checklist?.map(item => ({ title: item.title, done: item.done })),
      },
    )) return false;
  }
  return true;
}

/**
 * A mistaken purchase may be removed only while its generated execution is
 * still pristine. Cancellation/archiving cover every real historical case.
 */
export function removeUntouchedEnrollmentExecution<T extends EnrollmentExecutionState>(
  state: T,
  enrollment: Pick<ProductEnrollment, "id" | "company" | "productId" | "productVersion" | "startsAt" | "planId" | "milestone" | "milestoneHistory">,
  replacementPlanId?: string,
  legacyCompany?: Company,
  retainedPlanIds: ReadonlySet<string> = new Set(),
): T {
  const cycles = state.extraCycles.filter(
    (cycle) => cycle.enrollmentId === enrollment.id,
  );
  const tasks = state.extraTasks.filter(
    (task) => task.enrollmentId === enrollment.id,
  );
  const taskIds = new Set(tasks.map((task) => task.id));
  const cycleIds = new Set(cycles.map((cycle) => cycle.id));
  const editedCycles = Object.values(state.cycleEdits).filter(
    (cycle) => cycle.enrollmentId === enrollment.id,
  );
  const generatedPlanId = enrollment.planId;
  const privatePlan = generatedPlanId ? state.productPlans[generatedPlanId] : undefined;
  const expectedProductCycleIds = new Set((privatePlan?.milestones ?? []).flatMap(milestone => milestone.cycleTemplateId ? [`${generatedPlanId}-${milestone.cycleTemplateId}`] : []));
  const productGeneratedCycles = Boolean(generatedPlanId) && expectedProductCycleIds.size === cycles.length && cycles.every(cycle =>
    expectedProductCycleIds.has(cycle.id) &&
    Boolean(cycle.templateId) &&
    Boolean(cycle.productBaseline) &&
    cycle.id === `${generatedPlanId}-${cycle.templateId}` &&
    sameIds(cycle.taskIds, cycle.productBaseline!.deliveries.map(delivery => `${cycle.id}-${delivery.id}`))
  );
  const productGeneratedTasks = tasks.length === cycles.reduce((count, cycle) => count + (cycle.productBaseline?.deliveries.length ?? 0), 0) && tasks.every(task => {
    const owner = cycles.find(cycle => cycle.taskIds.includes(task.id));
    return Boolean(
      owner &&
      task.baseDeliveryId &&
      task.cycleTemplateId === owner.templateId &&
      task.id === `${owner.id}-${task.baseDeliveryId}`,
    );
  });
  const plannedMilestones = privatePlan?.autoCreateCycles ? privatePlan.milestones.filter(milestone => milestone.period) : [];
  const planGeneratedCycles = Boolean(privatePlan?.autoCreateCycles) && cycles.length === plannedMilestones.length && cycles.every(cycle => {
    const milestone = plannedMilestones.find(row => row.n === cycle.milestone);
    return Boolean(milestone && cycle.id === `enrollment-${enrollment.id}-m${milestone.n}` && sameIds(
      cycle.taskIds,
      (milestone.tasks ?? []).map(task => `${cycle.id}-${task.id}`),
    ));
  });
  const planGeneratedTasks = tasks.length === plannedMilestones.reduce((count, milestone) => count + (milestone.tasks?.length ?? 0), 0) && tasks.every(task => {
    const owner = cycles.find(cycle => cycle.taskIds.includes(task.id));
    const milestone = owner && plannedMilestones.find(row => row.n === owner.milestone);
    return Boolean(owner && milestone?.tasks?.some(reference => reference.id === task.baseDeliveryId && task.id === `${owner.id}-${reference.id}`));
  });
  const generatedStructure = (
    productGeneratedCycles &&
    productGeneratedTasks &&
    Boolean(privatePlan) &&
    productPreparationIsPristine(enrollment, privatePlan!, cycles, tasks)
  ) || (
    planGeneratedCycles &&
    planGeneratedTasks &&
    Boolean(privatePlan) &&
    automaticPlanPreparationIsPristine(enrollment, privatePlan!, cycles, tasks, legacyCompany)
  );
  if (
    !generatedStructure ||
    (enrollment.milestone ?? 1) > 1 ||
    Boolean(enrollment.milestoneHistory?.length) ||
    editedCycles.length ||
    cycles.some(
      (cycle) =>
        cycle.status !== "planejado" ||
        cycle.removed ||
        Boolean(cycle.productUpdates?.length) ||
        (cycle.productVersion !== undefined &&
          enrollment.productVersion !== undefined &&
          cycle.productVersion !== enrollment.productVersion) ||
        Boolean(cycle.debrief) ||
        Boolean(cycle.acceptance.some((criterion) => criterion.done)),
    ) ||
    tasks.some(
      (task) =>
        (state.statusMap[task.id] ?? task.status) !== "fila" ||
        Boolean(task.history?.length) ||
        Boolean(task.comments?.length) ||
        Boolean(task.evidence) ||
        Boolean(task.effortActual) ||
        Boolean(task.blocker) ||
        Boolean(task.checklist?.some((item) => item.done)) ||
        Boolean(state.taskPatches[task.id]),
    )
  )
    throw new Error(
      "A contratação já possui trabalho ou personalizações. Cancele-a para preservar o histórico.",
    );

  const referencesRemovedTask = (deadline: Delivery["deadline"] | undefined) =>
    deadline?.mode === "task" && taskIds.has(deadline.taskId);
  const survivingTaskDependsOnRemoved = state.extraTasks.some((task) => {
    if (taskIds.has(task.id)) return false;
    const patch = state.taskPatches[task.id];
    const deadline = patch && Object.hasOwn(patch, "deadline")
      ? patch.deadline
      : task.deadline;
    return referencesRemovedTask(deadline);
  }) || Object.entries(state.taskPatches).some(([id, patch]) =>
    !taskIds.has(id)
    && !state.extraTasks.some((task) => task.id === id)
    && referencesRemovedTask(patch.deadline),
  );
  if (survivingTaskDependsOnRemoved)
    throw new Error(
      "Outra tarefa usa esta execução como referência de prazo. Remova a dependência antes de excluir ou recriar a contratação.",
    );

  const productPlans = { ...state.productPlans };
  if (enrollment.planId && enrollment.planId !== replacementPlanId && !retainedPlanIds.has(enrollment.planId))
    delete productPlans[enrollment.planId];
  const companyJourney = { ...state.companyJourney };
  const companyMilestone = { ...state.companyMilestone };
  const companyJourneyVersion = { ...state.companyJourneyVersion };
  if (
    enrollment.planId &&
    companyJourney[enrollment.company] === enrollment.planId
  ) {
    if (replacementPlanId) {
      companyJourney[enrollment.company] = replacementPlanId;
      companyMilestone[enrollment.company] = 1;
    } else {
      delete companyJourney[enrollment.company];
      delete companyMilestone[enrollment.company];
    }
    delete companyJourneyVersion[enrollment.company];
  }
  return {
    ...state,
    extraCycles: state.extraCycles.filter((cycle) => !cycleIds.has(cycle.id)),
    extraTasks: state.extraTasks.filter((task) => !taskIds.has(task.id)),
    statusMap: Object.fromEntries(
      Object.entries(state.statusMap).filter(([id]) => !taskIds.has(id)),
    ),
    taskPatches: Object.fromEntries(
      Object.entries(state.taskPatches).filter(([id]) => !taskIds.has(id)),
    ),
    productPlans,
    companyJourney,
    companyMilestone,
    companyJourneyVersion,
  };
}
