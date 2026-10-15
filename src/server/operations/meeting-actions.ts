import type { ServerEnv } from '../context';
import { getDoc } from '../db.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { commitOperation, receipt, requestHash, type VersionGuard } from './transaction.ts';
import { OperationError } from './errors.ts';
import * as v from './input.ts';
import { normalizeEngagementSnapshot, projectMeetings, putMeetingSnapshot } from '../../modules/engagement/infrastructure/snapshot.ts';
import { deliveryFromAction, linkAction, withActionIds } from '../../modules/engagement/domain/meetings.ts';
import { normalizeDeliverySnapshot, projectDelivery } from '../../modules/delivery/infrastructure/snapshot.ts';
import { deliveryPatchError } from '../../modules/delivery/domain/delivery-policy.ts';
import { recordHistory } from '../../modules/delivery/domain/history.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
import { projectStakeholders } from '../../modules/clients/infrastructure/stakeholders-snapshot.ts';
import { projectCatalog } from '../../modules/catalog/infrastructure/snapshot.ts';
import { people } from '../../modules/workspace/infrastructure/seed.ts';
import type { Person } from '../../modules/workspace/domain/models.ts';
import type { Delivery } from '../../modules/delivery/domain/models.ts';
import type { Meeting } from '../../modules/engagement/domain/models.ts';
import { enrollmentCanReceiveWork } from '../../modules/clients/domain/product-enrollments.ts';
import { activeTaskStatements, clientSnapshotFor, ClientScopeRequiresBridge,
  readActiveCompanySlice } from './delivery-client-task-write.ts';
