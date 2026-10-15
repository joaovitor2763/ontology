import { getDoc } from '../db.ts';
import { freshDocumentSnapshot } from './request-context.ts';
import { normalizeClientsSnapshot, projectClients, type ClientsSnapshot } from '../../modules/clients/infrastructure/snapshot.ts';
import { normalizeCatalogSnapshot, projectCatalog } from '../../modules/catalog/infrastructure/snapshot.ts';
import { normalizeDeliverySnapshot, projectDelivery } from '../../modules/delivery/infrastructure/snapshot.ts';
import { projectStakeholders, STAKEHOLDERS_INITIAL } from '../../modules/clients/infrastructure/stakeholders-snapshot.ts';
import { upsertAllocation } from '../../modules/clients/domain/allocation.ts';
import { archiveEnrollment, changeEnrollmentStatus, enrollmentCanReceiveWork, enrollmentError, enrollmentIsCurrent, restoreEnrollment, upsertEnrollment, type ProductEnrollment } from '../../modules/clients/domain/product-enrollments.ts';
import { participationError, upsertParticipation } from '../../modules/clients/domain/product-stakeholders.ts';
import { stakeholderError, upsertStakeholder } from '../../modules/clients/domain/stakeholders.ts';
import { prepareProduct, applyProduct, editedDatesError, executionError, type ProductExecution } from '../../modules/delivery/application/product-execution.ts';
import { removeUntouchedEnrollmentExecution } from '../../modules/delivery/application/enrollment-lifecycle.ts';
import { provisionPlan } from '../../modules/delivery/application/plan-execution.ts';
import { scheduledExecution } from '../../modules/delivery/application/task-deadlines.ts';
import { pinnedJourney } from '../../modules/catalog/domain/publication.ts';
import type { Company } from '../../modules/clients/domain/models.ts';
import { people } from '../../modules/workspace/infrastructure/seed.ts';
import { normalizeContactPoints } from '../../shared/lib/contact-points.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { canonical, commitOperation, requestHash, receipt, type VersionGuard, type OperationEvent, type ExternalReference } from './transaction.ts';
import type { IntegrationScope } from './credentials.ts';
import type { Action } from '../../modules/workspace/domain/permissions.ts';
import { clientInput, serviceInput, stakeholderInput } from './client-input.ts';
import { saleInput } from './tool-definitions.ts';
import { OperationError } from './errors.ts';
import { projectAllMeetings } from '../../modules/engagement/infrastructure/snapshot.ts';
import * as v from './input.ts';
import { activeTaskStatements, ClientScopeRequiresBridge, readActiveCompanySlice } from './delivery-client-task-write.ts';
import { clientOwnership } from './delivery-client-shadow-sync.ts';
import { partitionClientDelivery } from '../delivery-client-slices.ts';
import { reconstructDeliverySnapshot } from '../delivery-records.ts';
import { activeNewClientStatements, readActiveNewClientAuthority } from './delivery-client-create.ts';
import { unclaimedPrivatePlan } from './delivery-client-plan-claims.ts';
import { activeClientLifecycleStatements, assertEnrollmentRemovalAllowed, certifiedClientRemoval } from './commercial-removal.ts';
const CLIENTS='ontology.clients.v3', CATALOG='ontology.catalog.v2', DELIVERY='ontology.delivery.v2', CONTACTS='ontology.stakeholders.v1';
export const commercialCommands=['sales.register','clients.create','clients.configure','clients.archive','clients.restore','enrollments.create','enrollments.update','enrollments.archive','enrollments.restore','enrollments.remove','enrollments.rebuild','stakeholders.save','stakeholders.remove','participants.save'] as const;
export function mergeGuards(...sets: VersionGuard[][]): VersionGuard[] {
  const map=new Map<string,number>();
  for(const guard of sets.flat()) {
    if(map.has(guard.key) && map.get(guard.key)!==guard.version) throw new OperationError(409,'version_conflict','Os dados mudaram durante a operação. Atualize e tente novamente.');
    map.set(guard.key,guard.version);
  }
  return [...map].map(([key,version])=>({key,version}));
}
/** Only editable preparation fields cross the boundary. Identity, history and state are generated. */
export function customized(draft: ProductExecution, input: unknown): ProductExecution {
  if(input===undefined) return draft;
  const raw=v.object(input);
  if(!Array.isArray(raw.cycles)||!Array.isArray(raw.tasks)) v.invalid('Preparação inválida.');
  const cycles=raw.cycles.map(v.object),tasks=raw.tasks.map(v.object);
  if(cycles.length!==draft.cycles.length||tasks.length!==draft.tasks.length) v.invalid('O modelo mudou. Prepare o produto novamente.');
  const result:ProductExecution={...draft,cycles:draft.cycles.map(c=>{
    const source=cycles.find(row=>row.templateId===c.templateId);
    if(!source) v.invalid('O modelo do ciclo mudou.');
    return {...c,name:v.string(source.name,'nome do ciclo',c.name),startsAt:v.string(source.startsAt,'início',c.startsAt),endsAt:v.string(source.endsAt,'fim',c.endsAt)};
  }),tasks:draft.tasks.map(t=>{
    const source=tasks.find(row=>row.baseDeliveryId===t.baseDeliveryId&&row.cycleTemplateId===t.cycleTemplateId);
    if(!source) v.invalid('O modelo da tarefa mudou.');
    const dueAt=v.string(source.dueAt,'prazo',t.dueAt);
    let checklist=t.checklist;
    if(source.checklist!==undefined) {
      if(!Array.isArray(source.checklist)||source.checklist.length>100) v.invalid('Checklist inválido.');
      checklist=source.checklist.map((item,i)=>({id:`${t.id}-c${i}`,title:v.string(v.object(item).title,'item de checklist'),done:false})).filter(c=>c.title);
    }
    return {...t,title:v.string(source.title,'título',t.title),startsAt:v.string(source.startsAt,'início',t.startsAt),dueAt,checklist,...(dueAt!==t.dueAt?{deadline:{mode:'fixed' as const}}:{})};
  })};
  const issue=editedDatesError(draft,result)??executionError(result); if(issue) v.invalid(issue);
  return result;
}
export async function executeCommercialCommand(db:D1Database,workspace:string,principal:OperationPrincipal,command:string,input:unknown,key:string,expectedVersions:Record<string,number>={},skipActive=false) {
  if(!commercialCommands.includes(command as typeof commercialCommands[number])) throw new OperationError(404,'unknown_command','Operação não encontrada.');
  const request=v.object(input),sale=command==='sales.register';
  let raw=request;
  let saleClient:Record<string,unknown>|undefined;
  if(sale) {
    if(!saleInput.safeParse(input).success) v.invalid('Revise os campos da venda, dos contatos e das contratações.');
    if(Object.keys(request).some(k=>!['client','contacts','enrollments','externalReference'].includes(k))) v.invalid('A venda contém campos desconhecidos.');
    saleClient=v.object(request.client);
    if((saleClient.id!==undefined)===(saleClient.create!==undefined)) v.invalid('Informe o cliente existente ou os dados para criar um cliente, nunca ambos.');
    if(Object.keys(saleClient).some(k=>!['id','create','externalReference'].includes(k))) v.invalid('Seletor de cliente inválido.');
    const create=saleClient.create===undefined?undefined:v.object(saleClient.create);
    if(create?.journeyId) v.invalid('Na venda, a execução é definida pelas contratações.');
    raw={...request,company:saleClient.id,client:create?{...create,journeyId:''}:undefined,config:{productIds:[]},journeyId:'',stakeholders:undefined};
  }
  const enrollmentFields:Partial<Record<string,readonly string[]>>={
    'enrollments.update':['company','enrollmentId','status','reason','startsAt','endsAt','productVersion'],
    'enrollments.archive':['company','enrollmentId'],
    'enrollments.restore':['company','enrollmentId'],
    'enrollments.remove':['company','enrollmentId'],
    'enrollments.rebuild':['company','enrollmentId'],
  };
  const permittedFields=enrollmentFields[command];
  if(permittedFields&&Object.keys(raw).some(field=>!permittedFields.includes(field))) v.invalid('A alteração da contratação contém campos desconhecidos.');
  const clientRaw=raw.client===undefined?undefined:v.object(raw.client);
  const company=v.id(raw.company ?? clientRaw?.slug ?? (clientRaw?.name ? (await import('../../modules/clients/domain/models.ts')).slugify(v.string(clientRaw.name,'nome')):undefined),'cliente');
  const creating=command==='clients.create'||(sale&&saleClient?.create!==undefined);
  const scope:IntegrationScope=command.startsWith('stakeholders.')?'stakeholders:write':command.startsWith('participants.')||command.startsWith('enrollments.')?'enrollments:write':'clients:write';
  const action:Action=creating?'clientes.criar':command==='clients.archive'||command==='clients.restore'?'cliente.arquivar':command.startsWith('stakeholders.')||command.startsWith('participants.')?'stakeholders.editar':'cliente.configurar';
  let guards=await authorizeOperation(db,workspace,principal,{action,scope,company});
  const requirements:{action:Action;scope:IntegrationScope}[]=[{action,scope}];
  const permit=async(action:Action,scope:IntegrationScope)=>{
    guards=mergeGuards(guards,await authorizeOperation(db,workspace,principal,{action,scope,company}));
    if(!requirements.some(r=>r.action===action&&r.scope===scope)) requirements.push({action,scope});
  };
  const replayResult=async(value:unknown,otherPrincipal=false)=>{
    const saved=value as {data:unknown;documents?:unknown[];authorizationRequirements?:{action:Action;scope:IntegrationScope}[]};
    if(!saved.authorizationRequirements?.length) throw new OperationError(409,'receipt_authorization_missing','Consulte o registro: este recibo não possui as permissões necessárias para repetição segura.');
    let replayGuards:VersionGuard[]=[];
    for(const required of saved.authorizationRequirements) replayGuards=mergeGuards(replayGuards,await authorizeOperation(db,workspace,principal,{...required,company}));
    if(principal.kind!=='session'||otherPrincipal) return {data:saved.data,documents:[]};
    const entries=(saved.documents??[]).map(entry=>{
      const document=entry as {key?:unknown;value?:unknown;version?:unknown;updatedAt?:unknown};
      if(typeof document.key!=='string'||!Number.isSafeInteger(document.version)) throw new OperationError(409,'receipt_document_invalid','Consulte o registro: este recibo não identifica seus documentos.');
      return document as {key:string;value?:unknown;version:number;updatedAt?:unknown};
    });
    const compact=entries.filter(document=>!Object.hasOwn(document,'value'));
    const current=await freshDocumentSnapshot(db,workspace,compact.map(document=>document.key));
    let index=0;
    const documents=entries.map(document=>{
      if(Object.hasOwn(document,'value')) return document;
      const found=current[index++];
      if(!found) throw new OperationError(409,'receipt_document_missing','O documento confirmado não está mais disponível. Atualize a página.');
      return {key:document.key,value:found.value,version:found.version,updatedAt:found.updatedAt};
    });
    return {data:saved.data,documents};
  };
  const hash=await requestHash(command,input);
  const replay=await receipt(db,workspace,principal.id,key,command,hash);
  if(replay) return replayResult(replay.result);
  const clientDocForActive=(creating||command==='clients.configure'||command==='enrollments.create'||
    command==='enrollments.remove'||command==='enrollments.rebuild'||sale&&!creating)&&!skipActive
    ?await getDoc(db,workspace,CLIENTS):null;
  const registered=clientDocForActive&&projectClients(clientDocForActive.value as Partial<ClientsSnapshot>).allClients.some(client=>client.slug===company);
  const activeSlice=registered
    ? await readActiveCompanySlice(db,workspace,company):null;
  const activeNewClient=creating&&clientDocForActive&&!registered
    ? await readActiveNewClientAuthority(db,workspace,company):null;
  let external: {system:string;kind:string;externalId:string}|undefined;
  if(raw.externalReference!==undefined) {
    if(!sale&&command!=='clients.create'&&command!=='enrollments.create') v.invalid('Referência externa somente em cadastro ou contratação.');
    const ref=v.object(raw.externalReference);if(sale&&ref.kind!==undefined&&ref.kind!=='sale') v.invalid('A referência desta operação deve identificar uma venda.');external={system:v.id(ref.system),kind:sale?'sale':v.id(ref.kind),externalId:v.string(ref.externalId,'identificador externo',undefined,300)};
    if(!external.externalId) v.invalid('Referência externa vazia.');
    const existing=await db.prepare('SELECT command,request_hash,operation_id FROM external_references WHERE workspace_id=? AND system=? AND kind=? AND external_id=?').bind(workspace,external.system,external.kind,external.externalId).first<{command:string;request_hash:string;operation_id:string}>();
    if(existing) {
      if(existing.command!==command||existing.request_hash!==hash) throw new OperationError(409,'external_reference_conflict','Esta referência externa já identifica outro pedido.');
      const saved=await db.prepare('SELECT result,principal_id FROM operation_receipts WHERE id=? AND workspace_id=?').bind(existing.operation_id,workspace).first<{result:string;principal_id:string}>();
      if(!saved) throw new OperationError(409,'external_reference_conflict','Referência já vinculada; consulte o registro.');
      return replayResult(JSON.parse(saved.result),saved.principal_id!==principal.id);
    }
  }
  // These commands never inspect or change execution ownership. The active
  // client marker advances in the same batch without rebuilding all slices.
  const contactsOnly=command==='stakeholders.save'||command==='stakeholders.remove';
  const deliveryIndependent=contactsOnly||[
    'clients.archive','clients.restore','enrollments.update','enrollments.archive',
    'enrollments.restore','participants.save',
  ].includes(command);
  const keys=[CLIENTS,...(!contactsOnly||expectedVersions[CATALOG]!==undefined?[CATALOG]:[]),
    ...(!deliveryIndependent||expectedVersions[DELIVERY]!==undefined?[DELIVERY]:[]),CONTACTS];
  const docs=new Map(await Promise.all(keys.map(async documentKey =>
    [documentKey,documentKey===CLIENTS&&clientDocForActive?clientDocForActive
      :documentKey===DELIVERY&&activeSlice?{value:activeSlice.snapshot,version:activeSlice.version}
      :documentKey===DELIVERY&&activeNewClient?{value:reconstructDeliverySnapshot([],{sparse:true}),version:activeNewClient.version}
      :await getDoc(db,workspace,documentKey)] as const)));
  guards=mergeGuards(guards,keys.map(documentKey=>({key:documentKey,version:docs.get(documentKey)?.version??0})));
  for(const [key,version] of Object.entries(expectedVersions)) {
    if(!Number.isSafeInteger(version)||version<0) v.invalid('Versão inválida.');
    const live=guards.find(g=>g.key===key);
    if(live&&live.version!==version) throw new OperationError(409,'version_conflict','Os dados mudaram. Atualize antes de salvar.');
  }
  let clients=normalizeClientsSnapshot((docs.get(CLIENTS)?.value??{}) as Partial<ClientsSnapshot>);
  const catalog=normalizeCatalogSnapshot(docs.get(CATALOG)?.value??{});
  let delivery=normalizeDeliverySnapshot(docs.get(DELIVERY)?.value??{});
  const initialDelivery=delivery,initialOwnership=activeSlice?clientOwnership(clients):null;
  const previousSelection={journey:{...delivery.companyJourney},milestone:{...delivery.companyMilestone},version:{...delivery.companyJourneyVersion}};
  let contacts=projectStakeholders(docs.get(CONTACTS)?.value ? docs.get(CONTACTS)!.value as typeof STAKEHOLDERS_INITIAL : undefined);
  let workspaceMembers=people.filter(person=>person.org==='praxis').map(normalizeContactPoints);
  const contactsWillChange=command==='stakeholders.save'||raw.stakeholders!==undefined||(sale&&Array.isArray(request.contacts)&&request.contacts.length>0);
  if(contactsWillChange) {
    const workspaceKey=guards.find(guard=>guard.key.startsWith('ontology.workspace.'));
    if(!workspaceKey) throw new OperationError(409,'workspace_guard_missing','Atualize os dados antes de salvar contatos.');
    const rosterDoc=await getDoc(db,workspace,workspaceKey.key);
    guards=mergeGuards(guards,[{key:workspaceKey.key,version:rosterDoc?.version??0}]);
    const roster=(rosterDoc?.value??{}) as {extraMembers?:typeof people;memberEdits?:Record<string,Partial<(typeof people)[number]>>};
    const extra=roster.extraMembers??[];
    workspaceMembers=[...extra,...people.filter(person=>person.org==='praxis'&&!extra.some(member=>member.id===person.id))]
      .map(person=>normalizeContactPoints({...person,...roster.memberEdits?.[person.id]}));
  }
  const projected=projectClients(clients), products=projectCatalog(catalog,delivery.productPlans);
  let companyRecord=projected.allClients.find(c=>c.slug===company);
  if(creating&&companyRecord) throw new OperationError(409,'client_exists','Já existe um cliente com este identificador.');
  if(!creating&&!companyRecord) throw new OperationError(404,'client_not_found','Cliente não encontrado.');
  const initialExecution=projectDelivery(delivery,company);
  const promoteFirstPurchase=!clients.enrollments.some(enrollment=>enrollment.company===company&&enrollmentIsCurrent(enrollment))
    && !initialExecution.cycles.some(cycle=>!cycle.enrollmentId)
    && !initialExecution.tasks.some(task=>!task.enrollmentId);
  const at=new Date().toISOString(), operationId=crypto.randomUUID();
  const events:OperationEvent[]=[], changed=new Set<string>(),references:ExternalReference[]=[],statements:D1PreparedStatement[]=[];
  const purchasedModels=new Set<'consultoria'|'implementacao'|'recorrente'>();
  let data:unknown;
  let lifecycleOriginalPlanId:string|undefined;
  const emit=(type:string,subject:string,data?:unknown)=>events.push({type,company,subject,...(data===undefined?{}:{data})});
  function lifecycle<T>(action:()=>T):T {
    try{return action();}catch(error){v.invalid(error instanceof Error?error.message:'Operação inválida para esta contratação.');}
  }
  function saveClient(client:Company) {
    clients={...clients,clientEdits:{...clients.clientEdits,[company]:client},extraClients:creating?[...clients.extraClients,client]:clients.extraClients};
    changed.add(CLIENTS); companyRecord=client;
  }
  async function enroll(request:Record<string,unknown>, prepared?:unknown) {
    await permit('plano.editar','enrollments:write');
    await permit('ciclos.editar','delivery:write');
    const productId=v.id(request.productId,'produto');
    const head=products.products.find(p=>p.id===productId);
    if(!head) v.invalid('Produto não encontrado.');
    const version=request.productVersion===undefined?head.version??1:v.number(request.productVersion,1,1);
    const product=version===(head.version??1)?head:catalog.productVersions[productId]?.find(p=>p.version===version)?.snapshot;
    if(!product) v.invalid('Versão do produto não encontrada.');
    if(product.serviceModel) purchasedModels.add(product.serviceModel);
    const createdProductLink=!(projected.configFor(company).productIds??[]).includes(productId);
    const enrollment:ProductEnrollment={id:crypto.randomUUID(),company,productId,productVersion:version,startsAt:v.string(request.startsAt,'início',companyRecord!.startedAt),status:'ativa',createdAt:at,createdBy:principal.memberId,lifecycleHistory:[{type:'created',at,by:principal.memberId}],...(createdProductLink?{createdProductLink:true}:{}),
      ...(request.previousEnrollmentId?{previousEnrollmentId:v.id(request.previousEnrollmentId)}:{}),...(request.endsAt?{endsAt:v.string(request.endsAt,'término')}:{}),...(request.soldAt?{soldAt:v.string(request.soldAt,'venda')}:{})};
    const enrollmentIssue=enrollmentError(enrollment,clients.enrollments);if(enrollmentIssue)v.invalid(enrollmentIssue);
    // The purchased product version is the only source for cycles and tasks.
    // Catalogue plans remain readable for legacy clients, but never override a sale.
    const draft=customized(prepareProduct(product,companyRecord!,at,{id:enrollment.id,startsAt:enrollment.startsAt!}),prepared);
    enrollment.planId=draft.plan.id;
    const selectionBefore={journey:delivery.companyJourney[company],milestone:delivery.companyMilestone[company],version:delivery.companyJourneyVersion[company]};
    delivery=applyProduct(delivery,draft);
    const journeys={...delivery.companyJourney},milestones={...delivery.companyMilestone},versions={...delivery.companyJourneyVersion};
    if(selectionBefore.journey===undefined) delete journeys[company]; else journeys[company]=selectionBefore.journey;
    if(selectionBefore.milestone===undefined) delete milestones[company]; else milestones[company]=selectionBefore.milestone;
    if(selectionBefore.version===undefined) delete versions[company]; else versions[company]=selectionBefore.version;
    delivery={...delivery,companyJourney:journeys,companyMilestone:milestones,companyJourneyVersion:versions};
    delivery.productPlans={...delivery.productPlans,[draft.plan.id]:draft.plan};
    clients={...clients,enrollments:upsertEnrollment(clients.enrollments,enrollment)};
    const config=projectClients(clients).configFor(company);
    clients.configs={...clients.configs,[company]:{...config,productIds:[...new Set([...(config.productIds??[]),productId])]}};
    changed.add(CLIENTS);changed.add(DELIVERY);emit('enrollment.created',enrollment.id);return enrollment;
  }
  /** Associate only one unambiguous legacy execution; its identities and work remain untouched. */
  async function adoptLegacy(productId:string) {
    await permit('plano.editar','enrollments:write');
    const execution=projectDelivery(delivery,company);
    const cycles=execution.cycles.filter(c=>c.productId===productId&&!c.enrollmentId);
    const tasks=execution.tasks.filter(t=>t.productId===productId&&!t.enrollmentId);
    if(!cycles.length) {
      if(tasks.length) v.invalid('Há tarefas legadas sem ciclo neste produto. Revise o vínculo antes de preparar uma nova contratação.');
      return undefined;
    }
    const templates=cycles.map(c=>c.templateId).filter(Boolean);
    if(new Set(templates).size!==templates.length || (cycles.length>1&&templates.length!==cycles.length)) v.invalid('Há mais de uma execução legada deste produto. Revise os vínculos antes de contratar.');
    const planIds=[...new Set(tasks.map(t=>t.journeyId).filter((id):id is string=>Boolean(id)))];
    if(planIds.length>1) v.invalid('A execução legada aponta para planos diferentes. Revise os vínculos antes de contratar.');
    const versions=[...new Set(cycles.map(c=>c.productVersion).filter((version):version is number=>version!==undefined))];
    const enrollment:ProductEnrollment={id:crypto.randomUUID(),company,productId,status:'ativa',legacy:true,
      ...(planIds[0]?{planId:planIds[0]}:{}),
      ...(versions.length===1&&cycles.every(c=>c.productVersion!==undefined)?{productVersion:versions[0]}:{})};
    const cycleIds=new Set(cycles.map(c=>c.id));
    const taskIds=new Set([...tasks.map(t=>t.id),...cycles.flatMap(c=>c.taskIds)]);
    delivery={...delivery,
      extraCycles:delivery.extraCycles.map(c=>cycleIds.has(c.id)?{...c,enrollmentId:enrollment.id}:c),
      cycleEdits:{...delivery.cycleEdits,...Object.fromEntries(cycles.filter(c=>!delivery.extraCycles.some(row=>row.id===c.id)).map(c=>[c.id,{...c,enrollmentId:enrollment.id}]))},
      extraTasks:delivery.extraTasks.map(t=>taskIds.has(t.id)?{...t,enrollmentId:enrollment.id}:t),
      taskPatches:{...delivery.taskPatches,...Object.fromEntries([...taskIds].map(id=>[id,{...delivery.taskPatches[id],enrollmentId:enrollment.id}]))},
    };
    clients={...clients,enrollments:upsertEnrollment(clients.enrollments,enrollment)};
    changed.add(CLIENTS);changed.add(DELIVERY);emit('enrollment.created',enrollment.id);
    return enrollment;
  }
  if(creating||command==='clients.configure') {
    const client=clientInput(clientRaw,companyRecord,principal.memberId,at);
    if(client.slug!==company) v.invalid('Cliente inconsistente.');
    const oldConfig=projected.configFor(company);
    const config=serviceInput(raw.config??oldConfig,oldConfig);
    const newProductIds=(config.productIds??[]).filter(productId=>
      !projected.enrollments.some(enrollment=>enrollment.company===company&&enrollment.productId===productId));
    if(activeSlice&&newProductIds.some(productId=>
      initialExecution.cycles.some(cycle=>cycle.productId===productId&&!cycle.enrollmentId)||
      initialExecution.tasks.some(task=>task.productId===productId&&!task.enrollmentId)))
      return executeCommercialCommand(db,workspace,principal,command,input,key,expectedVersions,true);
    const oldAssigned=companyRecord?projected.assigned(companyRecord):null;
    const leadId=v.id((raw.leadId??clientRaw?.leadId??oldAssigned?.leadId??client.leadId)||principal.memberId,'responsável');
    const csId=v.id((raw.csId??clientRaw?.csId??oldAssigned?.csId??client.csId)||leadId,'CS');
    if(creating||oldAssigned?.leadId!==leadId||oldAssigned?.csId!==csId) {
      await permit(creating?'alocacao.editar':'cliente.responsaveis','clients:write');
      const workspaceKey=guards.find(g=>g.key.startsWith('ontology.workspace.'))!;
      const rosterDoc=await getDoc(db,workspace,workspaceKey.key);
      guards=mergeGuards(guards,[{key:workspaceKey.key,version:rosterDoc?.version??0}]);
      const roster=(rosterDoc?.value??{}) as {extraMembers?:{id:string}[];deactivatedIds?:string[]};
      for(const memberId of [leadId,csId]) if(roster.deactivatedIds?.includes(memberId)||![...people.filter(p=>p.org==='praxis'),...(roster.extraMembers??[])].some(p=>p.id===memberId)) v.invalid('Escolha responsáveis ativos da equipe.');
      let allocations=projected.allocations;
      for(const [role,memberId] of [['responsavel',leadId],['cs',csId]] as const) allocations=upsertAllocation(allocations,{id:`alloc-${company}-${role}`,company,memberId,role,percent:role==='cs'?10:30,updatedAt:at});
      clients={...clients,allocations,allocationsMigrated:true};
    }
    saveClient({...client,leadId,csId});clients.configs={...clients.configs,[company]:config};
    if(!Array.isArray(raw.prepared??[])) v.invalid('Preparação inválida.');
    const preparations=(raw.prepared??[]) as unknown[];
    const selectedId=v.string(raw.journeyId,'plano',client.journeyId);
    const selected=products.journeys.find(j=>j.id===selectedId);
    if(selectedId&&!selected) v.invalid('Plano não encontrado.');
    if(selected?.productId&&!config.productIds?.includes(selected.productId)) config.productIds=[...(config.productIds??[]),selected.productId];
    if(selected && delivery.productPlans[selected.id] && !projectDelivery(delivery,company).tasks.some(t=>t.journeyId===selected.id) && !clients.enrollments.some(e=>e.company===company&&e.planId===selected.id))
      v.invalid('O plano privado precisa pertencer ao cliente.');
    const previousJourney=delivery.companyJourney[company]??projected.allClients.find(c=>c.slug===company)?.journeyId;
    const previousMilestone=delivery.companyMilestone[company]??client.milestone;
    const previousPin=delivery.companyJourneyVersion[company];
    const enrollments:ProductEnrollment[]=[];
    for(const productId of config.productIds??[]) {
      if(!products.products.some(p=>p.id===productId)) v.invalid('Produto não encontrado.');
      const prepared=preparations.find(p=>v.object(v.object(p).plan).productId===productId);
      const exists=clients.enrollments.some(e=>e.company===company&&e.productId===productId);
      if(!exists) {
        const legacy=!creating ? await adoptLegacy(productId) : undefined;
        if(legacy) enrollments.push(legacy);
        else enrollments.push(await enroll({productId,startsAt:client.startedAt},prepared));
      }
    }
    if(selected) {
      await permit('plano.editar','delivery:write');
      const created=enrollments.find(e=>e.productId===selected.productId&&!e.legacy);
      const effectiveId=created?.planId??selected.id;
      const effective=delivery.productPlans[effectiveId]??selected;
      const same=previousJourney===effectiveId;
      const pin=same?previousPin:undefined;
      const followed=pinnedJourney(effective,catalog.journeyVersions[effectiveId]??[],pin);
      const pins={...delivery.companyJourneyVersion};
      if(pin===undefined) delete pins[company]; else pins[company]=pin;
      delivery={...delivery,companyJourney:{...delivery.companyJourney,[company]:effectiveId},
        companyMilestone:{...delivery.companyMilestone,[company]:v.number(raw.milestone,same?previousMilestone:1,1,followed.milestones.length||1)},companyJourneyVersion:pins};
      // Existing product execution belongs to its enrollment and is never regenerated by editing client settings.
      if(selected.autoCreateCycles&&!selected.productId) delivery=provisionPlan(delivery,followed,companyRecord!,at);
      changed.add(DELIVERY);
    }
    if(raw.stakeholders!==undefined) {
      await permit('stakeholders.editar','stakeholders:write');
      if(!Array.isArray(raw.stakeholders)||raw.stakeholders.length>100) v.invalid('Lista de stakeholders inválida.');
      for(const contact of raw.stakeholders) { const candidate=stakeholderInput(contact,company); const issue=stakeholderError(candidate,[...contacts,...workspaceMembers]);if(issue)v.invalid(issue);const next=normalizeContactPoints(candidate);contacts=upsertStakeholder(contacts,next);emit('stakeholder.created',next.id); }
      changed.add(CONTACTS);
    }
    emit(creating?'client.created':'client.updated',company);data={client:companyRecord,enrollments};
  } else if(command==='enrollments.create') {
    const enrollment=await enroll(raw,raw.prepared);
    if(promoteFirstPurchase) {
      delivery={...delivery,companyJourney:{...delivery.companyJourney,[company]:enrollment.planId!},companyMilestone:{...delivery.companyMilestone,[company]:1},companyJourneyVersion:{...delivery.companyJourneyVersion}};
      delete delivery.companyJourneyVersion[company];
      changed.add(DELIVERY);
    }
    data={enrollment};
  }
  else if(command==='enrollments.update') {
    const enrollment=clients.enrollments.find(e=>e.id===v.id(raw.enrollmentId)&&e.company===company);
    if(!enrollment) v.invalid('Contratação não encontrada.');
    if(enrollment.archivedAt) v.invalid('Restaure a contratação antes de alterá-la.');
    if(enrollment.status==='cancelada') v.invalid('Uma contratação cancelada é somente leitura e não pode ser reativada ou alterada.');
    const status=v.choice(raw.status,['planejada','ativa','pausada','concluida','cancelada'],enrollment.status);
    const reason=raw.reason===undefined?undefined:v.string(raw.reason,'motivo',undefined,2000);
    if(reason!==undefined&&status===enrollment.status) v.invalid('Informe um motivo somente ao alterar a situação da contratação.');
    let next=lifecycle(()=>changeEnrollmentStatus(enrollment,status,principal.memberId,at,reason));
    next={...next,endsAt:raw.endsAt===undefined?next.endsAt:v.string(raw.endsAt,'término')};
    if(raw.startsAt!==undefined||raw.productVersion!==undefined) {
      await permit('plano.editar','enrollments:write');
      if(raw.startsAt!==undefined) {
        const startsAt=v.string(raw.startsAt,'início');
        if(enrollment.startsAt&&enrollment.startsAt!==startsAt) v.invalid('Use o ajuste de datas do plano para alterar uma data já registrada.');
        next.startsAt=startsAt;
      }
      if(raw.productVersion!==undefined) {
        const version=v.number(raw.productVersion,1,1);
        const head=products.products.find(p=>p.id===enrollment.productId);
        if(!Number.isSafeInteger(version)||!head||(version!==(head.version??1)&&!catalog.productVersions[head.id]?.some(p=>p.version===version))) v.invalid('Versão do produto não encontrada.');
        if(enrollment.productVersion!==undefined&&enrollment.productVersion!==version) v.invalid('A versão contratada já foi registrada.');
        next.productVersion=version;
      }
    }
    const enrollmentIssue=enrollmentError(next,clients.enrollments);if(enrollmentIssue)v.invalid(enrollmentIssue);
    if(canonical(next)!==canonical(enrollment)) {
      clients={...clients,enrollments:upsertEnrollment(clients.enrollments,next)}; changed.add(CLIENTS);
      emit('enrollment.updated',next.id,{productId:next.productId,status:next.status});
      if(status==='cancelada') emit('enrollment.cancelled',next.id,{productId:next.productId,status:next.status,reason});
    }
    data={enrollment:next};
  } else if(command==='enrollments.archive'||command==='enrollments.restore') {
    const enrollment=clients.enrollments.find(e=>e.id===v.id(raw.enrollmentId)&&e.company===company);
    if(!enrollment) v.invalid('Contratação não encontrada.');
    if(command==='enrollments.archive'&&enrollment.archivedAt) v.invalid('A contratação já está arquivada.');
    if(command==='enrollments.restore'&&!enrollment.archivedAt) v.invalid('A contratação não está arquivada.');
    const next=lifecycle(()=>command==='enrollments.archive'?archiveEnrollment(enrollment,principal.memberId,at):restoreEnrollment(enrollment,principal.memberId,at));
    clients={...clients,enrollments:upsertEnrollment(clients.enrollments,next)};changed.add(CLIENTS);
    emit(command==='enrollments.archive'?'enrollment.archived':'enrollment.restored',next.id);data={enrollment:next};
  } else if(command==='enrollments.remove'||command==='enrollments.rebuild') {
    await permit('ciclos.editar','delivery:write');
    const enrollment=clients.enrollments.find(e=>e.id===v.id(raw.enrollmentId)&&e.company===company);
    if(!enrollment) v.invalid('Contratação não encontrada.');
    lifecycleOriginalPlanId=enrollment.planId;
    if(command==='enrollments.rebuild'&&!enrollmentCanReceiveWork(enrollment)) v.invalid('Recrie somente contratações ativas ou planejadas e não arquivadas.');
    const currentExecution=projectDelivery(delivery,company),cycleIds=new Set(currentExecution.cycles.filter(cycle=>cycle.enrollmentId===enrollment.id).map(cycle=>cycle.id)),taskIds=new Set(currentExecution.tasks.filter(task=>task.enrollmentId===enrollment.id).map(task=>task.id));
    if(activeSlice&&!await certifiedClientRemoval(db,workspace,delivery,enrollment.id,activeSlice.version))
      return executeCommercialCommand(db,workspace,principal,command,input,key,expectedVersions,true);
    const engagement=await getDoc(db,workspace,'ontology.engagement.v2');
    guards=mergeGuards(guards,[{key:'ontology.engagement.v2',version:engagement?.version??0}]);
    if(projectAllMeetings(engagement?.value as Parameters<typeof projectAllMeetings>[0]).some(meeting=>meeting.enrollmentIds?.includes(enrollment.id)||(meeting.cycleId&&cycleIds.has(meeting.cycleId))||(meeting.deliveryId&&taskIds.has(meeting.deliveryId))||meeting.actions?.some(action=>action.deliveryId&&taskIds.has(action.deliveryId))))
      v.invalid(`Esta contratação ou sua execução está vinculada a reuniões. ${command==='enrollments.rebuild'?'Ajuste os vínculos antes de recriar a execução.':'Cancele-a para preservar o histórico.'}`);
    if(command==='enrollments.remove') await assertEnrollmentRemovalAllowed(db,workspace,company,clients,enrollment);
    let rebuildDraft:ReturnType<typeof prepareProduct>|undefined;
    if(command==='enrollments.rebuild') {
      if(!enrollment.startsAt||enrollment.productVersion===undefined) v.invalid('Informe início e versão antes de recriar a execução.');
      const head=products.products.find(p=>p.id===enrollment.productId);
      const product=catalog.productVersions[enrollment.productId]?.find(p=>p.version===enrollment.productVersion)?.snapshot??((head?.version??1)===enrollment.productVersion?head:undefined);
      if(!product) v.invalid('A versão contratada não está disponível.');
      const sharedPlan=enrollment.planId&&clients.enrollments.some(candidate=>candidate.id!==enrollment.id&&candidate.planId===enrollment.planId);
      const planId=sharedPlan?`enrollment-${enrollment.id}-rebuild-${operationId}`:enrollment.planId;
      rebuildDraft=prepareProduct(product,companyRecord!,at,{id:enrollment.id,startsAt:enrollment.startsAt,planId});
    }
    const remaining=clients.enrollments.filter(e=>e.id!==enrollment.id);
    const replacement=remaining.find(e=>e.company===company&&e.planId&&!e.archivedAt&&e.status!=='cancelada')?.planId;
    const retainedPlanIds=new Set(remaining.flatMap(candidate=>candidate.planId?[candidate.planId]:[]));
    const replacementPlanId=rebuildDraft?.plan.id??replacement;
    const participationIds=command==='enrollments.remove'?clients.participations.filter(participation=>participation.enrollmentId===enrollment.id).map(participation=>participation.id):[];
    let deletedEntityIds=[...new Set([...(command==='enrollments.remove'?[enrollment.id,...participationIds]:[]),...(enrollment.planId&&enrollment.planId!==replacementPlanId&&!retainedPlanIds.has(enrollment.planId)?[enrollment.planId]:[]),...cycleIds,...taskIds])];
    const referenceEntityIds=command==='enrollments.rebuild'?[...new Set([...cycleIds,...taskIds])]:deletedEntityIds;
    delivery=lifecycle(()=>removeUntouchedEnrollmentExecution(delivery,enrollment,replacementPlanId,companyRecord,retainedPlanIds));
    if(command==='enrollments.rebuild') {
      const draft=rebuildDraft!;
      const retainedEntityIds=new Set([draft.plan.id,...draft.cycles.map(cycle=>cycle.id),...draft.tasks.map(task=>task.id)]);
      deletedEntityIds=deletedEntityIds.filter(id=>!retainedEntityIds.has(id));
      delivery=applyProduct(delivery,draft);
      delivery.productPlans={...delivery.productPlans,[draft.plan.id]:draft.plan};
      const next={...enrollment,planId:draft.plan.id,lifecycleHistory:[...(enrollment.lifecycleHistory??[]),{type:'execution_rebuilt' as const,at,by:principal.memberId,reason:'Execução recriada a partir da versão contratada do produto.'}]};
      clients={...clients,enrollments:upsertEnrollment(clients.enrollments,next)};
      emit('enrollment.execution.rebuilt',enrollment.id);data={enrollment:next,cycles:draft.cycles.map(c=>c.id),tasks:draft.tasks.map(t=>t.id)};
    } else {
      const successor=remaining.find(candidate=>candidate.company===company&&candidate.productId===enrollment.productId);
      const remainingWithLinkOwner=enrollment.createdProductLink&&successor
        ? remaining.map(candidate=>candidate.id===successor.id?{...candidate,createdProductLink:true}:candidate)
        : remaining;
      clients={...clients,enrollments:remainingWithLinkOwner,participations:clients.participations.filter(p=>p.enrollmentId!==enrollment.id)};
      const legacyProductExecution=currentExecution.cycles.some(cycle=>cycle.productId===enrollment.productId&&!cycle.enrollmentId)||currentExecution.tasks.some(task=>task.productId===enrollment.productId&&!task.enrollmentId);
      if(enrollment.createdProductLink&&!legacyProductExecution&&!remainingWithLinkOwner.some(e=>e.company===company&&e.productId===enrollment.productId)) {
        const config=projectClients(clients).configFor(company);
        clients={...clients,configs:{...clients.configs,[company]:{...config,productIds:(config.productIds??[]).filter(id=>id!==enrollment.productId)}}};
      }
      emit('enrollment.removed',enrollment.id);data={company,enrollmentId:enrollment.id};
    }
    if(referenceEntityIds.length) {
      for(let offset=0;offset<referenceEntityIds.length;offset+=90) {
        const ids=referenceEntityIds.slice(offset,offset+90),placeholders=ids.map(()=>'?').join(',');
        const linked=await db.prepare(`SELECT entity_id FROM external_references WHERE workspace_id=? AND entity_id IN (${placeholders}) LIMIT 1`).bind(workspace,...ids).first<{entity_id:string}>();
        if(linked) v.invalid(`A contratação ou sua execução possui referência de integração e não pode ser ${command==='enrollments.rebuild'?'recriada':'excluída'}. Preserve a conciliação antes de continuar.`);
      }
    }
    // Tombstones also act as an in-transaction reservation. Rebuild removes
    // the temporary ones before commit for IDs recreated by the draft; the
    // opposing triggers make a concurrent external reference lose the race.
    const reservedEntityIds=[...new Set([...referenceEntityIds,...deletedEntityIds])];
    if(reservedEntityIds.length) {
      for(let offset=0;offset<reservedEntityIds.length;offset+=20) {
        const ids=reservedEntityIds.slice(offset,offset+20);
        statements.push(db.prepare(`INSERT INTO external_reference_tombstones(workspace_id,entity_id,operation_id,created_at) VALUES${ids.map(()=>'(?,?,?,?)').join(',')}`).bind(...ids.flatMap(id=>[workspace,id,operationId,at])));
      }
      const deleted=new Set(deletedEntityIds),temporary=reservedEntityIds.filter(id=>!deleted.has(id));
      for(let offset=0;offset<temporary.length;offset+=90) {
        const ids=temporary.slice(offset,offset+90),placeholders=ids.map(()=>'?').join(',');
        statements.push(db.prepare(`DELETE FROM external_reference_tombstones WHERE workspace_id=? AND operation_id=? AND entity_id IN (${placeholders})`).bind(workspace,operationId,...ids));
      }
    }
    changed.add(CLIENTS);changed.add(DELIVERY);
  } else if(command==='clients.archive'||command==='clients.restore') {
    clients={...clients,archivedClients:command==='clients.archive'?[...new Set([...clients.archivedClients,company])]:clients.archivedClients.filter(c=>c!==company)};changed.add(CLIENTS);emit(command==='clients.archive'?'client.archived':'client.restored',company);data={company};
  } else if(command==='stakeholders.save'||command==='stakeholders.remove') {
    const source=v.object(raw.stakeholder??raw),contactId=source.id===undefined?undefined:v.id(source.id);
    const previous=contacts.find(c=>c.id===contactId&&c.company===company);
    if(command==='stakeholders.remove') {
      if(!previous) v.invalid('Stakeholder não encontrado.');
      contacts=upsertStakeholder(contacts,{...previous,active:false,primary:false});data={stakeholder:{...previous,active:false,primary:false}};emit('stakeholder.deactivated',previous.id);
    } else {
      const candidate=stakeholderInput(source,company,previous),issue=stakeholderError(candidate,[...contacts,...workspaceMembers]);if(issue)v.invalid(issue);const next=normalizeContactPoints(candidate);
      if(!previous&&contacts.some(c=>c.id===next.id)) v.invalid('Identificador de stakeholder já utilizado.');
      contacts=upsertStakeholder(contacts,next);data={stakeholder:next};emit(previous?'stakeholder.updated':'stakeholder.created',next.id);
    }
    changed.add(CONTACTS);
  } else if(command==='participants.save') {
    const enrollmentId=v.id(raw.enrollmentId),stakeholderId=v.id(raw.stakeholderId);
    const enrollment=clients.enrollments.find(row=>row.id===enrollmentId&&row.company===company);
    if(!enrollment) v.invalid('Contratação não encontrada.');
    if(!enrollmentCanReceiveWork(enrollment)) v.invalid('A contratação está encerrada ou arquivada e suas participações são somente leitura.');
    const previous=clients.participations.find(p=>p.enrollmentId===enrollmentId&&p.stakeholderId===stakeholderId);
    const contact=stakeholderInput({...raw,name:'participação',role:'participação'},company);
    const participation={id:previous?.id??crypto.randomUUID(),company,enrollmentId,stakeholderId,accountRole:contact.accountRole,primary:contact.primary,active:contact.active,stance:contact.stance,influence:contact.influence,notes:contact.notes};
    const participationIssue=participationError(participation,clients.enrollments,contacts,clients.participations);if(participationIssue)v.invalid(participationIssue);
    clients={...clients,participations:upsertParticipation(clients.participations,participation,clients.enrollments,contacts)};
    changed.add(CLIENTS);emit('participation.updated',participation.id);data={participation};
  }
  if(sale) {
    const seenReferences=new Set<string>();
    if(external) seenReferences.add(JSON.stringify([external.system,external.kind,external.externalId]));
    async function entityReference(value:unknown,kind:string) {
      if(value===undefined) return undefined;
      const ref=v.object(value);
      if(ref.kind!==undefined&&ref.kind!==kind) v.invalid('O tipo da referência externa não corresponde à entidade.');
      const parsed={system:v.id(ref.system),kind,externalId:v.string(ref.externalId,'identificador externo',undefined,300)};
      if(!parsed.externalId) v.invalid('Referência externa vazia.');
      const identity=JSON.stringify([parsed.system,parsed.kind,parsed.externalId]);
      if(seenReferences.has(identity)) v.invalid('Não repita referências externas na mesma venda.');
      seenReferences.add(identity);
      const existing=await db.prepare('SELECT entity_id FROM external_references WHERE workspace_id=? AND system=? AND kind=? AND external_id=?').bind(workspace,parsed.system,kind,parsed.externalId).first<{entity_id:string}>();
      return {...parsed,existingId:existing?.entity_id};
    }
    function stageReference(ref:Awaited<ReturnType<typeof entityReference>>,entityId:string) {
      if(!ref) return;
      if(ref.existingId&&ref.existingId!==entityId) throw new OperationError(409,'external_reference_conflict','A referência externa identifica outro registro.');
      if(!ref.existingId) references.push({system:ref.system,kind:ref.kind,externalId:ref.externalId,entityId});
    }
    stageReference(await entityReference(saleClient!.externalReference,'client'),company);
    const rows=(value:unknown,label:string,max:number)=>{
      if(!Array.isArray(value)||value.length>max) return v.invalid(`Revise ${label}: limite de ${max} itens.`);
      return value.map(v.object);
    };
    const contactRows=rows(request.contacts??[],'os contatos',100);
    const purchases=rows(request.enrollments,'as contratações',20);
    if(!purchases.length) v.invalid('Informe pelo menos uma contratação na venda.');
    const contactIds=new Map<string,string>(),purchaseRefs=new Set<string>();
    const savedContacts:{ref:string;stakeholder:ReturnType<typeof stakeholderInput>}[]=[];
    if(contactRows.length) await permit('stakeholders.editar','stakeholders:write');
    for(const row of contactRows) {
      if(Object.keys(row).some(k=>!['ref','stakeholderId','stakeholder','externalReference'].includes(k))) v.invalid('Contato da venda inválido.');
      const ref=v.id(row.ref,'referência local do contato');
      if(contactIds.has(ref)) v.invalid('Não repita a referência local de contato.');
      if(row.stakeholderId!==undefined&&row.stakeholder!==undefined) v.invalid('Informe um stakeholder existente ou seus dados.');
      const externalContact=await entityReference(row.externalReference,'stakeholder');
      const contactId=row.stakeholderId===undefined?externalContact?.existingId:v.id(row.stakeholderId);
      if(externalContact?.existingId&&contactId!==externalContact.existingId) v.invalid('Stakeholder e referência externa não correspondem.');
      const previous=contactId?contacts.find(c=>c.id===contactId&&c.company===company):undefined;
      if(contactId&&!previous) v.invalid('Stakeholder não pertence ao cliente desta venda.');
      if(!previous&&row.stakeholder===undefined) v.invalid('Informe os dados do novo stakeholder.');
      let next=previous;
      if(row.stakeholder!==undefined) {
        const source=v.object(row.stakeholder);
        if(['id','company','org'].some(k=>Object.hasOwn(source,k))) v.invalid('A identidade do stakeholder é definida pelo servidor.');
        const candidate=stakeholderInput(source,company,previous);
        const issue=stakeholderError(candidate,[...contacts,...workspaceMembers]);if(issue)v.invalid(issue);
        next=normalizeContactPoints(candidate);
        contacts=upsertStakeholder(contacts,next);changed.add(CONTACTS);emit(previous?'stakeholder.updated':'stakeholder.created',next.id);
      }
      if(!next) v.invalid('Stakeholder não encontrado.');
      if([...contactIds.values()].includes(next.id)) v.invalid('Informe cada stakeholder uma única vez na venda.');
      stageReference(externalContact,next.id);contactIds.set(ref,next.id);savedContacts.push({ref,stakeholder:next});
    }
    const savedEnrollments:{ref:string;enrollment:ProductEnrollment;participants:typeof clients.participations}[]=[];
    let participantCount=0;
    for(const purchase of purchases) {
      if(Object.keys(purchase).some(k=>!['ref','productId','productVersion','startsAt','endsAt','soldAt','previousEnrollmentId','prepared','participants','externalReference'].includes(k))) v.invalid('Contratação da venda inválida.');
      const ref=v.id(purchase.ref,'referência local da contratação');
      if(purchaseRefs.has(ref)) v.invalid('Não repita a referência local de contratação.');purchaseRefs.add(ref);
      if(purchase.startsAt===undefined) v.invalid('Informe o início de cada contratação.');
      const externalEnrollment=await entityReference(purchase.externalReference,'enrollment');
      if(externalEnrollment?.existingId) throw new OperationError(409,'external_reference_conflict','Esta contratação externa já foi registrada em outra venda.');
      const enrollment=await enroll(purchase,purchase.prepared);stageReference(externalEnrollment,enrollment.id);
      const participants:typeof clients.participations=[];
      const participantRows=rows(purchase.participants??[],'os participantes',100);
      participantCount+=participantRows.length;if(participantCount>200) v.invalid('A venda aceita até 200 participações.');
      if(participantRows.length) await permit('stakeholders.editar','enrollments:write');
      const used=new Set<string>();
      for(const person of participantRows) {
        if(Object.keys(person).some(k=>!['stakeholderId','stakeholderRef','accountRole','primary','active','stance','influence','notes'].includes(k))) v.invalid('Participante da venda inválido.');
        if((person.stakeholderRef!==undefined)===(person.stakeholderId!==undefined)) v.invalid('Informe stakeholderRef ou stakeholderId.');
        const stakeholderId=person.stakeholderId===undefined?contactIds.get(v.id(person.stakeholderRef)):v.id(person.stakeholderId);
        if(!stakeholderId) v.invalid('Referência local de stakeholder desconhecida.');
        if(used.has(stakeholderId)) v.invalid('Não repita o participante na mesma contratação.');used.add(stakeholderId);
        const details=stakeholderInput({...person,name:'participação',role:'participação'},company);
        const participation={id:crypto.randomUUID(),company,enrollmentId:enrollment.id,stakeholderId,accountRole:details.accountRole,primary:details.primary,active:details.active,stance:details.stance,influence:details.influence,notes:details.notes};
        const issue=participationError(participation,clients.enrollments,contacts,clients.participations);if(issue)v.invalid(issue);
        clients={...clients,participations:upsertParticipation(clients.participations,participation,clients.enrollments,contacts)};
        participants.push(participation);changed.add(CLIENTS);emit('participation.created',participation.id);
      }
      savedEnrollments.push({ref,enrollment,participants});
    }
    // Buying execution does not change an existing client's selected plan or progress.
    delivery={...delivery,companyJourney:previousSelection.journey,companyMilestone:previousSelection.milestone,companyJourneyVersion:previousSelection.version};
    if(creating||(promoteFirstPurchase&&savedEnrollments.length===1)) {
      delivery.companyJourney[company]=savedEnrollments[0].enrollment.planId!;
      delivery.companyMilestone[company]=1;
      delete delivery.companyJourneyVersion[company];
    }
    data={saleId:operationId,client:companyRecord,contacts:savedContacts.map(row=>({...row,stakeholder:contacts.find(c=>c.id===row.stakeholder.id)!})),enrollments:savedEnrollments.map(row=>({...row,participants:clients.participations.filter(p=>p.enrollmentId===row.enrollment.id)}))};
    emit('sale.registered',operationId);
  }
  if((creating||promoteFirstPurchase)&&purchasedModels.size===1) {
    const model=[...purchasedModels][0];
    const config=projectClients(clients).configFor(company);
    if(config.model!==model) {
      clients={...clients,configs:{...clients.configs,[company]:{...config,model}}};
      changed.add(CLIENTS);
    }
  }
  if(changed.has(DELIVERY)) {
    const all=projectClients(clients),execution=projectDelivery(delivery);
    delivery=scheduledExecution(delivery,execution.tasks.filter(t=>t.company===company),execution.cycles.filter(c=>c.company===company),Object.fromEntries(all.allClients.map(c=>[c.slug,c.startedAt])),Object.fromEntries(clients.enrollments.map(e=>[e.id,e.startsAt])));
  }
  let activeClientDelivery=false;
  if(activeSlice&&command==='clients.configure') {
    const addedPurchases=(data as {enrollments:ProductEnrollment[]}).enrollments;
    const addedPlanIds=addedPurchases.map(enrollment=>enrollment.planId);
    const before=JSON.parse(initialOwnership!) as {companies:string[];plans:string[]};
    const after=JSON.parse(clientOwnership(clients)) as typeof before;
    const ownershipChanged=clientOwnership(clients)!==initialOwnership;
    const simpleAddition=addedPurchases.length>0&&
      addedPurchases.every(enrollment=>!enrollment.legacy&&enrollment.planId&&
        !Object.hasOwn(initialDelivery.productPlans,enrollment.planId)&&
        Object.hasOwn(delivery.productPlans,enrollment.planId))&&
      new Set(addedPlanIds).size===addedPlanIds.length&&
      JSON.stringify(after.companies)===JSON.stringify(before.companies)&&
      JSON.stringify(after.plans)===JSON.stringify([...before.plans,
        ...addedPlanIds.map(id=>`${company}\u0000${id}`)].sort());
    if(ownershipChanged&&!simpleAddition)
      return executeCommercialCommand(db,workspace,principal,command,input,key,expectedVersions,true);
    if(canonical(delivery)===canonical(initialDelivery)) {
      changed.delete(DELIVERY);
      const transaction=crypto.randomUUID();
      statements.unshift(db.prepare(`INSERT INTO delivery_client_guards
        (transaction_id,workspace_id,company,generation,expected_revision,expected_mode,expected_incarnation)
        VALUES(?,?,?,?,?,'active',?)`).bind(transaction,workspace,company,activeSlice.generation,
          activeSlice.revision,activeSlice.incarnation));
      statements.push(db.prepare('DELETE FROM delivery_client_guards WHERE transaction_id=?').bind(transaction));
      guards=guards.filter(guard=>guard.key!==DELIVERY||expectedVersions[DELIVERY]!==undefined);
    } else {
      const partition=partitionClientDelivery(delivery,clients.enrollments.filter(enrollment=>enrollment.company===company));
      if(partition.unassigned.length||partition.sharedPlanIds.length||
         partition.slices.some(slice=>slice.company!==company))
        return executeCommercialCommand(db,workspace,principal,command,input,key,expectedVersions,true);
      try {
        statements.push(...await activeTaskStatements(db,workspace,activeSlice,delivery,600,
          command,simpleAddition?new Set(addedPlanIds as string[]):
            new Set(products.journeys.filter(journey=>!delivery.productPlans[journey.id]).map(journey=>journey.id)),
          false,docs.get(CLIENTS)!.version));
      } catch(error) {
        if(error instanceof ClientScopeRequiresBridge)
          return executeCommercialCommand(db,workspace,principal,command,input,key,expectedVersions,true);
        throw error;
      }
      changed.delete(DELIVERY);
      activeClientDelivery=true;
    }
  } else if(activeSlice&&(command==='enrollments.create'||sale&&!creating)) {
    const purchased=sale
      ?(data as {enrollments:{enrollment:ProductEnrollment}[]}).enrollments.map(row=>row.enrollment)
      :[(data as {enrollment:ProductEnrollment}).enrollment];
    const planIds=purchased.map(enrollment=>enrollment.planId);
    const before=JSON.parse(initialOwnership!) as {companies:string[];plans:string[]};
    const after=JSON.parse(clientOwnership(clients)) as typeof before;
    if(planIds.some(id=>!id||initialDelivery.productPlans[id])||
       new Set(planIds).size!==planIds.length||
       JSON.stringify(after.companies)!==JSON.stringify(before.companies)||
       JSON.stringify(after.plans)!==JSON.stringify([...before.plans,...planIds.map(id=>`${company}\u0000${id}`)].sort()))
      return executeCommercialCommand(db,workspace,principal,command,input,key,expectedVersions,true);
    try {
      statements.push(...await activeTaskStatements(db,workspace,activeSlice,delivery,600,
        command,new Set(planIds as string[]),false,docs.get(CLIENTS)!.version));
    } catch(error) {
      if(error instanceof ClientScopeRequiresBridge)
        return executeCommercialCommand(db,workspace,principal,command,input,key,expectedVersions,true);
      throw error;
    }
    changed.delete(DELIVERY); activeClientDelivery=true;
  } else if(activeSlice&&(command==='enrollments.remove'||command==='enrollments.rebuild')) {
    const prepared=await activeClientLifecycleStatements(db,workspace,company,activeSlice,
      initialDelivery,delivery,clients.enrollments,command,lifecycleOriginalPlanId,data,
      docs.get(CLIENTS)!.version);
    if(!prepared) return executeCommercialCommand(db,workspace,principal,command,input,key,expectedVersions,true);
    statements.push(...prepared); changed.delete(DELIVERY); activeClientDelivery=true;
  } else if(activeNewClient&&creating) {
    const purchased=clients.enrollments.filter(enrollment=>enrollment.company===company);
    const planIds=purchased.map(enrollment=>enrollment.planId);
    const selectedPlan=delivery.companyJourney[company];
    if(planIds.some(id=>!id||!Object.hasOwn(delivery.productPlans,id))||
       new Set(planIds).size!==planIds.length||
       Object.keys(delivery.productPlans).length!==planIds.length||
       (selectedPlan!==undefined&&!planIds.includes(selectedPlan)))
      return executeCommercialCommand(db,workspace,principal,command,input,key,expectedVersions,true);
    for(const planId of planIds)
      if(!await unclaimedPrivatePlan(db,workspace,company,planId!,activeNewClient.version))
        return executeCommercialCommand(db,workspace,principal,command,input,key,expectedVersions,true);
    try {
      statements.push(...await activeNewClientStatements(db,workspace,company,
        activeNewClient,delivery,purchased,600));
    } catch(error) {
      if(error instanceof ClientScopeRequiresBridge)
        return executeCommercialCommand(db,workspace,principal,command,input,key,expectedVersions,true);
      throw error;
    }
    changed.delete(DELIVERY); activeClientDelivery=true;
  }
  const values:Record<string,unknown>={[CLIENTS]:clients,[DELIVERY]:delivery,[CONTACTS]:{contacts}};
  const writes=[...changed].map(key=>({key,value:values[key]}));
  const documents=writes.map(w=>({...w,version:guards.find(g=>g.key===w.key)!.version+1,updatedAt:at}));
  const result={data,documents:principal.kind==='session'?documents:[],authorizationRequirements:requirements};
  const receiptResult={...result,documents:principal.kind==='session'?documents.map(({key,version,updatedAt})=>({key,version,updatedAt})):[]};
  return replayResult(await commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash, checked: true,id:operationId,guards,writes,events,result,receiptResult,statements,activeClientDelivery,references:[...references,...(external?[{...external,entityId:sale?operationId:command==='enrollments.create'?(data as {enrollment:ProductEnrollment}).enrollment.id:company}]:[])]}));
}
