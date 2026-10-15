import type { ServerEnv } from '../context';
import { getDoc } from '../db.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { ACTIVE_STATEMENT_BUDGET, commitOperation, receipt, requestHash } from './transaction.ts';
import { OperationError } from './errors.ts';
import * as v from './input.ts';
import { normalizeCatalogSnapshot, projectCatalog, type CatalogSnapshot } from '../../modules/catalog/infrastructure/snapshot.ts';
import { normalizeDeliverySnapshot } from '../../modules/delivery/infrastructure/snapshot.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
import { DEFAULT_JOURNEY_ID, seedJourneys } from '../../modules/catalog/infrastructure/journey.ts';
import { seedProducts } from '../../modules/catalog/infrastructure/products.ts';
import { journeyError, type JourneyTemplate, type ReferenceTask, type TaskSchedule } from '../../modules/catalog/domain/models.ts';
import { templateError, type Product, type BaseDelivery } from '../../modules/catalog/domain/products.ts';
import { validateSchedules } from '../../modules/catalog/domain/schedule.ts';
import { versionProduct } from '../../modules/catalog/domain/product-versions.ts';
import { fingerprint, latestVersion, publishSnapshot } from '../../modules/catalog/domain/publication.ts';
import { unclaimedPrivatePlan } from './delivery-client-plan-claims.ts';
const CATALOG='ontology.catalog.v2',DELIVERY='ontology.delivery.v2',CLIENTS='ontology.clients.v3';
export type CatalogCommand='products.save'|'plans.save'|'plans.remove'|'plans.publish';
function fields(raw:Record<string,unknown>,names:string[]){if(Object.keys(raw).some(k=>!names.includes(k)))v.invalid('Campo de catálogo inválido.');}
function rows(value:unknown,label:string):unknown[]{if(!Array.isArray(value)||value.length>500)v.invalid(`Informe ${label} válidos.`);return value;}
function texts(value:unknown):string[]{return rows(value,'textos').map(x=>v.string(x,'texto'));}
function integer(value:unknown,min=0,max=10000){const n=v.number(value,NaN,min,max);if(!Number.isInteger(n))v.invalid('Informe um número inteiro válido.');return n;}
function unique(ids:(string|number)[]){if(new Set(ids).size!==ids.length)v.invalid('Identificadores não podem se repetir.');}
function period(value:unknown){if(value===undefined)return undefined;const raw=v.object(value);fields(raw,['startMonth','endMonth']);const startMonth=integer(raw.startMonth,1),endMonth=integer(raw.endMonth,1);if(endMonth<startMonth)v.invalid('O fim do período deve ocorrer após o início.');return{startMonth,endMonth};}
function schedule(value:unknown):TaskSchedule|undefined{
 if(value===undefined)return undefined;const raw=v.object(value),mode=v.choice(raw.mode,['none','date','task'] as const);
 fields(raw,mode==='none'?['mode']:mode==='date'?['mode','base','offsetDays']:['mode','predecessorId','offsetDays']);
 if(mode==='none')return{mode};const offsetDays=integer(raw.offsetDays,-365,365);
 return mode==='date'?{mode,base:v.choice(raw.base,['inicio','venda'] as const),offsetDays}:{mode,predecessorId:v.id(raw.predecessorId),offsetDays};
}
function policy(raw:Record<string,unknown>){return{
 ...(raw.completion!==undefined?{completion:v.choice(raw.completion,['checklist','deliverable'] as const)}:{}),
 ...(raw.party!==undefined?{party:v.choice(raw.party,['equipe','cliente','terceiro'] as const)}:{}),
 ...(raw.checklistItems!==undefined?{checklistItems:texts(raw.checklistItems)}:{}),
 ...(raw.requiresEvidence!==undefined?{requiresEvidence:v.boolean(raw.requiresEvidence,false)}:{}),
 ...(raw.approvalRequired!==undefined?{approvalRequired:v.boolean(raw.approvalRequired,false)}:{}),
 ...(raw.deliverableTemplateId!==undefined?{deliverableTemplateId:v.string(raw.deliverableTemplateId,'modelo')}:{})};}
