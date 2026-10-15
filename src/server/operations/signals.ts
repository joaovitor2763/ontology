import type { ServerEnv } from '../context';
import { getDoc } from '../db.ts';
import { prefetchDocuments } from './request-context.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { canonical, commitOperation, receipt, requestHash } from './transaction.ts';
import { OperationError } from './errors.ts';
import * as v from './input.ts';
import { extractSignals, priorityRank } from '../../modules/engagement/domain/signals.ts';
import type { Signal, Thread, ThreadMessage } from '../../modules/engagement/domain/models.ts';
import { normalizeEngagementSnapshot, resolveSignalReview, reopenSignalReview, type EngagementSnapshot, type SignalReview } from '../../modules/engagement/infrastructure/snapshot.ts';
import { threads as seedThreads } from '../../modules/engagement/infrastructure/seed.ts';
import { people } from '../../modules/workspace/infrastructure/seed.ts';
import type { Person } from '../../modules/workspace/domain/models.ts';
import { NOW, refreshNow, formatDateTime } from '../../shared/lib/format.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
import { projectCatalog } from '../../modules/catalog/infrastructure/snapshot.ts';
import { normalizeDeliverySnapshot, projectDelivery } from '../../modules/delivery/infrastructure/snapshot.ts';
import { deliveryPatchError } from '../../modules/delivery/domain/delivery-policy.ts';
import { recordHistory } from '../../modules/delivery/domain/history.ts';
import type { Delivery } from '../../modules/delivery/domain/models.ts';
import { enrollmentCanReceiveWork } from '../../modules/clients/domain/product-enrollments.ts';
import { activeTaskStatements, clientSnapshotFor, ClientScopeRequiresBridge,
  readActiveCompanySlice } from './delivery-client-task-write.ts';
