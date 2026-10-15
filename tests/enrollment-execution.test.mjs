import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareProduct, applyProduct } from '../src/modules/delivery/application/product-execution.ts';
import { provisionPlan } from '../src/modules/delivery/application/plan-execution.ts';
import { scheduledExecution } from '../src/modules/delivery/application/task-deadlines.ts';
const company = { slug:'demo', startedAt:'2020-01-01', leadId:'lead' };
const product = { id:'p', name:'Produto', description:'', version:2, cycles:[{id:'c',name:'Ciclo',goal:'Resultado',durationDays:14,acceptance:['Aceito'],deliveries:[{id:'t',title:'Fazer',description:'',day:3,hours:1,deadline:{mode:'client',offsetDays:2}}]}] };
const empty = () => ({extraTasks:[],extraCycles:[],taskPatches:{},cycleEdits:{},statusMap:{},companyJourney:{},companyMilestone:{}});
test('two purchases of the same product have independent plans, dates and task IDs', () => {
  const first = prepareProduct(product, company, 'now', {id:'one',startsAt:'2026-01-01'});
  const second = prepareProduct(product, company, 'now', {id:'two',startsAt:'2026-04-01'});
  assert.notEqual(first.plan.id, second.plan.id);
  assert.notEqual(first.tasks[0].id, second.tasks[0].id);
  let state = applyProduct(empty(), first);
  state.extraTasks[0].status = 'entregue';
  state.extraTasks[0].evidence = 'preserved';
  state = applyProduct(state, second);
  assert.equal(state.extraCycles.length, 2);
  assert.equal(state.extraTasks[0].evidence, 'preserved');
  assert.equal(state.extraTasks[1].startsAt, '2026-04-01');
  assert.deepEqual(applyProduct(state, second), state);
});
test('new calendar-based purchase never consolidates or reuses legacy execution', () => {
  const plan = {id:'g4-os-founding-companies',productId:'p',name:'Plano',autoCreateCycles:true,milestones:[{n:1,name:'Kickoff',stage:'Mês 1',period:{startMonth:1,endMonth:1},cycleTemplateId:'g4os-onboarding',tasks:[{id:'t',title:'Fazer',hours:1}]}]};
  const legacy = provisionPlan(empty(), plan, {...company,startedAt:'2025-01-31'},'now');
  legacy.extraTasks[0].status='entregue';
  const copy = structuredClone(legacy);
  const state = provisionPlan(legacy, {...plan,id:'enrollment-new'}, company, 'now', {id:'new',startsAt:'2026-01-31'});
  assert.equal(state.extraCycles.length,2);
  assert.equal(state.extraTasks.length,2);
  assert.deepEqual(state.extraTasks[0],copy.extraTasks[0]);
  assert.equal(state.extraCycles[1].startsAt,'2026-01-31');
  assert.equal(state.extraCycles[1].endsAt,'2026-02-27');
  assert.equal(state.extraTasks[1].enrollmentId,'new');
  assert.deepEqual(provisionPlan(state,{...plan,id:'enrollment-new'},company,'now',{id:'new',startsAt:'2026-01-31'}),state);
});

test('reprojection uses each purchase start and preserves finished dates', () => {
  const first = prepareProduct(product,company,'now',{id:'one',startsAt:'2026-01-01'});
  const second = prepareProduct(product,company,'now',{id:'two',startsAt:'2026-04-01'});
  const state = applyProduct(applyProduct(empty(), first), second);
  state.extraTasks[0].status='entregue';
  const projected = scheduledExecution(state,state.extraTasks,state.extraCycles,{demo:'2020-01-01'},{one:'2026-02-01',two:'2026-05-01'});
  assert.equal(projected.taskPatches[first.tasks[0].id],undefined);
  assert.equal(projected.taskPatches[second.tasks[0].id].dueAt,'2026-05-03');
  assert.throws(() => scheduledExecution(state,state.extraTasks,state.extraCycles,{demo:'2020-01-01'}));
});
