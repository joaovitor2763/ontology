import type {ServerEnv} from '../context';
import {databaseOrigin,loadDocuments,prefetchDocuments,sameVersions,WORKSPACE_KEYS} from './request-context.ts';
import {authorizeOperation,type OperationPrincipal} from './principal.ts';
import {OperationError} from './errors.ts';
import {keys,projectAlerts,alertDocuments,alertAudienceOf} from './alerts.ts';
import {seesAllAlerts} from '../../modules/workspace/domain/alert-scope.ts';
import {normalizeAccess} from '../../modules/workspace/domain/permissions.ts';
import {acknowledgedFrom,acknowledgmentsStatement,unseenBy} from './alert-acknowledgments.ts';
import {workspaceMinute} from '../../shared/lib/format.ts';
import {normalizeEngagementSnapshot,projectMeetings} from '../../modules/engagement/infrastructure/snapshot.ts';
import {resolveAlertRules,type AlertRules} from '../../modules/workspace/domain/models.ts';

/**
 * A fila do workspace inteiro, sem recorte de pessoa: o que custa ler e projetar
 * todas as fatias. Fica no isolate por binding original e workspace, sob a chave
 * de dados (`marker`); o que é de cada pessoa (ciência, público) é aplicado em
 * memória a cada pedido e nunca entra aqui.
 */
type Queue = {
 marker: string;
 /** Hora local de São Paulo do cálculo (`AAAA-MM-DDTHH`): vira o dia (UTC e SP) só em hora cheia. */
 hour: string;
 /** Primeiro instante em que uma regra por horário (reuniões) pode mudar a fila. */
 validUntil: number;
 alerts: {company:string;id:string}[];
 hidden: string[];
};
const queues = new WeakMap<D1Database, Map<string, Queue>>();
const pending = new WeakMap<D1Database, Map<string, Promise<Queue>>>();

const HOUR = 3_600_000;
const saoPauloHour = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',
 month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
