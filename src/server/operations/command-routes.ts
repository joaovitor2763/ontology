import { OperationError } from './errors.ts';
import { object, string } from './input.ts';

/**
 * Traduz o caminho e o método REST na operação correspondente e na sua entrada.
 * É só tabela: nenhuma regra de domínio mora aqui, e nada é gravado.
 */
export function commandForRequest(
  method: string,
  path: string[],
  body: Record<string, unknown>,
): { command: string; input: unknown; expectedVersions: Record<string, number> } {
  const [resource, company, child, record] = path;
  let command:string,input:unknown,expectedVersions:Record<string,number>={};
  if(resource==='commands'&&method==='POST') { command=string(body.command,'operação');input=body.input;expectedVersions=(body.expectedVersions===undefined?{}:object(body.expectedVersions)) as Record<string,number>; }
  else if(resource==='alerts'&&company==='acknowledge'){command='alerts.acknowledgeBatch';input=body;}
  else if(resource==='alerts'){command='alerts.acknowledge';input={...body,alertId:company};}
  else if(resource==='workspace'&&company==='settings'&&method==='PATCH'){command='workspace.settings.update';input=body;}
  else if(resource==='members'){command=company==='approve'?'members.approve':method==='PATCH'?'members.update':child==='active'?'members.setActive':'members.create';input=company&&company!=='approve'?{...body,memberId:company}:body;}
  else if(resource==='allocations'){command=company?'allocations.remove':'allocations.save';input=company?{...body,allocationId:company}:body;}
  else if(resource==='knowledge') {
    const action=child==='graph'?'upsert':child==='history'?'restore':child==='layout'?(record==='reset'?'reset':'update'):record?'remove':'save';
    command=`knowledge.${child}.${action}`;input={...body,company,...(record&&['elements','connections'].includes(child)?{[child==='elements'?'nodeId':'edgeId']:record}:{})};
  }
  else if(resource==='documents'){command='documents.'+(method==='PATCH'?'update':child==='versions'?'version':child??'register');input=company?{...body,[child==='versions'?'previousId':'documentId']:company}:body;}
  else if(resource==='inbox'){command=record==='notes'?(method==='POST'?'inbox.notes.create':'inbox.notes.update'):'inbox.thread.update';input={...body,threadId:child,...(path[4]?{noteId:path[4]}:{})};}
  else if(resource==='signals'){command='signals.'+(child==='task'?'createTask':child);input={...body,signalId:company};}
  else if(resource==='program-events'){command='program-events.'+(method==='PATCH'?'update':child??'create');input=company?{...body,eventId:company}:body;}
  else if(['pains','solutions','hypotheses'].includes(resource)) {
    command=resource+'.'+(method==='PATCH'?'update':child==='evidence'?'evidence.add':child??'create');
    input=company?{...body,[resource==='pains'?'painId':resource==='solutions'?'solutionId':'hypothesisId']:company}:body;
  }
  else if(resource==='interactions') {command=method==='PATCH'?'interactions.update':'interactions.create';input=method==='PATCH'?{...body,noteId:company}:body;}
  else if(resource==='products') {command='products.save';input={product:{...object(body.product??body),...(company?{id:company}:{})}};}
  else if(resource==='plans') {command=method==='DELETE'?'plans.remove':child==='publish'?'plans.publish':'plans.save';input=command==='plans.remove'?{planId:company}:command==='plans.publish'?{...body,planId:company}:{plan:{...object(body.plan??body),...(company?{id:company}:{})}};}
  else if(resource==='product-rollouts'&&company==='apply') {command='product-rollouts.apply';input=body;}
  else if(resource==='sales') {command='sales.register';input=body;}
  else if(resource==='clients') {
    if(!company&&method==='POST') {command='clients.create';input=body.client?body:{client:body,config:{}};}
    else if(company&&record&&child==='plans'&&path[4]==='advance') {command='plans.advance';input={...body,company,planId:record};}
    else if(company&&record&&path[4]==='provision'&&method==='POST') {command=child==='enrollments'?'enrollments.provision':'plans.provision';input=child==='enrollments'?{...body,company,enrollmentId:record}:{...body,company,planId:record,enrollmentId:null};}
    else if(company&&child==='enrollments'&&record&&['archive','restore','remove','rebuild'].includes(path[4]??'')&&method==='POST') {command=`enrollments.${path[4]}`;input={company,enrollmentId:record};}
    else if(company&&child==='enrollments'&&method==='POST') {command='enrollments.create';input={...body,company};}
    else if(company&&child==='stakeholders'&&method==='POST') {command='stakeholders.save';input={company,stakeholder:body};}
    else if(company&&child==='participants'&&method==='POST') {command='participants.save';input={...body,company};}
    else if(company&&child==='responsible'&&method==='POST') {command='clients.setResponsible';input={...body,company};}
    else if(company&&child==='archive'&&method==='POST') {command='clients.archive';input={company};}
    else if(company&&child==='restore'&&method==='POST') {command='clients.restore';input={company};}
    else if(company&&!child&&method==='PATCH') {command='clients.configure';input={...body,client:{...object(body.client??body),slug:company}};}
    else if(company&&child==='enrollments'&&record&&method==='PATCH') {command='enrollments.update';input={...body,company,enrollmentId:record};}
    else throw new OperationError(404,'not_found','Operação não encontrada.');
  } else if(resource==='tasks'||resource==='cycles') {
    if(resource==='tasks'&&method==='POST'&&!company){command='tasks.create';input=body;}
    else if(resource==='cycles'&&method==='POST'&&!company){command='cycles.save';input=body;}
    else if(resource==='tasks'&&method==='PATCH'&&company){command='tasks.update';input={taskId:company,patch:body};}
    else if(resource==='cycles'&&method==='PATCH'&&company){command='cycles.save';input={...body,cycleId:company};}
    else if(resource==='cycles'&&method==='DELETE'&&company){command='cycles.remove';input={cycleId:company};}
    else if(resource==='tasks'&&company&&method==='POST'&&['complete','comment','checklist','blocker','remove'].includes(child)){command=`tasks.${child}`;input={...body,taskId:company};}
    else throw new OperationError(404,'not_found','Operação não encontrada.');
  } else if(resource==='meetings') {
    if(method==='POST'&&company==='capture'&&!child) {command='meetings.capture';input=body;}
    else if(method==='PATCH'&&company&&child==='content') {command='meetings.content.update';input={meetingId:company,patch:body};}
    else if(method==='POST'&&!company) {command='meetings.create';input=body.meeting?body:{meeting:body};}
    else if(method==='POST'&&company&&child==='actions'&&record&&['remove','restore'].includes(path[4])) {command=`meetings.actions.${path[4]}`;input={...body,meetingId:company,actionId:record};}
    else if(method==='POST'&&company&&['remove','restore'].includes(child)) {command=`meetings.${child}`;input={...body,meetingId:company};}
    else if(method==='POST'&&company&&child==='actions'&&record&&path[4]==='task') {command='meetings.actions.createTask';input={...body,meetingId:company,actionId:record};}
    else if(method==='POST'&&company&&child==='sync-artifacts') {command='meetings.syncArtifacts';input={...body,meetingId:company};}
    else if(method==='POST'&&company&&child==='sync-responses') {command='meetings.syncResponses';input={...body,meetingId:company};}
    else if(method==='PATCH'&&company) {command='meetings.update';input={meetingId:company,patch:body};}
    else if(method==='POST'&&company&&child==='reschedule') {const {expectedGoogleEtag,...patch}=body;command='meetings.reschedule';input={meetingId:company,patch:body.patch??patch,expectedGoogleEtag};}
    else if(method==='POST'&&company&&child==='cancel') {command='meetings.cancel';input={meetingId:company,expectedGoogleEtag:body.expectedGoogleEtag};}
    else throw new OperationError(404,'not_found','Operação não encontrada.');
  } else throw new OperationError(404,'not_found','Operação não encontrada.');
  return { command, input, expectedVersions };
}
