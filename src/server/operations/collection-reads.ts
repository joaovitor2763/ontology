import type { ServerEnv } from '../context';
import type { OperationPrincipal } from './principal.ts';
import { authorizeOperation } from './principal.ts';
import { OperationError } from './errors.ts';
import { getDoc } from '../db.ts';
import { prefetchDocuments } from './request-context.ts';
import { fingerprint } from '../../modules/catalog/domain/publication.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
import { allocationsForEnrollment, currentAllocations, effectiveClientAllocations } from './allocation-relations.ts';
import { responsibilityIndex, matchesResponsible } from '../../modules/clients/domain/responsibility-filters.ts';
import { projectCatalog } from '../../modules/catalog/infrastructure/snapshot.ts';
import { projectDelivery } from '../../modules/delivery/infrastructure/snapshot.ts';
import { scopedDeliverySnapshotWithVersion } from './delivery-record-read.ts';
import { readEffectiveDeliveryPage } from './delivery-effective-read.ts';
import { readActiveGlobalCyclePage, readActiveGlobalTaskPage } from './delivery-global-effective-read.ts';
import { validDate } from '../../modules/delivery/application/plan-execution.ts';
import { projectStakeholders } from '../../modules/clients/infrastructure/stakeholders-snapshot.ts';
import { projectMeetings, projectAllMeetings } from '../../modules/engagement/infrastructure/snapshot.ts';
import type { IntegrationScope } from './credentials.ts';

/**
 * Leitura das coleções do catálogo, dos clientes e da execução, com o mesmo
 * recorte de permissão por cliente que as demais rotas aplicam.
 */
