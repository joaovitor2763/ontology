import type { ServerEnv } from '../context';
import { getDoc } from '../db.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { commitOperation, receipt, requestHash } from './transaction.ts';
import { OperationError } from './errors.ts';
import * as v from './input.ts';
import { enrollmentMilestone, milestoneAdvance } from '../../modules/catalog/domain/journey-progress.ts';
import { normalizeClientsSnapshot } from '../../modules/clients/infrastructure/snapshot.ts';
import { resolveClientJourney, normalizeCatalogSnapshot } from '../../modules/catalog/infrastructure/snapshot.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
import { normalizeDeliverySnapshot, projectDelivery } from '../../modules/delivery/infrastructure/snapshot.ts';
import { projectCatalog } from '../../modules/catalog/infrastructure/snapshot.ts';
import { changePlanSchedule, selectPlanScheduleExecution } from '../../modules/delivery/application/plan-schedule.ts';
import { scheduledExecution } from '../../modules/delivery/application/task-deadlines.ts';
import type { DateChange } from '../../modules/delivery/application/plan-execution.ts';
import { enrollmentCanReceiveWork } from '../../modules/clients/domain/product-enrollments.ts';
import { activeTaskStatements, clientSnapshotFor, ClientScopeRequiresBridge,
  readActiveCompanySlice } from './delivery-client-task-write.ts';