const ENGAGEMENT='ontology.engagement.v2',DELIVERY='ontology.delivery.v2',CLIENTS='ontology.clients.v3',CATALOG='ontology.catalog.v2',CONTACTS='ontology.stakeholders.v1';
const COMMAND='meetings.actions.createTask';
async function authorization(db:D1Database,workspace:string,principal:OperationPrincipal,company:string){
 return [...await authorizeOperation(db,workspace,principal,{action:'reunioes.agendar',scope:'meetings:write',company}),...await authorizeOperation(db,workspace,principal,{action:'entregas.editar',scope:'delivery:write',company})];
}
/** Meeting action conversion and its task commit together. Retries never complete work implicitly. */
export async function executeMeetingActionCommand(env:ServerEnv,principal:OperationPrincipal,input:unknown,key:string,expectedVersions:Record<string,number>={},skipActive=false) {
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const db=env.DB,workspace=env.WORKSPACE_ID||'default',raw=v.object(input);
 if(Object.keys(raw).some(k=>!['meetingId','actionId','enrollmentId'].includes(k)))v.invalid('Campo de conversão inválido.');
 const meetingId=v.id(raw.meetingId),actionId=v.id(raw.actionId);
 if(!Object.hasOwn(raw,'enrollmentId'))v.invalid('Escolha explicitamente a contratação ou sem contratação.');
 const enrollmentId=raw.enrollmentId===null?null:v.id(raw.enrollmentId);
 const hash=await requestHash(COMMAND,input),saved=await receipt(db,workspace,principal.id,key,COMMAND,hash);
 if(saved){const result=saved.result as {data:{meeting:Meeting}};await authorization(db,workspace,principal,result.data.meeting.company);return saved.result;}
 const engagementDoc=await getDoc(db,workspace,ENGAGEMENT),engagement=normalizeEngagementSnapshot(engagementDoc?.value??{});
 const found=projectMeetings(engagement).find(m=>m.id===meetingId);if(!found)throw new OperationError(404,'meeting_not_found','Reunião não encontrada.');
 const meeting=withActionIds(found),auth=await authorization(db,workspace,principal,meeting.company);
 if(meeting.cancelledAt)throw new OperationError(409,'meeting_cancelled','A reunião está cancelada.');
 if(meeting.schedulingStatus==='pending'||meeting.schedulingStatus==='uncertain'||await db.prepare("SELECT id FROM meeting_operations WHERE workspace_id=? AND meeting_id=? AND status!='complete'").bind(workspace,meeting.id).first())throw new OperationError(409,'meeting_operation_pending','Conclua a operação pendente da reunião antes de converter uma ação.');
 const action=meeting.actions.find(a=>a.id===actionId&&!a.removedAt);if(!action)throw new OperationError(404,'action_not_found','Ação não encontrada.');
 if(meeting.actions.filter(a=>a.id===actionId).length!==1)v.invalid('As ações precisam ter identificadores únicos.');
 const rosterKey=auth.find(g=>g.key.startsWith('ontology.workspace.'))!.key;
 const activeSlice=skipActive?null:await readActiveCompanySlice(db,workspace,meeting.company);
 const keys=[CLIENTS,CATALOG,CONTACTS,rosterKey];
 const docs=await Promise.all(keys.map(name=>getDoc(db,workspace,name)));
 const [clientsDoc,catalogDoc,contactsDoc,rosterDoc]=docs;
 const deliveryDoc=activeSlice?{value:activeSlice.snapshot,version:activeSlice.version}:await getDoc(db,workspace,DELIVERY);
 const versions=new Map<string,number>();
 for(const guard of [...auth,{key:ENGAGEMENT,version:engagementDoc?.version??0},{key:DELIVERY,version:deliveryDoc?.version??0},...keys.map((name,index)=>({key:name,version:docs[index]?.version??0}))]){
  if(versions.has(guard.key)&&versions.get(guard.key)!==guard.version)throw new OperationError(409,'version_conflict','Os dados ou as permissões mudaram.');versions.set(guard.key,guard.version);
 }
 for(const [name,version] of Object.entries(expectedVersions)){if(!Number.isSafeInteger(version)||version<0)v.invalid('Versão inválida.');if(versions.has(name)&&versions.get(name)!==version)throw new OperationError(409,'version_conflict','Atualize os dados antes de converter.');}
 const clients=projectClients(clientsDoc?.value??{}),client=clients.clients.find(c=>c.slug===meeting.company);
 if(!client)throw new OperationError(404,'client_not_found','Cliente não encontrado ou arquivado.');
 if(meeting.enrollmentIds?.length?enrollmentId===null||!meeting.enrollmentIds.includes(enrollmentId):enrollmentId!==null)v.invalid('Escolha uma contratação vinculada à reunião; sem vínculos, escolha sem contratação.');
 const enrollment=enrollmentId===null?undefined:clients.enrollments.find(e=>e.id===enrollmentId&&e.company===meeting.company);
 if(enrollmentId&&!enrollment)v.invalid('Contratação não pertence ao cliente.');
 const state=normalizeDeliverySnapshot(deliveryDoc?.value??{}),execution=projectDelivery(state,meeting.company);
 function compatible(entity:Pick<Delivery,'company'|'enrollmentId'|'productId'>){return entity.company===meeting.company&&(entity.enrollmentId??null)===enrollmentId&&(!enrollment||entity.productId===enrollment.productId);}
 if(meeting.cycleId){const cycle=execution.cycles.find(c=>c.id===meeting.cycleId);if(!cycle||!compatible(cycle))v.invalid('O ciclo da reunião não corresponde à contratação selecionada.');}
 if(meeting.deliveryId){const task=execution.tasks.find(t=>t.id===meeting.deliveryId);if(!task||!compatible(task))v.invalid('A tarefa da reunião não corresponde à contratação selecionada.');}
 const at=new Date().toISOString();let task:Delivery,updated=meeting,existing=false;
 if(action.deliveryId){const linked=execution.tasks.find(t=>t.id===action.deliveryId);if(!linked||!compatible(linked))throw new OperationError(409,'action_task_conflict','O vínculo da ação está ausente ou não corresponde ao cliente e à contratação.');task=linked;existing=true;}
 else{
  if(enrollment&&!enrollmentCanReceiveWork(enrollment))v.invalid('A contratação está encerrada ou arquivada.');
  if(enrollment&&!projectCatalog(catalogDoc?.value??{}).products.some(p=>p.id===enrollment.productId))v.invalid('Produto da contratação não encontrado.');
  const roster=(rosterDoc?.value??{}) as {extraMembers?:Person[];memberEdits?:Record<string,Partial<Person>>;deactivatedIds?:string[]};
  const members=[...people.filter(p=>p.org==='praxis'),...(roster.extraMembers??[])].map(p=>({...p,...roster.memberEdits?.[p.id]})).filter(p=>!roster.deactivatedIds?.includes(p.id));
  const contacts=projectStakeholders(contactsDoc?.value as Parameters<typeof projectStakeholders>[0]);
  if(!members.some(p=>p.id===action.ownerId)&&!contacts.some(p=>p.id===action.ownerId&&p.company===meeting.company&&p.active))v.invalid('Escolha um responsável ativo da equipe ou deste cliente.');
  if(!action.text.trim()||action.text.length>8000||!/^\d{4}-\d{2}-\d{2}$/.test(action.dueAt))v.invalid('Revise o título e o prazo da ação.');
  task={...deliveryFromAction(meeting,action,`task-${crypto.randomUUID()}`),status:'fila',origin:'reuniao',startsAt:action.dueAt,journeyId:enrollment?enrollment.planId:state.companyJourney[client.slug]??client.journeyId,
   ...(enrollment?{enrollmentId:enrollment.id,productId:enrollment.productId}:{}),requestedBy:principal.memberId};
  const issue=deliveryPatchError(task);if(issue)v.invalid(issue);
  task.history=recordHistory({}, {status:task.status,ownerId:task.ownerId,dueAt:task.dueAt},principal.memberId,at);
  updated={...linkAction(meeting,actionId,task.id),updatedAt:at};state.extraTasks=[...state.extraTasks,task];
 }
 const values=[{key:ENGAGEMENT,value:existing?engagement:putMeetingSnapshot(engagement,updated)},...(!activeSlice?[{key:DELIVERY,value:state}]:[])];
 let statements:D1PreparedStatement[]=[];
 if(activeSlice&&!existing) try {statements=await activeTaskStatements(db,workspace,activeSlice,state,780,COMMAND,
  new Set(projectCatalog(catalogDoc?.value??{}).journeys.map(journey=>journey.id)));}
 catch(error){if(error instanceof ClientScopeRequiresBridge)
   return executeMeetingActionCommand(env,principal,input,key,expectedVersions,true);
  throw error;}
 const guards=[...versions].filter(([name])=>name!==DELIVERY||!activeSlice||existing||expectedVersions[DELIVERY]!==undefined)
  .map(([name,version])=>({key:name,version})) as VersionGuard[];
 return commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command:COMMAND,hash,id:crypto.randomUUID(),guards,writes:existing?[]:values,statements,
 events:existing?[]:[{type:'meeting.action.converted',company:meeting.company,subject:meeting.id,data:{actionId,taskId:task.id}},{type:'task.created',company:meeting.company,subject:task.id}],result:{data:{meeting:updated,task,existing},documents:principal.kind==='session'?values.map(value=>({...value,version:versions.get(value.key)!+(existing?0:1),updatedAt:at})):[],...(activeSlice?{clientSnapshot:clientSnapshotFor(activeSlice,activeSlice.revision+(existing?0:1))}:{})}});
}