/** `AAAA-MM-DDTHH` em São Paulo: a data das regras e do público muda à meia-noite local. */
export function alertHour(at:Date){
 const part=(type:string)=>saoPauloHour.formatToParts(at).find(p=>p.type===type)?.value??'00';
 return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}`;
}

/**
 * Até quando a fila calculada em `at` continua exata. As regras por dia mudam na
 * hora cheia (o `today` das regras e o público por alocação usam a data de São
 * Paulo, como a fila e a carteira); as regras por hora dependem
 * só do início das reuniões: começar (`startsAt`), entrar na janela do ensaio
 * (`startsAt − presentationRehearsalHours`) e na da entrevista (`startsAt − 48h`).
 * A comparação por texto (`startsAt <= agora` em ISO) é coberta lendo o mesmo
 * texto como UTC. Qualquer outro limite cai na próxima hora cheia.
 */
export function alertQueueValidUntil(at:Date,meetings:{startsAt:string}[],rules:Pick<AlertRules,'presentationRehearsalHours'>){
 const now=at.getTime();
 let until=Math.floor(now/HOUR)*HOUR+HOUR;
 for(const meeting of meetings){
  const local=meeting.startsAt.slice(0,19);
  // O texto pode vir com fuso ou sem; sem fuso, a projeção o compara com a hora de parede de
  // São Paulo (UTC−3, sem horário de verão desde 2019). As leituras como UTC e no fuso do
  // processo ficam como margem: um limite a mais só encurta o cache.
  for(const start of [Date.parse(meeting.startsAt),Date.parse(`${local}Z`),Date.parse(`${local}-03:00`)]){
   if(!Number.isFinite(start))continue;
   // A projeção usa o minuto cheio: "já começou" vira no início, "ainda vai começar" um minuto depois.
   for(const edge of [start,start+60_000,start-rules.presentationRehearsalHours*HOUR,start-48*HOUR])
    if(edge>now&&edge<until)until=edge;
  }
 }
 return until;
}

/** Chave de dados da fila: modo, geração e versões (execução ativa pela versão lógica). */
function markerStatement(db:D1Database,workspace:string){
 const names=[...keys,...WORKSPACE_KEYS];
 return db.prepare(`SELECT d.key,
     CASE WHEN d.key='ontology.delivery.v2' AND m.mode='active'
       THEN m.compatibility_version ELSE d.version END AS version,m.mode,m.generation
   FROM state_documents d LEFT JOIN delivery_client_shadow_meta m ON m.workspace_id=d.workspace_id
   WHERE d.workspace_id=? AND d.key IN (${names.map(()=>'?').join(',')})`).bind(workspace,...names);
}
function markerOf(rows:{key:string;version:number;mode:string|null;generation:string|null}[],workspaceKey:string){
 const versions=new Map(rows.map(row=>[row.key,row.version]));
 return JSON.stringify([rows[0]?.mode??null,rows[0]?.generation??null,
  [...keys,workspaceKey].map(key=>versions.get(key)??0)]);
}

/**
 * Lê e projeta todas as fatias uma vez: pedidos simultâneos que viram a mesma
 * chave de dados na mesma hora esperam o mesmo cálculo. O resultado é sempre de
 * uma leitura posterior à chave que o pedido viu.
 */
function computeQueue(db:D1Database,workspace:string,workspaceKey:string,at:Date,seen:string):Promise<Queue>{
 const origin=databaseOrigin(db);
 let running=pending.get(origin);
 if(!running)pending.set(origin,(running=new Map()));
 const flight=JSON.stringify([workspace,seen,alertHour(at)]);
 const known=running.get(flight);
 if(known)return known;
 const work=(async()=>{
  const {docs,effective,versions}=await alertDocuments(db,workspace,workspaceKey,undefined,{withVersions:true});
  // Mesmo relógio da fila (`/api/alerts`) e da carteira: hora de parede de São Paulo, como `refreshNow()`.
  const {candidates,work}=projectAlerts(docs,undefined,(process.env.NEXT_PUBLIC_DEMO_DATE as string|undefined)||workspaceMinute(at),effective);
  const engagement=normalizeEngagementSnapshot(docs[3]?.value as object);
  const queue:Queue={
   // Fatias e versões do mesmo lote; sem modo ativo ou com documentos de outro
   // instante a fila vale só para este pedido (marcador vazio nunca bate).
   marker:effective&&sameVersions(versions!,[...keys,workspaceKey].map((key,index)=>[key,docs[index]] as const)
    .filter(([key])=>key!==keys[1]))
    ?JSON.stringify(['active',effective.generation,[...keys,workspaceKey].map((key,index)=>
     index===1?effective.compatibilityVersion:docs[index]?.version??0)]):'',
   hour:alertHour(at),
   validUntil:alertQueueValidUntil(at,projectMeetings(engagement),resolveAlertRules(work.alertRules)),
   alerts:candidates.map(({company,id})=>({company,id})),
   hidden:work.hidden??[],
  };
  let byWorkspace=queues.get(origin);
  if(!byWorkspace)queues.set(origin,(byWorkspace=new Map()));
  if(queue.marker)byWorkspace.set(workspace,queue);else byWorkspace.delete(workspace);
  return queue;
 })();
 running.set(flight,work);
 work.finally(()=>{if(running.get(flight)===work)running.delete(flight);}).catch(()=>undefined);
 return work;
}

/**
 * Quantos alertas estão abertos na fila de quem pede. É o que o menu mostra ao
 * lado de Alertas (`GET /api/v1/alerts/count` e o bloco `alerts` do bootstrap),
 * com o mesmo projetor de `GET /api/v1/alerts` (`projectAlerts`).
 *
 * A fila é a de quem pede: Admin e Gestor contam o workspace inteiro; AI Master
 * e Visualização contam só os clientes em que estão alocados (`alertAudience`).
 * Tira o que a própria pessoa já marcou como visto (`alert_acknowledgments`) e
 * o arquivo antigo da equipe (`hidden`).
 *
 * O caro — ler e projetar todas as fatias — é do workspace, não da pessoa: fica
 * num cache do isolate (`Queue`) com chave de dados (modo, geração, versão
 * lógica da execução e versões de clientes, catálogo, engajamento, stakeholders
 * e roster), da hora de São Paulo e do próximo limite das regras por horário.
 * Cada pedido revalida a chave e lê a ciência da pessoa num lote só, em paralelo
 * com a autorização, e só usa o resultado depois dela; público e ciência são
 * aplicados em memória. Um pedido nunca recebe a fila de outro workspace nem o
 * recorte de outra pessoa.
 *
 * `countAlertsIfReady` não espera uma fila ativa que ainda não está pronta:
 * dispara o cálculo (em `waitUntil`) e devolve `null`. É o que o bootstrap usa
 * para não segurar os documentos da tela pelo contador.
 */
export async function countAlerts(env:ServerEnv,principal:OperationPrincipal,
 options:{now?:Date}={}):Promise<{data:{count:number}}>{
 return (await count(env,principal,options))!;
}

/** O mesmo contador, mas sem esperar a fila ativa que ainda não está pronta: `null` e o cálculo segue em `defer`. */
export function countAlertsIfReady(env:ServerEnv,principal:OperationPrincipal,
 defer:(work:Promise<unknown>)=>void,options:{now?:Date}={}){
 return count(env,principal,{...options,deferMiss:defer});
}

async function count(env:ServerEnv,principal:OperationPrincipal,
 options:{now?:Date;deferMiss?:(work:Promise<unknown>)=>void}):Promise<{data:{count:number}}|null>{
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const db=env.DB,workspace=env.WORKSPACE_ID||'default',now=options.now??new Date();
 // O cadastro de clientes só serve ao recorte de quem não vê a fila inteira.
 if(!seesAllAlerts({access:normalizeAccess(principal.access),memberId:principal.memberId}))
  prefetchDocuments(db,workspace,[keys[0]]);
 // Ler antes de autorizar não expõe nada: nada sai daqui sem a autorização abaixo.
 const read=db.batch([markerStatement(db,workspace),acknowledgmentsStatement(db,workspace,principal.memberId)]);
 read.catch(()=>undefined);
 const auth=await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'workspace:read'});
 const workspaceKey=auth.find(g=>g.key.startsWith('ontology.workspace.'))!.key;
 const [markerRows,ackRows]=await read;
 const marker=markerOf(markerRows.results as Parameters<typeof markerOf>[0],workspaceKey);
 const cached=queues.get(databaseOrigin(db))?.get(workspace);
 let queue=cached&&cached.marker===marker&&cached.hour===alertHour(now)&&now.getTime()<cached.validUntil
  ?cached:null;
 if(!queue){
  const work=computeQueue(db,workspace,workspaceKey,now,marker);
  // Só a fila ativa é cara; no modo legado o pedido espera, como sempre esperou.
  if(options.deferMiss&&(markerRows.results[0] as {mode?:string}|undefined)?.mode==='active'){options.deferMiss(work.catch(()=>undefined));return null;}
  queue=await work;
 }
 const [roster]=await loadDocuments(db,workspace,[workspaceKey]);
 const audience=await alertAudienceOf(roster,async()=>(await loadDocuments(db,workspace,[keys[0]]))[0],principal,now);
 const unseen=unseenBy(acknowledgedFrom(ackRows),queue.hidden);
 return {data:{count:queue.alerts.filter(a=>unseen(a)&&(!audience||audience.has(a.company))).length}};
}