const KEY='ontology.delivery.v2';
export async function executePlanCommand(env:ServerEnv,principal:OperationPrincipal,command:string,input:unknown,key:string,
  expectedVersions:Record<string,number>={},skipActive=false,expectedClientSnapshot?:string) {
  if(!['plans.schedule','plans.advance'].includes(command)) throw new OperationError(404,'unknown_command','Operação não encontrada.');
  if(!env.DB) throw new OperationError(503,'database_unavailable','Banco indisponível.');
  const db=env.DB,workspace=env.WORKSPACE_ID||'default',raw=v.object(input),company=v.id(raw.company),planId=v.id(raw.planId);
  let guards=await authorizeOperation(db,workspace,principal,{action:'plano.editar',scope:'delivery:write',company});
  if(command==='plans.advance') guards=[...guards,...await authorizeOperation(db,workspace,principal,{action:'plano.editar',scope:'enrollments:write',company})];
  const hash=await requestHash(command,input),saved=await receipt(db,workspace,principal.id,key,command,hash);
  if(saved) return saved.result;
  const activeSlice=!skipActive?await readActiveCompanySlice(db,workspace,company):null;
  if(expectedClientSnapshot&&(!activeSlice||clientSnapshotFor(activeSlice)!==expectedClientSnapshot))
    throw new OperationError(409,'snapshot_changed','A execução do cliente mudou. Atualize antes de salvar.',
      {clientSnapshot:activeSlice?clientSnapshotFor(activeSlice):null});
  const [doc,clientsDoc,catalogDoc]=await Promise.all([
    activeSlice?Promise.resolve({value:activeSlice.snapshot,version:activeSlice.version}):getDoc(db,workspace,KEY),
    getDoc(db,workspace,'ontology.clients.v3'),getDoc(db,workspace,'ontology.catalog.v2'),
  ]);
  const versions=new Map(guards.map(g=>[g.key,g.version]));
  for(const [key,version] of [[KEY,doc?.version??0],['ontology.clients.v3',clientsDoc?.version??0],['ontology.catalog.v2',catalogDoc?.version??0]] as const) {
    if(versions.has(key)&&versions.get(key)!==version) throw new OperationError(409,'version_conflict','Os dados mudaram durante a operação.');
    versions.set(key,version);
  }
  for(const [name,version] of Object.entries(expectedVersions)) {
    if(!Number.isSafeInteger(version)||version<0) v.invalid('Versão inválida.');
    if(versions.has(name)&&versions.get(name)!==version) throw new OperationError(409,'version_conflict','Atualize os dados antes de salvar.');
  }
  const clients=projectClients(clientsDoc?.value??{}),state=normalizeDeliverySnapshot(doc?.value??{});
  if(!clients.allClients.some(c=>c.slug===company)) throw new OperationError(404,'client_not_found','Cliente não encontrado.');
  let plan=projectCatalog(catalogDoc?.value??{},state.productPlans).journeys.find(p=>p.id===planId);
  if(!plan) v.invalid('Plano não encontrado.');
  const matching=clients.enrollments.filter(e=>e.planId===planId&&e.company===company);
  const assigned=state.companyJourney[company]??clients.allClients.find(c=>c.slug===company)!.journeyId;
  const all=projectDelivery(state,company);
  const legacy=selectPlanScheduleExecution(all,planId,assigned);
  const hasLegacy=legacy.cycles.length>0||legacy.tasks.length>0;
  // null explicitly selects historical execution; omission only infers an
  // enrollment when no other eligible execution would become inaccessible.
  const legacySelected=raw.enrollmentId===null;
  const enrollmentId=raw.enrollmentId===undefined||legacySelected?undefined:v.id(raw.enrollmentId);
  if(raw.enrollmentId===undefined&&(matching.length>1||(matching.length===1&&hasLegacy))) v.invalid('Escolha a contratação ou a execução sem contratação para ajustar suas datas.');
  const enrollment=legacySelected?undefined:enrollmentId?matching.find(e=>e.id===enrollmentId):matching[0];
  if(enrollmentId&&!enrollment) v.invalid('Contratação não pertence ao cliente e plano informados.');
  if(enrollment&&!enrollmentCanReceiveWork(enrollment)) v.invalid('A contratação precisa estar ativa ou planejada e não arquivada.');
  if(!enrollment&&assigned!==planId) v.invalid('O plano legado não é o plano atribuído a este cliente.');
  if(state.productPlans[planId]&&!enrollment&&!all.tasks.some(t=>!t.enrollmentId&&t.journeyId===planId)) v.invalid('Plano não pertence ao cliente.');
  const {cycles,tasks}=enrollment?selectPlanScheduleExecution(all,planId,assigned,enrollment.id):legacy;
  if(command==='plans.advance') {
    if(raw.enrollmentId===undefined || Object.keys(raw).some(name=>!['company','planId','enrollmentId','currentMilestone','justification'].includes(name))) v.invalid('Informe contratação explícita (ou null para legado) e somente os campos do avanço.');
    const client=clients.allClients.find(c=>c.slug===company)!;
    if(assigned===planId) plan=resolveClientJourney(normalizeCatalogSnapshot(catalogDoc?.value??{}),state,client);
    const legacyMilestone=state.companyMilestone[company]??client.milestone;
    const current=enrollment?enrollmentMilestone(enrollment,plan,matching.length===1&&!hasLegacy&&assigned===planId?legacyMilestone:undefined):legacyMilestone;
    if(!Number.isSafeInteger(raw.currentMilestone)||raw.currentMilestone!==current) throw new OperationError(409,'milestone_conflict','O marco atual mudou. Atualize o plano.');
    const advance=milestoneAdvance(plan,tasks,current,current),justification=v.string(raw.justification,'justificativa','',4000).trim();
    if(!advance.next||advance.empty) v.invalid('Este marco não pode avançar: revise as tarefas e o próximo marco.');
    if(!advance.ready&&justification.length<10) throw new OperationError(422,'milestone_pending','Conclua as pendências ou registre uma justificativa de pelo menos 10 caracteres.');
    const at=new Date().toISOString(),entry={from:current,to:advance.next.n,at,by:principal.memberId,...(justification?{justification}:{}),pendingTaskIds:advance.pending.map(t=>t.id)};
    const target=enrollment?'ontology.clients.v3':KEY;
    const next=enrollment?{...normalizeClientsSnapshot(clientsDoc?.value??{}),enrollments:clients.enrollments.map(e=>e.id===enrollment.id?{...e,milestone:advance.next!.n,milestoneHistory:[...(e.milestoneHistory??[]),entry]}:e)}:{...state,companyMilestone:{...state.companyMilestone,[company]:advance.next.n}};
    let statements:D1PreparedStatement[]=[];
    if(activeSlice&&enrollment) {
      const transaction=crypto.randomUUID();
      statements=[db.prepare(`INSERT INTO delivery_client_guards
        (transaction_id,workspace_id,company,generation,expected_revision,expected_mode,expected_incarnation)
        VALUES(?,?,?,?,?,'active',?)`).bind(transaction,workspace,company,activeSlice.generation,
          activeSlice.revision,activeSlice.incarnation),
        db.prepare('DELETE FROM delivery_client_guards WHERE transaction_id=?').bind(transaction)];
    }
    else if(activeSlice) try {statements=await activeTaskStatements(db,workspace,activeSlice,next as typeof state,780,command);}
    catch(error){if(error instanceof ClientScopeRequiresBridge) {
      if(expectedClientSnapshot) throw new OperationError(409,'scoped_command_unavailable',
        'Este avanço exige o fluxo completo de execução.');
      return executePlanCommand(env,principal,command,input,key,expectedVersions,true);
    } throw error;}
    return commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash,id:crypto.randomUUID(),guards:[...versions].filter(([name])=>name!==KEY||!activeSlice||expectedVersions[KEY]!==undefined).map(([key,version])=>({key,version})),writes:activeSlice&&!enrollment?[]:[{key:target,value:next}],statements,events:[{type:'plan.milestone.advanced',company,subject:enrollment?.id??planId,data:{planId,enrollmentId:enrollment?.id??null,...entry}}],result:{data:{company,planId,enrollmentId:enrollment?.id??null,...entry},documents:principal.kind==='session'&&(!activeSlice||enrollment)?[{key:target,value:next,version:versions.get(target)!+1,updatedAt:at}]:[],...(activeSlice?{clientSnapshot:clientSnapshotFor(activeSlice,activeSlice.revision+Number(!enrollment))}:{})}});
  }
  const rows=(value:unknown):DateChange[]=>{
    if(!Array.isArray(value)||value.length>1000) return v.invalid('Informe uma lista válida de datas.');
    return value.map(row=>{const r=v.object(row);return{id:v.id(r.id),startsAt:v.string(r.startsAt,'início'),endsAt:v.string(r.endsAt,'fim')};});
  };
  const changes={cycles:rows(raw.cycles??[]),tasks:rows(raw.tasks??[])},at=new Date().toISOString();
  let next;
  try {
    next=changePlanSchedule(state,{cycles,tasks},changes,principal.memberId,at);
    const execution=projectDelivery(next,company);
    next=scheduledExecution(next,execution.tasks.filter(t=>tasks.some(selected=>selected.id===t.id)),execution.cycles.filter(c=>cycles.some(selected=>selected.id===c.id)),Object.fromEntries(clients.allClients.map(c=>[c.slug,c.startedAt])),Object.fromEntries(clients.enrollments.map(e=>[e.id,e.startsAt])));
  } catch(error) {throw new OperationError(422,'invalid_schedule',error instanceof Error?error.message:'Datas inválidas.');}
  let statements:D1PreparedStatement[]=[];
  if(activeSlice) try {statements=await activeTaskStatements(db,workspace,activeSlice,next,780,command);}
  catch(error){if(error instanceof ClientScopeRequiresBridge) {
    if(expectedClientSnapshot) throw new OperationError(409,'scoped_command_unavailable',
      'Esta alteração de datas exige o fluxo completo de execução.');
    return executePlanCommand(env,principal,command,input,key,expectedVersions,true);
  } throw error;}
  return commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash,id:crypto.randomUUID(),guards:[...versions].filter(([name])=>name!==KEY||!activeSlice||expectedVersions[KEY]!==undefined).map(([key,version])=>({key,version})),writes:activeSlice?[]:[{key:KEY,value:next}],statements,events:[{type:'plan.schedule.updated',company,subject:planId}],result:{data:{planId,company,enrollmentId:enrollment?.id??null,cycles:changes.cycles.map(c=>c.id),tasks:changes.tasks.map(t=>t.id)},documents:principal.kind==='session'&&!activeSlice?[{key:KEY,value:next,version:versions.get(KEY)!+1,updatedAt:at}]:[],...(activeSlice?{clientSnapshot:clientSnapshotFor(activeSlice,activeSlice.revision+1)}:{})}});
}
