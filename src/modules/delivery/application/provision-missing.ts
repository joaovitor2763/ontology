import type { Company } from '../../clients/domain/models.ts';
import type { JourneyTemplate } from '../../catalog/domain/models.ts';
import type { ExecutionSnapshot } from './cycles.ts';
import { applyProduct, type ProductExecution } from './product-execution.ts';
import { provisionPlan } from './plan-execution.ts';

type Selection = { companyJourney: Record<string,string>; companyMilestone: Record<string,number> };
/** Preparation adds absent cycles; existing/removed cycles are deliberate execution, not templates to replace. */
export function provisionMissingProduct<T extends ExecutionSnapshot & Selection>(state:T,draft:ProductExecution):T {
  const next=applyProduct(state,draft);
  const added=next.extraCycles.filter(c=>!state.extraCycles.some(previous=>previous.id===c.id));
  for(const cycle of added) for(const id of cycle.taskIds) {
    if([...state.extraCycles,...Object.values(state.cycleEdits)].some(other=>other.id!==cycle.id&&other.taskIds.includes(id)))
      throw new Error('Uma tarefa já pertence a outro ciclo. Revise a execução antes de preparar.');
  }
  return {...next,companyJourney:state.companyJourney,companyMilestone:state.companyMilestone};
}
export function provisionMissingPlan<T extends ExecutionSnapshot & Selection>(state:T,plan:JourneyTemplate,company:Company,at:string,enrollment?:{id:string;startsAt:string}):T {
  if(!plan.autoCreateCycles) throw new Error('Este plano não possui preparação automática.');
  // Generate each milestone independently: repeated titles or absent template IDs
  // must not collapse distinct cycles while building a new draft.
  const generated=plan.milestones.map(milestone=>provisionPlan({extraTasks:[],extraCycles:[],taskPatches:{},cycleEdits:{},statusMap:{},companyJourney:{},companyMilestone:{}},{...plan,milestones:[milestone]},company,at,enrollment));
  return provisionMissingProduct(state,{plan,cycles:generated.flatMap(s=>s.extraCycles),tasks:generated.flatMap(s=>s.extraTasks)});
}
