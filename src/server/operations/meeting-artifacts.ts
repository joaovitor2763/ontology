import type { ServerEnv } from '../context';
import { getDoc } from '../db.ts';
import { forgetDocuments } from './request-context.ts';
import { meetArtifacts, getConnection, googleEnabled, GoogleError } from '../google.ts';
import { cachedIntegration } from '../integration-cache.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { canonical, commitOperation, receipt, requestHash } from './transaction.ts';
import { OperationError } from './errors.ts';
import * as v from './input.ts';
import { normalizeEngagementSnapshot, projectMeetings, putMeetingSnapshot } from '../../modules/engagement/infrastructure/snapshot.ts';
import type { Meeting, MeetingGoogle } from '../../modules/engagement/domain/models.ts';
import { documentVersion, type ClientDocument } from '../../modules/documents/domain/models.ts';
import { documents as seedDocuments } from '../../modules/documents/infrastructure/seed.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
const ENGAGEMENT='ontology.engagement.v2',DOCUMENTS='ontology.documents.v3',CLIENTS='ontology.clients.v3',COMMAND='meetings.syncArtifacts',HOUR=3600000;
type Documents={extraDocs:ClientDocument[];removedDocIds:string[];docEdits:Record<string,Partial<ClientDocument>>};
type Envelope={collectedAt:number;result:Awaited<ReturnType<typeof meetArtifacts>>};
type File={id:string;r2_key:string;content_hash:string|null;company:string|null;status:string};
function context(m:Meeting){return{company:m.company,organizer:(m.organizerEmail??m.google?.organizer??'').toLowerCase(),meetLink:m.google?.meetLink,startsAt:m.startsAt,durationMin:m.durationMin,eventId:m.google?.eventId,calendarId:m.google?.calendarId||'primary',etag:m.google?.etag};}
async function hashBytes(bytes:Uint8Array<ArrayBuffer>){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
function docsState(value:unknown):Documents {return{extraDocs:[],removedDocIds:[],docEdits:{},...(value as Partial<Documents>??{})};}
function previousDocument(state:Documents,m:Meeting){const source=[...state.extraDocs,...seedDocuments].find(d=>d.id===m.google?.transcriptDocId&&!state.removedDocIds.includes(d.id));const doc=source?{...source,...state.docEdits[source.id]}:undefined;if(doc&&(doc.company!==m.company||doc.relatedMeetingId&&doc.relatedMeetingId!==m.id))throw new OperationError(409,'transcript_conflict','A transcrição possui vínculos incompatíveis.');return doc;}
/** Private immutable envelope permits recovery after R2 succeeds but the D1 commit fails. */
export async function executeMeetingArtifactsCommand(env:ServerEnv,principal:OperationPrincipal,input:unknown,key:string,expectedVersions:Record<string,number>={}){
 if(principal.kind==='integration')throw new OperationError(403,'organizer_delegation_required','Uma credencial de sistema não pode usar a conta Google pessoal sem delegação.');
 if(!env.DB||!env.FILES)throw new OperationError(503,'storage_unavailable','Armazenamento indisponível.');
 if(!googleEnabled(env))throw new OperationError(503,'google_unavailable','Integração Google não configurada.');
 const raw=v.object(input);if(Object.keys(raw).some(k=>k!=='meetingId'))v.invalid('Informe somente a reunião.');
 const meetingId=v.id(raw.meetingId),db=env.DB,bucket=env.FILES,workspace=env.WORKSPACE_ID||'default',hash=await requestHash(COMMAND,input);
 async function read(){const doc=await getDoc(db,workspace,ENGAGEMENT),state=normalizeEngagementSnapshot(doc?.value??{}),meeting=projectMeetings(state).find(m=>m.id===meetingId);if(!meeting)throw new OperationError(404,'meeting_not_found','Reunião não encontrada.');return{doc,state,meeting};}
 async function auth(meeting:Meeting){
  const guards=[...await authorizeOperation(db,workspace,principal,{action:'reunioes.agendar',scope:'meetings:write',company:meeting.company}),...await authorizeOperation(db,workspace,principal,{action:'documentos.enviar',scope:'documents:write',company:meeting.company})];
  if(context(meeting).organizer!==principal.email.toLowerCase())throw new OperationError(403,'organizer_required','Use a conexão do organizador para importar os materiais.');
  const connection=await getConnection(db,workspace,principal.email);if(!connection||connection.status!=='connected')throw new OperationError(409,'google_connection_required','Conecte novamente sua conta Google.');
  if(connection.account_email.toLowerCase()!==principal.email.toLowerCase())throw new OperationError(403,'google_account_mismatch','Conecte a mesma conta Google usada pelo organizador.');return guards;
 }
 async function available(m:Meeting){
  if(m.cancelledAt)throw new OperationError(409,'meeting_cancelled','A reunião já está cancelada.');
  if(m.schedulingStatus==='pending'||m.schedulingStatus==='uncertain'||await db.prepare("SELECT id FROM meeting_operations WHERE workspace_id=? AND meeting_id=? AND status!='complete'").bind(workspace,m.id).first())throw new OperationError(409,'meeting_operation_pending','Conclua a operação pendente da reunião.');
  if(!m.google?.meetLink||!Number.isFinite(Date.parse(m.startsAt)))throw new OperationError(409,'meet_link_required','Revise o link do Meet e a data da reunião.');
 }
 const initial=await read();await auth(initial.meeting);const saved=await receipt(db,workspace,principal.id,key,COMMAND,hash);if(saved)return saved.result;await available(initial.meeting);
 const identity=context(initial.meeting),encoded=canonical(identity),envelopeCandidate=`${workspace}/private/meet-sync/${crypto.randomUUID()}`;
 await db.prepare('INSERT OR IGNORE INTO meeting_artifact_syncs(workspace_id,principal_id,idempotency_key,request_hash,context,envelope_key,created_at) VALUES(?,?,?,?,?,?,?)').bind(workspace,principal.id,key,hash,encoded,envelopeCandidate,new Date().toISOString()).run();
 const journal=(await db.prepare('SELECT request_hash,context,envelope_key FROM meeting_artifact_syncs WHERE workspace_id=? AND principal_id=? AND idempotency_key=?').bind(workspace,principal.id,key).first<{request_hash:string;context:string;envelope_key:string}>())!;
 if(journal.request_hash!==hash)throw new OperationError(409,'idempotency_conflict','Esta chave já foi usada para outro pedido.');
 if(journal.context!==encoded)throw new OperationError(409,'meeting_changed','O contexto da reunião mudou. Atualize e inicie uma nova busca.');
 let envelope:Envelope|undefined,cached=true;
 try{
  const previous=await bucket.get(journal.envelope_key);if(previous)envelope=JSON.parse(await previous.text()) as Envelope;
  if(!envelope){
   let loaded=false;
   const result=await cachedIntegration(db,workspace,`meeting-artifacts:${await requestHash('meet.artifacts',{workspace,...identity})}`,async()=>{
    loaded=true;try{return await meetArtifacts(env,db,workspace,principal.email,{meetLink:identity.meetLink!,startsAt:identity.startsAt,includeEarlierSessions:Date.parse(identity.startsAt)>Date.now()});}
    catch(error){if(error instanceof GoogleError)throw new OperationError(error.status,'google_error',error.message);throw new OperationError(502,'google_artifacts_failed',error instanceof Error?error.message:'Não foi possível buscar os materiais do Meet.');}
   },{ttl:60_000});
   if(result.stale)throw new OperationError(409,'artifacts_sync_busy','Aguarde a atualização dos materiais.');cached=!loaded;
   envelope={collectedAt:result.fetchedAt,result:result.value};
   await bucket.put(journal.envelope_key,JSON.stringify(envelope),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
   const durable=await bucket.get(journal.envelope_key);if(!durable)throw new Error('Não foi possível confirmar a coleta no armazenamento.');envelope=JSON.parse(await durable.text()) as Envelope;
  }
 }catch(error){if(error instanceof OperationError)throw error;throw new OperationError(503,'artifacts_pending','Não foi possível confirmar o armazenamento da coleta. Tente novamente para retomar.');}
 // Coleta externa concluída: revalidar contra o banco, não contra a memória.
 forgetDocuments(db);
 let latest=await read();await auth(latest.meeting);await available(latest.meeting);
 if(canonical(context(latest.meeting))!==encoded)throw new OperationError(409,'meeting_changed','O contexto da reunião mudou durante a busca.');
 let documentsDoc=await getDoc(db,workspace,DOCUMENTS),documents=docsState(documentsDoc?.value),prior=previousDocument(documents,latest.meeting);
 const transcript=envelope.result.artifacts?.transcriptText,bytes=transcript?new TextEncoder().encode(transcript):undefined;
 let file:File|null=null,contentHash:string|undefined,newId:string|undefined,r2Key:string|undefined;
 if(bytes?.length){
  contentHash=await hashBytes(bytes);
  if(prior){file=await db.prepare('SELECT id,r2_key,content_hash,company,status FROM files WHERE workspace_id=? AND id=?').bind(workspace,prior.id).first<File>();if(file&&(file.company&&file.company!==latest.meeting.company||file.status!=='ready'))throw new OperationError(409,'transcript_conflict','O arquivo anterior está indisponível ou possui outro cliente.');
   if(file&&!file.content_hash){const original=await bucket.get(file.r2_key);if(original)file.content_hash=await hashBytes(new Uint8Array(await original.arrayBuffer()));}
  }
  if(!prior||!file||file.content_hash!==contentHash){
   newId=`up-meet-${await requestHash('transcript',{workspace,meetingId,previous:prior?.id??null,contentHash})}`;r2Key=`${workspace}/meet-transcripts/${newId}/${contentHash}`;
   try{await bucket.put(r2Key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'text/plain'}});}catch{throw new OperationError(503,'transcript_pending','A transcrição ainda não foi confirmada. Tente novamente para retomar.');}
  }
 }
 // R2 can be slow. Merge against fresh documents/meeting, preserving unrelated edits and RSVP.
 const linkedBefore=latest.meeting.google?.transcriptDocId,priorId=prior?.id;
 forgetDocuments(db);
 latest=await read();const guards=await auth(latest.meeting);await available(latest.meeting);
 if(canonical(context(latest.meeting))!==encoded||latest.meeting.google?.transcriptDocId!==linkedBefore)throw new OperationError(409,'meeting_changed','A reunião ou a transcrição mudou. Tente novamente para reconciliar a coleta.');
 documentsDoc=await getDoc(db,workspace,DOCUMENTS);documents=docsState(documentsDoc?.value);prior=previousDocument(documents,latest.meeting);
 if(prior?.id!==priorId)throw new OperationError(409,'transcript_conflict','O documento anterior mudou durante a importação.');
 const clientsDoc=await getDoc(db,workspace,CLIENTS);if(!projectClients(clientsDoc?.value??{}).clients.some(c=>c.slug===latest.meeting.company))throw new OperationError(404,'client_not_found','Cliente ativo não encontrado.');
 const versions=new Map<string,number>();for(const guard of [...guards,{key:ENGAGEMENT,version:latest.doc?.version??0},{key:DOCUMENTS,version:documentsDoc?.version??0},{key:CLIENTS,version:clientsDoc?.version??0}]){if(versions.has(guard.key)&&versions.get(guard.key)!==guard.version)throw new OperationError(409,'version_conflict','As permissões mudaram durante a operação.');versions.set(guard.key,guard.version);}
 for(const [name,version] of Object.entries(expectedVersions)){if(!Number.isSafeInteger(version)||version<0)v.invalid('Versão inválida.');if(name!==ENGAGEMENT&&name!==DOCUMENTS&&versions.has(name)&&versions.get(name)!==version)throw new OperationError(409,'version_conflict','Os dados ou as permissões mudaram.');}
 const at=new Date().toISOString(),checkedAt=new Date(envelope.collectedAt).toISOString(),current=latest.meeting.google??{},older=Boolean(current.lastArtifactCheckAt&&Date.parse(current.lastArtifactCheckAt)>envelope.collectedAt);
 const endedAgo=envelope.collectedAt-(Date.parse(latest.meeting.startsAt)+latest.meeting.durationMin*60000);let google:MeetingGoogle={...current},note:string;
 if(envelope.result.state==='not_found'){google={...current,lastArtifactCheckAt:checkedAt,artifactStatus:endedAgo>7*24*HOUR?'not_generated':'pending'};note='Não encontramos registro deste encontro no Meet. Confira o link e a data da reunião.';}
 else if(envelope.result.state==='pending'||!envelope.result.artifacts){google={...current,lastArtifactCheckAt:checkedAt,artifactStatus:'pending'};note='A reunião ainda não terminou no Meet.';}
 else{
  const artifacts=envelope.result.artifacts;
  google={...current,recordingUrl:artifacts.recordings.find(r=>r.url)?.url??current.recordingUrl,transcriptUrl:artifacts.transcripts.find(t=>t.url)?.url??current.transcriptUrl,syncedAt:checkedAt,lastArtifactCheckAt:checkedAt,...(newId?{transcriptDocId:newId}:{})};
  const found=Boolean(google.recordingUrl||google.transcriptUrl||google.transcriptDocId);google.artifactStatus=google.recordingUrl&&google.transcriptDocId?'ready':endedAgo>7*24*HOUR?(found?'ready':'not_generated'):'pending';
  note=[artifacts.startedAt?`Sessão de ${new Date(artifacts.startedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}.`:'',google.recordingUrl?'Gravação encontrada.':'Sem gravação.',google.transcriptUrl||google.transcriptDocId?'Transcrição encontrada.':'Sem transcrição.'].filter(Boolean).join(' ');
 }
 const changed=!older&&canonical(google)!==canonical(current);if(older){google=current;newId=undefined;note='Uma coleta mais recente já foi registrada.';}
 const statements:D1PreparedStatement[]=[];let doc:ClientDocument|undefined;
 if(newId&&r2Key&&bytes&&contentHash&&changed){
  doc={id:newId,company:latest.meeting.company,name:`Transcrição · ${latest.meeting.title}.txt`.slice(0,500),kind:prior?.kind??'ata',mime:'text/plain',size:bytes.byteLength,uploadedAt:at,uploadedBy:principal.memberId,relatedMeetingId:meetingId,relatedTaskId:prior?.relatedTaskId,relatedThreadId:prior?.relatedThreadId,visibility:prior?.visibility??'interna',note:'Transcrição gerada pelo Google Meet.',version:prior?documentVersion(prior)+1:1,...(prior?{supersedesId:prior.id}:{}),createdAt:at,updatedAt:at};
  documents={...documents,extraDocs:[doc,...documents.extraDocs]};
  statements.push(db.prepare("INSERT INTO files(id,workspace_id,r2_key,name,mime,size,created_by,company,content_hash,status) VALUES(?,?,?,?,?,?,?,?,?,'ready')").bind(newId,workspace,r2Key,doc.name,doc.mime,doc.size,principal.id,doc.company,contentHash));
 }
 const meeting=changed?{...latest.meeting,google}:latest.meeting,value=changed?putMeetingSnapshot(latest.state,meeting):latest.state;
 const writes=[...(changed?[{key:ENGAGEMENT,value}]:[]),...(doc?[{key:DOCUMENTS,value:documents}]:[])];
 return commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command:COMMAND,hash,id:crypto.randomUUID(),guards:[...versions].map(([key,version])=>({key,version})),writes,statements,events:changed?[{type:'meeting.artifacts.synced',company:meeting.company,subject:meetingId},...(doc?[{type:'document.created',company:doc.company,subject:doc.id}]:[])]:[],result:{data:{meeting,note,cached,changed},documents:principal.kind==='session'?[{key:ENGAGEMENT,value,version:versions.get(ENGAGEMENT)!+(changed?1:0),updatedAt:changed?at:latest.doc?.updatedAt??at},...(doc?[{key:DOCUMENTS,value:documents,version:versions.get(DOCUMENTS)!+1,updatedAt:at}]:[])]:[]}});
}
