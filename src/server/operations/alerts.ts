import type {ServerEnv} from '../context';
import {getDoc} from '../db.ts';
import {workspaceDate} from '../../shared/lib/format.ts';
import {documentVersions,documentVersionsStatement,loadDocuments,prefetchDocuments} from './request-context.ts';
import {authorizeOperation,type OperationPrincipal} from './principal.ts';
import {commitOperation,receipt,requestHash} from './transaction.ts';
import {OperationError} from './errors.ts';
import {object,id,invalid} from './input.ts';
import {projectClients} from '../../modules/clients/infrastructure/snapshot.ts';
import {projectStakeholders} from '../../modules/clients/infrastructure/stakeholders-snapshot.ts';
import {normalizeDeliverySnapshot,projectDelivery} from '../../modules/delivery/infrastructure/snapshot.ts';
import {normalizeCatalogSnapshot} from '../../modules/catalog/infrastructure/snapshot.ts';
import {projectClientExecution} from '../../modules/delivery/infrastructure/client-projection.ts';
import {currentExecution} from '../../modules/delivery/application/progress.ts';
import {normalizeEngagementSnapshot,projectMeetings} from '../../modules/engagement/infrastructure/snapshot.ts';
import {hypotheses} from '../../modules/engagement/infrastructure/seed.ts';
import {alerts} from '../../modules/workspace/infrastructure/seed.ts';
import {deriveAlerts} from '../../modules/workspace/domain/derived-alerts.ts';
import {readActiveAlertDeliveryWith,settleSummaries,type ActiveAlertDelivery} from './delivery-alert-source.ts';
import type {Delivery} from '../../modules/delivery/domain/models.ts';
import type {ServiceCycle} from '../../modules/delivery/domain/services.ts';
import type {AlertRules} from '../../modules/workspace/domain/models.ts';
import {alertQueueCompanies,allocatedCompanies,seesAllAlerts} from '../../modules/workspace/domain/alert-scope.ts';
import {normalizeAccess} from '../../modules/workspace/domain/permissions.ts';
import {memberOfRoster} from '../authz.ts';
import {acknowledgedFrom,acknowledgmentKey,acknowledgmentStatement,acknowledgmentsStatement,readAcknowledged,unseenBy} from './alert-acknowledgments.ts';
export const keys=['ontology.clients.v3','ontology.delivery.v2','ontology.catalog.v2','ontology.engagement.v2','ontology.stakeholders.v1'];
type ActiveAlerts = ActiveAlertDelivery;
/**
 * Documentos e fatias da fila. Com `withVersions`, as versões dos documentos
 * (`[...keys, workspaceKey]`) vão no mesmo lote das fatias: quem combina os dois
 * compara `versions` com `docs` e sabe, sem outra ida, se leu um retrato só.
 * Com `acknowledgedBy`, a ciência daquele membro vem no mesmo lote.
 */
