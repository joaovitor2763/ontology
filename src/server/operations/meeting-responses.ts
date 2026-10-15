import type { ServerEnv } from '../context';
import { getDoc } from '../db.ts';
import { forgetDocuments } from './request-context.ts';
import { eventResponses, getConnection, googleEnabled, GoogleError } from '../google.ts';
import { cachedIntegration } from '../integration-cache.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { canonical, commitOperation, receipt, requestHash } from './transaction.ts';
import { OperationError } from './errors.ts';
import * as v from './input.ts';
import { normalizeEngagementSnapshot, projectMeetings, putMeetingSnapshot } from '../../modules/engagement/infrastructure/snapshot.ts';
import type { Meeting } from '../../modules/engagement/domain/models.ts';
const KEY='ontology.engagement.v2',COMMAND='meetings.syncResponses';
function context(meeting:Meeting){return {company:meeting.company,organizer:(meeting.organizerEmail??meeting.google?.organizer??'').toLowerCase(),calendarId:meeting.google?.calendarId||'primary',eventId:meeting.google?.eventId,etag:meeting.google?.etag};}
async function authorize(db:D1Database,env:ServerEnv,workspace:string,principal:OperationPrincipal,meeting:Meeting){
 const guards=await authorizeOperation(db,workspace,principal,{action:'reunioes.agendar',scope:'meetings:write',company:meeting.company});
 if(context(meeting).organizer!==principal.email.toLowerCase())throw new OperationError(403,'organizer_required','Use a conexão do organizador para atualizar as respostas.');
 const connection=await getConnection(db,workspace,principal.email);
 if(!connection||connection.status!=='connected')throw new OperationError(409,'google_connection_required','Conecte novamente sua conta Google no perfil.');
 if(connection.account_email.toLowerCase()!==principal.email.toLowerCase())throw new OperationError(403,'google_account_mismatch','Conecte a mesma conta Google usada pelo organizador.');
 return guards;
}
async function available(db:D1Database,workspace:string,meeting:Meeting){
 if(meeting.cancelledAt)throw new OperationError(409,'meeting_cancelled','A reunião já está cancelada.');
 if(meeting.schedulingStatus==='pending'||meeting.schedulingStatus==='uncertain'||await db.prepare("SELECT id FROM meeting_operations WHERE workspace_id=? AND meeting_id=? AND status!='complete'").bind(workspace,meeting.id).first())throw new OperationError(409,'meeting_operation_pending','Conclua a operação pendente antes de atualizar as respostas.');
 if(!meeting.google?.eventId)throw new OperationError(409,'calendar_event_required','A reunião não tem evento Google vinculado.');
}
/** RSVP refresh has no external mutation. Merge only the response fields into a fresh local snapshot. */
export async function executeMeetingResponsesCommand(env:ServerEnv,principal:OperationPrincipal,input:unknown,key:string,expectedVersions:Record<string,number>={}){
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');
 if(principal.kind==='integration')throw new OperationError(403,'organizer_delegation_required','Uma credencial de sistema não pode usar a agenda pessoal sem delegação.');
 if(!googleEnabled(env))throw new OperationError(503,'google_unavailable','Integração Google não configurada.');
 const raw=v.object(input);if(Object.keys(raw).some(k=>k!=='meetingId'))v.invalid('Informe somente a reunião.');
 const meetingId=v.id(raw.meetingId),db=env.DB,workspace=env.WORKSPACE_ID||'default';
 async function read(){const doc=await getDoc(db,workspace,KEY),state=normalizeEngagementSnapshot(doc?.value??{}),meeting=projectMeetings(state).find(m=>m.id===meetingId);if(!meeting)throw new OperationError(404,'meeting_not_found','Reunião não encontrada.');return{doc,state,meeting};}
 const initial=await read();await authorize(db,env,workspace,principal,initial.meeting);
 const hash=await requestHash(COMMAND,input),saved=await receipt(db,workspace,principal.id,key,COMMAND,hash);if(saved)return saved.result;
 await available(db,workspace,initial.meeting);
 const identity=context(initial.meeting),cacheKey=`meeting-responses:${await requestHash('calendar.responses',{workspace,...identity})}`;
 let loaded=false,cached;
 try{cached=await cachedIntegration(db,workspace,cacheKey,async()=>{
  loaded=true;try{return await eventResponses(env,db,workspace,principal.email,{calendarId:identity.calendarId,eventId:identity.eventId!});}
  catch(error){if(error instanceof GoogleError)throw new OperationError(error.status,'google_error',error.message);throw new OperationError(502,'google_unavailable','Não foi possível consultar as respostas no Google. Tente novamente.');}
 },{ttl:60_000});}
 catch(error){if(error instanceof OperationError)throw error;throw new OperationError(409,'responses_sync_busy','Atualização em andamento. Aguarde alguns segundos e tente novamente.');}
 if(cached.stale)throw new OperationError(409,'responses_sync_busy','Aguarde a atualização das respostas antes de tentar novamente.');
 // Consulta ao Google concluída: revalidar contra o banco.
 forgetDocuments(db);
 const latest=await read(),auth=await authorize(db,env,workspace,principal,latest.meeting);await available(db,workspace,latest.meeting);
 if(canonical(context(latest.meeting))!==canonical(identity))throw new OperationError(409,'meeting_changed','O evento ou o organizador da reunião mudou. Atualize antes de tentar novamente.');
 const versions=new Map(auth.map(g=>[g.key,g.version]));versions.set(KEY,latest.doc?.version??0);
 // The pre-fetch engagement revision is deliberately ignored: notes/actions may change while Google responds.
 for(const [name,version] of Object.entries(expectedVersions)){if(!Number.isSafeInteger(version)||version<0)v.invalid('Versão inválida.');if(name!==KEY&&versions.has(name)&&versions.get(name)!==version)throw new OperationError(409,'version_conflict','Os dados ou as permissões mudaram. Atualize antes de tentar novamente.');}
 const fetchedAt=new Date(cached.fetchedAt).toISOString();
 const responses=Object.fromEntries(cached.value.attendees.map(a=>[a.email,a.responseStatus]));
 const patch={responses,responsesAt:fetchedAt,cancelled:cached.value.status==='cancelled'||undefined};
 const current=latest.meeting.google??{},older=Boolean(current.responsesAt&&Date.parse(current.responsesAt)>cached.fetchedAt);
 const changed=!older&&canonical({responses:current.responses,responsesAt:current.responsesAt,cancelled:current.cancelled})!==canonical(patch);
 const meeting:Meeting=changed?{...latest.meeting,google:{...current,...patch}}:latest.meeting;
 const value=changed?putMeetingSnapshot(latest.state,meeting):latest.state;
 return commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command:COMMAND,hash,id:crypto.randomUUID(),guards:[...versions].map(([key,version])=>({key,version})),writes:changed?[{key:KEY,value}]:[],events:changed?[{type:'meeting.responses.synced',company:meeting.company,subject:meeting.id}]:[],result:{data:{meeting,cached:!loaded,changed,fetchedAt},documents:principal.kind==='session'?[{key:KEY,value,version:versions.get(KEY)!+(changed?1:0),updatedAt:changed?new Date().toISOString():latest.doc?.updatedAt}]:[]}});
}