const KEY='ontology.engagement.v2',RELATIONSHIP='ontology.relationship.v1',CLIENTS='ontology.clients.v3',DELIVERY='ontology.delivery.v2',CATALOG='ontology.catalog.v2';
type Review=SignalReview&{reopenedAt?:string};
type Roster={extraMembers?:Person[];memberEdits?:Record<string,Partial<Person>>};
function derive(relationship:unknown,roster:Roster,state:EngagementSnapshot){
 const raw=(relationship??{}) as {spaces?:Thread[];notes?:Record<string,ThreadMessage[]>},members=[...(roster.extraMembers??[]),...people.filter(p=>p.org==='praxis')].map(p=>({...p,...roster.memberEdits?.[p.id]})),names=members.map(p=>p.name).filter(Boolean);
 const threads=[...(raw.spaces??[]),...seedThreads].map(t=>({...t,messages:[...t.messages,...(raw.notes?.[t.id]??[])]})).filter(t=>['whatsapp','call','email'].includes(t.channel));
 return threads.flatMap(thread=>extractSignals(thread,{now:NOW,isTeam:author=>names.some(name=>author.replace(/\+.*/,'').trim().startsWith(name))}).map(signal=>{
  const review=state.signalReviews[signal.id] as Review|undefined,ai=state.signalClassifications[signal.id];
  // Classification can affect presentation, never the message identity or authorization scope.
  return{...signal,...(ai?{title:typeof ai.title==='string'?ai.title:signal.title,categories:Array.isArray(ai.categories)&&ai.categories.every(c=>['pergunta','risco','compromisso','acao','informacao_faltante','plataforma'].includes(c))?ai.categories:signal.categories,priority:['alta','media','baixa'].includes(ai.priority??'')?ai.priority!:signal.priority,reason:typeof ai.reason==='string'?ai.reason:signal.reason,source:ai.source==='ia'?'ia' as const:signal.source,confidence:typeof ai.confidence==='number'?ai.confidence:undefined}:{}),resolvedAt:review&&!review.reopenedAt?review.at:undefined,resolvedBy:review&&!review.reopenedAt?review.by:undefined,deliveryId:review?.deliveryId};
 }));
}
async function source(env:ServerEnv,principal:OperationPrincipal,company:string,write:boolean){
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');refreshNow();const db=env.DB,workspace=env.WORKSPACE_ID||'default';prefetchDocuments(db,workspace,[CLIENTS,KEY]);const auth=await authorizeOperation(db,workspace,principal,{action:write?'interacoes.registrar':'clientes.ver',scope:write?'engagement:write':'engagement:read',company}),rosterKey=auth.find(g=>g.key.startsWith('ontology.workspace.'))!.key,keys=[KEY,RELATIONSHIP,rosterKey],docs=await Promise.all(keys.map(key=>getDoc(db,workspace,key))),state=normalizeEngagementSnapshot(docs[0]?.value??{}),all=derive(docs[1]?.value,(docs[2]?.value??{}) as Roster,state);return{db,workspace,auth,keys,docs,state,all};
}
function assertUnique(all:Signal[],id:string){if(all.filter(s=>s.id===id).length!==1)throw new OperationError(409,'ambiguous_signal','O identificador corresponde a mensagens diferentes. Revise a origem antes de continuar.');}
/** Reviews and conversion share the same local conversation source as the UI; no remote WhatsApp reads. */
export async function executeSignalCommand(env:ServerEnv,principal:OperationPrincipal,command:string,input:unknown,key:string,expectedVersions:Record<string,number>={},skipActive=false){
 if(!['signals.resolve','signals.reopen','signals.createTask'].includes(command))v.invalid('Operação de sinal inválida.');const raw=v.object(input),company=v.id(raw.company),signalId=v.id(raw.signalId),conversion=command==='signals.createTask';if(Object.keys(raw).some(k=>!['company','signalId',...(conversion?['enrollmentId']:[])].includes(k)))v.invalid('Campo de sinal inválido.');
 let enrollmentId:string|null=null;if(conversion){if(!Object.hasOwn(raw,'enrollmentId'))v.invalid('Escolha a contratação ou sem contratação explicitamente.');enrollmentId=raw.enrollmentId===null?null:v.id(raw.enrollmentId);}
 const ctx=await source(env,principal,company,true),{db,workspace}=ctx,auth=[...ctx.auth,...(conversion?await authorizeOperation(db,workspace,principal,{action:'entregas.editar',scope:'delivery:write',company}):[])],hash=await requestHash(command,input),saved=await receipt(db,workspace,principal.id,key,command,hash);if(saved)return saved.result;
 const signal=ctx.all.find(s=>s.id===signalId&&s.company===company);if(!signal)throw new OperationError(404,'signal_not_found','Sinal não encontrado nesta conversa.');assertUnique(ctx.all,signalId);
 const activeSlice=conversion&&!skipActive?await readActiveCompanySlice(db,workspace,company):null;
 const otherKeys=[CLIENTS,...(conversion?[CATALOG]:[])],otherDocs=await Promise.all(otherKeys.map(name=>getDoc(db,workspace,name)));
 const deliveryDoc=conversion?(activeSlice?{value:activeSlice.snapshot,version:activeSlice.version}:await getDoc(db,workspace,DELIVERY)):null;
 const versions=new Map<string,number>();for(const guard of [...auth,...ctx.keys.map((name,i)=>({key:name,version:ctx.docs[i]?.version??0})),...otherKeys.map((name,i)=>({key:name,version:otherDocs[i]?.version??0})),...(conversion?[{key:DELIVERY,version:deliveryDoc?.version??0}]:[])]){if(versions.has(guard.key)&&versions.get(guard.key)!==guard.version)throw new OperationError(409,'version_conflict','As permissões mudaram.');versions.set(guard.key,guard.version);}for(const [name,version] of Object.entries(expectedVersions)){if(!Number.isSafeInteger(version)||version<0)v.invalid('Versão inválida.');if(versions.has(name)&&versions.get(name)!==version)throw new OperationError(409,'version_conflict','Atualize a conversa antes de continuar.');}
 const clients=projectClients(otherDocs[0]?.value??{}),client=clients.clients.find(c=>c.slug===company);if(!client)throw new OperationError(404,'client_not_found','Cliente ativo não encontrado.');
 const previous=ctx.state.signalReviews[signalId] as Review|undefined,at=new Date().toISOString();let review:Review|undefined=previous,task:Delivery|undefined,existing=false,deliveryState:ReturnType<typeof normalizeDeliverySnapshot>|undefined;
 if(conversion){const enrollment=enrollmentId===null?undefined:clients.enrollments.find(e=>e.id===enrollmentId&&e.company===company);if(enrollmentId&&!enrollment)v.invalid('Contratação não pertence ao cliente.');deliveryState=normalizeDeliverySnapshot(deliveryDoc?.value??{});
  if(previous?.deliveryId){task=projectDelivery(deliveryState,company).tasks.find(t=>t.id===previous.deliveryId);if(!task||(task.enrollmentId??null)!==enrollmentId||(enrollment&&task.productId!==enrollment.productId))throw new OperationError(409,'signal_task_conflict','A tarefa vinculada está ausente ou pertence a outra contratação.');existing=true;}
  else{if(enrollment&&!enrollmentCanReceiveWork(enrollment))v.invalid('A contratação está encerrada ou arquivada.');if(enrollment&&!projectCatalog(otherDocs[1]?.value??{}).products.some(p=>p.id===enrollment.productId))v.invalid('Produto da contratação não encontrado.');const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),due=new Date(`${today}T12:00:00Z`);due.setUTCDate(due.getUTCDate()+(signal.priority==='alta'?2:7));task={id:`d-${crypto.randomUUID()}`,company,title:signal.title.replace(/^[^·]+·\s*/,'').slice(0,120)||'Acompanhar conversa',description:`Origem: conversa de ${formatDateTime(signal.at)}. “${signal.text}”`,status:'fila',ownerId:principal.memberId,dueAt:due.toISOString().slice(0,10),hours:2,workstream:'Relacionamento',milestone:0,completion:'checklist',kind:'journey',origin:'whatsapp',requestedBy:principal.memberId,priority:signal.priority==='alta'?'alta':'media',journeyId:enrollment?enrollment.planId:deliveryState.companyJourney[company]??client.journeyId,...(enrollment?{enrollmentId:enrollment.id,productId:enrollment.productId}:{})};const issue=deliveryPatchError(task);if(issue)v.invalid(issue);task.history=recordHistory({}, {status:task.status,ownerId:task.ownerId,dueAt:task.dueAt},principal.memberId,at);deliveryState={...deliveryState,extraTasks:[...deliveryState.extraTasks,task]};}
 }
 if(command==='signals.reopen'){if(previous&&!previous.reopenedAt)review=reopenSignalReview(previous,at);}
 else if(!previous||previous.reopenedAt||(task&&previous.deliveryId!==task.id)){review=resolveSignalReview(previous,principal.memberId,at,task?.id);}
 const changed=canonical(previous)!==canonical(review),state=changed?{...ctx.state,signalReviews:{...ctx.state.signalReviews,[signalId]:review!}}:ctx.state,created=conversion&&!existing,signalNext={...signal,resolvedAt:review&&!review.reopenedAt?review.at:undefined,resolvedBy:review&&!review.reopenedAt?review.by:undefined,deliveryId:review?.deliveryId};
 const writes=[...(changed?[{key:KEY,value:state}]:[]),...(created&&!activeSlice?[{key:DELIVERY,value:deliveryState}]:[])];
 let statements:D1PreparedStatement[]=[];
 if(activeSlice&&created) try {statements=await activeTaskStatements(db,workspace,activeSlice,deliveryState!,780,command,
  new Set(projectCatalog(otherDocs[1]?.value??{}).journeys.map(journey=>journey.id)));}
 catch(error){if(error instanceof ClientScopeRequiresBridge)
   return executeSignalCommand(env,principal,command,input,key,expectedVersions,true);
  throw error;}
 const guards=[...versions].filter(([name])=>name!==DELIVERY||!activeSlice||existing||expectedVersions[DELIVERY]!==undefined)
  .map(([name,version])=>({key:name,version}));
 return commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash, checked: true,id:crypto.randomUUID(),guards,writes,statements,events:[...(changed?[{type:command,company,subject:signalId}]:[]),...(created?[{type:'task.created',company,subject:task!.id}]:[])],result:{data:{signal:signalNext,review:review??null,...(conversion?{task,existing}:{})},documents:principal.kind==='session'?[{key:KEY,value:state,version:(ctx.docs[0]?.version??0)+(changed?1:0),updatedAt:changed?at:ctx.docs[0]?.updatedAt??at},...(conversion&&!activeSlice?[{key:DELIVERY,value:deliveryState,version:(deliveryDoc?.version??0)+(created?1:0),updatedAt:created?at:new Date().toISOString()}]:[])]:[],...(activeSlice&&created?{clientSnapshot:clientSnapshotFor(activeSlice,activeSlice.revision+1)}:{})}});
}
export async function readSignals(env:ServerEnv,principal:OperationPrincipal,input:{company:string;limit?:number;offset?:number}){
 const company=v.id(input.company),limit=input.limit??50,offset=input.offset??0;if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)v.invalid('Paginação inválida.');const ctx=await source(env,principal,company,false),signals=ctx.all.filter(s=>s.company===company);for(const signal of signals)assertUnique(ctx.all,signal.id);signals.sort((a,b)=>priorityRank(b.priority)-priorityRank(a.priority)||b.at.localeCompare(a.at)||a.id.localeCompare(b.id));return{data:signals.slice(offset,offset+limit),nextOffset:offset+limit<signals.length?offset+limit:null};
}
