import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { knowledgeReadOptions, knowledgeListOptions } from './knowledge-schemas.ts';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import type { ServerEnv } from '../context';
import { resolveOperationPrincipal } from './principal.ts';
import { apiResponse } from './http.ts';
import type { IntegrationScope } from './credentials.ts';
import { OperationError } from './errors.ts';
import { commandTools, rolloutInput, commandScopes } from './tool-definitions.ts';
const company=z.string().min(1).describe('Identificador do cliente (slug).');
const idempotencyKey=z.string().min(1).max(200);
const MCP_INLINE_FILE_BYTES=8*1024*1024;
const MCP_INLINE_BASE64_CHARS=Math.ceil(MCP_INLINE_FILE_BYTES/3)*4;
function decodeBase64(value:string) {
  if(value.length>MCP_INLINE_BASE64_CHARS||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new OperationError(422,'invalid_file_content','Conteúdo base64 inválido ou maior que 8 MB. Para arquivos maiores, use PUT /api/v1/files/{fileId}.');
  const binary=atob(value),bytes=new Uint8Array(binary.length);if(bytes.byteLength>MCP_INLINE_FILE_BYTES)throw new OperationError(422,'invalid_file_content','Conteúdo base64 inválido ou maior que 8 MB. Para arquivos maiores, use PUT /api/v1/files/{fileId}.');for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;
}
function encodeBase64(bytes:Uint8Array) {
  let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return btoa(binary);
}
/** No transport session, process-local identity, or chat history: both protocol eras are per-request. */
export async function mcpResponse(request:Request,env:ServerEnv) {
  try {
    if(!request.headers.has('authorization')) throw new OperationError(401,'authentication_required','Conecte uma credencial de integração.');
    const principal=await resolveOperationPrincipal(request,env);
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin) throw new OperationError(403,'invalid_origin','Origem não permitida.');
    const canScope=(scope:IntegrationScope)=>!principal.scopes||principal.scopes.includes(scope);
    const invoke=async(path:string[],method:string,input?:unknown,key?:string,
      query?:Record<string,unknown>,expectedClientSnapshot?:string)=>{
      const url=new URL(`/api/v1/${path.join('/')}`,request.url),headers=new Headers(request.headers);
      for(const [name,value] of Object.entries(query??{})) if(value!==undefined) url.searchParams.set(name,String(value));
      headers.delete('content-length');headers.set('content-type','application/json');
      if(key) headers.set('Idempotency-Key',key);
      if(expectedClientSnapshot) headers.set('x-client-snapshot',expectedClientSnapshot);
      const result=await apiResponse(new Request(url,{method,headers,...(input!==undefined?{body:JSON.stringify(input)}:{})}),env,path,{channel:'mcp'});
      const body=await result.json() as Record<string,unknown>;
      return {content:[{type:'text' as const,text:JSON.stringify(body)}],structuredContent:body,...(!result.ok?{isError:true}:{})};
    };
    const handler=createMcpHandler(()=>{
      const server=new McpServer({name:'g4-delivery',version:'1.0.0'},{capabilities:{tools:{}},jsonSchemaValidator:new CfWorkerJsonSchemaValidator()});
      const collections=[['clients','clients:read'],['products','catalog:read'],['plans','catalog:read'],['enrollments','enrollments:read'],['stakeholders','stakeholders:read'],['participants','enrollments:read'],['cycles','delivery:read'],['tasks','delivery:read'],['meetings','meetings:read'],['events','events:read']] as const;
      for(const [resource,scope] of collections) if(canScope(scope)) server.registerTool(`${resource}_list`,{
        description:resource==='plans'
          ? 'Compatibilidade legada: consultar modelos globais antigos. Novas contratações usam a versão do produto e recebem uma fotografia privada da execução.'
          : resource==='clients'
            ? 'Consultar clientes em visão compacta por padrão, com total real antes da paginação (limit não é o total). Filtre por memberId/role (alocação atual), productId, status, healthFlag ou q; use includeArchived=false para a carteira atual. Cada registro informa archived. Em páginas seguintes, envie expectedVersion=snapshotVersion da primeira página; 409 exige reiniciar a leitura. view=full devolve o cadastro legado, cujos leadId, csId e milestone podem divergir das alocações e do marco de cada contratação; a visão compacta omite esses campos. Para contar clientes distintos por membro/papel use allocations_list (totalClients); para marco do produto consulte enrollments_list com memberId/role e productId. healthFlag é o sinal de saúde e status é situação cadastral. Repita usando nextCursor quando presente.'
            : resource==='enrollments'
              ? 'Consultar contratações; filtre por memberId/role da alocação atual, productId, milestone e currentOnly=true para excluir canceladas/arquivadas. Uma alocação específica da contratação substitui a geral no mesmo papel. total conta contratações e totalClients conta clientes distintos antes da paginação; o mesmo cliente pode ter várias contratações e aparecer em mais de um marco. Em páginas seguintes, envie expectedVersion=snapshotVersion da primeira página; 409 exige reiniciar a leitura. milestone é o marco desta contratação; quando ausente não presuma o marco do cadastro. Repita usando nextCursor quando presente.'
            : resource==='tasks'||resource==='cycles'
              ? `Consultar ${resource} efetivos com paginação e escopo autorizado. Com company, a consulta usa o índice validado. Se a primeira página trouxer clientSnapshot, reenvie expectedClientSnapshot e nextCursor; expectedVersion continua disponível para a versão global legada.`
              : `Consultar ${resource}, com paginação e escopo autorizado. Repita usando nextCursor quando presente.`,
        inputSchema:z.object({company:company.optional(),cursor:z.string().optional(),limit:z.number().int().min(1).max(100).optional(),...(['clients','enrollments'].includes(resource)?{memberId:z.string().min(1).optional(),role:z.string().min(1).optional(),productId:z.string().min(1).optional(),expectedVersion:z.number().int().min(0).optional()}:{}),...(resource==='clients'?{clientResponsibleId:z.string().min(1).optional().describe('Responsável geral do cliente; __none__ para sem responsável.'),productResponsibleId:z.string().min(1).optional().describe('Responsável explícito pelo produto contratado; exige productId. __none__ para sem responsável.'),q:z.string().optional(),status:z.string().min(1).optional(),healthFlag:z.string().min(1).optional(),includeArchived:z.boolean().optional(),view:z.enum(['summary','full']).optional()}:{}),...(resource==='enrollments'?{milestone:z.number().int().positive().optional(),currentOnly:z.boolean().optional()}:{}),...(resource==='tasks'||resource==='cycles'?{status:z.string().min(1).optional(),enrollmentId:z.string().min(1).optional(),expectedVersion:z.number().int().min(0).optional(),expectedClientSnapshot:z.string().min(1).max(160).optional()}:{}),...(resource==='tasks'?{ownerId:z.string().min(1).optional(),dueFrom:z.string().optional(),dueTo:z.string().optional(),sort:z.enum(['position','dueAt']).optional()}:{}),...(resource==='meetings'?{includeRemoved:z.boolean().optional().describe('Incluir reuniões removidas para consultar histórico ou restaurar.')}:{})}),annotations:{readOnlyHint:true,openWorldHint:false},
      },async(args)=>{
        const url=new URL(`/api/v1/${resource}`,request.url);for(const [k,v] of Object.entries(args)) if(v!==undefined) url.searchParams.set(k,String(v));
        if(resource==='clients'&&!url.searchParams.has('view')) url.searchParams.set('view','summary');
        const result=await apiResponse(new Request(url,{headers:request.headers}),env,[resource],{channel:'mcp'});const body=await result.json() as Record<string,unknown>;
        return {content:[{type:'text',text:JSON.stringify(body)}],structuredContent:body,...(!result.ok?{isError:true}:{})};
      });
      if(canScope('delivery:read')) server.registerTool('clients_execution_snapshot',{
        description:'Consultar a fatia bruta de execução de um cliente para edição. mode=legacy indica que a autoridade ainda é o documento global; mode=active traz clientSnapshot, a revisão a enviar em comandos e nas páginas de tasks_list/cycles_list. Use as listas paginadas para tarefas e ciclos efetivos.',
        inputSchema:z.object({company}),annotations:{readOnlyHint:true,openWorldHint:false},
      },async({company})=>invoke(['clients',company,'execution-snapshot'],'GET'));
      if(canScope('workspace:read')) {
        server.registerTool('workspace_settings_get',{description:'Consultar nome, regras e catálogos personalizados de cargos e papéis; exige permissão de configurações.',inputSchema:z.object({}),annotations:{readOnlyHint:true,openWorldHint:false}},async()=>invoke(['workspace','settings'],'GET'));
        server.registerTool('alerts_list',{description:'Consultar alertas ativos do cliente que você ainda não marcou como vistos.',inputSchema:z.object({company,cursor:z.string().optional(),limit:z.number().int().min(1).max(100).optional()}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke(['alerts'],'GET',undefined,undefined,args));
        server.registerTool('members_list',{description:'Consultar membros da equipe; filtre por company e/ou role da alocação vigente para obter as pessoas de um cliente ou papel sem buscar o roster inteiro. total conta antes da paginação. Use os IDs retornados em allocations_list, clients_list ou enrollments_list.',inputSchema:z.object({company:company.optional(),role:z.string().min(1).optional(),cursor:z.string().optional(),limit:z.number().int().min(1).max(100).optional(),includeInactive:z.boolean().optional()}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke(['members'],'GET',undefined,undefined,args));
        server.registerTool('members_pending',{description:'Consultar pessoas aguardando aprovação; exige administrador atual.',inputSchema:z.object({cursor:z.string().optional(),limit:z.number().int().min(1).max(100).optional()}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke(['members','pending'],'GET',undefined,undefined,args));
        if(principal.access==='admin') server.registerTool('admin_audit_log',{description:'Consultar a auditoria operacional de todo o workspace. Exclusiva de Admin da plataforma; permite filtrar por cliente, ator, origem e área e paginar por cursor ou número de página. Consulte page 1 primeiro e reutilize seu anchor obrigatório nas páginas seguintes.',inputSchema:z.object({cursor:z.string().optional(),page:z.number().int().min(1).max(1_000_000).optional(),anchor:z.string().optional(),limit:z.number().int().min(1).max(100).optional(),company:company.optional(),actor:z.string().optional(),source:z.enum(['interface','api','mcp']).optional(),area:z.string().optional()}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke(['admin','audit-log'],'GET',undefined,undefined,args));
      }
      if(canScope('workspace:read')) server.registerTool('allocations_list',{description:'Fonte das atribuições. Informe company para equipe de um cliente (inclui vínculos históricos com from/to), ou memberId (ID de members_list) e role, por exemplo responsavel, para listar TODOS os clientes autorizados desse membro sem consultar cliente por cliente. totalClients conta clientes distintos antes da paginação; percorra nextCursor para detalhes e envie expectedVersion=snapshotVersion da primeira página. O campo enrollmentId da resposta indica vínculo a uma contratação; em busca global por membro, vínculos de contratações encerradas e responsabilidades gerais totalmente substituídas são excluídos. Para marco de produto, consulte enrollments_list e use milestone da contratação, não milestone legado de clients_list.',inputSchema:z.object({company:company.optional(),memberId:z.string().min(1).optional(),role:z.string().min(1).optional(),cursor:z.string().optional(),limit:z.number().int().min(1).max(100).optional(),expectedVersion:z.number().int().min(0).optional()}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke(['allocations'],'GET',undefined,undefined,args));
      if(canScope('knowledge:read')) {
        server.registerTool('knowledge_get',{description:'Comece aqui: resumo compacto do mapa, versão, contagens e até 25 domínios, sem grafo nem draft. Use knowledge_elements_list/knowledge_connections_list/knowledge_domains_list com limit e cursor para ler em blocos. view=full é explícito e pode gerar resposta grande; includeDraft=false evita duplicação.',inputSchema:knowledgeReadOptions.extend({company}),annotations:{readOnlyHint:true,openWorldHint:false}},async({company,...options})=>invoke(['knowledge',encodeURIComponent(company)],'GET',undefined,undefined,{...options,view:options.view??'summary',includeDraft:options.includeDraft??false}));
        for(const resource of ['elements','connections','domains'] as const) {
          const options=resource==='elements'?knowledgeListOptions.omit({nodeId:true}):resource==='connections'?knowledgeListOptions.omit({domain:true,elementType:true}):knowledgeListOptions.omit({domain:true,elementType:true,nodeId:true,view:true});
          server.registerTool(`knowledge_${resource}_list`,{description:`Consultar ${resource==='elements'?'elementos':resource==='connections'?'relações':'domínios'} em páginas do mesmo mapa. Padrão 25 e resumo sem textos longos. Repita cliente, filtros e view com nextCursor; snapshot_changed exige reiniciar. Para detalhes de um elemento/relação, use knowledge_element_get/knowledge_connection_get.`,inputSchema:options.extend({company}),annotations:{readOnlyHint:true,openWorldHint:false}},async({company,...query})=>invoke(['knowledge',encodeURIComponent(company),resource],'GET',undefined,undefined,query));
        }
        for(const [resource,name,id] of [['elements','element','nodeId'],['connections','connection','edgeId']] as const)
          server.registerTool(`knowledge_${name}_get`,{description:'Consultar um registro completo por ID para edição, sem carregar todo o mapa. Informe expectedVersion para validar a revisão observada.',inputSchema:z.object({company,[id]:z.string().min(1),expectedVersion:z.number().int().min(0).optional()}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke(['knowledge',encodeURIComponent(args.company as string),resource,encodeURIComponent(args[id] as string)],'GET',undefined,undefined,{expectedVersion:args.expectedVersion}));
      }
      if(canScope('documents:read')) server.registerTool('documents_list',{description:'Consultar documentos do cliente, suas versões e revisão; incluir removidos opcionalmente.',inputSchema:z.object({company,cursor:z.string().optional(),limit:z.number().int().min(1).max(100).optional(),includeRemoved:z.boolean().optional()}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke(['documents'],'GET',undefined,undefined,args));
      if(canScope('documents:read')) server.registerTool('files_download',{
        description:'Baixar o conteúdo de um arquivo como recurso binário MCP (base64), até 8 MB. Para arquivos maiores, use GET /api/v1/files/{fileId} com o mesmo Bearer.',
        inputSchema:z.object({fileId:z.string().regex(/^up-[A-Za-z0-9_.-]{1,117}$/)}).strict(),annotations:{readOnlyHint:true,openWorldHint:false},
      },async({fileId})=>{
        const url=new URL(`/api/v1/files/${encodeURIComponent(fileId)}`,request.url),result=await apiResponse(new Request(url,{headers:request.headers}),env,['files',fileId],{channel:'mcp'});
        if(!result.ok){const body=await result.json() as Record<string,unknown>;return{content:[{type:'text' as const,text:JSON.stringify(body)}],structuredContent:body,isError:true};}
        const size=Number(result.headers.get('content-length')??0),mimeType=result.headers.get('content-type')||'application/octet-stream',encodedName=result.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];let name=fileId;try{name=encodedName?decodeURIComponent(encodedName):fileId;}catch{name=fileId;}
        if(size>MCP_INLINE_FILE_BYTES){const body={error:{code:'mcp_file_too_large',message:'O arquivo excede 8 MB. Baixe pela API REST oficial.',details:{fileId,size,url:url.href}}};return{content:[{type:'text' as const,text:JSON.stringify(body)}],structuredContent:body,isError:true};}
        const blob=encodeBase64(new Uint8Array(await result.arrayBuffer())),body={data:{fileId,name,size,mimeType,url:url.href}};
        return{content:[{type:'text' as const,text:JSON.stringify(body)},{type:'resource' as const,resource:{uri:url.href,mimeType,blob}}],structuredContent:body};
      });
      if(principal.access!=='leitor'&&canScope('documents:write')) server.registerTool('files_upload',{
        description:'Enviar um arquivo de até 8 MB em base64. Use um fileId up-UUID estável para poder repetir a chamada com segurança; depois use documents_register ou documents_version para publicar metadados e vínculos. Para até 50 MB, use PUT /api/v1/files/{fileId}.',
        inputSchema:z.object({company,fileId:z.string().regex(/^up-[A-Za-z0-9_.-]{1,117}$/).describe('ID estável no formato up-UUID, gerado pelo cliente antes da chamada.'),name:z.string().min(1).max(500),mimeType:z.string().min(1).max(200).optional(),contentBase64:z.string().max(MCP_INLINE_BASE64_CHARS)}).strict(),annotations:{readOnlyHint:false,idempotentHint:true,openWorldHint:false},
      },async(args)=>{
        const fileId=args.fileId,bytes=decodeBase64(args.contentBase64),url=new URL(`/api/v1/files/${encodeURIComponent(fileId)}`,request.url),headers=new Headers(request.headers);
        headers.delete('content-length');headers.set('content-type',args.mimeType||'application/octet-stream');headers.set('x-client-company',args.company);headers.set('x-file-name',encodeURIComponent(args.name));
        const result=await apiResponse(new Request(url,{method:'PUT',headers,body:bytes}),env,['files',fileId],{channel:'mcp'}),body=await result.json() as Record<string,unknown>;
        const shaped=result.ok?{data:{...body,fileId,name:args.name,mimeType:args.mimeType||'application/octet-stream'}}:body;
        return{content:[{type:'text' as const,text:JSON.stringify(shaped)}],structuredContent:shaped,...(!result.ok?{isError:true}:{})};
      });
      if(principal.access!=='leitor'&&canScope('documents:write')) server.registerTool('files_delete',{
        description:'Excluir fisicamente somente upload órfão. Documento publicado, removido ou histórico deve usar documents_remove e tem seus bytes preservados.',
        inputSchema:z.object({fileId:z.string().regex(/^up-[A-Za-z0-9_.-]{1,117}$/),company:company.optional()}).strict(),annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:false},
      },async({fileId,company})=>{
        const url=new URL(`/api/v1/files/${encodeURIComponent(fileId)}`,request.url),headers=new Headers(request.headers);if(company)headers.set('x-client-company',company);
        const result=await apiResponse(new Request(url,{method:'DELETE',headers}),env,['files',fileId],{channel:'mcp'}),body=await result.json() as Record<string,unknown>;
        return{content:[{type:'text' as const,text:JSON.stringify(body)}],structuredContent:body,...(!result.ok?{isError:true}:{})};
      });
      if(canScope('engagement:read')) server.registerTool('insight_source_get',{description:'Consultar o texto usado em uma análise. Fontes de reunião exigem meetings:read; transcrições também documents:read.',inputSchema:z.object({company,insight:z.string()}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke(['insights',args.insight,'source'],'GET',undefined,undefined,{company:args.company}));
      if(canScope('engagement:write')) server.registerTool('whatsapp_sync',{description:'Solicitar importação e análise de conversas do grupo configurado do cliente. Retorna job persistido; processamento continua pela fila.',inputSchema:z.object({company,days:z.union([z.literal(2),z.literal(30),z.literal(90),z.literal(365)]).optional(),idempotencyKey}),annotations:{readOnlyHint:false,idempotentHint:true,openWorldHint:true}},async(args)=>invoke(['whatsapp','sync'],'POST',{company:args.company,days:args.days},args.idempotencyKey));
      if(canScope('engagement:write')&&canScope('meetings:read')) server.registerTool('meetings_analyze',{description:'Gerar análise das notas ou transcrição da reunião. Transcrição exige documents:read. Fonte alterada exige confirmação com sourceHash retornado, usando uma nova chave.',inputSchema:z.object({company,meeting:z.string(),confirmedHash:z.string().optional(),idempotencyKey}),annotations:{readOnlyHint:false,idempotentHint:true,openWorldHint:true}},async(args)=>invoke(['meetings',args.meeting,'analyze'],'POST',{company:args.company,confirmedHash:args.confirmedHash},args.idempotencyKey));
      if(canScope('engagement:write')) server.registerTool('insights_review',{description:'Aceitar ou descartar uma sugestão pendente. Registra revisão humana sem executar a ação sugerida.',inputSchema:z.object({company,insight:z.string(),decision:z.enum(['accept','dismiss']),idempotencyKey}),annotations:{readOnlyHint:false,idempotentHint:true,openWorldHint:false}},async(args)=>invoke(['insights',args.insight,'review'],'POST',{company:args.company,decision:args.decision},args.idempotencyKey));
      if(canScope('engagement:read')) server.registerTool('insights_list',{description:'Consultar análises persistidas e a última importação do cliente. Não inicia análise nem importação; reunião exige também meetings:read.',inputSchema:z.object({company,meeting:z.string().optional(),status:z.enum(['pending','accepted','dismissed']).optional(),cursor:z.string().optional()}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke(['insights'],'GET',undefined,undefined,args));
      if(canScope('engagement:read')) server.registerTool('whatsapp_messages_list',{description:'Consultar mensagens remotas do grupo configurado no cliente. Somente leitura; não envia mensagens.',inputSchema:z.object({company,before:z.string().optional(),refresh:z.boolean().optional()}),annotations:{readOnlyHint:true,openWorldHint:true}},async(args)=>invoke(['whatsapp','messages'],'GET',undefined,undefined,args));
      if(canScope('engagement:read')) server.registerTool('inbox_list',{description:'Consultar conversas de um cliente ou mensagens de uma conversa. Notas são internas; não envia mensagens.',inputSchema:z.object({company,threadId:z.string().optional(),cursor:z.string().optional(),limit:z.number().int().min(1).max(100).optional()}),annotations:{readOnlyHint:true,openWorldHint:false}},async({threadId,...args})=>invoke(threadId?['inbox','threads',threadId,'messages']:['inbox','threads'],'GET',undefined,undefined,args));
      if(canScope('engagement:read')) server.registerTool('signals_list',{description:'Consultar sinais derivados de conversas do cliente, com resolução e tarefa vinculada.',inputSchema:z.object({company,cursor:z.string().optional(),limit:z.number().int().min(1).max(100).optional()}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke(['signals'],'GET',undefined,undefined,args));
      if(canScope('meetings:read')) server.registerTool('program_events_list',{description:'Consultar eventos da agenda do cliente; separado do feed outbound.',inputSchema:z.object({company,cursor:z.string().optional(),limit:z.number().int().min(1).max(100).optional(),includeRemoved:z.boolean().optional()}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke(['program-events'],'GET',undefined,undefined,args));
      if(canScope('engagement:read')) for(const resource of ['pains','solutions','hypotheses']) server.registerTool(`${resource}_list`,{description:'Consultar diagnóstico do cliente, com paginação e opção de incluir removidos.',inputSchema:z.object({company,cursor:z.string().optional(),limit:z.number().int().min(1).max(100).optional(),includeRemoved:z.boolean().optional()}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke([resource],'GET',undefined,undefined,args));
      if(canScope('engagement:read')) server.registerTool('interactions_list',{description:'Consultar interações registradas de um cliente, com paginação e histórico.',inputSchema:z.object({company,cursor:z.string().optional(),limit:z.number().int().min(1).max(100).optional()}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke(['interactions'],'GET',undefined,undefined,args));
      server.registerTool('me_get',{description:'Consultar identidade e escopos atuais do acesso ao Delivery. Execute novamente após conectar ou reautorizar; resultados anteriores da conversa podem pertencer a outra conexão.',inputSchema:z.object({}),annotations:{readOnlyHint:true,openWorldHint:false}},async()=>invoke(['me'],'GET'));
      server.registerTool('capabilities_get',{description:'Consultar permissões atuais por ação, escopo e cliente. Reconsulte após reautorizar ou trocar de cliente; não use resultados antigos da conversa para diagnosticar uma chamada atual. Regras de negócio e configuração externa continuam obrigatórias.',inputSchema:z.object({company:company.optional()}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke(['capabilities'],'GET',undefined,undefined,args));
      if(canScope('clients:read')) server.registerTool('clients_context',{description:'Obter contexto compacto de um cliente, com contratações (incluindo marco próprio), alocações e links relacionados conforme os escopos atuais. Para a lista completa de stakeholders ou documentos, siga o recurso em links.related ou use stakeholders_list / documents_list com company; seções em unavailable não foram autorizadas.',inputSchema:z.object({company}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke(['clients',encodeURIComponent(args.company),'context'],'GET'));
      if(canScope('clients:read')) server.registerTool('clients_audit_log',{description:'Consultar a trilha permanente de alterações do cliente, com ator, horário, origem, ação e contexto mínimo.',inputSchema:z.object({company,cursor:z.string().optional(),limit:z.number().int().min(1).max(100).optional()}),annotations:{readOnlyHint:true,openWorldHint:false}},async({company,...query})=>invoke(['clients',encodeURIComponent(company),'audit-log'],'GET',undefined,undefined,query));
      if(canScope('delivery:read')) server.registerTool('tasks_history_list',{
        description:'Consultar o histórico completo recuperável de uma tarefa, em páginas, inclusive eventos anteriores à janela resumida da interface.',
        inputSchema:z.object({company,taskId:z.string().min(1),cursor:z.string().optional(),limit:z.number().int().min(1).max(100).optional()}),
        annotations:{readOnlyHint:true,openWorldHint:false},
      },async({taskId,...query})=>invoke(['tasks',encodeURIComponent(taskId),'history'],'GET',undefined,undefined,query));
      if(canScope('stakeholders:read')&&canScope('enrollments:read')) server.registerTool('clients_stakeholder_map',{description:'Consultar pessoas únicas do cliente, participações e lacunas específicas de cada contratação.',inputSchema:z.object({company}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke(['clients',encodeURIComponent(args.company),'stakeholder-map'],'GET'));
      if(canScope('catalog:read')) server.registerTool('products_versions',{description:'Listar versões de produto ou obter a definição de uma versão antes da contratação.',inputSchema:z.object({productId:z.string(),version:z.number().int().positive().optional(),company:company.optional()}),annotations:{readOnlyHint:true,openWorldHint:false}},async(args)=>invoke(['products',encodeURIComponent(args.productId),'versions',...(args.version===undefined?[]:[String(args.version)])],'GET',undefined,undefined,{company:args.company}));
      if(canScope('catalog:read')&&canScope('enrollments:read')&&canScope('delivery:read')) server.registerTool('product_rollouts_preview',{description:'Comparar uma versão do produto com ciclos de uma contratação específica, ou legado explicitamente null. Retorna fingerprint opaco e mudanças elegíveis; não altera execução.',inputSchema:rolloutInput,annotations:{readOnlyHint:true,openWorldHint:false}},async(input)=>invoke(['product-rollouts','preview'],'POST',input));
      for(const [name,command,scope,description,schema] of commandTools) if(principal.access!=='leitor'&&commandScopes(command,scope).every(canScope)&&(!['meetings.syncResponses','meetings.syncArtifacts'].includes(command)||principal.kind!=='integration')) server.registerTool(name,{
        description,inputSchema:z.object({idempotencyKey,input:schema,
          ...((command.startsWith('tasks.')||command.startsWith('cycles.')||
            command==='plans.schedule'||command==='plans.advance')
            ? {expectedClientSnapshot:z.string().min(1).max(160).optional().describe('Revisão da leitura paginada do cliente. Em active, tarefas em lote devem pertencer ao mesmo cliente; criação e edição de ciclo devolvem a próxima revisão. Se retornar snapshot_changed, releia antes de enviar outra intenção.')} : {})}),annotations:{readOnlyHint:false,destructiveHint:command.endsWith('cancel')||command.endsWith('archive')||command.endsWith('remove'),idempotentHint:true,openWorldHint:['meetings.create','meetings.reschedule','meetings.cancel','meetings.syncResponses','meetings.syncArtifacts'].includes(command)},
      },async(args)=>invoke(['commands'],'POST',{command,input:command.startsWith('knowledge.')?{...args.input,responseMode:(args.input as {responseMode?:string}).responseMode??'compact'}:args.input},args.idempotencyKey,
        undefined,'expectedClientSnapshot' in args ? args.expectedClientSnapshot as string|undefined : undefined));
      if(canScope('meetings:read')) server.registerTool('meeting_operation_get',{
        description:'Consultar estado de um envio de convite pendente pelo operationId retornado.',
        inputSchema:z.object({operationId:z.string()}),annotations:{readOnlyHint:true,openWorldHint:false},
      },async(args)=>invoke(['operations',encodeURIComponent(args.operationId)],'GET'));
      if(principal.access!=='leitor'&&canScope('meetings:write')) server.registerTool('meeting_operation_resume',{
        description:'Retomar operação de reunião pendente preservando a intenção e evitando convites duplicados.',
        inputSchema:z.object({operationId:z.string()}),annotations:{readOnlyHint:false,idempotentHint:true,openWorldHint:true},
      },async(args)=>invoke(['operations',encodeURIComponent(args.operationId),'resume'],'POST'));
      if(principal.access==='admin'&&canScope('events:read')) server.registerTool('webhooks_list',{
        description:'Listar assinaturas de eventos outbound. Requer administração.',inputSchema:z.object({}),annotations:{readOnlyHint:true,openWorldHint:false},
      },async()=>invoke(['webhooks'],'GET'));
      if(principal.access==='admin'&&canScope('events:read')) server.registerTool('webhooks_deliveries_list',{
        description:'Consultar entregas e histórico de tentativas de uma assinatura própria.',inputSchema:z.object({subscriptionId:z.string(),cursor:z.string().optional(),limit:z.number().int().min(1).max(100).optional()}),annotations:{readOnlyHint:true,openWorldHint:false},
      },async({subscriptionId,...query})=>invoke(['webhooks',encodeURIComponent(subscriptionId),'deliveries'],'GET',undefined,undefined,query));
      if(principal.access==='admin'&&canScope('events:write')) {
        if(canScope('events:read')) {
          server.registerTool('webhooks_rotate_secret',{description:'Trocar segredo de uma assinatura própria pausada. Configure o novo segredo no destino antes de retomar.',inputSchema:z.object({idempotencyKey,subscriptionId:z.string()}),annotations:{readOnlyHint:false,idempotentHint:true,openWorldHint:false}},async(args)=>invoke(['webhooks',encodeURIComponent(args.subscriptionId),'rotate-secret'],'POST',{},args.idempotencyKey));
          server.registerTool('webhooks_update',{description:'Atualizar URL, filtros ou pausa de uma assinatura própria. active false pausa; true retoma. Preserva cursor e histórico.',inputSchema:z.object({idempotencyKey,subscriptionId:z.string(),patch:z.object({url:z.string().url().optional(),types:z.array(z.string()).optional(),company:company.nullable().optional(),active:z.boolean().optional()}).strict()}),annotations:{readOnlyHint:false,idempotentHint:true,openWorldHint:true}},async(args)=>invoke(['webhooks',encodeURIComponent(args.subscriptionId)],'PATCH',args.patch,args.idempotencyKey));
          server.registerTool('webhooks_delivery_replay',{description:'Reenviar uma entrega terminal da assinatura própria. Mantém eventId, histórico e um novo orçamento limitado de tentativas.',inputSchema:z.object({idempotencyKey,subscriptionId:z.string(),eventId:z.string()}),annotations:{readOnlyHint:false,idempotentHint:true,openWorldHint:true}},async(args)=>invoke(['webhooks',encodeURIComponent(args.subscriptionId),'deliveries',encodeURIComponent(args.eventId),'replay'],'POST',{},args.idempotencyKey));
        }

        if(canScope('events:read')) server.registerTool('webhooks_create',{
          description:'Assinar eventos futuros em uma URL HTTPS pública. Guarde secret retornado para verificar a assinatura HMAC.',
          inputSchema:z.object({idempotencyKey,url:z.string().url(),company:company.optional(),types:z.array(z.string()).optional()}),annotations:{readOnlyHint:false,idempotentHint:true,openWorldHint:true},
        },async({idempotencyKey,...input})=>invoke(['webhooks'],'POST',input,idempotencyKey));
        server.registerTool('webhooks_deactivate',{
          description:'Desativar assinatura de eventos outbound.',inputSchema:z.object({idempotencyKey,subscriptionId:z.string()}),annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:false},
        },async(args)=>invoke(['webhooks',encodeURIComponent(args.subscriptionId)],'DELETE',{},args.idempotencyKey));
      }
      return server;
    },{legacy:'stateless',responseMode:'auto'});
    const result=await handler.fetch(request);
    result.headers.set('cache-control','private, no-store');
    return result;
  } catch(error) {
    const status=error instanceof OperationError?error.status:500;
    return Response.json({error:error instanceof OperationError?error.message:'Não foi possível atender a requisição MCP.'},{status,headers:{'cache-control':'no-store',...(status===401?{'www-authenticate':`Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource',request.url)}"`}:{})}});
  }
}