export async function alertDocuments(db:D1Database,workspace:string,workspaceKey:string,company?:string,options:{withVersions?:boolean;acknowledgedBy?:string}={}){
 const versionKeys=[...keys,workspaceKey];
 const statements=[...options.withVersions?[documentVersionsStatement(db,workspace,versionKeys)]:[],
  ...options.acknowledgedBy!==undefined?[acknowledgmentsStatement(db,workspace,options.acknowledgedBy)]:[]];
 // Resumos por cliente (0042) no lugar dos corpos; uma fatia que andou entre o
 // lote e a busca dos corpos que faltam faz reler tudo uma vez.
 // Cada leitura já repete até três vezes por conta própria; aqui só uma releitura a mais.
 for(let attempt=0;attempt<2;attempt++){
  const {active,extra}=await readActiveAlertDeliveryWith(db,workspace,{company,with:statements,summaries:true});
  const versions=options.withVersions?documentVersions(extra[0]):null;
  const acknowledged=options.acknowledgedBy!==undefined?acknowledgedFrom(extra.at(-1)!):null;
  if(!active)return{docs:await loadDocuments(db,workspace,versionKeys),effective:null,versions,acknowledged};
  const names=[keys[0],keys[2],keys[3],keys[4],workspaceKey];
  const docs=await loadDocuments(db,workspace,names);
  const effective=await settleSummaries(db,workspace,active,docs[0]?.value,docs[1]?.value,company);
  if(effective)return{docs:[docs[0],null,docs[1],docs[2],docs[3],docs[4]],effective,versions,acknowledged};
 }
 throw new OperationError(409,'snapshot_changed','Os alertas mudaram durante a leitura. Tente novamente.');
}
function activeGuards(db:D1Database,workspace:string,effective:ActiveAlerts|null,companies:string[]){
 if(!effective)return [];
 return companies.flatMap(company=>{
  const head=effective.heads.find(row=>row.company===company);
  if(!head)throw new OperationError(503,'execution_snapshot_incomplete',
    'A execução do cliente está sendo atualizada. Tente novamente.');
  const transaction=crypto.randomUUID();
  return[db.prepare(`INSERT INTO delivery_client_guards
    (transaction_id,workspace_id,company,generation,expected_revision,expected_mode,expected_incarnation)
    VALUES(?,?,?,?,?,'active',?)`).bind(transaction,workspace,company,effective.generation,
      head.revision,head.incarnation),
    db.prepare('DELETE FROM delivery_client_guards WHERE transaction_id=?').bind(transaction)];
 });
}
export async function acknowledgeAlert(env:ServerEnv,principal:OperationPrincipal,input:unknown,key:string,expected:Record<string,number>={}){
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const raw=object(input);if(Object.keys(raw).some(k=>!['company','alertId'].includes(k)))invalid('Alerta inválido.');
 const company=id(raw.company),alertId=id(raw.alertId),db=env.DB,workspace=env.WORKSPACE_ID||'default',command='alerts.acknowledge';
 const auth=await authorizeOperation(db,workspace,principal,{action:'alertas.ciencia',scope:'workspace:write',company});
 const hash=await requestHash(command,input),saved=await receipt(db,workspace,principal.id,key,command,hash);if(saved)return saved.result;
 const workspaceKey=auth.find(g=>g.key.startsWith('ontology.workspace.'))!.key;
 const [{docs,effective},acknowledged]=await Promise.all([alertDocuments(db,workspace,workspaceKey,company),readAcknowledged(db,workspace,principal.memberId)]);
 const versions=new Map<string,number>();for(const g of [...auth,...[...keys,workspaceKey].map((key,i)=>({key,version:docs[i]?.version??0}))]){if(effective&&g.key===keys[1])continue;if(versions.has(g.key)&&versions.get(g.key)!==g.version)throw new OperationError(409,'version_conflict','Os dados mudaram.');versions.set(g.key,g.version);}
 for(const [key,version]of Object.entries(expected)){if(!Number.isSafeInteger(version)||version<0)invalid('Versão inválida.');if(effective&&key===keys[1]){if(version!==effective.compatibilityVersion)throw new OperationError(409,'version_conflict','Atualize os alertas antes de continuar.');continue;}if(versions.has(key)&&versions.get(key)!==version)throw new OperationError(409,'version_conflict','Atualize os alertas antes de continuar.');}
 const at=new Date().toISOString(),{candidates,work}=projectAlerts(docs,company,at,effective);
 if(!candidates.some(a=>a.id===alertId))throw new OperationError(404,'alert_not_found','O alerta não está mais ativo. Atualize a lista.');
 // A ciência é de quem marca: o documento do workspace não muda, só a fila desta pessoa.
 const changed=unseenBy(acknowledged,work.hidden)({company,id:alertId});
 const statements=[...activeGuards(db,workspace,effective,[company]),...(changed?[acknowledgmentStatement(db,workspace,principal.memberId,[{company,alertId}],at)]:[])];
 return commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash,id:crypto.randomUUID(),guards:[...versions].map(([key,version])=>({key,version})),statements,writes:[],events:changed?[{type:command,company,subject:alertId}]:[],checked:true,result:{data:{alertId,acknowledged:true},documents:[]}});
}

