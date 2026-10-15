import type { ServerEnv } from '../context';
import { getDoc } from '../db.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { commitOperation, receipt, requestHash } from './transaction.ts';
import { mergeGuards, customized } from './commercial.ts';
import { OperationError } from './errors.ts';
import * as v from './input.ts';
import { normalizeClientsSnapshot, projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
import { normalizeCatalogSnapshot, projectCatalog, resolveClientJourney } from '../../modules/catalog/infrastructure/snapshot.ts';
import { normalizeDeliverySnapshot, projectDelivery } from '../../modules/delivery/infrastructure/snapshot.ts';
import { prepareProduct } from '../../modules/delivery/application/product-execution.ts';
import { provisionMissingPlan, provisionMissingProduct } from '../../modules/delivery/application/provision-missing.ts';
import { validDate } from '../../modules/delivery/application/plan-execution.ts';
import { enrollmentCanReceiveWork } from '../../modules/clients/domain/product-enrollments.ts';
import { activeTaskStatements, clientSnapshotFor, ClientScopeRequiresBridge,
  readActiveCompanySlice } from './delivery-client-task-write.ts';
import { partitionClientDelivery } from '../delivery-client-slices.ts';
import { unclaimedPrivatePlan } from './delivery-client-plan-claims.ts';
const CLIENTS='ontology.clients.v3',CATALOG='ontology.catalog.v2',DELIVERY='ontology.delivery.v2';
export async function executeProvisionCommand(env:ServerEnv,principal:OperationPrincipal,command:string,input:unknown,key:string,expectedVersions:Record<string,number>={},skipActive=false) {
 if(!['enrollments.provision','plans.provision'].includes(command)) throw new OperationError(404,'unknown_command','Operação não encontrada.');
 if(!env.DB) throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const db=env.DB,workspace=env.WORKSPACE_ID||'default',raw=v.object(input),company=v.id(raw.company),purchase=command==='enrollments.provision';
 if(Object.keys(raw).some(k=>!(purchase?['company','enrollmentId','prepared']:['company','planId','enrollmentId']).includes(k))) v.invalid('Campos de preparação inválidos.');
 const enrollmentId=purchase?v.id(raw.enrollmentId):undefined;
 if(!purchase&&raw.enrollmentId!==null) v.invalid('Selecione explicitamente a execução sem contratação.');
 let guards=await authorizeOperation(db,workspace,principal,{action:'plano.editar',scope:purchase?'enrollments:write':'delivery:write',company});
 guards=mergeGuards(guards,await authorizeOperation(db,workspace,principal,{action:'ciclos.editar',scope:'delivery:write',company}));
 const hash=await requestHash(command,input),saved=await receipt(db,workspace,principal.id,key,command,hash);
 if(saved) return saved.result;
 const activeSlice=skipActive?null:await readActiveCompanySlice(db,workspace,company);
 const keys=[CLIENTS,CATALOG,DELIVERY],docs=await Promise.all(keys.map(name=>name===DELIVERY&&activeSlice
  ? Promise.resolve({value:activeSlice.snapshot,version:activeSlice.version}) : getDoc(db,workspace,name)));
 guards=mergeGuards(guards,keys.map((key,i)=>({key,version:docs[i]?.version??0})));
 for(const [key,version] of Object.entries(expectedVersions)) {
  if(!Number.isSafeInteger(version)||version<0) v.invalid('Versão inválida.');
  if(guards.some(g=>g.key===key&&g.version!==version)) throw new OperationError(409,'version_conflict','Atualize os dados antes de preparar.');
 }
 let clients=normalizeClientsSnapshot(docs[0]?.value??{});
 const catalog=normalizeCatalogSnapshot(docs[1]?.value??{}),state=normalizeDeliverySnapshot(docs[2]?.value??{});
 const client=projectClients(clients).allClients.find(c=>c.slug===company);
 if(!client) throw new OperationError(404,'client_not_found','Cliente não encontrado.');
 const at=new Date().toISOString(),before=projectDelivery(state,company);
 let next=state,planId:string,clientChanged=false;
 try {
  if(purchase) {
   const enrollment=clients.enrollments.find(e=>e.id===enrollmentId&&e.company===company);
   if(!enrollment) v.invalid('Contratação não pertence ao cliente.');
   if(!enrollmentCanReceiveWork(enrollment)) v.invalid('Prepare somente contratações ativas ou planejadas e não arquivadas.');
   if(!validDate(enrollment.startsAt??'')||enrollment.productVersion===undefined) v.invalid('Classifique a data e a versão histórica desta contratação antes de preparar.');
   const context={id:enrollment.id,startsAt:enrollment.startsAt!};
   const privatePlan=enrollment.planId?state.productPlans[enrollment.planId]:undefined;
   if(privatePlan&&privatePlan.productId!==enrollment.productId) v.invalid('O plano privado não corresponde ao produto contratado.');
   if(privatePlan?.autoCreateCycles) {
    if(raw.prepared!==undefined) v.invalid('A preparação deste plano usa a cópia automática da contratação.');
    next=provisionMissingPlan(state,privatePlan,client,at,context);planId=privatePlan.id;
   } else {
    const head=projectCatalog(catalog).products.find(p=>p.id===enrollment.productId);
    const product=catalog.productVersions[enrollment.productId]?.find(p=>p.version===enrollment.productVersion)?.snapshot??((head?.version??1)===enrollment.productVersion?head:undefined);
    if(!product||product.id!==enrollment.productId) v.invalid('A versão contratada não está disponível; não é seguro usar o catálogo atual.');
    if(enrollment.legacy) v.invalid('Classifique a execução legada antes de materializar novos ciclos nesta contratação.');
    if(!privatePlan&&projectCatalog(catalog).journeys.some(p=>p.productId===product.id&&p.autoCreateCycles)) v.invalid('O plano automático histórico desta contratação não está disponível.');
    const draft=customized(prepareProduct(product,client,at,context),raw.prepared);
    if(enrollment.planId&&enrollment.planId!==draft.plan.id) v.invalid('O plano privado usa uma identidade histórica diferente. Revise a contratação.');
    next=provisionMissingProduct(state,draft);planId=draft.plan.id;
    next={...next,productPlans:{...next.productPlans,[planId]:privatePlan??draft.plan}};
   }
   if(enrollment.planId!==planId) {clients={...clients,enrollments:clients.enrollments.map(e=>e.id===enrollment.id?{...e,planId}:e)};clientChanged=true;}
  } else {
   planId=v.id(raw.planId);
   if(Object.values(clients.enrollments).some(e=>e.company===company&&e.planId===planId)) v.invalid('Este plano pertence a uma contratação; selecione a contratação.');
   const plan=resolveClientJourney(catalog,state,client);
   if(plan.productId) v.invalid('Planos de produto exigem uma contratação identificada. Use a preparação da contratação.');
   if(plan.id!==planId||state.productPlans[planId]) v.invalid('Selecione o plano legado atribuído ao cliente.');
   next=provisionMissingPlan(state,plan,client,at);
  }
 } catch(error) {if(error instanceof OperationError) throw error;throw new OperationError(422,'invalid_preparation',error instanceof Error?error.message:'Preparação inválida.');}
 const after=projectDelivery(next,company),cycles=after.cycles.filter(c=>!before.cycles.some(p=>p.id===c.id)).map(c=>c.id),tasks=after.tasks.filter(t=>!before.tasks.some(p=>p.id===t.id)).map(t=>t.id);
 const changed=JSON.stringify(state)!==JSON.stringify(next);
 let statements:D1PreparedStatement[]=[];
 let activeClientDelivery=false;
 const newPrivatePlan=purchase&&changed&&
  !Object.hasOwn(state.productPlans,planId)&&Object.hasOwn(next.productPlans,planId);
 let certifiedNewPlan=false;
 if(activeSlice&&(clientChanged||newPrivatePlan)) {
  const partition=partitionClientDelivery(next,clients.enrollments.filter(enrollment=>enrollment.company===company));
  const existingClaim=clients.enrollments.some(enrollment=>
   enrollment.id!==enrollmentId&&enrollment.planId===planId);
  const publicCollision=projectCatalog(catalog).journeys.some(journey=>journey.id===planId);
  if(!newPrivatePlan||existingClaim||publicCollision||partition.unassigned.length||
    partition.sharedPlanIds.length||partition.slices.some(slice=>slice.company!==company)||
    !await unclaimedPrivatePlan(db,workspace,company,planId,activeSlice.version))
   return executeProvisionCommand(env,principal,command,input,key,expectedVersions,true);
  try {
   statements=await activeTaskStatements(db,workspace,activeSlice,next,780,command,
    new Set([planId]),false,clientChanged?docs[0]!.version:undefined,!clientChanged);
   activeClientDelivery=clientChanged;
   certifiedNewPlan=true;
  } catch(error) {
   if(error instanceof ClientScopeRequiresBridge)
    return executeProvisionCommand(env,principal,command,input,key,expectedVersions,true);
   throw error;
  }
 } else if(activeSlice&&changed) try {statements=await activeTaskStatements(db,workspace,activeSlice,next,780,command,
  new Set(projectCatalog(catalog).journeys.map(journey=>journey.id)));}
 catch(error){if(error instanceof ClientScopeRequiresBridge)
   return executeProvisionCommand(env,principal,command,input,key,expectedVersions,true);
  throw error;}
 const writes=[...(changed&&!activeSlice?[{key:DELIVERY,value:next}]:[]),...(clientChanged?[{key:CLIENTS,value:clients}]:[])];
 const commitGuards=guards.filter(guard=>guard.key!==DELIVERY||!activeSlice||!changed||
  activeClientDelivery||certifiedNewPlan||expectedVersions[DELIVERY]!==undefined);
 return commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash, checked: true,id:crypto.randomUUID(),guards:commitGuards,writes,statements,activeClientDelivery,events:changed||clientChanged?[{type:purchase?'enrollment.provisioned':'plan.provisioned',company,subject:enrollmentId??planId}]:[],result:{data:{company,enrollmentId:enrollmentId??null,planId,cycles,tasks},documents:principal.kind==='session'?writes.map(w=>({...w,version:guards.find(g=>g.key===w.key)!.version+1,updatedAt:at})):[],...(activeSlice&&changed?{clientSnapshot:clientSnapshotFor(activeSlice,activeSlice.revision+1)}:{})}});
}
