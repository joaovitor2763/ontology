import { addDays } from "../../catalog/domain/schedule.ts";
import { toDate } from "../../../shared/lib/dates.ts";
import { mergeTaskOverride } from "../domain/task-overrides.ts";
import type { Delivery } from '../domain/models.ts';
import type { ServiceCycle } from '../domain/services.ts';
import type { DateChange } from './plan-execution.ts';
import { validDate } from './plan-execution.ts';
import { recordHistory } from '../domain/history.ts';
import { enrollmentIsCurrent, type ProductEnrollment } from '../../clients/domain/product-enrollments.ts';

type ScheduleState={extraCycles:ServiceCycle[];cycleEdits:Record<string,ServiceCycle>;taskPatches:Record<string,Partial<Delivery>>};

/** Detects historical execution even when it consists only of standalone tasks. */
export function hasLegacyExecutionForClient(
  execution: { cycles: ServiceCycle[]; tasks: Delivery[] },
  company: string,
  assignedPlanIds: (string | undefined)[],
  purchasedPlanIds: (string | undefined)[],
) {
  return execution.cycles.some((cycle) => cycle.company === company && !cycle.enrollmentId)
    || execution.tasks.some((task) => task.company === company && !task.enrollmentId)
    || (purchasedPlanIds.length === 0 && assignedPlanIds.some(Boolean));
}

/**
 * A marker left by the pre-purchase model must not hide the only current
 * purchased execution. Real unclassified work keeps the explicit legacy
 * selection; multiple purchases remain a user choice.
 */
export function effectiveAssignedPlanId(
  execution: { cycles: ServiceCycle[]; tasks: Delivery[] },
  company: string,
  assignedPlanId: string | undefined,
  purchases: ProductEnrollment[],
) {
  const currentPurchases = purchases
    .filter((purchase) => purchase.company === company && enrollmentIsCurrent(purchase));
  const currentPlanIds = currentPurchases.flatMap((purchase) => purchase.planId ? [purchase.planId] : []);
  if (assignedPlanId && currentPlanIds.includes(assignedPlanId)) return assignedPlanId;
  const hasUnclassifiedWork = execution.cycles.some((cycle) => cycle.company === company && !cycle.enrollmentId)
    || execution.tasks.some((task) => task.company === company && !task.enrollmentId);
  return !hasUnclassifiedWork && currentPurchases.length === 1 ? currentPurchases[0].planId ?? assignedPlanId : assignedPlanId;
}

/** A publication pin belongs to the explicitly assigned plan, never to an inferred replacement. */
export function effectiveAssignedPlanVersion(
  assignedPlanId: string | undefined,
  effectivePlanId: string,
  pinnedVersion: number | undefined,
) {
  return assignedPlanId === effectivePlanId ? pinnedVersion : undefined;
}

/** Progress belongs to the explicitly assigned plan; an inferred replacement starts at its first milestone. */
export function effectiveAssignedMilestone(
  assignedPlanId: string | undefined,
  effectivePlanId: string,
  milestone: number,
) {
  return assignedPlanId === effectivePlanId ? milestone : 1;
}

/** Product-specific legacy choices only exist when historical work identifies that product. */
export function legacyExecutionProductIds(
  execution: { cycles: ServiceCycle[]; tasks: Delivery[] },
  company: string,
) {
  return [...new Set([...execution.cycles, ...execution.tasks]
    .filter((record) => record.company === company && !record.enrollmentId && record.productId)
    .map((record) => record.productId!))];
}

/** An explicit legacy selection wins over any product parameter left by an older URL. */
export function selectedLegacyProduct(requestedId: string, productParam: string | null) {
  return requestedId.startsWith("legacy:") ? requestedId.slice(7) || null : productParam;
}

/** Stale bookmarks must fall back to a real purchase or legacy execution. */
export function selectedExecutionId(
  requested: string | null,
  enrollmentIds: string[],
  fallback: string,
  hasLegacyExecution: boolean,
) {
  if (requested && (enrollmentIds.includes(requested)
    || (hasLegacyExecution && (requested === "__legacy__" || requested.startsWith("legacy:"))))) return requested;
  return fallback;
}