/** Confirma uma seleção inteira no mesmo documento e na mesma transação. */
export async function acknowledgeAlertsBatch(env: ServerEnv, principal: OperationPrincipal, input: unknown, key: string, expected: Record<string, number> = {}) {
 if (!env.DB) throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const raw=object(input);
 if(Object.keys(raw).some(k=>k!=='alerts')||!Array.isArray(raw.alerts)||raw.alerts.length<1||raw.alerts.length>1000)invalid('Selecione de 1 a 1000 alertas.');
 const selected=raw.alerts.map(value=>{
  const row=object(value);
  if(Object.keys(row).some(k=>!['company','alertId'].includes(k)))invalid('Alerta inválido.');
  return {company:id(row.company),alertId:id(row.alertId)};
 });
 const identities=selected.map(a=>`${a.company}\u0000${a.alertId}`);
 if(new Set(identities).size!==identities.length)invalid('A seleção contém alertas repetidos.');
 const db=env.DB,workspace=env.WORKSPACE_ID||'default',command='alerts.acknowledgeBatch';
 const guards=new Map<string,number>();
 const companies=[...new Set(selected.map(a=>a.company))];
 // A autorização é por cliente, inclusive quando uma seleção atravessa vários.
 for(let index=0;index<companies.length;index+=8){
  const checks=await Promise.all(companies.slice(index,index+8).map(company=>authorizeOperation(db,workspace,principal,{action:'alertas.ciencia',scope:'workspace:write',company})));
  for(const check of checks)for(const guard of check){
   const previous=guards.get(guard.key);
   if(previous!==undefined&&previous!==guard.version)throw new OperationError(409,'version_conflict','Atualize os alertas antes de continuar.');
   guards.set(guard.key,guard.version);
  }
 }
 const hash=await requestHash(command,input),saved=await receipt(db,workspace,principal.id,key,command,hash);if(saved)return saved.result;
 const workspaceKey=[...guards.keys()].find(value=>value.startsWith('ontology.workspace.'))!;
 const [{docs,effective},acknowledged]=await Promise.all([alertDocuments(db,workspace,workspaceKey),readAcknowledged(db,workspace,principal.memberId)]);
 for(const [documentKey,version]of [...keys,workspaceKey].map((documentKey,index)=>[documentKey,docs[index]?.version??0] as const)){
  if(effective&&documentKey===keys[1])continue;
  const previous=guards.get(documentKey);
  if(previous!==undefined&&previous!==version)throw new OperationError(409,'version_conflict','Atualize os alertas antes de continuar.');
  guards.set(documentKey,version);
 }
 for(const [documentKey,version]of Object.entries(expected)){
  if(!Number.isSafeInteger(version)||version<0)invalid('Versão inválida.');
  if(effective&&documentKey===keys[1]){if(version!==effective.compatibilityVersion)throw new OperationError(409,'version_conflict','Atualize os alertas antes de continuar.');continue;}
  if(guards.has(documentKey)&&guards.get(documentKey)!==version)throw new OperationError(409,'version_conflict','Atualize os alertas antes de continuar.');
 }
 const at=new Date().toISOString(),{candidates,work}=projectAlerts(docs,undefined,at,effective);
 const available=new Set(candidates.map(a=>acknowledgmentKey(a.company,a.id)));
 const unseen=unseenBy(acknowledged,work.hidden);
 const changed=selected.filter(a=>available.has(acknowledgmentKey(a.company,a.alertId))&&unseen({company:a.company,id:a.alertId}));
 const events=companies.flatMap(company=>{
  const alertIds=changed.filter(a=>a.company===company).map(a=>a.alertId);
  return alertIds.length?[{type:command,company,subject:'batch',data:{alertIds}}]:[];
 });
 // Uma linha por alerta e pessoa, num comando só (JSON em um parâmetro), na mesma transação do recibo.
 const statements=[...activeGuards(db,workspace,effective,companies),...(changed.length?[acknowledgmentStatement(db,workspace,principal.memberId,changed,at)]:[])];
 return commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash,id:crypto.randomUUID(),guards:[...guards].map(([documentKey,version])=>({key:documentKey,version})),statements,writes:[],events,checked:true,result:{data:{acknowledged:changed.length,unavailable:selected.length-changed.length},documents:[]}});
}

/**
 * Clientes que entram na fila global de quem pede (`null` = todos). Usa o
 * roster e as alocações já carregados por `alertDocuments` (docs[5] e docs[0]),
 * na mesma janela de datas de `authorizeOperation`: nenhuma ida extra ao D1.
 */
