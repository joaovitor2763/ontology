import type { ServerEnv } from '../context';
import { getDoc } from '../db.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { commitOperation, receipt, requestHash, type VersionGuard } from './transaction.ts';
import { OperationError } from './errors.ts';
import * as v from './input.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
import { normalizeCatalogSnapshot, projectCatalog } from '../../modules/catalog/infrastructure/snapshot.ts';
import { normalizeDeliverySnapshot, projectDelivery } from '../../modules/delivery/infrastructure/snapshot.ts';
import { previewProduct, applyProductImpact, rolloutFingerprint } from '../../modules/delivery/application/product-rollout.ts';
import { enrollmentCanReceiveWork } from '../../modules/clients/domain/product-enrollments.ts';
import { activeTaskStatements, clientSnapshotFor, ClientScopeRequiresBridge,
  readActiveCompanySlice } from './delivery-client-task-write.ts';
const DELIVERY='ontology.delivery.v2',CLIENTS='ontology.clients.v3',CATALOG='ontology.catalog.v2';
function parse(input:unknown) {
  const raw=v.object(input),company=v.id(raw.company),productId=v.id(raw.productId);
  if(!Object.hasOwn(raw,'enrollmentId')) v.invalid('Selecione uma contratação ou explicitamente a execução legada.');
  const enrollmentId=raw.enrollmentId===null?null:v.id(raw.enrollmentId);
  if(!Number.isSafeInteger(raw.targetVersion)||(raw.targetVersion as number)<1) v.invalid('Informe a versão de destino.');
  let cycleIds:string[]|undefined;
  if(raw.cycleIds!==undefined) {
    if(!Array.isArray(raw.cycleIds)||raw.cycleIds.length>1000) v.invalid('Selecione ciclos válidos.');
    cycleIds=(raw.cycleIds as unknown[]).map(id=>v.id(id));
    if(new Set(cycleIds).size!==cycleIds.length) v.invalid('Não repita ciclos.');
  }
  return {company,productId,enrollmentId,targetVersion:raw.targetVersion as number,cycleIds,previewFingerprint:raw.previewFingerprint};
}
async function authorize(env:ServerEnv,principal:OperationPrincipal,input:ReturnType<typeof parse>,write:boolean) {
  if(!env.DB) throw new OperationError(503,'database_unavailable','Banco indisponível.');
  const db=env.DB,workspace=env.WORKSPACE_ID||'default',guards:VersionGuard[]=[];
  for(const scope of ['catalog:read','enrollments:read',write?'delivery:write':'delivery:read'] as const) guards.push(...await authorizeOperation(db,workspace,principal,{scope,company:input.company,action:scope.startsWith('delivery:')?'plano.editar':'clientes.ver'}));
  return {db,workspace,guards};
}
async function prepare(input:ReturnType<typeof parse>,auth:Awaited<ReturnType<typeof authorize>>,skipActive=false) {
  const {db,workspace}=auth;
  const activeSlice=skipActive?null:await readActiveCompanySlice(db,workspace,input.company);
  const docs=await Promise.all([activeSlice?Promise.resolve({value:activeSlice.snapshot,version:activeSlice.version}):getDoc(db,workspace,DELIVERY),getDoc(db,workspace,CLIENTS),getDoc(db,workspace,CATALOG)]);
  const versions=new Map<string,number>();
  for(const guard of [...auth.guards,...[DELIVERY,CLIENTS,CATALOG].map((key,i)=>({key,version:docs[i]?.version??0}))]) {
    if(versions.has(guard.key)&&versions.get(guard.key)!==guard.version) throw new OperationError(409,'version_conflict','Os dados mudaram durante a consulta.');
    versions.set(guard.key,guard.version);
  }
  const clients=projectClients(docs[1]?.value??{}),state=normalizeDeliverySnapshot(docs[0]?.value??{}),catalog=normalizeCatalogSnapshot(docs[2]?.value??{});
  const company=clients.allClients.find(c=>c.slug===input.company);
  if(!company) throw new OperationError(404,'client_not_found','Cliente não encontrado.');
  const enrollment=input.enrollmentId===null?undefined:clients.enrollments.find(e=>e.id===input.enrollmentId&&e.company===input.company&&e.productId===input.productId);
  if(input.enrollmentId!==null&&!enrollment) v.invalid('Contratação não pertence ao cliente e produto informados.');
  if(enrollment&&!enrollmentCanReceiveWork(enrollment)) v.invalid('A contratação precisa estar ativa ou planejada e não arquivada.');
  const head=projectCatalog(catalog).products.find(p=>p.id===input.productId);
  const product=input.targetVersion===(head?.version??1)?head:catalog.productVersions[input.productId]?.find(p=>p.version===input.targetVersion)?.snapshot;
  if(!head||!product) throw new OperationError(404,'product_version_not_found','Versão do produto não encontrada.');
  const execution=projectDelivery(state,input.company);
  const cycles=execution.cycles.filter(c=>c.productId===input.productId&&(c.enrollmentId??null)===input.enrollmentId);
  if(!cycles.length) v.invalid('Não há execução nesta contratação ou vínculo legado.');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const impacts=previewProduct(product,catalog.productVersions[input.productId]??[],execution.cycles,execution.tasks,today,{[input.company]:company.startedAt},{scope:{company:input.company,enrollmentId:input.enrollmentId},enrollmentStarts:Object.fromEntries(clients.enrollments.filter(e=>e.company===input.company).map(e=>[e.id,e.startsAt]))});
  if(input.cycleIds?.some(id=>!impacts.some(i=>i.cycle.id===id))) v.invalid('Um ciclo selecionado não pertence à execução.');
  const fingerprint=await requestHash('product-rollouts.preview',{company:input.company,enrollmentId:input.enrollmentId,productId:input.productId,targetVersion:input.targetVersion,versions:Object.fromEntries(versions),product,today,cycles,tasks:execution.tasks.filter(t=>cycles.some(c=>c.taskIds.includes(t.id)))});
  return {state,versions,execution,impacts,fingerprint,activeSlice,
    publicJourneyIds:new Set(projectCatalog(catalog).journeys.map(journey=>journey.id))};
}
export async function previewProductRollout(env:ServerEnv,principal:OperationPrincipal,input:unknown) {
  const parsed=parse(input),auth=await authorize(env,principal,parsed,false),preview=await prepare(parsed,auth);
  return {data:{company:parsed.company,enrollmentId:parsed.enrollmentId,productId:parsed.productId,targetVersion:parsed.targetVersion,previewFingerprint:preview.fingerprint,cycles:preview.impacts.filter(i=>!parsed.cycleIds||parsed.cycleIds.includes(i.cycle.id)).map(i=>({id:i.cycle.id,name:i.cycle.name,blocked:i.blocked,changes:i.changes,preserved:i.preserved,addedTaskCount:i.added.length}))}};
}
export async function executeProductRollout(env:ServerEnv,principal:OperationPrincipal,input:unknown,key:string,expectedVersions:Record<string,number>={},skipActive=false) {
  const parsed=parse(input),auth=await authorize(env,principal,parsed,true),command='product-rollouts.apply';
  if(!parsed.cycleIds?.length||typeof parsed.previewFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(parsed.previewFingerprint)) v.invalid('Selecione ciclos e revise a prévia antes de aplicar.');
  const hash=await requestHash(command,input),saved=await receipt(auth.db,auth.workspace,principal.id,key,command,hash);
  if(saved) return saved.result;
  const preview=await prepare(parsed,auth,skipActive);
  for(const [name,version] of Object.entries(expectedVersions)) {
    if(!Number.isSafeInteger(version)||version<0)v.invalid('Versão inválida.');
    if(preview.versions.has(name)&&preview.versions.get(name)!==version) throw new OperationError(409,'version_conflict','Atualize os dados antes de salvar.');
  }
  if(parsed.previewFingerprint!==preview.fingerprint) throw new OperationError(409,'stale_preview','Os dados mudaram. Gere uma nova prévia.');
  const selected=preview.impacts.filter(i=>parsed.cycleIds!.includes(i.cycle.id)),at=new Date().toISOString();
  let next;
  try {next=applyProductImpact(preview.state,selected,preview.execution.cycles,preview.execution.tasks,rolloutFingerprint(preview.execution.cycles,preview.execution.tasks),principal.memberId,at);}
  catch(error){throw new OperationError(422,'invalid_rollout',error instanceof Error?error.message:'Atualização inválida.');}
  let statements:D1PreparedStatement[]=[];
  if(preview.activeSlice) try {statements=await activeTaskStatements(auth.db,auth.workspace,
    preview.activeSlice,next,780,command,preview.publicJourneyIds);}
  catch(error){if(error instanceof ClientScopeRequiresBridge)
    return executeProductRollout(env,principal,input,key,expectedVersions,true);
   throw error;}
  const guards=[...preview.versions].filter(([name])=>name!==DELIVERY||!preview.activeSlice||expectedVersions[DELIVERY]!==undefined)
    .map(([name,version])=>({key:name,version}));
  return commitOperation(auth.db,{workspace:auth.workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash,id:crypto.randomUUID(),guards,writes:preview.activeSlice?[]:[{key:DELIVERY,value:next}],statements,events:[{type:'product_rollout.applied',company:parsed.company,subject:parsed.productId,data:{enrollmentId:parsed.enrollmentId,targetVersion:parsed.targetVersion,cycleIds:parsed.cycleIds}}],result:{data:{company:parsed.company,enrollmentId:parsed.enrollmentId,productId:parsed.productId,targetVersion:parsed.targetVersion,cycleIds:parsed.cycleIds},documents:principal.kind==='session'&&!preview.activeSlice?[{key:DELIVERY,value:next,version:preview.versions.get(DELIVERY)!+1,updatedAt:at,updatedBy:principal.id}]:[],...(preview.activeSlice?{clientSnapshot:clientSnapshotFor(preview.activeSlice,preview.activeSlice.revision+1)}:{})}});
}
