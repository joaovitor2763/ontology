import test from "node:test";
import assert from "node:assert/strict";
import { prepareProduct, applyProduct } from "../src/modules/delivery/application/product-execution.ts";
import { provisionPlan } from "../src/modules/delivery/application/plan-execution.ts";
import { removeUntouchedEnrollmentExecution } from "../src/modules/delivery/application/enrollment-lifecycle.ts";
import { normalizeDeliverySnapshot } from "../src/modules/delivery/infrastructure/snapshot.ts";

const product={id:"product",name:"Produto",description:"",version:2,cycles:[{id:"setup",name:"Setup",goal:"Preparar",durationDays:7,acceptance:["Pronto"],deliveries:[{id:"task",title:"Configurar",description:"",day:2,hours:1}]}]};
const company={slug:"client",name:"Cliente",startedAt:"2026-09-01",leadId:"lead"};
const enrollment={id:"purchase",company:"client",productId:"product",productVersion:2,startsAt:"2026-09-01",status:"ativa"};
function execution(){
  const draft=prepareProduct(product,company,"now",{id:enrollment.id,startsAt:enrollment.startsAt});
  const state=applyProduct(normalizeDeliverySnapshot(),draft);
  state.productPlans[draft.plan.id]=draft.plan;
  return {state,draft};
}

test("mistaken untouched purchase removes its private execution and selection",()=>{
  const {state,draft}=execution();
  const next=removeUntouchedEnrollmentExecution(state,{...enrollment,planId:draft.plan.id});
  assert.equal(next.extraCycles.length,0);
  assert.equal(next.extraTasks.length,0);
  assert.equal(next.productPlans[draft.plan.id],undefined);
  assert.equal(next.companyJourney.client,undefined);
});

test("removal selects another purchase and refuses recorded work",()=>{
  const {state,draft}=execution();
  const selected=removeUntouchedEnrollmentExecution(state,{...enrollment,planId:draft.plan.id},"other-plan");
  assert.equal(selected.companyJourney.client,"other-plan");
  state.extraTasks[0].comments=[{id:"comment",text:"Preservar",at:"now",by:"admin"}];
  assert.throws(()=>removeUntouchedEnrollmentExecution(state,{...enrollment,planId:draft.plan.id}),/Cancele-a/);
});

test("removal cannot orphan a surviving task deadline",()=>{
  const {state,draft}=execution();
  const removedTaskId=state.extraTasks[0].id;
  state.extraTasks.push({...state.extraTasks[0],id:"other-task",enrollmentId:"other-purchase",baseDeliveryId:"other",deadline:{mode:"task",taskId:removedTaskId,offsetDays:1}});
  assert.throws(
    ()=>removeUntouchedEnrollmentExecution(state,{...enrollment,planId:draft.plan.id}),
    /referência de prazo/,
  );
  state.extraTasks.pop();
  state.taskPatches["seed-task"]={deadline:{mode:"task",taskId:removedTaskId,offsetDays:1}};
  assert.throws(
    ()=>removeUntouchedEnrollmentExecution(state,{...enrollment,planId:draft.plan.id}),
    /referência de prazo/,
  );
});

test("milestone progress makes the purchase historical even when tasks are pristine",()=>{
  const {state,draft}=execution();
  assert.throws(()=>removeUntouchedEnrollmentExecution(state,{...enrollment,planId:draft.plan.id,milestone:2}),/Cancele-a/);
  assert.throws(()=>removeUntouchedEnrollmentExecution(state,{...enrollment,planId:draft.plan.id,milestoneHistory:[{from:1,to:2,at:"now",by:"admin",pendingTaskIds:[]}]}),/Cancele-a/);
});

test("planned cycles and queued tasks added by people are still customizations",()=>{
  const withCycle=execution();
  withCycle.state.extraCycles.push({...withCycle.state.extraCycles[0],id:"manual-cycle",templateId:undefined,productBaseline:undefined,taskIds:[]});
  assert.throws(()=>removeUntouchedEnrollmentExecution(withCycle.state,{...enrollment,planId:withCycle.draft.plan.id}),/personalizações/);
  const withTask=execution();
  withTask.state.extraTasks.push({...withTask.state.extraTasks[0],id:"manual-task",baseDeliveryId:undefined,cycleTemplateId:undefined});
  assert.throws(()=>removeUntouchedEnrollmentExecution(withTask.state,{...enrollment,planId:withTask.draft.plan.id}),/personalizações/);
});

test("a missing generated cycle is not treated as an untouched execution",()=>{
  const {state,draft}=execution();
  state.extraCycles=[];state.extraTasks=[];
  assert.throws(()=>removeUntouchedEnrollmentExecution(state,{...enrollment,planId:draft.plan.id}),/personalizações/);
});

