import type { ServerEnv } from '../context';
import { getDoc } from '../db.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { canonical, commitOperation, receipt, requestHash } from './transaction.ts';
import { OperationError } from './errors.ts';
import * as v from './input.ts';
import { withActionIds } from '../../modules/engagement/domain/meetings.ts';
import type { ActionItem, Meeting, MeetingPrep } from '../../modules/engagement/domain/models.ts';
import { interactionTags, normalizeInteractionTags } from '../../modules/engagement/domain/interaction-tags.ts';
import { normalizeEngagementSnapshot, projectMeetings, putMeetingSnapshot } from '../../modules/engagement/infrastructure/snapshot.ts';
import { hypotheses } from '../../modules/engagement/infrastructure/seed.ts';
import { people } from '../../modules/workspace/infrastructure/seed.ts';
import { projectStakeholders } from '../../modules/clients/infrastructure/stakeholders-snapshot.ts';
import { validDate } from '../../modules/delivery/application/plan-execution.ts';
const KEY='ontology.engagement.v2',COMMAND='meetings.content.update';
const fields=['summary','notes','decisions','actions','prep','learnings','implications','receptiveness','commitmentObtained','tags'] as const;
function text(value:unknown,label:string,max=8000){return v.string(value,label,undefined,max);}
function list(value:unknown,label:string){if(!Array.isArray(value)||value.length>100)v.invalid(`Revise ${label}.`);return value as unknown[];}
function keys(row:Record<string,unknown>,allowed:readonly string[]){if(Object.keys(row).some(k=>!allowed.includes(k)))v.invalid('Campo de conteúdo não permitido.');}
/** Content-only validation deliberately does not reinterpret scheduling dates or touch Google. */
export function normalizeMeetingContent(existing:Meeting,input:unknown):Meeting {
 const raw=v.object(input);keys(raw,fields);const next={...existing};
 for(const key of ['summary','notes','learnings','implications'] as const)if(Object.hasOwn(raw,key))next[key]=text(raw[key],key,key==='notes'?50000:8000);
 if(Object.hasOwn(raw,'receptiveness')){if(raw.receptiveness===null)delete next.receptiveness;else next.receptiveness=v.choice(raw.receptiveness,['aliado','neutro','cetico'] as const);}
 if(Object.hasOwn(raw,'commitmentObtained'))next.commitmentObtained=v.boolean(raw.commitmentObtained,false);
 if(raw.tags!==undefined){const tags=list(raw.tags,'marcadores');if(tags.some(t=>!interactionTags.includes(t as typeof interactionTags[number])))v.invalid('Marcador inválido.');next.tags=normalizeInteractionTags(tags);}
 if(raw.decisions!==undefined)next.decisions=list(raw.decisions,'decisões').map(item=>text(item,'decisão',8000)).filter(Boolean);
 if(raw.actions!==undefined){
  const previous=withActionIds(existing).actions,protectedActions=previous.some(a=>a.deliveryId||a.removedAt);
  next.actions=list(raw.actions,'ações').map((value,index)=>{
   const action=v.object(value);keys(action,['id','text','ownerId','dueAt','done','deliveryId','removedAt','removedBy']);
   if(protectedActions&&action.id===undefined)v.invalid('Informe os identificadores das ações para preservar seu histórico.');
   const id=action.id===undefined?previous[index]?.id??crypto.randomUUID():v.id(action.id),old=previous.find(a=>a.id===id);
   for(const key of ['deliveryId','removedAt','removedBy'] as const)if(Object.hasOwn(action,key)&&canonical(action[key])!==canonical(old?.[key]))v.invalid('Use as operações de conversão ou remoção da ação.');
   if(old?.removedAt){for(const key of ['text','ownerId','dueAt','done'] as const)if(Object.hasOwn(action,key)&&canonical(action[key])!==canonical(old[key]))v.invalid('Restaure a ação antes de editar.');return old;}
   const result:ActionItem={id,text:text(action.text,'ação'),ownerId:text(action.ownerId,'responsável',180),dueAt:text(action.dueAt,'prazo',32),done:action.done===undefined?old?.done:v.boolean(action.done,false),...(old?.deliveryId?{deliveryId:old.deliveryId}:{})};
   if(!result.text)v.invalid('Informe o texto da ação.');
   if(result.dueAt&&result.dueAt!==old?.dueAt&&!validDate(result.dueAt))v.invalid('Prazo da ação inválido.');
   return result;
  });
  next.actions.push(...previous.filter(a=>a.removedAt&&!next.actions.some(n=>n.id===a.id)));
  if(new Set(next.actions.map(a=>a.id)).size!==next.actions.length)v.invalid('Ações com identificadores duplicados.');
  if(previous.some(a=>a.deliveryId&&!next.actions.some(n=>n.id===a.id)))v.invalid('Não remova ações vinculadas por uma edição de conteúdo.');
 }
 if(raw.prep!==undefined){const prep=v.object(raw.prep);keys(prep,['homeworkDone','hypothesisIds','questions','purpose','importance','preview','format','preReadSent','rehearsed','speakers']);const nextPrep:MeetingPrep={};
  for(const key of ['homeworkDone','preReadSent','rehearsed'] as const)if(prep[key]!==undefined)nextPrep[key]=v.boolean(prep[key],false);
  for(const key of ['questions','purpose','importance','preview','speakers'] as const)if(prep[key]!==undefined)nextPrep[key]=text(prep[key],key);
  if(prep.format!==undefined)nextPrep.format=v.choice(prep.format,['deck','conversa','pre-leitura'] as const);
  if(prep.hypothesisIds!==undefined)nextPrep.hypothesisIds=v.strings(prep.hypothesisIds,'hipóteses');next.prep=nextPrep;
 }
 if(raw.decisions!==undefined&&existing.decisionItems&&canonical(next.decisions)!==canonical(existing.decisions)){
  // Preserve metadata for retained decisions, including duplicate summaries.
  const remaining=[...existing.decisionItems];
  next.decisionItems=next.decisions.map(summary=>{
   const index=remaining.findIndex(item=>item.summary.trim()===summary);
   return index>=0?remaining.splice(index,1)[0]:{id:crypto.randomUUID(),summary,status:'registrada' as const};
  });
 }

 return next;
}
export async function executeMeetingContentCommand(env:ServerEnv,principal:OperationPrincipal,input:unknown,key:string,expectedVersions:Record<string,number>={}){
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const db=env.DB,workspace=env.WORKSPACE_ID||'default',raw=v.object(input);keys(raw,['meetingId','patch']);const meetingId=v.id(raw.meetingId),patch=v.object(raw.patch);
 const hash=await requestHash(COMMAND,input),saved=await receipt(db,workspace,principal.id,key,COMMAND,hash);
 if(saved){const result=saved.result as {data:{meeting:Meeting}};await authorizeOperation(db,workspace,principal,{action:'reunioes.agendar',scope:'meetings:write',company:result.data.meeting.company});return saved.result;}
 const doc=await getDoc(db,workspace,KEY),state=normalizeEngagementSnapshot(doc?.value??{}),meeting=projectMeetings(state).find(m=>m.id===meetingId);
 if(!meeting)throw new OperationError(404,'meeting_not_found','Reunião não encontrada.');
 const auth=await authorizeOperation(db,workspace,principal,{action:'reunioes.agendar',scope:'meetings:write',company:meeting.company});
 if(meeting.schedulingStatus==='pending'||meeting.schedulingStatus==='uncertain'||await db.prepare("SELECT id FROM meeting_operations WHERE workspace_id=? AND meeting_id=? AND status!='complete'").bind(workspace,meetingId).first())throw new OperationError(409,'meeting_operation_pending','Conclua a operação pendente da reunião antes de editar.');
 const updated=normalizeMeetingContent(meeting,patch);
 const keysToRead=['ontology.stakeholders.v1',auth.find(g=>g.key.startsWith('ontology.workspace.'))!.key];const dependencies=await Promise.all(keysToRead.map(key=>getDoc(db,workspace,key)));
 const versions=new Map<string,number>();for(const guard of [...auth,{key:KEY,version:doc?.version??0},...keysToRead.map((key,i)=>({key,version:dependencies[i]?.version??0}))]){if(versions.has(guard.key)&&versions.get(guard.key)!==guard.version)throw new OperationError(409,'version_conflict','As permissões ou dados mudaram.');versions.set(guard.key,guard.version);}
 for(const [key,version] of Object.entries(expectedVersions)){if(!Number.isSafeInteger(version)||version<0)v.invalid('Versão inválida.');if(versions.has(key)&&versions.get(key)!==version)throw new OperationError(409,'version_conflict','Atualize os dados antes de salvar.');}
 const roster=(dependencies[1]?.value??{}) as {extraMembers?:{id:string}[];memberEdits?:Record<string,{active?:boolean}>;deactivatedIds?:string[]};
 const ownerIds=new Set([...people.filter(p=>p.org==='praxis'),...(roster.extraMembers??[])].filter(p=>!roster.deactivatedIds?.includes(p.id)).map(p=>p.id));
 for(const contact of projectStakeholders(dependencies[0]?.value as Parameters<typeof projectStakeholders>[0]))if(contact.company===meeting.company&&contact.active)ownerIds.add(contact.id);
 for(const action of updated.actions){const old=meeting.actions.find(a=>a.id===action.id);if(!action.removedAt&&action.ownerId!==old?.ownerId&&!ownerIds.has(action.ownerId))v.invalid('Escolha um responsável ativo da equipe ou deste cliente.');}
 const belongs=(id:string,seed:{id:string;company:string}[],extra:{id:string;company:string}[],edits:Record<string,{id:string;company:string}>,removed:string[])=>[...seed.map(item=>edits[item.id]??item),...extra].some(item=>item.id===id&&item.company===meeting.company&&!removed.includes(id));
 const checkHypothesis=(id:string)=>{if(!belongs(id,hypotheses,state.extraHypotheses,state.hypothesisEdits,state.removedHypotheses))v.invalid('Hipótese não pertence ao cliente da reunião.');};
 if(patch.prep!==undefined)for(const id of updated.prep?.hypothesisIds??[])checkHypothesis(id);
 const at=new Date().toISOString();updated.updatedAt=at;const next=putMeetingSnapshot(state,updated);if(Object.hasOwn(patch,'notes'))next.notes={...next.notes,[meetingId]:updated.notes};
 return commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command:COMMAND,hash,id:crypto.randomUUID(),guards:[...versions].map(([key,version])=>({key,version})),writes:[{key:KEY,value:next}],events:[{type:'meeting.content.updated',company:meeting.company,subject:meetingId,data:{fields:Object.keys(patch)}}],result:{data:{meeting:updated},documents:principal.kind==='session'?[{key:KEY,value:next,version:(doc?.version??0)+1,updatedAt:at,updatedBy:principal.id}]:[]}});
}
