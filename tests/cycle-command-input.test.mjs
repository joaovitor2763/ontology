import test from 'node:test';
import assert from 'node:assert/strict';
import { cycleChanges, cycleCopyInput } from '../src/modules/delivery/application/cycle-command-input.ts';
const cycle={id:'cycle',company:'one',productId:'product',enrollmentId:'purchase',name:'Ciclo',goal:'Meta',startsAt:'2026-01-01',endsAt:'2026-01-31',ownerId:'admin',status:'planejado',taskIds:['task'],acceptance:[{id:'criterion',text:'Aceito',done:true,approvedBy:'admin',approvedAt:'2026-01-20T12:00:00Z'}],transitions:[{by:'admin',at:'2026-01-01',status:'planejado'}]};
test('cycle commands send only changes and never stale task references, publication or history',()=>{
 assert.deepEqual(cycleChanges(cycle,{...cycle,status:'em-curso'}),{status:'em-curso'});
 const changed=cycleChanges(cycle,{...cycle,acceptance:[{...cycle.acceptance[0],note:'Confirmado'}]});
 assert.equal(changed.acceptance[0].approvedAt,undefined,'keep original approval timestamp on server');
 assert.equal(cycleChanges(cycle,{...cycle,debrief:{by:'forged',at:'past',score:4,comment:'Bom',wouldRehire:true}}).debrief.by,undefined);
});
test('cycle duplicate maps task deadlines to draft refs and excludes completion or audit state',()=>{
 const task={id:'new-task',company:'one',title:'Tarefa',description:'',dueAt:'2026-02-20',ownerId:'admin',hours:1,workstream:'Entrega',milestone:1,deadline:{mode:'task',taskId:'old-parent',offsetDays:1},comments:[{text:'privado'}],history:[{by:'admin'}],evidence:'old',checklist:[{title:'Revisar',done:true}]};
 const input=cycleCopyInput(cycle,[{...task,id:'new-parent'},task],[{id:'old-parent'},{id:'old-task'}]);
 assert.equal(input.cycle.enrollmentId,'purchase');assert.deepEqual(input.cycle.taskIds,[]);
 assert.equal(input.tasks[1].deadline.taskId,'new-parent');assert.equal(input.tasks[1].history,undefined);assert.equal(input.tasks[1].evidence,undefined);
 assert.deepEqual(input.tasks[1].checklist,[{title:'Revisar'}]);
 assert.deepEqual(input.cycle.acceptance,[{text:'Aceito',done:false}]);
});

test('copy preserves template and editable task context while excluding caller-owned publication claims',()=>{
 const source={id:'old',company:'one',title:'Task',description:'Scope',ownerId:'admin',dueAt:'2026-01-20',hours:3,workstream:'Execution',milestone:1,priority:'critica',relatedNodeIds:['node-1'],origin:'reuniao',requestedBy:'Sponsor',responsibleRole:'lead',party:'equipe',assignmentSource:'papel',requiresEvidence:true,approvalRequired:true,deliverableTemplateId:'document-template',completion:'deliverable',deliverable:'Report',journeyId:'private-plan'};
 const copied=cycleCopyInput({...cycle,templateId:'template',productVersion:999,productBaseline:{name:'Untrusted'}},[{...source,id:'new'}],[source]);
 assert.equal(copied.cycle.templateId,'template');assert.equal(copied.cycle.productVersion,undefined);assert.equal(copied.cycle.productBaseline,undefined);
 for(const field of ['title','description','ownerId','dueAt','hours','workstream','milestone','priority','relatedNodeIds','origin','requestedBy','responsibleRole','party','assignmentSource','requiresEvidence','approvalRequired','deliverableTemplateId','completion','deliverable','journeyId']) assert.deepEqual(copied.tasks[0][field],source[field],field);
});