test("duplicate task IDs never count as a pristine generated cycle",()=>{
  const wide={...product,cycles:[{...product.cycles[0],deliveries:[product.cycles[0].deliveries[0],{...product.cycles[0].deliveries[0],id:"second",title:"Segunda"}]}]};
  const draft=prepareProduct(wide,company,"now",{id:enrollment.id,startsAt:enrollment.startsAt});
  const state=applyProduct(normalizeDeliverySnapshot(),draft);state.productPlans[draft.plan.id]=draft.plan;
  state.extraCycles[0].taskIds=[state.extraTasks[0].id,state.extraTasks[0].id];
  state.extraTasks[1]={...state.extraTasks[0]};
  assert.throws(()=>removeUntouchedEnrollmentExecution(state,{...enrollment,planId:draft.plan.id}),/personalizações/);
});

test("prepared field customizations cannot be discarded by removal or rebuild",()=>{
  const mutations=[
    state=>{state.extraCycles[0].name="Setup ajustado";},
    state=>{state.extraCycles[0].startsAt="2026-09-02";},
    state=>{state.extraTasks[0].title="Configuração ajustada";},
    state=>{state.extraTasks[0].dueAt="2026-09-03";},
    state=>{state.extraCycles[0].ownerId="outro-responsavel";state.extraTasks[0].ownerId="outro-responsavel";},
  ];
  for(const mutate of mutations) {
    const {state,draft}=execution();
    mutate(state);
    assert.throws(()=>removeUntouchedEnrollmentExecution(state,{...enrollment,planId:draft.plan.id}),/personalizações/);
  }
});

test("legacy product copies without an immutable owner baseline are not destroyed",()=>{
  const {state,draft}=execution();
  delete state.extraCycles[0].productOwnerBaseline;
  assert.throws(()=>removeUntouchedEnrollmentExecution(state,{...enrollment,planId:draft.plan.id}),/personalizações/);
});

test("product rollout history cannot be erased by removal or rebuild",()=>{
  for (const recordRollout of [
    state=>{state.extraCycles[0].productUpdates=[{version:3,at:"now",by:"admin"}];},
    state=>{state.extraCycles[0].productVersion=3;},
  ]) {
    const {state,draft}=execution();
    recordRollout(state);
    assert.throws(
      ()=>removeUntouchedEnrollmentExecution(state,{...enrollment,planId:draft.plan.id}),
      /trabalho ou personalizações/,
    );
  }
});

test("untouched execution from the former automatic-plan path can be repaired",()=>{
  const plan={id:"old-private",productId:"product",name:"Plano antigo",description:"",autoCreateCycles:true,milestones:[{n:1,name:"Kickoff",stage:"Mês 1",owner:"Responsável",period:{startMonth:1,endMonth:1},cycleTemplateId:"old-cycle",tasks:[{id:"old-task",title:"Legada",description:"",hours:1,completion:"checklist"}]}]};
  let state=normalizeDeliverySnapshot();state.productPlans[plan.id]=plan;
  state=provisionPlan(state,plan,company,"now",{id:enrollment.id,startsAt:enrollment.startsAt});
  const next=removeUntouchedEnrollmentExecution(state,{...enrollment,planId:plan.id},undefined,company);
  assert.equal(next.extraCycles.length,0);assert.equal(next.extraTasks.length,0);
});

test("customized fields in former automatic-plan execution are preserved",()=>{
  const plan={id:"old-private",productId:"product",name:"Plano antigo",description:"",autoCreateCycles:true,milestones:[{n:1,name:"Kickoff",stage:"Mês 1",owner:"Responsável",period:{startMonth:1,endMonth:1},cycleTemplateId:"old-cycle",exitCriteria:["Aceito"],tasks:[{id:"old-task",title:"Legada",description:"",hours:1,completion:"checklist",checklistItems:["Validar"]}]}]};
  const mutations=[
    state=>{state.extraCycles[0].name="Kickoff personalizado";},
    state=>{state.extraCycles[0].ownerId="outro";state.extraTasks[0].ownerId="outro";},
    state=>{state.extraTasks[0].title="Tarefa personalizada";},
    state=>{state.extraTasks[0].checklist[0].title="Checklist personalizado";},
  ];
  for(const mutate of mutations) {
    let state=normalizeDeliverySnapshot();state.productPlans[plan.id]=plan;
    state=provisionPlan(state,plan,company,"now",{id:enrollment.id,startsAt:enrollment.startsAt});
    mutate(state);
    assert.throws(()=>removeUntouchedEnrollmentExecution(state,{...enrollment,planId:plan.id},undefined,company),/personalizações/);
  }
});
