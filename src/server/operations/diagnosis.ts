import type { ServerEnv } from '../context';
import { getDoc } from '../db.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { canonical, commitOperation, receipt, requestHash } from './transaction.ts';
import { OperationError } from './errors.ts';
import * as v from './input.ts';
import type { Hypothesis, Pain, Solution } from '../../modules/engagement/domain/models.ts';
import type { Person } from '../../modules/workspace/domain/models.ts';
import { painError, solutionError } from '../../modules/engagement/domain/diagnosis.ts';
import { hypothesisError, refineHypothesis } from '../../modules/engagement/domain/hypotheses.ts';
import { normalizeEngagementSnapshot, type EngagementSnapshot } from '../../modules/engagement/infrastructure/snapshot.ts';
import { pains as seedPains, solutions as seedSolutions, hypotheses as seedHypotheses } from '../../modules/engagement/infrastructure/seed.ts';
import { people } from '../../modules/workspace/infrastructure/seed.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
import { projectStakeholders } from '../../modules/clients/infrastructure/stakeholders-snapshot.ts';
const KEY='ontology.engagement.v2',CLIENTS='ontology.clients.v3',CONTACTS='ontology.stakeholders.v1';
export type DiagnosisCommand='pains.update'|'solutions.update'|'hypotheses.create'|'hypotheses.update'|'hypotheses.evidence.add'|'hypotheses.refine'|'hypotheses.remove'|'hypotheses.restore';
function project(state:EngagementSnapshot){return{pains:[...seedPains,...state.extraPains].map(p=>state.painEdits[p.id]??p),solutions:[...seedSolutions,...state.extraSolutions].map(s=>state.solutionEdits[s.id]??s),hypotheses:[...seedHypotheses,...state.extraHypotheses].map(h=>state.hypothesisEdits[h.id]??h)};}
function fields(raw:Record<string,unknown>,allowed:string[]){if(Object.keys(raw).some(key=>!allowed.includes(key)))v.invalid('Campo de diagnóstico inválido.');}
function optional(value:unknown,label:string){return value===null?undefined:v.string(value,label,undefined,8000)||undefined;}
/** Patches cannot replace evidence, provenance or refinement ancestry. */
export async function executeDiagnosisCommand(env:ServerEnv,principal:OperationPrincipal,command:string,input:unknown,key:string,expectedVersions:Record<string,number>={}){
 if(!(['pains.update','solutions.update','hypotheses.create','hypotheses.update','hypotheses.evidence.add','hypotheses.refine','hypotheses.remove','hypotheses.restore'] satisfies DiagnosisCommand[]).includes(command as DiagnosisCommand))v.invalid('Operação de diagnóstico inválida.');
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');const db=env.DB,workspace=env.WORKSPACE_ID||'default',raw=v.object(input),company=v.id(raw.company);
 const allowed=command==='hypotheses.create'?['company','hypothesis']:command==='pains.update'?['company','painId','patch']:command==='solutions.update'?['company','solutionId','patch']:command==='hypotheses.update'?['company','hypothesisId','patch']:command==='hypotheses.evidence.add'?['company','hypothesisId','kind','source','note']:command==='hypotheses.refine'?['company','hypothesisId','statement']:['company','hypothesisId'];fields(raw,allowed);
 const auth=await authorizeOperation(db,workspace,principal,{action:'interacoes.registrar',scope:'engagement:write',company}),hash=await requestHash(command,input),saved=await receipt(db,workspace,principal.id,key,command,hash);if(saved)return saved.result;
 const rosterKey=auth.find(g=>g.key.startsWith('ontology.workspace.'))!.key,keys=[KEY,CLIENTS,CONTACTS,rosterKey],docs=await Promise.all(keys.map(k=>getDoc(db,workspace,k))),[document,clientsDoc,contactsDoc,rosterDoc]=docs;
 const versions=new Map<string,number>();for(const guard of [...auth,...keys.map((key,i)=>({key,version:docs[i]?.version??0}))]){if(versions.has(guard.key)&&versions.get(guard.key)!==guard.version)throw new OperationError(409,'version_conflict','As permissões mudaram.');versions.set(guard.key,guard.version);}for(const [name,version] of Object.entries(expectedVersions)){if(!Number.isSafeInteger(version)||version<0)v.invalid('Versão inválida.');if(versions.has(name)&&versions.get(name)!==version)throw new OperationError(409,'version_conflict','Atualize os dados antes de salvar.');}
 if(!projectClients(clientsDoc?.value??{}).clients.some(c=>c.slug===company))throw new OperationError(404,'client_not_found','Cliente ativo não encontrado.');
 let state=normalizeEngagementSnapshot(document?.value??{});const all=project(state),roster=(rosterDoc?.value??{}) as {extraMembers?:Person[];memberEdits?:Record<string,Partial<Person>>;deactivatedIds?:string[]},members=[...people.filter(p=>p.org==='praxis'),...(roster.extraMembers??[])].map(p=>({...p,...roster.memberEdits?.[p.id]})).filter(p=>!roster.deactivatedIds?.includes(p.id)),contacts=projectStakeholders(contactsDoc?.value as Parameters<typeof projectStakeholders>[0]).filter(p=>p.company===company&&p.active);
 function owner(value:unknown){if(value===null||value==='')return undefined;const id=v.id(value);if(!members.some(p=>p.id===id)&&!contacts.some(p=>p.id===id))v.invalid('Escolha um responsável ativo da equipe ou deste cliente.');return id;}
 function painIds(value:unknown){const ids=v.strings(value,'dores');if(ids.some(id=>!all.pains.some(p=>p.id===id&&p.company===company&&!state.removedPains.includes(id))))v.invalid('Escolha dores ativas deste cliente.');return ids;}
 function get<T extends {id:string;company:string}>(rows:T[],id:unknown,removed:string[],allowRemoved=false){const found=rows.find(r=>r.id===v.id(id)&&r.company===company);if(!found||(!allowRemoved&&removed.includes(found.id)))throw new OperationError(404,'diagnosis_not_found','Registro de diagnóstico não encontrado.');return found;}
 const at=new Date().toISOString();let changed=true,subject:string,data:Record<string,unknown>;
 if(command==='pains.update'){
  const current=get(all.pains,raw.painId,state.removedPains),patch=v.object(raw.patch);fields(patch,['title','description','area','severity','frequency','impact','confidence','status','evidence']);if(!Object.keys(patch).length)v.invalid('Informe uma alteração.');const pain:Pain={...current};
  for(const key of ['title','description'] as const)if(Object.hasOwn(patch,key))pain[key]=v.string(patch[key],key,undefined,8000);
  for(const key of ['area','impact','evidence'] as const)if(Object.hasOwn(patch,key))pain[key]=optional(patch[key],key);
  if(Object.hasOwn(patch,'confidence'))pain.confidence=patch.confidence===null?undefined:v.number(patch.confidence,0,0,100);
  if(Object.hasOwn(patch,'frequency'))pain.frequency=patch.frequency===null||patch.frequency===''?undefined:v.choice(patch.frequency,['pontual','semanal','diaria','continua'] as const);
  if(patch.severity!==undefined)pain.severity=v.choice(patch.severity,['baixa','media','alta','critica'] as const);
  if(patch.status!==undefined)pain.status=v.choice(patch.status,['aberta','validada','em-tratamento','resolvida'] as const);
  const error=painError(pain);if(error)v.invalid(error);changed=canonical(pain)!==canonical(current);if(changed){pain.updatedAt=at;state={...state,painEdits:{...state.painEdits,[pain.id]:pain}};}subject=pain.id;data={pain};
 }else if(command==='solutions.update'){
  const current=get(all.solutions,raw.solutionId,state.removedSolutions),patch=v.object(raw.patch);fields(patch,['title','description','painIds','hypothesis','ownerId','effort','expectedImpact','successMetric','status','tradeoffs','chosen','chosenReason']);if(!Object.keys(patch).length)v.invalid('Informe uma alteração.');const solution:Solution={...current};
  for(const key of ['title','description','hypothesis'] as const)if(Object.hasOwn(patch,key))solution[key]=v.string(patch[key],key,undefined,8000);
  for(const key of ['expectedImpact','successMetric','chosenReason'] as const)if(Object.hasOwn(patch,key))solution[key]=optional(patch[key],key);
  if(Object.hasOwn(patch,'painIds'))solution.painIds=painIds(patch.painIds);if(Object.hasOwn(patch,'ownerId'))solution.ownerId=owner(patch.ownerId);
  if(Object.hasOwn(patch,'effort'))solution.effort=patch.effort===null||patch.effort===''?undefined:v.choice(patch.effort,['baixo','medio','alto'] as const);
  if(patch.status!==undefined)solution.status=v.choice(patch.status,['proposta','aprovada','em-execucao','concluida','descartada'] as const);if(Object.hasOwn(patch,'chosen'))solution.chosen=v.boolean(patch.chosen,false);
  if(Object.hasOwn(patch,'tradeoffs')){if(patch.tradeoffs===null)solution.tradeoffs=undefined;else{const axes=v.object(patch.tradeoffs);fields(axes,['time','capital','talent']);solution.tradeoffs=Object.fromEntries(Object.entries(axes).map(([axis,value])=>[axis,v.choice(value,['baixo','medio','alto'] as const)]));}}
  const error=solutionError(solution,all.pains.filter(p=>p.company===company));if(error)v.invalid(error);changed=canonical(solution)!==canonical(current);if(changed){solution.updatedAt=at;state={...state,solutionEdits:{...state.solutionEdits,[solution.id]:solution}};}subject=solution.id;data={solution};
 }else{
  let hypothesis:Hypothesis;
  if(command==='hypotheses.create')hypothesis={id:`hyp-${crypto.randomUUID()}`,company,statement:'',status:'aberta',painIds:[],evidence:[],createdAt:at};
  else hypothesis=get(all.hypotheses,raw.hypothesisId,state.removedHypotheses,command==='hypotheses.remove'||command==='hypotheses.restore');
  subject=hypothesis.id;data={hypothesis};
  if(command==='hypotheses.create'||command==='hypotheses.update'){
   const patch=v.object(command==='hypotheses.create'?raw.hypothesis:raw.patch);fields(patch,['statement','rootCause','painIds','ownerId','status']);if(!Object.keys(patch).length)v.invalid('Informe uma alteração.');const next={...hypothesis};if(Object.hasOwn(patch,'statement'))next.statement=v.string(patch.statement,'hipótese',undefined,8000);if(Object.hasOwn(patch,'rootCause'))next.rootCause=optional(patch.rootCause,'causa raiz');if(Object.hasOwn(patch,'ownerId'))next.ownerId=owner(patch.ownerId);if(Object.hasOwn(patch,'painIds'))next.painIds=painIds(patch.painIds);if(patch.status!==undefined)next.status=v.choice(patch.status,['aberta','em-teste','confirmada','refutada','refinada'] as const);const error=hypothesisError(next);if(error)v.invalid(error);changed=command==='hypotheses.create'||canonical(next)!==canonical(hypothesis);hypothesis=next;if(changed){hypothesis.updatedAt=at;state=command==='hypotheses.create'?{...state,extraHypotheses:[...state.extraHypotheses,hypothesis]}:{...state,hypothesisEdits:{...state.hypothesisEdits,[hypothesis.id]:hypothesis}};}data={hypothesis};
  }else if(command==='hypotheses.evidence.add'){
   const note=v.string(raw.note,'evidência',undefined,20000);if(!note)v.invalid('Descreva a evidência.');const evidence={id:`ev-${crypto.randomUUID()}`,at,kind:v.choice(raw.kind,['confirma','contradiz','refina'] as const),source:v.choice(raw.source,['entrevista','dados','observacao'] as const),note,by:principal.memberId};hypothesis={...hypothesis,updatedAt:at,evidence:[...(hypothesis.evidence??[]),evidence]};state={...state,hypothesisEdits:{...state.hypothesisEdits,[hypothesis.id]:hypothesis}};data={hypothesis,evidence};
  }else if(command==='hypotheses.refine'){
   const statement=v.string(raw.statement,'hipótese',undefined,8000),error=hypothesisError({statement});if(error)v.invalid(error);painIds(hypothesis.painIds);if(hypothesis.ownerId)owner(hypothesis.ownerId);const child={...refineHypothesis(hypothesis,statement,`hyp-${crypto.randomUUID()}`,at),updatedAt:at},parent={...hypothesis,status:'refinada' as const,updatedAt:at};state={...state,hypothesisEdits:{...state.hypothesisEdits,[parent.id]:parent},extraHypotheses:[...state.extraHypotheses,child]};data={hypothesis:child,parent};
  }else{
   const removed=command==='hypotheses.remove';changed=state.removedHypotheses.includes(hypothesis.id)!==removed;state={...state,removedHypotheses:removed?[...new Set([...state.removedHypotheses,hypothesis.id])]:state.removedHypotheses.filter(id=>id!==hypothesis.id)};data={hypothesis,removed};
  }
 }
 return commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash, checked: true,id:crypto.randomUUID(),guards:[...versions].map(([key,version])=>({key,version})),writes:changed?[{key:KEY,value:state}]:[],events:changed?[{type:command,company,subject,data:command==='hypotheses.refine'?{childId:(data.hypothesis as Hypothesis).id}:undefined}]:[],result:{data,documents:principal.kind==='session'?[{key:KEY,value:state,version:(document?.version??0)+(changed?1:0),updatedAt:changed?at:document?.updatedAt??at}]:[]}});
}
export async function readDiagnosis(env:ServerEnv,principal:OperationPrincipal,input:{company:string;kind:'pains'|'solutions'|'hypotheses';includeRemoved?:boolean;limit?:number;offset?:number}){
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');const company=v.id(input.company),workspace=env.WORKSPACE_ID||'default',kind=v.choice(input.kind,['pains','solutions','hypotheses'] as const),includeRemoved=v.boolean(input.includeRemoved,false),limit=input.limit??50,offset=input.offset??0;if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)v.invalid('Paginação inválida.');await authorizeOperation(env.DB,workspace,principal,{action:'clientes.ver',scope:'engagement:read',company});
 const state=normalizeEngagementSnapshot((await getDoc(env.DB,workspace,KEY))?.value??{}),removed=kind==='pains'?state.removedPains:kind==='solutions'?state.removedSolutions:state.removedHypotheses;
 const rows=project(state)[kind].filter(item=>item.company===company&&(includeRemoved||!removed.includes(item.id))).sort((a,b)=>(b.updatedAt??b.createdAt).localeCompare(a.updatedAt??a.createdAt)||a.id.localeCompare(b.id));return{data:rows.slice(offset,offset+limit).map(item=>({...item,removed:removed.includes(item.id)})),nextOffset:offset+limit<rows.length?offset+limit:null};
}
