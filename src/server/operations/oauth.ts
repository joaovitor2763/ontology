import { OAuthProvider, getOAuthApi, type OAuthProviderOptions, type AuthRequest, type Grant } from '@cloudflare/workers-oauth-provider';
import type { ServerEnv } from '../context';
import { resolveMember } from '../authz.ts';
import { getDoc } from '../db.ts';
import { integrationScopes, type IntegrationScope } from './credentials.ts';
import { OperationError } from './errors.ts';
import { oauthD1Kv, OAUTH_GUARD } from './oauth-kv.ts';

const COOKIE='g4_oauth_pending';
export { OAUTH_GUARD } from './oauth-kv.ts';
export type OAuthGrantReference={userId:string;grantId:string;clientId:string;origin:string;scopes:IntegrationScope[]};
type OAuthEnv=ServerEnv & { OAUTH_KV: KVNamespace };
type Props={email:string;memberId:string;workspace:string};
type Pending={url:string;email?:string};
const now=()=>Math.floor(Date.now()/1000);
const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function originFor(request:Request,env:ServerEnv) {
  const url=new URL(request.url),local=/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
  const origin=local?url.origin:env.AUTH_ORIGIN;
  if(!origin || (!local && url.origin!==origin)) throw new OperationError(400,'invalid_origin','Endereço de autorização inválido.');
  return origin;
}
function cookie(request:Request) {
  const token=(request.headers.get('cookie')??'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
  return token&&/^[a-f0-9-]{36}$/.test(token)?token:null;
}
function flowCookie(request:Request,token:string,seconds=600) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
}
function html(content:string,extra?:HeadersInit,status=200) {
  return new Response(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar ao Ontology</title><style>@font-face{font-family:Figtree;font-style:normal;font-weight:300 900;font-display:swap;src:url(/fonts/figtree-latin.woff2) format("woff2")}*{box-sizing:border-box}body{font:14px/1.5 Figtree,ui-sans-serif,system-ui,sans-serif;background:#fff;color:#202124;margin:0;padding:32px 20px}main{max-width:520px;margin:6vh auto;padding:32px;background:white;border:1px solid #e9eaed;border-radius:16px}h1{font-size:26px;line-height:1.2;letter-spacing:-.8px;margin:24px 0 12px}p{color:#6b6e76;margin:12px 0 24px}strong{color:#27272a;font-weight:600}label{display:flex;align-items:center;gap:10px;padding:14px 16px;border:1px solid #e9eaed;border-radius:10px;margin:8px 0}input[type=checkbox],input[type=radio]{accent-color:#202124;width:16px;height:16px}button{font:inherit;font-weight:500;cursor:pointer;border:1px solid #202124;border-radius:10px;background:#202124;color:white;padding:11px 18px;margin:20px 8px 0 0}button[value=deny]{background:white;color:#52525b;border-color:#e9eaed}a{color:#52525b;text-underline-offset:3px}button:hover{opacity:.85}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid #b99054;outline-offset:3px}code{font:12px ui-monospace,monospace;overflow-wrap:anywhere}form+form{border-top:1px solid #e9eaed;margin-top:20px;padding-top:20px}.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:14px}.mark{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:#202124;color:white;font-size:12px}.detail{font-size:12px;background:#f8f8f9;border-radius:8px;padding:12px;margin-top:24px}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6b6e76;margin:24px 0 10px}.footer{font-size:12px;margin:24px 0 0;padding-top:20px;border-top:1px solid #eee}@media(max-width:520px){body{padding:16px}main{padding:24px;margin:20px auto}h1{font-size:24px}button{min-height:44px}}</style><main><div class="brand"><svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><rect width="28" height="28" rx="8" fill="#18181b"/><path d="m9 12 10-2.5-2.5 9.5L9 12Z" stroke="#fafafa" stroke-width="1.1"/><circle cx="9" cy="12" r="2" fill="#fafafa"/><circle cx="19" cy="9.5" r="2" fill="#fafafa"/><circle cx="16.5" cy="19" r="2.3" fill="#b9915b"/></svg>Ontology</div>${content}</main></html>`,{status,headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','referrer-policy':'same-origin','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",...Object.fromEntries(new Headers(extra))}});
}
export function oauthEnvironment(env:ServerEnv):OAuthEnv {
  if(!env.DB) throw new OperationError(503,'oauth_unavailable','OAuth requer banco de dados configurado.');
  return {...env,OAUTH_KV:oauthD1Kv(env.DB,env.WORKSPACE_ID||'default')};
}
export function oauthOptions(origin:string):OAuthProviderOptions<OAuthEnv> {
  return {apiRoute:'/mcp',apiHandler:{fetch:async()=>new Response(null,{status:404})},defaultHandler:{fetch:async()=>new Response('Não encontrado.',{status:404})},
    authorizeEndpoint:`${origin}/oauth/authorize`,tokenEndpoint:`${origin}/oauth/token`,clientRegistrationEndpoint:`${origin}/oauth/register`,
    scopesSupported:[...integrationScopes],allowImplicitFlow:false,allowPlainPKCE:false,allowTokenExchangeGrant:false,
    accessTokenTTL:900,refreshTokenTTL:30*86400,clientRegistrationTTL:90*86400,
    clientIdMetadataDocumentEnabled:typeof Cloudflare!=="undefined"&&Cloudflare.compatibilityFlags?.global_fetch_strictly_public===true,resourceMatchOriginOnly:false,
    resourceMetadata:{resource:`${origin}/mcp`,...(origin.startsWith("https:")?{authorization_servers:[origin]}:{}),scopes_supported:[...integrationScopes],resource_name:'Ontology'},
  };
}
async function activeUser(request:Request,env:ServerEnv) {
  const {authenticate}=await import('../auth.ts');
  const user=await authenticate(request,env);
  if(!user) return null;
  const {member}=await resolveMember(env.DB!,env.WORKSPACE_ID||'default',user.email.toLowerCase());
  if(!member?.active) throw new OperationError(403,'inactive_member','Seu acesso precisa ser aprovado antes de conectar um aplicativo.');
  return {email:user.email.toLowerCase(),memberId:member.id,name:user.name};
}
function userId(env:ServerEnv,memberId:string) { return `${encodeURIComponent(env.WORKSPACE_ID||'default')}.${encodeURIComponent(memberId)}`; }
async function parseAuthorization(request:Request,env:OAuthEnv,origin:string):Promise<AuthRequest> {
  const auth=await getOAuthApi(oauthOptions(origin),env).parseAuthRequest(request);
  if(auth.codeChallengeMethod!=='S256'||!auth.codeChallenge) throw new OperationError(400,'invalid_pkce','O aplicativo precisa usar PKCE S256.');
  if(auth.scope.some(s=>!integrationScopes.includes(s as IntegrationScope))) throw new OperationError(400,'invalid_scope','O aplicativo solicitou escopos desconhecidos.');
  if(!auth.scope.length) auth.scope=[...integrationScopes];
  return auth;
}
async function consent(request:Request,env:OAuthEnv,origin:string) {
  const helpers=getOAuthApi(oauthOptions(origin),env),path=new URL(request.url).pathname;
  const user=await activeUser(request,env);
  if(request.method==='POST') {
    if(request.headers.get('origin')!==origin) throw new OperationError(403,'invalid_origin','Origem inválida para autorizar.');
    const form=await request.formData(),nonce=String(form.get('nonce')??'');
    if(!nonce||nonce!==cookie(request)) throw new OperationError(403,'invalid_csrf','A autorização expirou. Comece novamente.');
    const pending=await env.OAUTH_KV.get<Pending>(`consent:${nonce}`,'json');
    if(!pending||!user||pending.email!==user.email) throw new OperationError(403,'invalid_consent','A autorização expirou ou pertence a outra pessoa.');
    const auth=await parseAuthorization(new Request(pending.url),env,origin);
    const approved=form.get('decision')==='allow';
    const omittedScope=!new URL(pending.url).searchParams.get('scope')?.trim();
    const access=form.get('access');
    if(approved&&omittedScope&&(!['read','operate'].includes(String(access))||form.has('scope')))throw new OperationError(400,'invalid_scope','Escolha o acesso do aplicativo.');
    const scopes=omittedScope?auth.scope.filter(scope=>access==='operate'||scope.endsWith(':read')):form.getAll('scope').map(String);
    if(scopes.some(s=>!auth.scope.includes(s))) throw new OperationError(400,'invalid_scope','Escopo não solicitado.');
    await env.OAUTH_KV.delete(`consent:${nonce}`);
    if(!approved) { const redirect=new URL(auth.redirectUri);redirect.searchParams.set('error','access_denied');if(auth.state)redirect.searchParams.set('state',auth.state);return new Response(null,{status:302,headers:{location:redirect.toString(),'set-cookie':flowCookie(request,'',0)}}); }
    if(!scopes.length) throw new OperationError(400,'invalid_scope','Escolha pelo menos uma permissão.');
    const result=await helpers.completeAuthorization({request:auth,userId:userId(env,user.memberId),metadata:{clientName:(await helpers.lookupClient(auth.clientId))?.clientName??auth.clientId},scope:scopes,props:{email:user.email,memberId:user.memberId,workspace:env.WORKSPACE_ID||'default'} satisfies Props});
    return new Response(null,{status:302,headers:{location:result.redirectTo,'set-cookie':flowCookie(request,'',0),'cache-control':'no-store'}});
  }
  let authorization=request;
  if(path==='/oauth/resume') {
    const nonce=cookie(request),pending=nonce?await env.OAUTH_KV.get<Pending>(`consent:${nonce}`,'json'):null;
    if(!pending) return html('<h1>Autorização expirada</h1><p>Reinicie a conexão no aplicativo.</p>',undefined,400);
    authorization=new Request(pending.url);
  }
  const auth=await parseAuthorization(authorization,env,origin),client=await helpers.lookupClient(auth.clientId),nonce=crypto.randomUUID();
  await env.OAUTH_KV.put(`consent:${nonce}`,JSON.stringify({url:authorization.url,email:user?.email}),{expirationTtl:600});
  const callback=new URL(auth.redirectUri);
  const callbackSource=callback.origin==='null'?callback.protocol:callback.origin;
  const headers={'set-cookie':flowCookie(request,nonce),'content-security-policy':`default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self' ${callbackSource}; frame-ancestors 'none'; base-uri 'none'`};
  if(!user) return html('<h1>Conectar ao Ontology</h1><p>Entre com seu acesso da plataforma para revisar as permissões do aplicativo.</p><a href="/api/auth/google">Entrar com Google</a>',headers);
  const labels:Record<string,string>={clients:'Clientes',stakeholders:'Stakeholders',enrollments:'Contratações',delivery:'Ciclos e tarefas',meetings:'Reuniões e convites',catalog:'Catálogo',events:'Eventos de integração',documents:'Documentos',engagement:'Interações',knowledge:'Conhecimento',workspace:'Equipe e configurações'};
  const omittedScope=!new URL(authorization.url).searchParams.get('scope')?.trim();
  const permissions=omittedScope?`<label><input type="radio" name="access" value="read" checked> Somente leitura</label><label><input type="radio" name="access" value="operate"> Consultar e operar</label><p>Leitura permite consultar clientes, stakeholders, contratações, ciclos e tarefas, reuniões, catálogo, eventos de integração, documentos, interações, conhecimento, equipe e configurações. Operar também permite criar e alterar esses registros, conforme seu nível de acesso.</p>`:auth.scope.map(scope=>{const [area,mode]=scope.split(':');return `<label><input type="checkbox" name="scope" value="${escape(scope)}" checked> ${mode==='write'?'Criar e alterar':'Consultar'} ${escape(labels[area]??area)}</label>`;}).join('');
  return html(`<h1>Autorizar ${escape(client?.clientName??'aplicativo')}</h1><p><strong>${escape(client?.clientName??'O aplicativo')}</strong> quer se conectar ao seu Ontology.<br>Conectado como <strong>${escape(user.name)}</strong>.</p><div class="eyebrow">${omittedScope?'Escolha o acesso do aplicativo':'Permissões solicitadas'}</div><form method="post" action="/oauth/authorize"><input type="hidden" name="nonce" value="${nonce}">${permissions}${auth.scope.includes('meetings:write')?'<p>Permitir reuniões inclui enviar convites pelo seu Google Agenda conectado, quando você solicitar ao aplicativo.</p>':''}<button name="decision" value="allow">Autorizar acesso</button><button name="decision" value="deny">Cancelar</button></form><p class="footer">O aplicativo respeita seu nível de acesso. Você pode desconectá-lo em <a href="/configuracoes">Configurações → Aplicativos conectados</a>.</p><div class="detail">Retorno ao aplicativo<br><code>${escape(new URL(auth.redirectUri).origin)}</code></div>`,headers);
}
async function grantsPage(request:Request,env:OAuthEnv,origin:string) {
  const user=await activeUser(request,env);if(!user) throw new OperationError(401,'authentication_required','Entre na plataforma para gerenciar conexões.');
  const helpers=getOAuthApi(oauthOptions(origin),env),id=userId(env,user.memberId);
  const asJson=new URL(request.url).searchParams.get('format')==='json';
  if(!asJson&&request.method==='GET')return new Response(null,{status:303,headers:{location:`${origin}/configuracoes#aplicativos-conectados`,'cache-control':'no-store'}});
  if(request.method==='POST') {
    const form=await request.formData(),nonce=String(form.get('nonce')??'');
    if(request.headers.get('origin')!==origin||nonce!==cookie(request)||await env.OAUTH_KV.get(`manage:${nonce}`)!==id) throw new OperationError(403,'invalid_csrf','Atualize a página para revogar.');
    await env.OAUTH_KV.delete(`manage:${nonce}`);
    await helpers.revokeGrant(String(form.get('grant')??''),id);
    if(asJson)return Response.json({ok:true},{headers:{'cache-control':'no-store'}});
    return new Response(null,{status:303,headers:{location:`${origin}/oauth/grants`}});
  }
  const grants=await helpers.listUserGrants(id,{limit:100}),nonce=crypto.randomUUID();
  await env.OAUTH_KV.put(`manage:${nonce}`,id,{expirationTtl:600});
  if(asJson)return Response.json({nonce,endpoint:`${origin}/mcp`,scopes:integrationScopes,data:grants.items.map(g=>({id:g.id,name:String(g.metadata?.clientName??g.clientId),scopes:g.scope}))},{headers:{'cache-control':'no-store','set-cookie':flowCookie(request,nonce)}});
  return html(`<h1>Aplicativos conectados</h1>${grants.items.length?grants.items.map(g=>`<form method="post"><input type="hidden" name="nonce" value="${nonce}"><input type="hidden" name="grant" value="${escape(g.id)}"><strong>${escape(String(g.metadata?.clientName??g.clientId))}</strong><p>${g.scope.map(escape).join(', ')}</p><button>Revogar acesso</button></form>`).join(''):'<p>Nenhum aplicativo conectado a este acesso.</p><p>As conexões aparecem aqui após você autorizar um aplicativo como Codex ou Claude Code.</p>'}<a href="/configuracoes">Voltar às configurações</a>`,{'set-cookie':flowCookie(request,nonce)});
}
export async function oauthResponse(request:Request,input:ServerEnv):Promise<Response> {
  try {
    const origin=originFor(request,input),env=oauthEnvironment(input),path=new URL(request.url).pathname;
    if(path==='/oauth/authorize'||path==='/oauth/resume') return await consent(request,env,origin);
    if(path==='/oauth/grants') return await grantsPage(request,env,origin);
    const pending:Promise<unknown>[]=[];
    const ctx={waitUntil:(p:Promise<unknown>)=>{pending.push(p);},passThroughOnException(){}} as ExecutionContext;
    const response=await new OAuthProvider(oauthOptions(origin)).fetch(request,env,ctx);
    await Promise.allSettled(pending);
    return response;
  } catch(error) {
    if(error instanceof OperationError) return html(`<h1>Não foi possível conectar</h1><p>${escape(error.message)}</p>`,undefined,error.status);
    return html('<h1>Não foi possível conectar</h1><p>Verifique os parâmetros da conexão e tente novamente.</p>',undefined,400);
  }
}
export async function resolveOAuthIdentity(request:Request,input:ServerEnv) {
  const origin=originFor(request,input),env=oauthEnvironment(input),token=request.headers.get('authorization')?.replace(/^Bearer /i,'')??'';
  const guard=await getDoc(env.DB!,env.WORKSPACE_ID||'default',OAUTH_GUARD);
  const decoded=await getOAuthApi(oauthOptions(origin),env).unwrapToken<Props>(token);
  const audience=decoded?.audience,resource=`${origin}/mcp`;
  if(!decoded||decoded.expiresAt<=now()||!(Array.isArray(audience)?audience.includes(resource):audience===resource)) throw new OperationError(401,'invalid_token','Token OAuth inválido ou expirado.');
  // unwrapToken uses the token's cached grant; explicitly check current grant and client on every call.
  const grant=await env.OAUTH_KV.get<Grant>(`grant:${decoded.userId}:${decoded.grantId}`,'json');
  const props=decoded.grant.props;
  if(!grant||grant.clientId!==decoded.grant.clientId||(grant.expiresAt!==undefined&&grant.expiresAt<=now())||!await getOAuthApi(oauthOptions(origin),env).lookupClient(grant.clientId)||props.workspace!==(env.WORKSPACE_ID||'default')||decoded.userId!==userId(env,props.memberId)) throw new OperationError(401,'invalid_token','A conexão OAuth foi revogada.');
  const {member}=await resolveMember(env.DB!,env.WORKSPACE_ID||'default',props.email);
  if(!member?.active||member.id!==props.memberId) throw new OperationError(403,'inactive_member','Seu acesso à plataforma não está ativo.');
  const scopes=decoded.scope.filter(s=>grant.scope.includes(s)&&integrationScopes.includes(s as IntegrationScope)) as IntegrationScope[];
  return {id:`oauth:${decoded.userId}:${decoded.grantId}`,email:props.email,memberId:member.id,application:grant.clientId,scopes,guard:{key:OAUTH_GUARD,version:guard?.version??0},
    oauthGrant:{userId:decoded.userId,grantId:decoded.grantId,clientId:grant.clientId,origin,scopes}};
}

/** Revocable durable identity for outbound work; never stores an access or refresh token. */
export async function validateOAuthGrant(db:D1Database,workspace:string,ref:OAuthGrantReference) {
  const env=oauthEnvironment({DB:db,WORKSPACE_ID:workspace});
  const guard=await getDoc(db,workspace,OAUTH_GUARD);
  const grant=await env.OAUTH_KV.get<Grant>(`grant:${ref.userId}:${ref.grantId}`,'json');
  if(!grant||grant.clientId!==ref.clientId||(grant.expiresAt!==undefined&&grant.expiresAt<=now())||!await getOAuthApi(oauthOptions(ref.origin),env).lookupClient(ref.clientId)) throw new OperationError(401,'invalid_token','A conexão OAuth foi revogada.');
  return {scopes:ref.scopes.filter(s=>grant.scope.includes(s)),guard:{key:OAUTH_GUARD,version:guard?.version??0}};
}