export function alertAudience(docs:Awaited<ReturnType<typeof getDoc>>[],principal:Pick<OperationPrincipal,'email'|'memberId'|'access'>,at=new Date()){
 const actor=audienceActor(docs[5],principal);
 return alertQueueCompanies(actor,projectClients(docs[0]?.value as object).allocations,saoPauloDay(at));
}
/** Quem a fila considera: o membro atual do roster (ou o principal, sem roster). */
export function audienceActor(roster:Awaited<ReturnType<typeof getDoc>>|undefined,principal:Pick<OperationPrincipal,'email'|'memberId'|'access'>){
 const {member}=memberOfRoster(roster?.value,principal.email);
 return {access:normalizeAccess(member?.access??principal.access),memberId:member?.id??principal.memberId};
}
const saoPauloDay=(at:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
/** A mesma `alertAudience`, mas só lê o cadastro de clientes quando a pessoa não vê a fila inteira. */
export async function alertAudienceOf(roster:Awaited<ReturnType<typeof getDoc>>|undefined,loadClients:()=>Promise<Awaited<ReturnType<typeof getDoc>>>,principal:Pick<OperationPrincipal,'email'|'memberId'|'access'>,at=new Date()){
 const actor=audienceActor(roster,principal);
 if(seesAllAlerts(actor))return null;
 return allocatedCompanies(actor.memberId,projectClients((await loadClients())?.value as object).allocations,saoPauloDay(at));
}
/** Sem `company`, projeta a fila do workspace inteiro: é o que o contador lê. */
/**
 * O relógio das regras derivadas tem duas partes: a data de São Paulo (prazos e
 * ciclos são só-data) e o instante real (o início das reuniões é gravado como
 * instante ISO). `at` pode vir como instante (`…Z`/com fuso) ou como hora de
 * parede de São Paulo sem fuso (`refreshNow()`); os dois viram o mesmo par, e o
 * resultado não depende do fuso do processo.
 */
export function alertClockOf(at:string){
 const zoned=/(?:[zZ]|[+-]\d\d:\d\d)$/.test(at);
 const local=at.length<=10?`${at.slice(0,10)}T00:00:00`:at.length===16?`${at}:00`:at.slice(0,19);
 let instant=new Date(zoned?at:`${local}-03:00`);
 if(!Number.isFinite(instant.getTime()))instant=new Date(at);
 if(!Number.isFinite(instant.getTime()))instant=new Date();
 return {today:workspaceDate(instant),now:instant.toISOString()};
}

export function projectAlerts(docs:Awaited<ReturnType<typeof getDoc>>[],company:string|undefined,at:string,effective?:ActiveAlerts|null){
 const clientState=projectClients(docs[0]?.value as object);
 const clients=clientState.clients.filter(c=>!company||c.slug===company);if(company&&!clients.length)invalid('Cliente não encontrado.');
 const delivery=normalizeDeliverySnapshot(docs[1]?.value as object),catalog=normalizeCatalogSnapshot(docs[2]?.value as object),engagement=normalizeEngagementSnapshot(docs[3]?.value as object);
 const work=(docs[5]?.value??{}) as {hidden?:string[];alertRules?:Partial<AlertRules>};
 const slices=effective?new Map(effective.slices.map(row=>[row.company,row.raw])):null;
 const clientStarts=Object.fromEntries(clientState.clients.map(client=>[client.slug,client.startedAt]));
 const enrollmentStarts=Object.fromEntries(clientState.enrollments.map(enrollment=>[enrollment.id,enrollment.startsAt]));
 const projected=clients.map(c=>{
  // Resumo conferido por `settleSummaries`: a execução que a projeção abaixo daria.
  const stored=effective?.executions?.get(c.slug);
  if(stored)return {...stored,referenceTasks:[],...currentExecution(stored.tasks,stored.cycles,clientState.enrollments)};
  if(slices&&!slices.has(c.slug))throw new OperationError(503,'execution_snapshot_incomplete','A execução está sendo atualizada. Tente novamente.');
  const raw=slices?normalizeDeliverySnapshot(slices.get(c.slug)):delivery;
  const execution = projectClientExecution(raw,catalog,c,clientState.enrollments,clientStarts,enrollmentStarts);
  return { ...execution, ...currentExecution(execution.tasks, execution.cycles, clientState.enrollments) };
 });
 const alertClock=alertClockOf(at);
 const deliveries:Delivery[]=projected.flatMap(row=>row.tasks);
 const cycles:ServiceCycle[]=currentExecution([],effective?projected.flatMap(row=>row.cycles):projectDelivery(delivery,company).cycles,clientState.enrollments).cycles;
 const candidates=[...alerts.filter(a=>!company||a.company===company),...deriveAlerts({today:alertClock.today,now:alertClock.now,clients,deliveries,cycles,meetings:projectMeetings(engagement),hypotheses:[...hypotheses,...engagement.extraHypotheses].map(h=>engagement.hypothesisEdits[h.id]??h).filter(h=>!engagement.removedHypotheses.includes(h.id)),stakeholders:projectStakeholders(docs[4]?.value as Parameters<typeof projectStakeholders>[0]),rules:work.alertRules})];
 return {candidates:company?candidates.filter(a=>a.company===company):candidates,work,executions:new Map(clients.map((client,index)=>[client.slug,projected[index]]))};
}

export async function readAlerts(env:ServerEnv,principal:OperationPrincipal,input:{company:string;limit?:number;offset?:number}){
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const company=id(input.company),limit=input.limit??50,offset=input.offset??0;
 if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)invalid('Paginação inválida.');
 const workspace=env.WORKSPACE_ID||'default';
 prefetchDocuments(env.DB,workspace,keys.filter(key=>key!=='ontology.delivery.v2'));
 const auth=await authorizeOperation(env.DB,workspace,principal,{action:'clientes.ver',scope:'workspace:read',company});
 const workspaceKey=auth.find(g=>g.key.startsWith('ontology.workspace.'))!.key;
 const [{docs,effective},acknowledged]=await Promise.all([alertDocuments(env.DB,workspace,workspaceKey,company),readAcknowledged(env.DB,workspace,principal.memberId)]);
 const {candidates,work}=projectAlerts(docs,company,new Date().toISOString(),effective);
 const rows=candidates.filter(unseenBy(acknowledged,work.hidden)).sort((a,b)=>a.id.localeCompare(b.id));
 return {data:rows.slice(offset,offset+limit),nextCursor:offset+limit<rows.length?String(offset+limit):null};
}
