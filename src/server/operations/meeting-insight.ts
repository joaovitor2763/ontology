import type {ServerEnv} from '../context';
import {getDoc} from '../db.ts';
import {generateInsight,InsightSourceChangedError,type InsightGenerationResult} from '../insights.ts';
import {aiConfigured,aiEnabled} from '../ai/gateway.ts';
import {projectMeetings,type EngagementSnapshot} from '../../modules/engagement/infrastructure/snapshot.ts';
import {authorizeOperation,type OperationPrincipal} from './principal.ts';
import {commitOperation,receipt,requestHash,type VersionGuard} from './transaction.ts';
import {object,id,string,invalid} from './input.ts';
import {OperationError} from './errors.ts';

export async function generateMeetingInsight(env:ServerEnv,principal:OperationPrincipal,input:unknown,key:string){
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const raw=object(input),company=id(raw.company),meeting=id(raw.meeting),confirmedHash=raw.confirmedHash===undefined?undefined:string(raw.confirmedHash,'confirmação',undefined,64);
 if(confirmedHash!==undefined&&!/^[a-f0-9]{64}$/.test(confirmedHash))invalid('Confirmação inválida.');
 const db=env.DB,workspace=env.WORKSPACE_ID||'default',command='meetings.analyze';
 const authorize=async()=>[...await authorizeOperation(db,workspace,principal,{action:'ia.analisar',scope:'engagement:write',company}),...await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'meetings:read',company})];
 const auth=await authorize(),hash=await requestHash(command,{company,meeting,confirmedHash});
 const saved=await receipt(db,workspace,principal.id,key,command,hash);if(saved){const result=saved.result as {data:unknown;requiresDocuments?:boolean};if(result.requiresDocuments)await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'documents:read',company});return {data:result.data};}
 const document=await getDoc(db,workspace,'ontology.engagement.v2'),state=(document?.value??{}) as Partial<EngagementSnapshot>;
 const record=projectMeetings(state).find(m=>m.id===meeting&&m.company===company);
 if(!record)throw new OperationError(404,'meeting_not_found','Reunião não encontrada.');
 const guards:VersionGuard[]=[...auth,{key:'ontology.engagement.v2',version:document?.version??0}];
 let text=state.notes?.[meeting]?.trim()||'',evidence=[meeting];
 const transcript=record.google?.transcriptDocId;
 if(transcript){
  guards.push(...await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'documents:read',company}));
  const file=await db.prepare("SELECT r2_key,size FROM files WHERE workspace_id=? AND id=? AND (company=? OR company IS NULL) AND status='ready'").bind(workspace,transcript,company).first<{r2_key:string;size:number}>();
  if(!file||!env.FILES)throw new OperationError(409,'transcript_unavailable','A transcrição vinculada está indisponível. Atualize os materiais da reunião antes de analisar.');
  const contents=file.size<=300000?await env.FILES.get(file.r2_key):null;
  text=contents?await contents.text():'';evidence=[transcript];
  if(!text.trim()||text.length>80000)throw new OperationError(413,'transcript_too_large','A transcrição está vazia ou excede o limite de análise. Revise os materiais da reunião.');
 }
 if(!text.trim())invalid('Adicione notas da reunião ou importe a transcrição antes de analisar. O resumo do agendamento não é usado como fonte.');
 if(!aiEnabled(env)||!aiConfigured(env))throw new OperationError(503,'ai_unavailable','IA ainda não configurada neste ambiente.');
 let committed:unknown;
 const persist=async(statements:D1PreparedStatement[],result:InsightGenerationResult)=>{
  const current=await authorize();
  if(transcript)current.push(...await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'documents:read',company}));
  const versions=new Map<string,number>();
  for(const guard of [...guards,...current]){if(versions.has(guard.key)&&versions.get(guard.key)!==guard.version)throw new OperationError(409,'version_conflict','A reunião ou as permissões mudaram. Atualize e tente novamente.');versions.set(guard.key,guard.version);}
  committed=await commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash, checked: true,id:crypto.randomUUID(),guards:[...versions].map(([key,version])=>({key,version})),writes:[],statements,events:result.reused?[]:[{type:command,company,subject:meeting,data:{insightId:result.id}}],result:{data:result,requiresDocuments:Boolean(transcript)}});
 };
 try{
  const result=await generateInsight(db,env,{workspace,company,kind:'meeting',sourceId:meeting,title:`Reunião · ${record.title}`,text,evidence,confirmedHash},persist);
  if(!committed)await persist([],result);
  return {data:(committed as {data:unknown}).data};
 }catch(error){
  if(error instanceof InsightSourceChangedError)throw new OperationError(409,'source_changed',error.message,{sourceHash:error.sourceHash});
  if(error instanceof OperationError)throw error;
  throw new OperationError(502,'analysis_failed','Não foi possível concluir a análise. Aguarde e tente novamente com a mesma chave.');
 }
}
