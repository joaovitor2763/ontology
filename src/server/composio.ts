import type { ServerEnv } from "./context";

const enc = new TextEncoder();
function b64(bytes: Uint8Array) { let s=""; bytes.forEach(v=>s+=String.fromCharCode(v)); return btoa(s); }
function unb64(value: string) { return Uint8Array.from(atob(value),c=>c.charCodeAt(0)); }
async function cryptoKey(secret:string) { const hash=await crypto.subtle.digest("SHA-256",enc.encode(secret));return crypto.subtle.importKey("raw",hash,"AES-GCM",false,["encrypt","decrypt"]); }
export async function seal(secret:string,text:string) { const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},await cryptoKey(secret),enc.encode(text)));const out=new Uint8Array(iv.length+encrypted.length);out.set(iv);out.set(encrypted,iv.length);return b64(out); }
export async function unseal(secret:string,value:string) { const bytes=unb64(value);return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:bytes.slice(0,12)},await cryptoKey(secret),bytes.slice(12))); }

export const COMPOSIO_API = "https://backend.composio.dev/api/v3.1";
export const COMPOSIO_TOOLKITS = ["gmail", "googlecalendar", "outlook"] as const;
export type Toolkit = (typeof COMPOSIO_TOOLKITS)[number];
export const READ_TOOLS: Record<Toolkit, { slug: string }> = {
  gmail: { slug: "GMAIL_FETCH_EMAILS" },
  googlecalendar: { slug: "GOOGLECALENDAR_EVENTS_LIST" },
  outlook: { slug: "OUTLOOK_LIST_EVENTS" },
};
function boundedReadArguments(tool:Toolkit,input:Record<string,unknown>,kind: "mail" | "calendar" = "calendar") {
  const now=new Date(); const end=new Date(now.getTime()+14*24*60*60_000);
  const candidates:Record<string,unknown>=(tool==="gmail" || (tool==="outlook" && kind==="mail"))
    ? {max_results:10,maxResults:10,query:"newer_than:30d",q:"newer_than:30d",top:10,"$top":10,user_id:"me",userId:"me"}
    : tool==="googlecalendar"
      ? {calendarId:"primary",calendar_id:"primary",timeMin:now.toISOString(),timeMax:end.toISOString(),time_min:now.toISOString(),time_max:end.toISOString(),maxResults:10,max_results:10}
      : {top:10,"$top":10,startDateTime:now.toISOString(),endDateTime:end.toISOString(),start_datetime:now.toISOString(),end_datetime:end.toISOString()};
  return Object.fromEntries(Object.entries(candidates).filter(([key])=>Object.hasOwn(input,key)));
}
export type ComposioEnv = Pick<ServerEnv, "DB" | "INTEGRATION_SECRET_KEY">;
export function toolkit(value: unknown): value is Toolkit { return typeof value === "string" && (COMPOSIO_TOOLKITS as readonly string[]).includes(value); }
export function originAllowed(request:Request) { const origin=request.headers.get("origin"); return !!origin && origin===new URL(request.url).origin; }
export function canConfigureComposio(access:unknown) { return access==="admin"; }
export function safeRedirect(value: unknown) { if (typeof value !== "string") return null; try { const u = new URL(value); return u.protocol === "https:" && u.hostname === "connect.composio.dev" && !u.username && !u.password && (!u.port || u.port === "443") ? u.toString() : null; } catch { return null; } }
export function composioConfigured(env: ComposioEnv) { return !!env.DB && (env.INTEGRATION_SECRET_KEY?.length ?? 0) >= 32; }
export async function configGet(env: ComposioEnv, workspace: string) {
  const row = await env.DB!.prepare("SELECT api_key_enc, auth_configs, updated_at FROM composio_settings WHERE workspace_id=?").bind(workspace).first<{api_key_enc:string;auth_configs:string;updated_at:string}>();
  if (!row) return { configured: false, authConfigs: {} };
  return { configured: true, apiKeyHint: "••••••••", authConfigs: JSON.parse(row.auth_configs) as Partial<Record<Toolkit,string>>, updatedAt: row.updated_at };
}
export async function configSave(env: ComposioEnv, workspace: string, apiKey: string, authConfigs: Partial<Record<Toolkit,string>>) {
  if (!env.DB || !env.INTEGRATION_SECRET_KEY || env.INTEGRATION_SECRET_KEY.length < 32) throw new Error("Integração sem armazenamento criptográfico configurado.");
  const previous = await env.DB.prepare("SELECT api_key_enc,auth_configs FROM composio_settings WHERE workspace_id=?").bind(workspace).first<{api_key_enc:string;auth_configs:string}>();
  const effectiveKey = apiKey.trim() || (previous ? await unseal(env.INTEGRATION_SECRET_KEY, previous.api_key_enc) : "");
  if (!/^\S{20,512}$/.test(effectiveKey)) throw new Error("API key inválida.");
  const configs:Partial<Record<Toolkit,string>> = {};
  for (const [key,value] of Object.entries(authConfigs)) {
    if (!toolkit(key) || typeof value !== "string") throw new Error("Auth config inválida.");
    if (!value.trim()) continue;
    if (!/^[A-Za-z0-9_-]{4,200}$/.test(value.trim())) throw new Error("Auth config inválida.");
    configs[key] = value.trim();
  }
  const sealed = await seal(env.INTEGRATION_SECRET_KEY, effectiveKey);
  await env.DB.prepare("INSERT INTO composio_settings(workspace_id,api_key_enc,auth_configs,updated_at) VALUES(?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET api_key_enc=excluded.api_key_enc,auth_configs=excluded.auth_configs,updated_at=excluded.updated_at").bind(workspace,sealed,JSON.stringify(configs),new Date().toISOString()).run();
}
async function credentials(env: ComposioEnv, workspace: string) {
  const row = await env.DB!.prepare("SELECT api_key_enc,auth_configs FROM composio_settings WHERE workspace_id=?").bind(workspace).first<{api_key_enc:string;auth_configs:string}>();
  if (!row) throw new Error("Composio não configurado por um administrador.");
  return { key: await unseal(env.INTEGRATION_SECRET_KEY!, row.api_key_enc), configs: JSON.parse(row.auth_configs) as Partial<Record<Toolkit,string>> };
}
export async function composioFetch(env: ComposioEnv, workspace: string, path: string, init: RequestInit = {}) {
  const {key}=await credentials(env,workspace);
  return fetch(`${COMPOSIO_API}${path}`,{...init,redirect:"manual",signal:AbortSignal.timeout(12_000),headers:{"content-type":"application/json","x-api-key":key,...init.headers}});
}
export async function readJsonBounded(response:Response,maxBytes=1_000_000):Promise<unknown> {
  const declared=Number(response.headers.get("content-length")??0);if(declared>maxBytes)throw new Error("Resposta Composio excede o limite permitido.");
  if(!response.body)throw new Error("Resposta Composio vazia.");
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new Error("Resposta Composio excede o limite permitido.");}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function createAuthLink(env: ComposioEnv, workspace:string, userId:string, _appOrigin:string, tool:Toolkit) {
  const {configs}=await credentials(env,workspace); const auth_config_id=configs[tool];
  if(!auth_config_id) throw new Error(`Configure o Auth Config de ${tool} antes da conexão.`);
  const response=await composioFetch(env,workspace,"/connected_accounts/link",{method:"POST",body:JSON.stringify({auth_config_id,user_id:userId})});
  if(!response.ok) throw new Error(`Composio recusou iniciar a conexão (${response.status}).`);
  const data=await readJsonBounded(response) as {redirect_url?:unknown;connected_account_id?:unknown};
  const redirect=safeRedirect(data.redirect_url);
  if(!redirect || typeof data.connected_account_id!=="string" || !data.connected_account_id || data.connected_account_id.length>200) throw new Error("Resposta de conexão Composio inválida.");
  return {redirect,connectedAccountId:data.connected_account_id};
}
export async function completeAuth(env:ComposioEnv,workspace:string,sessionUri:string,userId:string) {
  if(sessionUri.length>2048 || !sessionUri.startsWith("https://")) throw new Error("Sessão de autorização inválida.");
  const response=await composioFetch(env,workspace,"/connected_accounts/complete_auth",{method:"POST",body:JSON.stringify({session_uri:sessionUri,user_id:userId})});
  if(!response.ok) throw new Error(`Verificação de identidade Composio falhou (${response.status}).`);
  const result=await readJsonBounded(response) as {connected_account_id?:unknown;toolkit_slug?:unknown};
  if(typeof result.connected_account_id!=="string" || !result.connected_account_id || result.connected_account_id.length>200 || typeof result.toolkit_slug!=="string") throw new Error("Resposta de verificação Composio inválida.");
  return result as {connected_account_id:string;toolkit_slug:string};
}
export async function executeRead(env:ComposioEnv,workspace:string,tool:Toolkit,accountId:string,userId:string,kind: "mail" | "calendar" = "calendar") {
  const allowed=tool === "outlook" && kind === "mail" ? {slug:"OUTLOOK_LIST_MESSAGES"} : READ_TOOLS[tool];
  if(!allowed || accountId.length>200) throw new Error("Leitura não permitida.");
  // Discover this exact allowlisted tool at runtime and pin the returned published version.
  const metadataResponse=await composioFetch(env,workspace,`/tools/${encodeURIComponent(allowed.slug)}`);
  if(!metadataResponse.ok) throw new Error(`Não foi possível validar a ferramenta permitida (${metadataResponse.status}).`);
  const discovered=await readJsonBounded(metadataResponse,256_000) as {slug?:string;version?:string;input_parameters?:Record<string,unknown>};
  if(discovered.slug!==allowed.slug || typeof discovered.version!=="string" || !/^\d{8}_\d{2}$/.test(discovered.version)) throw new Error("A ferramenta de leitura permitida não está publicada no Composio.");
  const schema=discovered.input_parameters??{};
  const input=(schema.properties && typeof schema.properties==="object" ? schema.properties : schema) as Record<string,unknown>;
  const args=boundedReadArguments(tool,input,kind);
  const res=await composioFetch(env,workspace,`/tools/execute/${allowed.slug}`,{method:"POST",body:JSON.stringify({connected_account_id:accountId,user_id:userId,version:discovered.version,arguments:args})});
  const data=await readJsonBounded(res).catch(()=>null) as {successful?:boolean;data?:unknown;error?:unknown}|null;
  if(!res.ok || !data?.successful) throw new Error(`Leitura Composio falhou (${res.status}).`);
  return data.data;
}
export async function deleteRemote(env:ComposioEnv,workspace:string,id:string) {
  const response=await composioFetch(env,workspace,`/connected_accounts/${encodeURIComponent(id)}`,{method:"DELETE"});
  if(!response.ok && response.status!==404) throw new Error(`Composio recusou desconectar (${response.status}).`);
}