/** Receives only the execution selected for this plan/enrollment. No seed rewriting. */
export function changePlanSchedule<T extends ScheduleState>(state:T, execution:{cycles:ServiceCycle[];tasks:Delivery[]}, changes:{cycles:DateChange[];tasks:DateChange[]}, by:string, at:string):T {
  for(const rows of [changes.cycles,changes.tasks]) {
    if(new Set(rows.map(r=>r.id)).size!==rows.length) throw new Error('Uma data foi informada mais de uma vez.');
    if(rows.some(r=>!validDate(r.startsAt)||!validDate(r.endsAt)||r.startsAt>r.endsAt)) throw new Error('Informe início e fim válidos.');
  }
  const next={...state,extraCycles:[...state.extraCycles],cycleEdits:{...state.cycleEdits},taskPatches:{...state.taskPatches}};
  for(const row of changes.cycles) {
    const previous=execution.cycles.find(c=>c.id===row.id);
    if(!previous) throw new Error('O ciclo não pertence ao plano selecionado.');
    if(previous.status==='concluido'&&(previous.startsAt!==row.startsAt||previous.endsAt!==row.endsAt)) throw new Error('Datas de ciclos concluídos não podem mudar.');
    const saved={...previous,startsAt:row.startsAt,endsAt:row.endsAt,updatedAt:at};
    if(next.extraCycles.some(c=>c.id===row.id)) next.extraCycles=next.extraCycles.map(c=>c.id===row.id?saved:c);
    else next.cycleEdits[row.id]=saved;
  }
  for(const row of changes.tasks) {
    const previous=execution.tasks.find(t=>t.id===row.id);
    if(!previous) throw new Error('A tarefa não pertence ao plano selecionado.');
    if((previous.status==='entregue'||execution.cycles.some(c=>c.status==='concluido'&&c.taskIds.includes(previous.id)))&&((previous.startsAt??previous.dueAt)!==row.startsAt||previous.dueAt!==row.endsAt)) throw new Error('Datas de tarefas concluídas não podem mudar.');
    const patch:Partial<Delivery>={startsAt:row.startsAt,dueAt:row.endsAt,deadline:{mode:'fixed'}};
    next.taskPatches[row.id]=mergeTaskOverride(next.taskPatches[row.id] ?? {}, {...patch,history:[...(previous.history??[]),...recordHistory(previous,patch,by,at)]});
  }
  return next;
}

/** Legacy records without an explicit journey belong only to the client's current assignment.
 * Product identity alone cannot prove which plan owns a historical execution. */
export function selectPlanScheduleExecution(execution:{cycles:ServiceCycle[];tasks:Delivery[]}, planId:string, assignedPlanId:string, enrollmentId?:string) {
  if(enrollmentId) return {cycles:execution.cycles.filter(c=>c.enrollmentId===enrollmentId),tasks:execution.tasks.filter(t=>t.enrollmentId===enrollmentId)};
  if(planId!==assignedPlanId) return {cycles:[],tasks:[]};
  const belongs=(t:Delivery)=>!t.enrollmentId&&(t.journeyId??assignedPlanId)===planId;
  const cycles=execution.cycles.filter(c=>!c.enrollmentId&&c.taskIds.length>0&&c.taskIds.every(id=>execution.tasks.some(t=>t.id===id&&belongs(t))));
  const tasks=execution.tasks.filter(t=>belongs(t)&&!execution.cycles.some(c=>c.taskIds.includes(t.id)&&!cycles.some(selected=>selected.id===c.id)));
  return {cycles,tasks};
}

/** Preview only: shift pending work as one block, preserving its relative spacing. */
export function suggestPlanSchedule(execution:{cycles:ServiceCycle[];tasks:Delivery[]}, startsAt:string) {
  if(!validDate(startsAt)) throw new Error('Informe uma data válida.');
  const {cycles,tasks}=execution;
  const frozen=(task:Delivery)=>task.status==='entregue'||cycles.some(c=>c.status==='concluido'&&c.taskIds.includes(task.id));
  const anchors=[...tasks.filter(t=>!frozen(t)).map(t=>t.startsAt??t.dueAt),...cycles.filter(c=>c.status!=='concluido'&&!c.taskIds.some(id=>tasks.some(t=>t.id===id&&frozen(t)))).map(c=>c.startsAt)].filter(validDate).sort();
  const offset=anchors.length?Math.round((toDate(startsAt).getTime()-toDate(anchors[0]).getTime())/86400000):0;
  const shiftedTasks=tasks.map(t=>({id:t.id,startsAt:!frozen(t)&&validDate(t.startsAt??t.dueAt)?addDays(t.startsAt??t.dueAt,offset):(t.startsAt??t.dueAt),endsAt:!frozen(t)&&validDate(t.dueAt)?addDays(t.dueAt,offset):t.dueAt}));
  const shiftedCycles=cycles.map(c=>{
    if(c.status==='concluido') return {id:c.id,startsAt:c.startsAt,endsAt:c.endsAt};
    const members=shiftedTasks.filter(t=>c.taskIds.includes(t.id));
    const hasCompleted=c.taskIds.some(id=>tasks.some(t=>t.id===id&&frozen(t)));
    const start=hasCompleted?c.startsAt:addDays(c.startsAt,offset);
    const end=hasCompleted?[c.endsAt,...members.map(t=>t.endsAt).filter(Boolean)].sort().at(-1)!:addDays(c.endsAt,offset);
    return {id:c.id,startsAt:[start,...members.map(t=>t.startsAt).filter(Boolean)].sort()[0],endsAt:[end,...members.map(t=>t.endsAt).filter(Boolean)].sort().at(-1)!};
  });
  return {cycles:shiftedCycles,tasks:shiftedTasks};
}
