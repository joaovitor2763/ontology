import {generateMeetingInsight} from './meeting-insight.ts';
import {requestWhatsAppSync} from './whatsapp-sync.ts';
import {reviewInsight} from './insight-review.ts';
import { readInsights, readInsightSource } from './insights.ts';
import { readWhatsAppMessages } from './whatsapp.ts';
import { readAlerts } from "./alerts.ts";
import { countAlerts } from "./alerts-count.ts";
import { readWorkspaceSettings } from "./workspace-settings.ts";
import { readMembers, readPendingMembers } from './members.ts';
import { readAllocations } from './allocations.ts';
import { readKnowledgeResource } from './knowledge-read.ts';
import { readDocuments } from './documents.ts';
import { readInbox } from './inbox.ts';
import { readSignals } from './signals.ts';
import { readProgramEvents } from './program-events.ts';
import { readDiagnosis } from './diagnosis.ts';
import type { ServerEnv } from '../context';
import { resolveOperationPrincipal } from './principal.ts';
import { previewProductRollout } from './rollouts.ts';
import { readInteractions } from './interactions.ts';
import { listEvents } from './events.ts';
import { readContextQuery } from './context-queries.ts';
import { readAdminAudit, readClientAudit } from './client-audit.ts';
import { createWebhook,listWebhooks,deactivateWebhook,updateWebhook,rotateWebhookSecret,listWebhookDeliveries,replayWebhookDelivery } from './webhooks.ts';
import { readMeetingOperation,resumeMeetingOperation } from './meetings.ts';
import { apiGuide } from '../../shared/lib/api-guide.ts';
import { issuePersonalApiKey, listPersonalApiKeys, revokePersonalApiKey } from './credentials.ts';
import { openApiDocument } from './openapi.ts';
import { fileResponse } from './files.ts';
import { OperationError } from './errors.ts';
import { object, string } from './input.ts';
import { instrumentQueries, markAuthenticated, withQueryTiming } from '../timing.ts';
import { matchesRoute } from './route-table.ts';
import { commandForRequest } from './command-routes.ts';
import { executeCommand } from './command-dispatch.ts';
import { compactCommandResult } from './transaction.ts';
import { readCollection } from './collection-reads.ts';
import { readClientExecutionSnapshot } from './delivery-client-execution-read.ts';
import { readTaskHistory } from './task-history.ts';
import { issueIntegrationCredential, listIntegrationCredentials, revokeIntegrationCredential } from './credentials.ts';
const response=(value:unknown,status=200,extraHeaders:Record<string,string>={})=>Response.json(value,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff',...extraHeaders}});

/** Keep diagnostic details in Worker logs, never in an API response. */
function diagnosticMessage(value:unknown):string|undefined {
  if(typeof value!=='string') return undefined;
  return value.slice(0,600)
    .replace(/\bBearer\s+\S+|\bg4d_[A-Za-z0-9_-]+/gi,'[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[redacted]')
    .replace(/'(?:[^']|'')*'|"(?:[^"\\]|\\.)*"/g,'[redacted]')
    .replace(/\b[A-Za-z0-9_-]{80,}\b/g,'[redacted]');
}
function diagnosticError(error:unknown):unknown {
  if(error instanceof AggregateError) return {name:error.name,message:diagnosticMessage(error.message),causes:[...error.errors].slice(0,3).map(diagnosticError)};
  if(error instanceof Error) return {
    name:error.name,
    message:diagnosticMessage(error.message),
    cause:error.cause===undefined?undefined:diagnosticError(error.cause),
    stack:typeof error.stack==='string'?error.stack.split('\n').slice(1,5).map(line=>diagnosticMessage(line.trim())):undefined,
  };
  return {name:typeof error};
}
/** O documento OpenAPI é fixo por build e por origem: serializado uma vez por isolate, com ETag; 298 KB que só voltam quando mudam. */
const openApiCache=new Map<string,{body:string;etag:string}>();
async function openApiResponse(request:Request) {
  const origin=new URL(request.url).origin;
  let cached=openApiCache.get(origin);
  if(!cached) {
    const body=JSON.stringify(openApiDocument(origin));
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)));
    cached={body,etag:`"${[...digest.slice(0,16)].map(b=>b.toString(16).padStart(2,'0')).join('')}"`};
    openApiCache.set(origin,cached);
  }
  const headers={'cache-control':'private, max-age=3600','etag':cached.etag,'x-content-type-options':'nosniff'};
  if(request.headers.get('if-none-match')===cached.etag) return new Response(null,{status:304,headers});
  return new Response(cached.body,{status:200,headers:{...headers,'content-type':'application/json'}});
}
/** Browser cookies authorize only same-origin mutations; Bearer requests never use session fallback. */
export function assertMutationOrigin(request:Request) {
  if(request.headers.has('authorization')) return;
  const origin=request.headers.get('origin');
  if(origin!==new URL(request.url).origin) throw new OperationError(403,'invalid_origin','Origem da requisição não permitida.');
}
/** Entrada única do adaptador REST v1: mede as idas ao D1 quando a medição está ligada. */
export async function apiResponse(request:Request,env:ServerEnv,path:string[],context:{channel?:"mcp"}={}) {
  const startedAt=Date.now(),instrumented=instrumentQueries(env,request);
  return withQueryTiming(await dispatchApi(request,instrumented.env,path,context),instrumented.meter,startedAt);
}
async function dispatchApi(request:Request,env:ServerEnv,path:string[],context:{channel?:"mcp"}) {
  const requestId=crypto.randomUUID();
  let commandName:string|undefined;
  try {
    if(!env.DB) throw new OperationError(503,'database_unavailable','Banco de dados não configurado.');
    const authenticated=await resolveOperationPrincipal(request,env),workspace=env.WORKSPACE_ID||'default';
    // Request-local snapshot: adapters annotate their trusted channel without
    // mutating the identity object returned by authentication.
    const channel:"interface"|"api"|"mcp"=context.channel??(authenticated.kind==='session'?'interface':'api');
    const principal={...authenticated,guards:[...authenticated.guards],channel};
    // Bearer, OAuth ou sessão: a partir daqui a requisição tem dono e pode receber a medição.
    markAuthenticated(env.DB);
    const [resource,company,child,record]=path;
    // Match the whole path before dispatch: a valid prefix must never execute a
    // mutation or expose a collection when the caller requested another route.
    const route=path.join('/');
    if(!matchesRoute(request.method,route)) throw new OperationError(404,'not_found','Recurso não encontrado.');
    if(resource==='files'&&company) {
      if(!/^up-[A-Za-z0-9_.-]{1,117}$/.test(company)) throw new OperationError(422,'invalid_file_id','Use um fileId no formato up- seguido de até 117 letras, números, pontos, hífens ou sublinhados.');
      const result=await fileResponse(request,env,company,principal);
      if(result.ok)return result;
      const body=await result.json().catch(()=>({})) as {code?:string;error?:string};
      return response({error:{code:body.code??'file_operation_failed',message:body.error??'Não foi possível concluir a operação do arquivo.'}},result.status);
    }
    let parsedBody:Record<string,unknown>|undefined;
    const parseBody=async()=>{
      if(parsedBody) return parsedBody;
      if(Number(request.headers.get('content-length')??0)>1000000) throw new OperationError(413,'request_too_large','Pedido muito grande.');
      const text=await request.text();if(text.length>1000000) throw new OperationError(413,'request_too_large','Pedido muito grande.');
      let value:unknown;
      try { value=text?JSON.parse(text):{}; }
      catch(error) {
        if(error instanceof SyntaxError) throw new OperationError(400,'invalid_json','JSON inválido.');
        throw error;
      }
      return parsedBody=object(value);
    };
    if ((resource==='docs'||resource==='doc') && request.method==='GET') return response({data:apiGuide(new URL(request.url).origin)});
    if(request.method!=='GET') assertMutationOrigin(request);
    if(resource==='api-keys') {
      if(principal.kind!=='session') throw new OperationError(403,'session_required','Use sua sessão para gerenciar suas chaves.');
      if(request.method==='GET') return response({data:await listPersonalApiKeys(env.DB,workspace,principal.email)});
      if(request.method==='POST') return response({data:await issuePersonalApiKey(env.DB,workspace,principal.email,await parseBody())},201);
      if(request.method==='DELETE'&&company) {await revokePersonalApiKey(env.DB,workspace,principal.email,company);return response({data:{revoked:true}});}
    }
    if(resource==='openapi.json'&&request.method==='GET') return openApiResponse(request);
    if(resource==='credentials') {
      if(principal.kind!=='session') throw new OperationError(403,'session_required','Use sua sessão para gerenciar credenciais.');
      if(request.method==='GET') return response({data:await listIntegrationCredentials(env.DB,workspace,principal.email)});
      if(request.method==='POST') return response({data:await issueIntegrationCredential(env.DB,workspace,principal.email,await parseBody() as Parameters<typeof issueIntegrationCredential>[3])},201);
      if(request.method==='DELETE'&&company) { await revokeIntegrationCredential(env.DB,workspace,principal.email,company);return response({data:{revoked:true}}); }
    }
    if(resource==='operations'&&company) {
      if(request.method==='GET') return response(await readMeetingOperation(env,principal,company));
      if(request.method==='POST'&&child==='resume') return response(await resumeMeetingOperation(env,principal,company));
    }
    if(request.method==='GET') {
      const url=new URL(request.url),selected=url.searchParams.get('company')??undefined;
      if(resource==='tasks'&&company&&child==='history') return response(await readTaskHistory(env,principal,
        {company:selected??'',taskId:company,cursor:url.searchParams.get('cursor')??undefined,
          limit:Number(url.searchParams.get('limit')??50)}));
      if(resource==='admin'&&company==='audit-log') { const page=url.searchParams.get('page');return response(await readAdminAudit(env,principal,{limit:Number(url.searchParams.get('limit')??50),cursor:url.searchParams.get('cursor')??undefined,page:page===null?undefined:Number(page),anchor:url.searchParams.get('anchor')??undefined,company:selected,actor:url.searchParams.get('actor')??undefined,source:url.searchParams.get('source')??undefined,area:url.searchParams.get('area')??undefined})); }
      if(resource==='insights'&&path[2]==='source')return response(await readInsightSource(env,principal,{company:selected??'',insight:company}));
      if(resource==='insights')return response(await readInsights(env,principal,{company:selected??'',meeting:url.searchParams.get('meeting')??undefined,status:url.searchParams.get('status')??undefined,cursor:url.searchParams.get('cursor')??undefined}));
      if(resource==='whatsapp'&&company==='messages'){const refresh=url.searchParams.get('refresh');if(refresh!==null&&!['true','false'].includes(refresh))throw new OperationError(422,'invalid_input','Atualização inválida.');return response(await readWhatsAppMessages(env,principal,{company:selected??'',before:url.searchParams.get('before')??undefined,refresh:refresh==='true'}));}
      if(resource==='workspace'&&company==='settings') return response(await readWorkspaceSettings(env,principal));
      if(resource==='alerts'&&company==='count') return response(await countAlerts(env,principal));
      if(resource==='alerts') return response(await readAlerts(env,principal,{company:selected??'',limit:Number(url.searchParams.get('limit')??50),offset:Number(url.searchParams.get('cursor')??0)}));
      if(resource==='me'||resource==='capabilities') return response(await readContextQuery(env,principal,resource,{company:selected}));
      if(resource==='clients'&&child==='audit-log') return response(await readClientAudit(env,principal,{company,limit:Number(url.searchParams.get('limit')??50),cursor:url.searchParams.get('cursor')??undefined}));

      if(resource==='clients'&&child==='execution-snapshot') return response(await readClientExecutionSnapshot(env,principal,company));
      if(resource==='clients'&&(child==='context'||child==='stakeholder-map')) return response(await readContextQuery(env,principal,child==='context'?'client.context':'client.stakeholder-map',{company}));
      if(resource==='products'&&child==='versions') return response(await readContextQuery(env,principal,'product.versions',{productId:company,company:selected,...(record===undefined?{}:{version:Number(record)})}));
      if(resource==='webhooks') {
        if(company&&child==='deliveries') return response(await listWebhookDeliveries(env,principal,company,{cursor:url.searchParams.get('cursor')??undefined,limit:url.searchParams.has('limit')?Number(url.searchParams.get('limit')):undefined}));
        return response(await listWebhooks(env,principal));
      }
    }
    if(resource==='events'&&request.method==='GET') {
      const url=new URL(request.url);return response(await listEvents(env.DB,workspace,principal,{cursor:url.searchParams.get('cursor')??undefined,company:url.searchParams.get('company')??undefined,limit:Number(url.searchParams.get('limit'))||50}));
    }
    if(resource==='members'&&request.method==='GET') {
      const url=new URL(request.url),limit=Number(url.searchParams.get('limit')??50),offset=Number(url.searchParams.get('cursor')??0),inactive=url.searchParams.get('includeInactive');
      if(inactive!==null&&!['true','false'].includes(inactive))throw new OperationError(400,'invalid_input','Filtro inválido.');
      const result=company==='pending'?await readPendingMembers(env,principal,{limit,offset}):await readMembers(env,principal,{limit,offset,includeInactive:inactive==='true',company:url.searchParams.get('company')??undefined,role:url.searchParams.get('role')??undefined});
      return response({data:result.data,...('total'in result?{total:result.total}:{}),nextCursor:result.nextOffset===null?null:String(result.nextOffset)});
    }
    if(resource==='allocations'&&request.method==='GET') {
      const url=new URL(request.url),limit=Number(url.searchParams.get('limit')??50),offset=Number(url.searchParams.get('cursor')??0),versionText=url.searchParams.get('expectedVersion');
      if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new OperationError(400,'invalid_limit','Limite inválido.');
      if(!Number.isSafeInteger(offset)||offset<0)throw new OperationError(400,'invalid_cursor','Cursor inválido.');
      if(versionText!==null&&!/^\d+$/.test(versionText))throw new OperationError(400,'invalid_filter','Versão esperada inválida.');
      const result=await readAllocations(env,principal,{company:url.searchParams.get('company')??undefined,memberId:url.searchParams.get('memberId')??undefined,role:url.searchParams.get('role')??undefined,limit,offset,expectedVersion:versionText===null?undefined:Number(versionText)});
      return response({data:result.data,total:result.total,totalClients:result.totalClients,snapshotVersion:result.snapshotVersion,nextCursor:result.nextOffset===null?null:String(result.nextOffset)});
    }
    if(resource==='knowledge'&&request.method==='GET') {
      const query:Record<string,unknown>=Object.fromEntries(new URL(request.url).searchParams);
      for(const field of ['limit','expectedVersion'])if(query[field]!==undefined)query[field]=query[field]===''?NaN:Number(query[field]);
      if(query.includeDraft!==undefined)query.includeDraft=query.includeDraft==='true'?true:query.includeDraft==='false'?false:query.includeDraft;
      return response(await readKnowledgeResource(env,principal,company,child,record,query));
    }
    if(resource==='documents'&&request.method==='GET') {
      const url=new URL(request.url),limit=Number(url.searchParams.get('limit')??50),offset=Number(url.searchParams.get('cursor')??0),removed=url.searchParams.get('includeRemoved');
      if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new OperationError(400,'invalid_limit','Limite inválido.');
      if(!Number.isSafeInteger(offset)||offset<0)throw new OperationError(400,'invalid_cursor','Cursor inválido.');
      if(removed!==null&&!['true','false'].includes(removed))throw new OperationError(400,'invalid_input','Filtro inválido.');
      const result=await readDocuments(env,principal,{company:string(url.searchParams.get('company')??undefined,'cliente'),includeRemoved:removed==='true',limit,offset});
      return response({data:result.data,nextCursor:result.nextOffset===null?null:String(result.nextOffset)});
    }
    if(resource==='inbox'&&request.method==='GET') {
      const url=new URL(request.url),limit=Number(url.searchParams.get('limit')??50),offset=Number(url.searchParams.get('cursor')??0);
      if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new OperationError(400,'invalid_limit','Limite inválido.');
      if(!Number.isSafeInteger(offset)||offset<0)throw new OperationError(400,'invalid_cursor','Cursor inválido.');
      const result=await readInbox(env,principal,{company:string(url.searchParams.get('company')??undefined,'cliente'),threadId:child,limit,offset});
      return response({data:result.data,nextCursor:result.nextOffset===null?null:String(result.nextOffset)});
    }
    if(resource==='signals'&&request.method==='GET') {
      const url=new URL(request.url),limit=Number(url.searchParams.get('limit')??50),offset=Number(url.searchParams.get('cursor')??0);
      if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new OperationError(400,'invalid_limit','Limite inválido.');
      if(!Number.isSafeInteger(offset)||offset<0)throw new OperationError(400,'invalid_cursor','Cursor inválido.');
      const result=await readSignals(env,principal,{company:string(url.searchParams.get('company')??undefined,'cliente'),limit,offset});
      return response({data:result.data,nextCursor:result.nextOffset===null?null:String(result.nextOffset)});
    }
    if(resource==='program-events'&&request.method==='GET') {
      const url=new URL(request.url),limit=Number(url.searchParams.get('limit')??50),offset=Number(url.searchParams.get('cursor')??0),removed=url.searchParams.get('includeRemoved');
      if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new OperationError(400,'invalid_limit','Limite inválido.');
      if(!Number.isSafeInteger(offset)||offset<0)throw new OperationError(400,'invalid_cursor','Cursor inválido.');
      if(removed!==null&&!['true','false'].includes(removed))throw new OperationError(400,'invalid_input','Filtro inválido.');
      const result=await readProgramEvents(env,principal,{company:string(url.searchParams.get('company')??undefined,'cliente'),includeRemoved:removed==='true',limit,offset});
      return response({data:result.data,nextCursor:result.nextOffset===null?null:String(result.nextOffset)});
    }
    if(['pains','solutions','hypotheses'].includes(resource)&&request.method==='GET') {
      const url=new URL(request.url),limit=Number(url.searchParams.get('limit')??50),offset=Number(url.searchParams.get('cursor')??0);
      if(!Number.isSafeInteger(limit)||limit<1||limit>100) throw new OperationError(400,'invalid_limit','Limite inválido.');
      if(!Number.isSafeInteger(offset)||offset<0) throw new OperationError(400,'invalid_cursor','Cursor inválido.');
      const removed=url.searchParams.get('includeRemoved');if(removed!==null&&!['true','false'].includes(removed))throw new OperationError(400,'invalid_input','Filtro de removidos inválido.');
      const result=await readDiagnosis(env,principal,{company:string(url.searchParams.get('company')??undefined,'cliente'),kind:resource as 'pains'|'solutions'|'hypotheses',includeRemoved:removed==='true',limit,offset});
      return response({data:result.data,nextCursor:result.nextOffset===null?null:String(result.nextOffset)});
    }
    if(resource==='interactions'&&request.method==='GET') {
      const url=new URL(request.url),limit=Number(url.searchParams.get('limit')??50),offset=Number(url.searchParams.get('cursor')??0);
      if(!Number.isSafeInteger(limit)||limit<1||limit>100) throw new OperationError(400,'invalid_limit','Informe um limite inteiro de 1 a 100.');
      if(!Number.isSafeInteger(offset)||offset<0) throw new OperationError(400,'invalid_cursor','Cursor inválido.');
      const result=await readInteractions(env,principal,{company:string(url.searchParams.get('company')??undefined,'cliente'),limit,offset});
      return response({data:result.notes,nextCursor:result.nextOffset===null?null:String(result.nextOffset)});
    }
    if(request.method==='GET') return response(await readCollection(request,env,workspace,principal,path));
    if(resource==='product-rollouts'&&company==='preview') return response(await previewProductRollout(env,principal,await parseBody()));
    const key=string(request.headers.get('idempotency-key')??undefined,'Idempotency-Key',undefined,200);
    if(!key) throw new OperationError(400,'idempotency_required','Informe Idempotency-Key.');
    const body=await parseBody();
    if(resource==='meetings'&&child==='analyze')return response(await generateMeetingInsight(env,principal,{...object(body),meeting:company},key));
    if(resource==='whatsapp'&&company==='sync')return response(await requestWhatsAppSync(env,principal,body,key),202);
    if(resource==='insights'&&child==='review')return response(await reviewInsight(env,principal,{...object(body),insight:company},key));
    if(resource==='webhooks') {
      if(request.method==='POST'&&!company) return response(await createWebhook(env,principal,body,key));
      if(request.method==='DELETE'&&company) return response(await deactivateWebhook(env,principal,company,key));
      if(request.method==='POST'&&company&&child==='rotate-secret') return response(await rotateWebhookSecret(env,principal,company,body,key));
      if(request.method==='PATCH'&&company) return response(await updateWebhook(env,principal,company,body,key));
      if(request.method==='POST'&&company&&child==='deliveries'&&record&&path[4]==='replay') return response(await replayWebhookDelivery(env,principal,company,record,key));
    }
    const {command,input,expectedVersions}=commandForRequest(request.method,path,body);
    commandName=command;
    const expectedClientSnapshot=request.headers.get('x-client-snapshot')??undefined;
    if(expectedClientSnapshot!==undefined&&!/^[A-Za-z0-9:_-]{1,160}$/.test(expectedClientSnapshot))
      throw new OperationError(400,'invalid_filter','Marcador do cliente inválido.');
    if(expectedClientSnapshot!==undefined&&!((command.startsWith('tasks.')||command.startsWith('cycles.'))||
      command==='plans.schedule'||command==='plans.advance'))
      throw new OperationError(400,'invalid_filter','Esta operação não aceita marcador de execução do cliente.');
    return response(compactCommandResult(await executeCommand(env,principal,workspace,command,input,key,expectedVersions,expectedClientSnapshot)));
  } catch(error) {
    if(error instanceof OperationError) return response({error:{code:error.code,message:error.message,details:error.details}},error.status);
    console.error({event:'operation_unexpected_error',requestId,method:request.method,resource:path[0],command:commandName,error:diagnosticError(error)});
    return response({error:{code:'internal_error',message:`Não foi possível confirmar a operação. Verifique o resultado com a mesma chave. Código de suporte: ${requestId}.`,details:{requestId}}},500,{'x-request-id':requestId});
  }
}