/** Called only after an explicit administrator save. Each confirmed ID is persisted before another provider call. */
export async function setupManagedAuth(env:ComposioEnv,workspace:string) {
  const {configs}=await credentials(env,workspace);
  for(const tool of COMPOSIO_TOOLKITS) {
    if(configs[tool]) continue;
    const tools=[READ_TOOLS[tool].slug,...(tool==="outlook"?["OUTLOOK_LIST_MESSAGES"]:[])];
    const response=await composioFetch(env,workspace,"/auth_configs",{method:"POST",body:JSON.stringify({toolkit:{slug:tool},auth_config:{type:"use_composio_managed_auth",restrict_to_following_tools:tools}})});
    if(!response.ok) throw new Error(`Não foi possível preparar ${tool} (${response.status}). Confira o projeto Composio antes de salvar novamente ou informe um Auth Config ID manual.`);
    const data=await readJsonBounded(response,32000) as {auth_config?:{id?:unknown}};
    if(typeof data.auth_config?.id!=="string" || !/^[A-Za-z0-9_-]{4,200}$/.test(data.auth_config.id)) throw new Error("O Composio não confirmou o Auth Config. Confira o painel antes de tentar novamente.");
    configs[tool]=data.auth_config.id;
    await env.DB!.prepare("UPDATE composio_settings SET auth_configs=?,updated_at=? WHERE workspace_id=?").bind(JSON.stringify(configs),new Date().toISOString(),workspace).run();
  }
}