const policyFields=['completion','party','checklistItems','requiresEvidence','approvalRequired','deliverableTemplateId'];
function planInput(value:unknown,previous:JourneyTemplate|undefined,at:string):JourneyTemplate{
 const raw=v.object(value);fields(raw,['id','name','description','milestones','autoCreateCycles','productId','version','publishedAt','createdAt','updatedAt','draftUpdatedAt','fingerprint']);
 const plan:JourneyTemplate={id:raw.id===undefined?`plan-${crypto.randomUUID()}`:v.id(raw.id),name:v.string(raw.name,'nome'),description:v.string(raw.description,'descrição',''),
 milestones:rows(raw.milestones,'marcos').map(item=>{
  const m=v.object(item);fields(m,['n','period','cycleTemplateId','stage','name','owner','goal','durationWeeks','exitCriteria','tasks']);
  const tasks:ReferenceTask[]=rows(m.tasks??[],'tarefas').map(item=>{const t=v.object(item);fields(t,['id','title','description','hours','ownerRole','schedule','period','legacyBaseDeliveryIds',...policyFields]);
   return{id:v.id(t.id),title:v.string(t.title,'título'),description:v.string(t.description,'descrição',''),hours:v.number(t.hours,0),completion:v.choice(t.completion,['checklist','deliverable'] as const,'checklist'),...policy(t),
    ...(t.ownerRole!==undefined?{ownerRole:v.string(t.ownerRole,'papel')}:{ }),schedule:schedule(t.schedule),period:period(t.period),...(t.legacyBaseDeliveryIds!==undefined?{legacyBaseDeliveryIds:v.strings(t.legacyBaseDeliveryIds,'aliases')}:{})};});
  const issue=validateSchedules(tasks);if(issue)v.invalid(issue);
  return{n:integer(m.n,1),name:v.string(m.name,'nome do marco'),stage:v.string(m.stage,'etapa',''),owner:v.string(m.owner,'responsável',''),tasks,period:period(m.period),
   ...(m.cycleTemplateId!==undefined?{cycleTemplateId:v.id(m.cycleTemplateId)}:{}),...(m.goal!==undefined?{goal:v.string(m.goal,'objetivo')}:{ }),...(m.durationWeeks!==undefined?{durationWeeks:integer(m.durationWeeks,1,52)}:{}),...(m.exitCriteria!==undefined?{exitCriteria:texts(m.exitCriteria)}:{})};
 }),...(raw.autoCreateCycles!==undefined?{autoCreateCycles:v.boolean(raw.autoCreateCycles,false)}:{}),...(raw.productId!==undefined?{productId:v.id(raw.productId)}:{}),
 createdAt:previous?.createdAt??at,updatedAt:at,draftUpdatedAt:at,...(previous?.version?{version:previous.version,publishedAt:previous.publishedAt}:{})};
 unique(plan.milestones.map(m=>m.n));const issue=journeyError(plan);if(issue)v.invalid(issue);return plan;
}
function productInput(value:unknown):Product{
 const raw=v.object(value);fields(raw,['id','name','description','cycles','version','serviceModel','autoAllocateLead']);
 const product:Product={id:raw.id===undefined?`product-${crypto.randomUUID()}`:v.id(raw.id),name:v.string(raw.name,'nome'),description:v.string(raw.description,'descrição',''),...(raw.serviceModel===undefined?{}:{serviceModel:v.choice(raw.serviceModel,['consultoria','implementacao','recorrente'] as const)}),autoAllocateLead:v.boolean(raw.autoAllocateLead,false),cycles:rows(raw.cycles,'ciclos').map(item=>{
  const c=v.object(item);fields(c,['id','name','goal','durationDays','milestones','deliveries','acceptance']);
  const deliveries:BaseDelivery[]=rows(c.deliveries,'tarefas').map(item=>{
   const d=v.object(item);fields(d,['id','title','description','day','milestoneId','hours','deadline','responsibleRole',...policyFields]);
   let deadline:BaseDelivery['deadline'];if(d.deadline!==undefined){const r=v.object(d.deadline),mode=v.choice(r.mode,['fixed','cycle','client','task'] as const);fields(r,mode==='fixed'?['mode']:mode==='task'?['mode','taskId','offsetDays']:['mode','offsetDays']);deadline=mode==='fixed'?{mode}:mode==='task'?{mode,taskId:v.id(r.taskId),offsetDays:integer(r.offsetDays,-3650,3650)}:{mode,offsetDays:integer(r.offsetDays,-3650,3650)};}
   return{id:v.id(d.id),title:v.string(d.title,'título'),description:v.string(d.description,'descrição',''),day:integer(d.day,1),hours:v.number(d.hours,0),...policy(d),deadline,...(d.milestoneId!==undefined?{milestoneId:v.id(d.milestoneId)}:{}),...(d.responsibleRole!==undefined?{responsibleRole:v.string(d.responsibleRole,'papel')}:{})};
  });
  const cycle={id:v.id(c.id),name:v.string(c.name,'nome'),goal:v.string(c.goal,'objetivo'),durationDays:integer(c.durationDays,1,365),deliveries,acceptance:texts(c.acceptance),...(c.milestones!==undefined?{milestones:rows(c.milestones,'marcos').map(item=>{const m=v.object(item);fields(m,['id','name']);return{id:v.id(m.id),name:v.string(m.name,'nome')};})}:{})};
  const issue=templateError(cycle);if(issue)v.invalid(issue);return cycle;
 })};
 if(!product.name)v.invalid('Dê um nome ao produto.');unique(product.cycles.map(c=>c.id));return product;
}
function savePlan(state:CatalogSnapshot,plan:JourneyTemplate):CatalogSnapshot {
 return {...state,removedJourneys:state.removedJourneys.filter(id=>id!==plan.id),...(seedJourneys.some(j=>j.id===plan.id)?{journeyEdits:{...state.journeyEdits,[plan.id]:plan}}:{extraJourneys:[...state.extraJourneys.filter(j=>j.id!==plan.id),plan]})};
}
async function activePlanProtection(db:D1Database,workspace:string,id:string) {
 const row=await db.prepare(`SELECT m.compatibility_version AS version,
   EXISTS(SELECT 1 FROM delivery_client_map_order p
     WHERE p.workspace_id=m.workspace_id AND p.generation=m.generation
       AND p.kind='productPlans' AND p.id=?) AS private_plan
   FROM delivery_client_shadow_meta m
   JOIN state_documents d ON d.workspace_id=m.workspace_id
     AND d.key='ontology.delivery.v2' AND d.version=m.source_delivery_version
   JOIN state_documents c ON c.workspace_id=m.workspace_id
     AND c.key='ontology.clients.v3' AND c.version=m.source_clients_version
   WHERE m.workspace_id=? AND m.mode='active'
     AND m.expected_clients=(SELECT COUNT(*) FROM delivery_client_snapshots s
       WHERE s.workspace_id=m.workspace_id AND s.generation=m.generation)
     AND m.expected_map_order=(SELECT COUNT(*) FROM delivery_client_map_order p
       WHERE p.workspace_id=m.workspace_id AND p.generation=m.generation)`)
   .bind(id,workspace).first<{version:number;private_plan:number}>();
 return row?{version:row.version,privatePlan:Boolean(row.private_plan)}:null;
}
/** Comandos fixos do commit de publicação: guardas, recibo, catálogo com
 * histórico, evento com auditoria, limpeza das guardas e marcador da fatia. */
