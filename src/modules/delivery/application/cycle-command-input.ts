import type { ServiceCycle } from '../domain/services.ts';
import type { Delivery } from '../domain/models.ts';

/** Send only intended changes. Current references and audit history stay server-owned. */
export function cycleChanges(current: ServiceCycle, next: ServiceCycle) {
  const patch: Record<string, unknown> = {};
  for (const field of ['name','goal','startsAt','endsAt','ownerId','status','taskIds','milestone'] as const)
    if (JSON.stringify(current[field]) !== JSON.stringify(next[field])) patch[field] = next[field];
  if (JSON.stringify(current.acceptance) !== JSON.stringify(next.acceptance))
    patch.acceptance = next.acceptance.map(({id,text,done,approvedBy,approvedAt,channel,note}) => ({id,text,done,approvedBy,approvedAt:current.acceptance.find(a=>a.id===id)?.approvedAt===approvedAt?undefined:approvedAt,channel,note}));
  if (JSON.stringify(current.debrief) !== JSON.stringify(next.debrief) && next.debrief) {
    const {score,comment,wouldRehire} = next.debrief;
    patch.debrief = {score,comment,wouldRehire};
  }
  return patch;
}

/** Draft refs exist only for this command; real identities are generated atomically. */
export function cycleCopyInput(cycle: ServiceCycle, tasks: Delivery[], sources: Delivery[]) {
  const references = new Map(sources.map((task,index) => [task.id,tasks[index]?.id]));
  return {
    company: cycle.company,
    cycle: {
      name:cycle.name,goal:cycle.goal,startsAt:cycle.startsAt,endsAt:cycle.endsAt,ownerId:cycle.ownerId,status:'planejado',
      productId:cycle.productId,templateId:cycle.templateId,enrollmentId:cycle.enrollmentId,milestone:cycle.milestone,taskIds:[],
      acceptance:cycle.acceptance.map(a=>({text:a.text,done:false})),
    },
    tasks:tasks.map(t=>({
      draftRef:t.id,title:t.title,description:t.description,ownerId:t.ownerId,startsAt:t.startsAt,dueAt:t.dueAt,
      deadline:t.deadline?.mode==='task'&&references.get(t.deadline.taskId)?{...t.deadline,taskId:references.get(t.deadline.taskId)}:t.deadline,
      hours:t.hours,workstream:t.workstream,priority:t.priority,relatedNodeIds:t.relatedNodeIds,origin:t.origin,requestedBy:t.requestedBy,milestone:t.milestone,completion:t.completion,kind:t.kind,
      journeyId:t.journeyId,responsibleRole:t.responsibleRole,party:t.party,assignmentSource:t.assignmentSource,
      requiresEvidence:t.requiresEvidence,approvalRequired:t.approvalRequired,deliverableTemplateId:t.deliverableTemplateId,
      deliverable:t.deliverable,checklist:t.checklist?.map(item=>({title:item.title})),
    })),
  };
}
