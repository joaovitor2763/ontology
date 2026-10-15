import type { ServerEnv } from '../context';
import { getDoc } from '../db.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { commitOperation, receipt, requestHash } from './transaction.ts';
import { OperationError } from './errors.ts';
import * as v from './input.ts';
import { normalizeEngagementSnapshot, projectAllMeetings, putMeetingSnapshot, removeMeetingSnapshot, restoreMeetingSnapshot } from '../../modules/engagement/infrastructure/snapshot.ts';
import { removeMeetingAction, restoreMeetingAction } from '../../modules/engagement/domain/meeting-lifecycle.ts';
const ENGAGEMENT='ontology.engagement.v2';
export type MeetingLifecycleCommand='meetings.remove'|'meetings.restore'|'meetings.actions.remove'|'meetings.actions.restore';
/** Tombstones preserve linked tasks, invitations and history; restoration has no external effects. */
export async function executeMeetingLifecycleCommand(env:ServerEnv,principal:OperationPrincipal,command:MeetingLifecycleCommand,input:unknown,key:string,expectedVersions:Record<string,number>={}){
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const db=env.DB,workspace=env.WORKSPACE_ID||'default',raw=v.object(input),actionCommand=command.startsWith('meetings.actions.'),remove=command.endsWith('.remove');
 const allowed=actionCommand?['meetingId','actionId']:command==='meetings.remove'?['meetingId','keepCalendar']:['meetingId'];
 if(Object.keys(raw).some(name=>!allowed.includes(name)))v.invalid('Campo de remoção ou restauração inválido.');
 const meetingId=v.id(raw.meetingId),actionId=actionCommand?v.id(raw.actionId):undefined;
 if(Object.hasOwn(raw,'keepCalendar')&&typeof raw.keepCalendar!=='boolean')v.invalid('Informe se deseja manter o evento na agenda.');
 const hash=await requestHash(command,input),doc=await getDoc(db,workspace,ENGAGEMENT),state=normalizeEngagementSnapshot(doc?.value??{});
 const current=projectAllMeetings(state).find(m=>m.id===meetingId);
 if(!current)throw new OperationError(404,'meeting_not_found','Reunião não encontrada.');
 const auth=await authorizeOperation(db,workspace,principal,{action:'reunioes.agendar',scope:'meetings:write',company:current.company});
 const saved=await receipt(db,workspace,principal.id,key,command,hash);if(saved)return saved.result;
 const versions=new Map<string,number>();for(const guard of [...auth,{key:ENGAGEMENT,version:doc?.version??0}]){if(versions.has(guard.key)&&versions.get(guard.key)!==guard.version)throw new OperationError(409,'version_conflict','As permissões mudaram.');versions.set(guard.key,guard.version);}
 for(const [name,version] of Object.entries(expectedVersions)){if(!Number.isSafeInteger(version)||version<0)v.invalid('Versão inválida.');if(versions.has(name)&&versions.get(name)!==version)throw new OperationError(409,'version_conflict','Atualize os dados antes de continuar.');}
 const wasRemoved=state.removedMeetings.includes(meetingId);
 if(actionCommand&&wasRemoved)throw new OperationError(409,'meeting_removed','Restaure a reunião antes de alterar suas ações.');
 if(current.schedulingStatus==='pending'||current.schedulingStatus==='uncertain'||await db.prepare("SELECT id FROM meeting_operations WHERE workspace_id=? AND meeting_id=? AND status!='complete'").bind(workspace,meetingId).first())throw new OperationError(409,'meeting_operation_pending','Conclua a operação pendente da reunião antes de continuar.');
 if(command==='meetings.remove'&&!wasRemoved&&current.google?.eventId&&!current.cancelledAt&&!current.google.cancelled&&raw.keepCalendar!==true)throw new OperationError(409,'calendar_choice_required','Escolha manter o evento na agenda ou confirme seu cancelamento antes de remover o registro.');
 const at=new Date().toISOString();let meeting=current,changed=false,value=state;
 if(actionCommand){
  const matches=current.actions.filter(a=>a.id===actionId);if(matches.length!==1)throw new OperationError(matches.length?409:404,'action_not_found','Ação não encontrada ou identificador ambíguo.');
  const action=matches[0];changed=Boolean(action.removedAt)!==remove;
  if(changed){meeting=remove?removeMeetingAction(current,actionId!,principal.memberId,at):restoreMeetingAction(current,actionId!,at);value=putMeetingSnapshot(state,meeting);}
 }else{
  changed=wasRemoved!==remove;
  if(changed){value=remove?removeMeetingSnapshot(state,current,principal.memberId,at):restoreMeetingSnapshot(state,current,principal.memberId,at);meeting=projectAllMeetings(value).find(m=>m.id===meetingId)!;}
 }
 return commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash, checked: true,id:crypto.randomUUID(),guards:[...versions].map(([key,version])=>({key,version})),writes:changed?[{key:ENGAGEMENT,value}]:[],events:changed?[{type:actionCommand?`meeting.action.${remove?'removed':'restored'}`:`meeting.${remove?'removed':'restored'}`,company:meeting.company,subject:meetingId,...(actionId?{data:{actionId}}:{})}]:[],result:{data:{meeting,removed:remove,changed},documents:principal.kind==='session'?[{key:ENGAGEMENT,value,version:(doc?.version??0)+(changed?1:0),updatedAt:changed?at:doc?.updatedAt??at}]:[]}});
}