const PUBLISH_RESERVED_STATEMENTS = 12;
/** Estimativa mínima de `plans.publish` com escopo `todos` em `active`, sem
 * reconstruir a execução. Conta só clientes certamente afetados (sem seleção
 * própria em `companyJourney` e com o plano como padrão do cadastro) e, por
 * cliente, os comandos que a ponte certamente gera: fatia, posição nova do pin
 * e os heads certificados de reivindicações e prazos. Sem cobertura certificada
 * do índice de mapas, devolve null e o caminho completo decide. */
async function publishStatementEstimate(db:D1Database,workspace:string,planId:string,clientsValue:unknown){
 const row=await db.prepare(`SELECT
   (SELECT json_group_array(p.kind||char(0)||p.id) FROM delivery_client_map_order p
     WHERE p.workspace_id=m.workspace_id AND p.generation=m.generation
       AND p.kind IN ('companyJourney','companyJourneyVersion')) AS keys,
   (SELECT json_group_array(s.company) FROM delivery_client_snapshots s
     JOIN delivery_client_plan_claim_heads h ON h.workspace_id=s.workspace_id AND h.company=s.company
       AND h.authority_generation=s.generation AND h.source_revision=s.revision
       AND h.source_incarnation=s.incarnation
       AND h.expected_claims=(SELECT COUNT(*) FROM delivery_client_plan_claims x
         WHERE x.workspace_id=h.workspace_id AND x.projection_generation=h.projection_generation
           AND x.company=h.company)
     WHERE s.workspace_id=m.workspace_id AND s.generation=m.generation) AS claim_heads,
   (SELECT json_group_array(s.company) FROM delivery_client_snapshots s
     JOIN delivery_client_deadline_heads h ON h.workspace_id=s.workspace_id AND h.company=s.company
       AND h.authority_generation=s.generation AND h.source_revision=s.revision
       AND h.source_incarnation=s.incarnation
       AND h.expected_dependencies=(SELECT COUNT(*) FROM delivery_client_deadline_dependencies x
         WHERE x.workspace_id=h.workspace_id AND x.projection_generation=h.projection_generation
           AND x.company=h.company)
     WHERE s.workspace_id=m.workspace_id AND s.generation=m.generation) AS deadline_heads
   FROM delivery_client_shadow_meta m
   JOIN state_documents d ON d.workspace_id=m.workspace_id
     AND d.key='ontology.delivery.v2' AND d.version=m.source_delivery_version
   JOIN state_documents c ON c.workspace_id=m.workspace_id
     AND c.key='ontology.clients.v3' AND c.version=m.source_clients_version
   WHERE m.workspace_id=? AND m.mode='active'
     AND m.expected_map_order=(SELECT COUNT(*) FROM delivery_client_map_order p
       WHERE p.workspace_id=m.workspace_id AND p.generation=m.generation)`)
  .bind(workspace).first<{keys:string;claim_heads:string;deadline_heads:string}>();
 if(!row)return null;
 const keys=new Set(JSON.parse(row.keys) as string[]),claims=new Set(JSON.parse(row.claim_heads) as string[]),deadlines=new Set(JSON.parse(row.deadline_heads) as string[]);
 const affected=projectClients(clientsValue??{}).allClients.filter(client=>!keys.has(`companyJourney\u0000${client.slug}`)&&(client.journeyId??DEFAULT_JOURNEY_ID)===planId);
 return affected.reduce((total,client)=>total+1+Number(!keys.has(`companyJourneyVersion\u0000${client.slug}`))+Number(claims.has(client.slug))+Number(deadlines.has(client.slug)),PUBLISH_RESERVED_STATEMENTS);
}
/** Shared catalog writer. Product purchases retain their private plans and copied execution. */
export async function executeCatalogCommand(env:ServerEnv,principal:OperationPrincipal,command:CatalogCommand,input:unknown,key:string,expectedVersions:Record<string,number>={},skipActive=false) {
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const db=env.DB,workspace=env.WORKSPACE_ID||'default',raw=v.object(input);
 const guards=await authorizeOperation(db,workspace,principal,{action:'catalogo.editar',scope:'catalog:write'});
 const hash=await requestHash(command,input),replay=await receipt(db,workspace,principal.id,key,command,hash);if(replay)return replay.result;
 // A new plan has no existing private-plan identity to reserve. Product edits
 // do not inspect execution or purchases at all.
 const newPlan=command==='plans.save' && raw.plan !== null && typeof raw.plan==='object' &&
  !Array.isArray(raw.plan) && (raw.plan as Record<string,unknown>).id===undefined;
 const independent=command==='products.save'||newPlan;
 const candidate=command==='plans.save'&&!newPlan&&raw.plan!==null&&typeof raw.plan==='object'&&!Array.isArray(raw.plan)
   ?(raw.plan as Record<string,unknown>).id:command==='plans.remove'?raw.planId:undefined;
 const protection=!skipActive&&typeof candidate==='string'&&expectedVersions[DELIVERY]===undefined
   ?await activePlanProtection(db,workspace,candidate):null;
 const certifiedRemoval=command==='plans.remove'&&typeof candidate==='string'&&protection&&!protection.privatePlan
   ?await unclaimedPrivatePlan(db,workspace,'',candidate,protection.version):false;
 const readDelivery=(!independent&&!(command==='plans.remove'?certifiedRemoval:protection))||expectedVersions[DELIVERY]!==undefined;
 const readClients=!independent||expectedVersions[CLIENTS]!==undefined;
 // Publicar para todos em active passa pela ponte global. Recusar antes de
 // reconstruir a execução quando o batch certamente excede o limite do D1.
 if(command==='plans.publish'&&raw.scope==='todos'&&typeof raw.planId==='string'&&typeof raw.fingerprint==='string'){
  const [catalogDoc,clientsDoc]=await Promise.all([getDoc(db,workspace,CATALOG),getDoc(db,workspace,CLIENTS)]);
  const plan=projectCatalog(normalizeCatalogSnapshot(catalogDoc?.value??{})).journeys.find(p=>p.id===raw.planId);
  if(plan&&fingerprint(plan)===raw.fingerprint){
   const estimate=await publishStatementEstimate(db,workspace,plan.id,clientsDoc?.value);
   if(estimate!==null&&estimate>ACTIVE_STATEMENT_BUDGET)throw new OperationError(503,'execution_write_too_large','Esta publicação alcança clientes demais para uma única gravação. Publique para novos clientes ou divida a mudança.');
  }
 }
 const [catalogDoc,deliveryDoc,clientsDoc]=await Promise.all([getDoc(db,workspace,CATALOG),
  readDelivery?getDoc(db,workspace,DELIVERY):Promise.resolve(null),
  readClients?getDoc(db,workspace,CLIENTS):Promise.resolve(null)]);
 const versions=new Map(guards.map(g=>[g.key,g.version]));
 for(const [name,version] of [[CATALOG,catalogDoc?.version??0],...(readDelivery?[[DELIVERY,deliveryDoc?.version??0]]:[]),...(readClients?[[CLIENTS,clientsDoc?.version??0]]:[])] as [string,number][]){if(versions.has(name)&&versions.get(name)!==version)throw new OperationError(409,'version_conflict','Os dados mudaram. Atualize antes de salvar.');versions.set(name,version);}
 if(protection) {if(versions.has(DELIVERY)&&versions.get(DELIVERY)!==protection.version)throw new OperationError(409,'version_conflict','Os dados mudaram. Atualize antes de salvar.');versions.set(DELIVERY,protection.version);}
 for(const [name,version] of Object.entries(expectedVersions)){if(!Number.isSafeInteger(version)||version<0)v.invalid('Versão inválida.');if(versions.has(name)&&versions.get(name)!==version)throw new OperationError(409,'version_conflict','Os dados mudaram. Atualize antes de salvar.');}
 let catalog=normalizeCatalogSnapshot(catalogDoc?.value??{});const delivery=normalizeDeliverySnapshot(deliveryDoc?.value??{}),clients=projectClients(clientsDoc?.value??{}),projection=projectCatalog(catalog),at=new Date().toISOString();
 // A client whose default selection is this plan may have an explicit override
 // outside the claim index. Keep the exact legacy check for that case.
 if(certifiedRemoval&&clients.allClients.some(client=>(client.journeyId??DEFAULT_JOURNEY_ID)===candidate))
  return executeCatalogCommand(env,principal,command,input,key,expectedVersions,true);
 let data:unknown,subject:string,eventType:string;let writeDelivery=false;
 if(command==='products.save'){
  fields(raw,['product']);const product=productInput(raw.product),previous=projection.products.find(p=>p.id===product.id);
  const saved=versionProduct(previous,product,catalog.productVersions[product.id]??[],principal.memberId,at);
  catalog={...catalog,productVersions:{...catalog.productVersions,[product.id]:saved.versions},...(seedProducts.some(p=>p.id===product.id)?{productEdits:{...catalog.productEdits,[product.id]:saved.product}}:{extraProducts:[...catalog.extraProducts.filter(p=>p.id!==product.id),saved.product]})};
  data={product:saved.product};subject=product.id;eventType='product.saved';
 }else{
  if(command!=='plans.save'&&command!=='plans.remove'&&command!=='plans.publish')throw new OperationError(404,'unknown_command','Operação não encontrada.');
  fields(raw,command==='plans.save'?['plan']:command==='plans.remove'?['planId']:['planId','scope','fingerprint']);
  const planRaw=command==='plans.save'?v.object(raw.plan):undefined;
  const id=command==='plans.save'?(planRaw!.id===undefined?undefined:v.id(planRaw!.id)):v.id(raw.planId);
  if(id&&(protection?.privatePlan||Object.values(delivery.productPlans).some(p=>p.id===id)||clients.enrollments.some(enrollment=>enrollment.planId===id)))v.invalid('Planos de uma contratação não podem ser alterados pelo catálogo.');
  const previous=projection.journeys.find(p=>p.id===id);
  if(command==='plans.save'){
   const plan=planInput(raw.plan,previous,at);
   if(plan.productId&&!projection.products.some(p=>p.id===plan.productId))v.invalid('Produto não encontrado.');
   catalog=savePlan(catalog,plan);data={plan,fingerprint:fingerprint(plan)};subject=plan.id;eventType='plan.saved';
  }else{
   if(!previous)throw new OperationError(404,'plan_not_found','Plano não encontrado.');
   const affected=clients.allClients.filter(c=>(delivery.companyJourney[c.slug]??c.journeyId??DEFAULT_JOURNEY_ID)===previous.id);
   if(command==='plans.remove'){
    if(previous.id==='founding-companies'||clients.allClients.some(c=>(delivery.companyJourney[c.slug]??c.journeyId??DEFAULT_JOURNEY_ID)===previous.id)||clients.enrollments.some(e=>e.planId===previous.id))v.invalid('O plano está protegido ou vinculado a clientes. Desvincule-o antes de remover.');
    catalog={...catalog,removedJourneys:[...new Set([...catalog.removedJourneys,previous.id])],extraJourneys:catalog.extraJourneys.filter(p=>p.id!==previous.id)};
    data={planId:previous.id,removed:true};eventType='plan.removed';
   }else{
    const scope=v.choice(raw.scope,['novos','todos'] as const);
    if(v.string(raw.fingerprint,'impressão digital')!==fingerprint(previous))throw new OperationError(409,'draft_changed','O rascunho mudou. Revise antes de publicar.');
    // Validate legacy drafts too, but publish the actual head rather than rewriting it.
    planInput(previous,previous,at);
    const latest=latestVersion(catalog.journeyVersions[previous.id]),published=publishSnapshot(previous,catalog.journeyVersions[previous.id],principal.memberId,at);
    catalog=savePlan({...catalog,journeyVersions:{...catalog.journeyVersions,[previous.id]:[...(catalog.journeyVersions[previous.id]??[]),published.version]}},published.head);
    const pins:Record<string,number>={};for(const client of affected){if(scope==='todos')pins[client.slug]=published.version.version;else if(delivery.companyJourneyVersion[client.slug]==null&&latest)pins[client.slug]=latest.version;}
    delivery.companyJourneyVersion={...delivery.companyJourneyVersion,...pins};writeDelivery=true;
    data={plan:published.head,version:published.version,pins,scope};eventType='plan.published';
   }
   subject=previous.id;
  }
 }
 const writes=[{key:CATALOG,value:catalog},...(writeDelivery?[{key:DELIVERY,value:delivery}]:[])];
 return commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash, checked: true,id:crypto.randomUUID(),guards:[...versions].map(([key,version])=>({key,version})),writes,events:[{type:eventType,subject}],reportStaleHeads:command==='plans.publish',result:{data,documents:principal.kind==='session'?writes.map(w=>({...w,version:versions.get(w.key)!+1,updatedAt:at})):[]}});
}
