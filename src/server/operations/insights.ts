import {insightSource} from '../insight-source.ts';
import type {ServerEnv} from '../context';
import {getDoc} from '../db.ts';
import {configuredGroup,groupKey} from '../insight-context.ts';
import {projectClients} from '../../modules/clients/infrastructure/snapshot.ts';
import {authorizeOperation,type OperationPrincipal} from './principal.ts';
import {OperationError} from './errors.ts';
import {id,choice,invalid} from './input.ts';

export async function readInsights(env:ServerEnv,principal:OperationPrincipal,input:{company:string;meeting?:string;status?:string;cursor?:string},options?:{bookmark?:string}){
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const db=env.DB,workspace=env.WORKSPACE_ID||'default',company=id(input.company),meeting=input.meeting===undefined?undefined:id(input.meeting),status=choice(input.status,['pending','accepted','dismissed'],'pending');
 const authorize=async()=>{await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'engagement:read',company});if(meeting)await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'meetings:read',company});};
 await authorize();
 if(!projectClients((await getDoc(db,workspace,'ontology.clients.v3'))?.value as object).clients.some(c=>c.slug===company))throw new OperationError(404,'client_not_found','Cliente não encontrado.');
 let cursor:{at:string;id:string}|undefined;
 if(input.cursor){try{if(input.cursor.length>1000)throw Error();const value=JSON.parse(input.cursor);if(typeof value.at!=='string'||!Number.isFinite(Date.parse(value.at))||typeof value.id!=='string'||!value.id||value.id.length>100)throw Error();cursor={at:value.at,id:value.id};}catch{invalid('Página inválida.');}}
 const group=meeting?null:await configuredGroup(db,workspace,company),prefix=group?`${groupKey(group)}|`:'';
 const session=options?db.withSession(options.bookmark&&options.bookmark.length<500?options.bookmark:'first-primary'):null;
 const rows=await (session??db).prepare(`SELECT id,company,source_kind,source_id,title,body,evidence,status,created_at,reviewed_by,model FROM ai_suggestions WHERE workspace_id=? AND company=? AND status=? AND source_kind=? ${meeting?'AND source_id=?':"AND substr(source_id,1,?)=? AND ?<>''"} ${cursor?'AND (created_at<? OR (created_at=? AND id<?))':''} ORDER BY created_at DESC,id DESC LIMIT 31`).bind(workspace,company,status,meeting?'meeting':'whatsapp',...(meeting?[meeting]:[prefix.length,prefix,prefix]),...(cursor?[cursor.at,cursor.at,cursor.id]:[])).all<{id:string;created_at:string}>();
 const fallback=meeting&&rows.results.length===0?await (session??db).prepare("SELECT status FROM ai_suggestions WHERE workspace_id=? AND company=? AND source_kind='meeting' AND source_id=? ORDER BY created_at DESC,id DESC LIMIT 1").bind(workspace,company,meeting).first<{status:'pending'|'accepted'|'dismissed'}>():null;
 const items=rows.results.slice(0,30),last=items.at(-1);
 const job=group?await db.prepare('SELECT id,status,phase,imported,error,created_at,updated_at FROM whatsapp_jobs WHERE workspace_id=? AND company=? AND group_key=? ORDER BY created_at DESC LIMIT 1').bind(workspace,company,groupKey(group)).first():null;
 await authorize();
 if(!meeting&&JSON.stringify(await configuredGroup(db,workspace,company))!==JSON.stringify(group))throw new OperationError(409,'version_conflict','O grupo do cliente mudou. Consulte novamente.');
 return {data:{...(session?{bookmark:session.getBookmark()}:{}),items,nextCursor:rows.results.length>30&&last?JSON.stringify({at:last.created_at,id:last.id}):null,job,...(meeting&&rows.results.length===0?{fallbackStatus:fallback?.status??null}:{})}};
}

/** Source scopes are derived from the stored analysis, never from caller hints. */
export async function readInsightSource(env:ServerEnv,principal:OperationPrincipal,input:{company:string;insight:string}){
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const db=env.DB,workspace=env.WORKSPACE_ID||'default',company=id(input.company),insight=id(input.insight);
 const authorize=()=>authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'engagement:read',company});
 await authorize();
 const row=await db.prepare('SELECT source_kind,source_id,evidence FROM ai_suggestions WHERE workspace_id=? AND company=? AND id=?').bind(workspace,company,insight).first<{source_kind:string;source_id:string;evidence:string}>();
 if(!row)throw new OperationError(404,'insight_not_found','Análise não encontrada.');
 const refs=JSON.parse(row.evidence) as string[];
 const authorizeSource=async()=>{
  await authorize();
  if(row.source_kind==='meeting'){
   await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'meetings:read',company});
   if(refs.some(ref=>ref.startsWith('up-')))await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'documents:read',company});
  }
 };
 await authorizeSource();
 const data=await insightSource(db,env.FILES,workspace,company,insight);
 await authorizeSource();
 if(!data)throw new OperationError(404,'insight_not_found','Análise não encontrada.');
 return {data};
}