export async function readCollection(
  request: Request,
  env: ServerEnv,
  workspace: string,
  principal: OperationPrincipal,
  path: string[],
): Promise<unknown> {
  if (!env.DB)
    throw new OperationError(503, 'database_unavailable', 'Banco de dados não configurado.');
  const db = env.DB;
  const [resource, company, child, record] = path;
  const url=new URL(request.url),selected=resource==='clients'&&company?company:url.searchParams.get('company')??undefined;
  const collection=resource==='clients'&&child?child:resource;
  const scopes:Record<string,IntegrationScope>={clients:'clients:read',products:'catalog:read',plans:'catalog:read',enrollments:'enrollments:read',participants:'enrollments:read',stakeholders:'stakeholders:read',cycles:'delivery:read',tasks:'delivery:read',meetings:'meetings:read'};
  const scope=scopes[collection];
  if(!scope) throw new OperationError(404,'not_found','Recurso não encontrado.');
  // Cadastro de clientes (autorização) e documento da coleção numa ida só.
  const collectionKey:Record<string,string>={meetings:'ontology.engagement.v2',plans:'ontology.catalog.v2',products:'ontology.catalog.v2',stakeholders:'ontology.stakeholders.v1',cycles:'ontology.delivery.v2',tasks:'ontology.delivery.v2'};
  const scopedDelivery = Boolean(selected && (collection === 'tasks' || collection === 'cycles'));
  const indexedGlobalDelivery = !selected &&
    (collection === 'cycles' || collection === 'tasks');
  prefetchDocuments(db,workspace,[...(!scopedDelivery?['ontology.clients.v3']:[]),...(collectionKey[collection]&&!scopedDelivery&&!indexedGlobalDelivery?[collectionKey[collection]]:[])]);
  const permitted=selected?[selected]:principal.companies;
  if(permitted?.length) for(const slug of permitted) await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope,company:slug});
  else if(permitted===null) await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope});
  else if(permitted?.length===0) await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope});
  const load=async(key:string)=>(await getDoc(db,workspace,key))?.value??{};
  // A página SQL de um cliente já passou pela autorização indexada. Buscar o
  // cadastro inteiro aqui anulava parte do ganho de não ler a execução global.
  const clientsDoc=scopedDelivery?null:await getDoc(db,workspace,'ontology.clients.v3');
  const clients=projectClients(clientsDoc?.value??{});
  const activeClients=new Set(clients.clients.map(c=>c.slug));
  const allowed=(slug:string)=>permitted===null||permitted===undefined||permitted.includes(slug);
  const memberId=url.searchParams.get('memberId')??undefined,role=url.searchParams.get('role')??undefined,productId=url.searchParams.get('productId')??undefined;
  const clientResponsibleId=url.searchParams.get('clientResponsibleId')??undefined,productResponsibleId=url.searchParams.get('productResponsibleId')??undefined;
  const query=url.searchParams.get('q')?.trim()??'';
  const status=url.searchParams.get('status')??undefined,healthFlag=url.searchParams.get('healthFlag')??undefined;
  const milestoneText=url.searchParams.get('milestone');
  const currentOnlyText=url.searchParams.get('currentOnly');
  const includeArchivedText=url.searchParams.get('includeArchived');
  const view=url.searchParams.get('view');
  const expectedVersionText=url.searchParams.get('expectedVersion');
  const expectedClientSnapshot=url.searchParams.get('expectedClientSnapshot')??undefined;
  const clientList=resource==='clients'&&!child&&!company;
  if ((!clientList && (clientResponsibleId !== undefined || productResponsibleId !== undefined)) || (productResponsibleId !== undefined && !productId)) throw new OperationError(400,'invalid_filter','Responsável pelo produto exige productId na lista de clientes.');
  const enrollmentList=(resource==='enrollments'&&!company)||(resource==='clients'&&child==='enrollments'&&!record);
  const taskList=resource==='tasks'&&!company,cycleList=resource==='cycles'&&!company;
  const deliveryList=taskList||cycleList;
  if(expectedClientSnapshot!==undefined&&(!deliveryList||!selected||
    !/^[A-Za-z0-9:_-]{1,160}$/.test(expectedClientSnapshot)))
    throw new OperationError(400,'invalid_filter','Marcador da página do cliente inválido.');
  const dueFrom=url.searchParams.get('dueFrom')??undefined,dueTo=url.searchParams.get('dueTo')??undefined;
  const ownerId=url.searchParams.get('ownerId')??undefined,enrollmentId=url.searchParams.get('enrollmentId')??undefined;
  const sort=url.searchParams.get('sort')??undefined;
  if(!clientList&&!enrollmentList&&[memberId,role,productId].some(value=>value!==undefined)) throw new OperationError(400,'invalid_filter','Filtro não disponível nesta consulta.');
  if(!clientList&&url.searchParams.has('q')) throw new OperationError(400,'invalid_filter','Busca não disponível nesta consulta.');
  if(!clientList&&!deliveryList&&(status!==undefined||healthFlag!==undefined)) throw new OperationError(400,'invalid_filter','Filtro não disponível nesta consulta.');
  if(!clientList&&healthFlag!==undefined) throw new OperationError(400,'invalid_filter','Filtro de saúde não disponível nesta consulta.');
  if(!deliveryList&&[dueFrom,dueTo,ownerId,enrollmentId,sort].some(value=>value!==undefined)) throw new OperationError(400,'invalid_filter','Filtro de execução não disponível nesta consulta.');
  if(cycleList&&[dueFrom,dueTo,ownerId,sort].some(value=>value!==undefined)) throw new OperationError(400,'invalid_filter','Filtro de tarefa não disponível para ciclos.');
  if((dueFrom!==undefined&&!validDate(dueFrom))||(dueTo!==undefined&&!validDate(dueTo))||(dueFrom&&dueTo&&dueFrom>dueTo)) throw new OperationError(400,'invalid_filter','Período inválido.');
  if(sort!==undefined&&!['position','dueAt'].includes(sort)) throw new OperationError(400,'invalid_filter','Ordenação inválida.');
  if(taskList&&status!==undefined&&!['fila','em-curso','revisao','entregue','bloqueado'].includes(status)) throw new OperationError(400,'invalid_filter','Status de tarefa inválido.');
  if(cycleList&&status!==undefined&&!['planejado','em-curso','em-aceite','concluido'].includes(status)) throw new OperationError(400,'invalid_filter','Status de ciclo inválido.');
  if([ownerId,enrollmentId].some(value=>value!==undefined&&!value.trim())) throw new OperationError(400,'invalid_filter','Filtro vazio.');
  if(!enrollmentList&&(milestoneText!==null||currentOnlyText!==null)) throw new OperationError(400,'invalid_filter','Filtro de contratação não disponível nesta consulta.');
  if(!clientList&&includeArchivedText!==null) throw new OperationError(400,'invalid_filter','Filtro de clientes não disponível nesta consulta.');
  if(view!==null&&(!clientList||!['summary','full'].includes(view))) throw new OperationError(400,'invalid_filter','Visão inválida.');
  if(expectedVersionText!==null) {
    if(!clientList&&!enrollmentList&&!deliveryList||!/^\d+$/.test(expectedVersionText)||!Number.isSafeInteger(Number(expectedVersionText))) throw new OperationError(400,'invalid_filter','Versão esperada inválida.');
    if((clientList||enrollmentList)&&Number(expectedVersionText)!==(clientsDoc?.version??0)) throw new OperationError(409,'snapshot_changed','A lista mudou. Recomece pela primeira página.',{snapshotVersion:clientsDoc?.version??0});
  }
  if ([memberId,role,productId,status,healthFlag,clientResponsibleId,productResponsibleId].some(value=>value!==undefined&&!value.trim())) throw new OperationError(400,'invalid_filter','Filtro vazio.');
  if(milestoneText!==null&&(!/^\d+$/.test(milestoneText)||Number(milestoneText)<1)) throw new OperationError(400,'invalid_filter','Marco inválido.');
  if(currentOnlyText!==null&&!['true','false'].includes(currentOnlyText)) throw new OperationError(400,'invalid_filter','Filtro currentOnly inválido.');
  if(includeArchivedText!==null&&!['true','false'].includes(includeArchivedText)) throw new OperationError(400,'invalid_filter','Filtro includeArchived inválido.');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const current=currentAllocations(clients,today),effective=effectiveClientAllocations(clients,current);
  const responsibilities=clientResponsibleId||productResponsibleId?responsibilityIndex(clients,today,productId):null;
  const assigned=(slug:string,enrollmentId?:string)=>{
    const rows=enrollmentId?allocationsForEnrollment(current,slug,enrollmentId):effective.filter(a=>a.company===slug);
    return rows.some(a=>(!memberId||a.memberId===memberId)&&(!role||a.role===role));
  };
  if(resource==='clients'&&company&&!clients.allClients.some(c=>c.slug===company&&allowed(c.slug))) throw new OperationError(404,'not_found','Cliente não encontrado.');
  const limit=url.searchParams.has('limit')?Number(url.searchParams.get('limit')):50;
  if(!Number.isSafeInteger(limit)||limit<1||limit>100) throw new OperationError(400,'invalid_limit','Informe um limite inteiro de 1 a 100.');
  const cursor=Number(url.searchParams.get('cursor')??0);
  if(!Number.isSafeInteger(cursor)||cursor<0) throw new OperationError(400,'invalid_cursor','Cursor inválido.');
  // Detail reads in active mode resolve one owner and decode only its slice.
  // A missing owner is a genuine 404; an indexed owner with a missing slice
  // signals an incomplete generation and must never fall back to the frozen
  // workspace document.
  if ((resource === 'tasks' || resource === 'cycles') && company) {
    const owner = await db.prepare(`SELECT m.mode,m.generation,o.company
      FROM delivery_client_shadow_meta m
      LEFT JOIN delivery_entity_owners o ON o.workspace_id=m.workspace_id
        AND o.generation=m.generation AND o.kind=? AND o.id=?
      WHERE m.workspace_id=?`)
      .bind(resource === 'tasks' ? 'task' : 'cycle', company, workspace)
      .first<{ mode: string; generation: string; company: string | null }>();
    if (owner?.mode === 'active') {
      if (!owner.company || (selected && selected !== owner.company) || !allowed(owner.company))
        throw new OperationError(404, 'not_found', 'Registro não encontrado.');
      const scoped = await scopedDeliverySnapshotWithVersion(db, workspace, owner.company);
      if (!scoped?.clientSnapshot?.startsWith(`${owner.generation}:`))
        throw new OperationError(503, 'execution_snapshot_incomplete',
          'A execução está sendo atualizada. Tente novamente.');
      const execution = projectDelivery(scoped.snapshot);
      const item = (resource === 'tasks' ? execution.tasks : execution.cycles)
        .find(row => row.id === company && row.company === owner.company);
      if (!item) throw new OperationError(503, 'execution_snapshot_incomplete',
        'A execução está sendo atualizada. Tente novamente.');
      return { data: item };
    }
  }
  if(deliveryList&&selected) {
    const page=await readEffectiveDeliveryPage(db,workspace,selected,taskList?'tasks':'cycles',cursor,limit,
      {status,dueFrom,dueTo,ownerId,enrollmentId,sort:sort as 'position'|'dueAt'|undefined},
      expectedVersionText===null?undefined:Number(expectedVersionText),expectedClientSnapshot);
    if(page) return page;
  }
  if(taskList&&!selected) {
    const page=await readActiveGlobalTaskPage(db,workspace,cursor,limit,
      {status,dueFrom,dueTo,ownerId,enrollmentId,sort:sort as 'position'|'dueAt'|undefined},permitted,
      expectedVersionText===null?undefined:Number(expectedVersionText));
    if(page) return page;
  }
  if(cycleList&&!selected) {
    const page=await readActiveGlobalCyclePage(db,workspace,cursor,limit,
      {status,enrollmentId},permitted,
      expectedVersionText===null?undefined:Number(expectedVersionText));
    if(page) return page;
  }
  let rows:unknown[];
  let deliveryVersion: number | undefined;
  let clientSnapshot: string | undefined;
  if(resource==='clients'&&!child) rows=clients.allClients.filter(c=>allowed(c.slug)).map(c=>({...c,archived:!activeClients.has(c.slug)}));
  else if(resource==='enrollments'||(resource==='clients'&&child==='enrollments')) rows=clients.enrollments.filter(e=>allowed(e.company));
  else if(resource==='participants'||(resource==='clients'&&child==='participants')) rows=clients.participations.filter(p=>allowed(p.company));
  else if(resource==='meetings') {
    const state=await load('ontology.engagement.v2') as {removedMeetings?:string[]};
    rows=url.searchParams.get('includeRemoved')==='true'
      ?projectAllMeetings(state).filter(m=>allowed(m.company)).map(m=>({...m,removed:Boolean(state.removedMeetings?.includes(m.id))}))
      :projectMeetings(state).filter(m=>allowed(m.company));
  }
  else if(resource==='plans') rows=projectCatalog(await load('ontology.catalog.v2')).journeys.map(plan=>({...plan,fingerprint:fingerprint(plan)}));
  else if(resource==='products') rows=projectCatalog(await load('ontology.catalog.v2')).products;
  else if(resource==='stakeholders'||(resource==='clients'&&child==='stakeholders')) { const doc=await getDoc(db,workspace,'ontology.stakeholders.v1');rows=projectStakeholders(doc?.value as Parameters<typeof projectStakeholders>[0]).filter(c=>allowed(c.company)); }
  else if(resource==='cycles'||resource==='tasks') {
    const scoped=selected?await scopedDeliverySnapshotWithVersion(db,workspace,selected):null;
    const legacy=scoped?null:await getDoc(db,workspace,'ontology.delivery.v2');
    const execution=projectDelivery(scoped?.snapshot??legacy?.value??{});
    deliveryVersion=scoped?.sourceVersion??legacy?.version??0;
    clientSnapshot=scoped?.clientSnapshot;
    rows=(resource==='cycles'?execution.cycles:execution.tasks).filter(c=>allowed(c.company)&&(!selected||c.company===selected));
  }
  else throw new OperationError(404,'not_found','Recurso não encontrado.');
  if(resource==='clients'&&!child) rows=(rows as (typeof clients.allClients[number]&{archived:boolean})[]).filter(c=>(includeArchivedText!=='false'||!c.archived)
    &&(!(memberId||role||productId||clientResponsibleId||productResponsibleId)||!c.archived)
    &&(!clientResponsibleId||matchesResponsible(responsibilities?.client.get(c.slug)??[],[clientResponsibleId]))
    &&(!productResponsibleId||matchesResponsible(responsibilities?.product.get(c.slug)??[],[productResponsibleId]))
    &&(productId?clients.enrollments.some(e=>e.company===c.slug&&e.productId===productId&&!e.archivedAt&&e.status!=='cancelada'&&(!memberId&&!role||assigned(c.slug,e.id)))
      :!memberId&&!role||assigned(c.slug))
    &&(!status||c.status===status)&&(!healthFlag||c.healthFlag===healthFlag)
    &&(!query||`${c.name} ${c.slug}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(query.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase())));
  if(collection==='enrollments') rows=rows.filter(row=>{
    const enrollment=row as {company:string;id:string;productId:string;milestone?:number;archivedAt?:string;status?:string};
    return (!productId||enrollment.productId===productId)
      &&(milestoneText===null||enrollment.milestone===Number(milestoneText))
      &&(currentOnlyText!=='true'||(!enrollment.archivedAt&&enrollment.status!=='cancelada'))
      &&(!memberId&&!role||assigned(enrollment.company,enrollment.id));
  });
  if(deliveryList) {
    if(expectedVersionText!==null&&Number(expectedVersionText)!==deliveryVersion)
      throw new OperationError(409,'snapshot_changed','A lista mudou. Recomece pela primeira página.',{snapshotVersion:deliveryVersion});
    if(expectedClientSnapshot!==undefined&&expectedClientSnapshot!==clientSnapshot)
      throw new OperationError(409,'snapshot_changed','A lista mudou. Recomece pela primeira página.',{clientSnapshot:clientSnapshot??null});
    rows=rows.filter(row=>{
      const item=row as {status:string;enrollmentId?:string;ownerId?:string;dueAt?:string};
      return (!status||item.status===status)&&(!enrollmentId||item.enrollmentId===enrollmentId)
        &&(!ownerId||item.ownerId===ownerId)
        &&(!dueFrom||Boolean(item.dueAt&&item.dueAt>=dueFrom))
        &&(!dueTo||Boolean(item.dueAt&&item.dueAt<=dueTo));
    });
    if(taskList&&sort==='dueAt') rows.sort((a,b)=>{
      const first=a as {dueAt?:string;id:string},second=b as {dueAt?:string;id:string};
      return (!first.dueAt?1:0)-(!second.dueAt?1:0)
        ||(first.dueAt??'').localeCompare(second.dueAt??'')||first.id.localeCompare(second.id);
    });
  }
  const detailId=resource==='clients'?(child?record:company):company;
  if(detailId) {
    const item=rows.find(row=>{const value=row as {id?:string;slug?:string};return (collection==='clients'?value.slug:value.id)===detailId;});
    if(!item) throw new OperationError(404,'not_found','Registro não encontrado.');
    return {data:item};
  }
  const page=rows.slice(cursor,cursor+limit);
  const data=clientList&&view==='summary'?page.map(row=>{const client=row as {slug:string;name:string;status?:string;archived:boolean;healthFlag?:string;health?:number};return{slug:client.slug,name:client.name,status:client.status??null,archived:client.archived,healthFlag:client.healthFlag??null,health:client.health??null};}):page;
  return {data,total:rows.length,...(enrollmentList?{totalClients:new Set(rows.map(row=>(row as {company:string}).company)).size}:{}),...(clientList||enrollmentList?{snapshotVersion:clientsDoc?.version??0}:deliveryList?{snapshotVersion:deliveryVersion,...(clientSnapshot?{clientSnapshot}:{})}:{}),nextCursor:cursor+limit<rows.length?String(cursor+limit):null};
}
