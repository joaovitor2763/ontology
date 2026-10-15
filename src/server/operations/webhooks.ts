import type { ServerEnv } from '../context';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { OperationError } from './errors.ts';
import { eventPayload, type EventRow } from './events.ts';
import { commitOperation, requestHash, receipt } from './transaction.ts';
import * as v from './input.ts';
type Subscription={id:string;workspace_id:string;url:string;secret:string;principal:string;types:string;company:string|null;active:number;cursor:number;revision:number};
type Delivery={subscription_id:string;event_id:string;body:string;attempts:number;retry_start_attempt:number};
/** DNS rebinding is additionally blocked by Workers global_fetch_strictly_public; redirects are never followed. */
export function webhookUrl(input:string) {
  let url:URL;try{url=new URL(input);}catch{throw new OperationError(422,'invalid_webhook_url','Use um endereço HTTPS público.');}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port&&url.port!=='443'||!host.includes('.')||host.endsWith('.local')||host.endsWith('.localhost')||host.endsWith('.internal')||host==='localhost'||/^[\d.]+$/.test(host)||host.includes(':')||host.startsWith('[')) throw new OperationError(422,'invalid_webhook_url','Use um endereço HTTPS público, sem credenciais ou redirecionamentos.');
  return url.toString();
}
async function encryptionKey(env:ServerEnv) {
  const key=env.INTEGRATION_SECRET_KEY;
  if(!key) throw new OperationError(503,'webhooks_not_configured','Configure INTEGRATION_SECRET_KEY para assinar webhooks.');
  const bytes=Uint8Array.from(atob(key),c=>c.charCodeAt(0));if(bytes.length!==32) throw new OperationError(503,'webhooks_not_configured','Chave de integração inválida.');
  return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
}
const base64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
async function seal(env:ServerEnv,secret:string) {const iv=crypto.getRandomValues(new Uint8Array(12));const body=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(env),new TextEncoder().encode(secret));return `${base64(iv)}.${base64(new Uint8Array(body))}`;}
async function unseal(env:ServerEnv,secret:string) {const [iv,body]=secret.split('.').map(s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)));return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},await encryptionKey(env),body));}
export async function signWebhook(secret:string,timestamp:string,body:string) {
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${body}`)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function createWebhook(env:ServerEnv,principal:OperationPrincipal,input:unknown,key:string) {
  if(!env.DB) throw new OperationError(503,'database_unavailable','Banco não configurado.');
  const db=env.DB,workspace=env.WORKSPACE_ID||'default',raw=v.object(input);
  const company=raw.company===undefined?undefined:v.id(raw.company);
  const guards=await authorizeOperation(db,workspace,principal,{action:'configuracoes.editar',scope:'events:write',company});
  await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'events:read',company});
  const url=webhookUrl(v.string(raw.url,'URL'));
  const types=raw.types===undefined?['*']:(Array.isArray(raw.types)?raw.types.map(t=>v.string(t,'tipo de evento')):v.invalid('Tipos de eventos inválidos.'));
  if(!types.length||types.length>100||types.some(t=>t!=='*'&&!/^[a-z]+(?:[.][a-z]+)+$/.test(t))) v.invalid('Tipos de eventos inválidos.');
  const id=crypto.randomUUID(),secret=`whsec_${[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('')}`;
  const now=new Date().toISOString();
  const sequence=(await db.prepare('SELECT COALESCE(MAX(sequence),0) seq FROM operation_events WHERE workspace_id=?').bind(workspace).first<{seq:number}>())!.seq;
  const encrypted=await seal(env,secret);
  const result={data:{id,url,secret,company,types},documents:[]};
  // The secret is returned once; the idempotent receipt also needs encryption-at-rest.
  const saved=await commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command:'webhooks.create',hash:await requestHash('webhooks.create',input),id:crypto.randomUUID(),guards,writes:[],events:[],auditEvents:[{type:'webhook.created',company,subject:id}],statements:[db.prepare('INSERT INTO webhook_subscriptions(id,workspace_id,url,secret,principal,types,company,cursor,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,workspace,url,encrypted,JSON.stringify(principal),JSON.stringify(types),company??null,sequence,now)],result:{data:{id,url,secretEncrypted:encrypted,company,types},documents:[]}}) as {data:{id:string;url:string;secretEncrypted:string;company?:string;types:string[]};documents:[]};
  const {secretEncrypted,...webhook}=saved.data;
  return {data:{...webhook,secret:await unseal(env,secretEncrypted)},documents:result.documents};
}
function webhookTypes(input:unknown):string[] {
 const types=Array.isArray(input)?input.map(t=>v.string(t,'tipo de evento')):v.invalid('Tipos de eventos inválidos.');
 if(!types.length||types.length>100||types.some(t=>t!=='*'&&!/^[a-z]+(?:[.][a-z]+)+$/.test(t))) v.invalid('Tipos de eventos inválidos.');
 return [...new Set(types)];
}
async function ownedWebhook(env:ServerEnv,principal:OperationPrincipal,id:string,write=false,read=true) {
 if(!env.DB) throw new OperationError(503,'database_unavailable','Banco não configurado.');
 const db=env.DB,workspace=env.WORKSPACE_ID||'default';
 const sub=await db.prepare('SELECT * FROM webhook_subscriptions WHERE workspace_id=? AND id=?').bind(workspace,v.id(id)).first<Subscription>();
 if(!sub||JSON.parse(sub.principal).id!==principal.id) throw new OperationError(404,'webhook_not_found','Assinatura não encontrada.');
 const guards=await authorizeOperation(db,workspace,principal,{action:'configuracoes.editar',scope:write?'events:write':'events:read',company:sub.company??undefined});
 if(read) await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'events:read',company:sub.company??undefined});
 return {db,workspace,sub,guards};
}
async function manageWebhook(env:ServerEnv,principal:OperationPrincipal,id:string,key:string,command:string,input:unknown,prepare:(context:Awaited<ReturnType<typeof ownedWebhook>>)=>Promise<{statements:D1PreparedStatement[];data:unknown;company?:string|null}>) {
 const context=await ownedWebhook(env,principal,id,true,command!=='webhooks.deactivate'),{db,workspace,sub,guards}=context;
 const hash=await requestHash(command,{id,input}),previous=await receipt(db,workspace,principal.id,key,command,hash);
 if(previous) return previous.result;
 const change=await prepare(context),guard=crypto.randomUUID();
 try{return await commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash, checked: true,id:crypto.randomUUID(),guards,writes:[],events:[],auditEvents:[{type:command,company:(change.company===undefined?sub.company:change.company)??undefined,subject:id}],statements:[
 db.prepare('INSERT INTO webhook_management_guards(id,subscription_id,revision,checked_at) VALUES(?,?,?,?)').bind(guard,id,sub.revision,new Date().toISOString()),
 ...change.statements,
 db.prepare('UPDATE webhook_subscriptions SET revision=revision+1 WHERE id=?').bind(id),
 db.prepare('DELETE FROM webhook_management_guards WHERE id=?').bind(guard)],result:{data:change.data,documents:[]}});
 }catch(error){if(String(error).includes('webhook_management_conflict')) throw new OperationError(409,'webhook_busy','A assinatura mudou ou há uma entrega em andamento. Tente novamente.');throw error;}
}
export async function listWebhooks(env:ServerEnv,principal:OperationPrincipal) {
 const workspace=env.WORKSPACE_ID||'default';
 if(!env.DB) throw new OperationError(503,'database_unavailable','Banco não configurado.');
 if(principal.companies?.length) for(const company of principal.companies) await authorizeOperation(env.DB,workspace,principal,{action:'configuracoes.editar',scope:'events:read',company});
 else await authorizeOperation(env.DB,workspace,principal,{action:'configuracoes.editar',scope:'events:read'});
 const rows=(await env.DB.prepare('SELECT * FROM webhook_subscriptions WHERE workspace_id=?').bind(workspace).all<Subscription>()).results;
 return {data:rows.filter(sub=>JSON.parse(sub.principal).id===principal.id&&(principal.companies===null||!!sub.company&&principal.companies.includes(sub.company))).map(({id,url,types,company,active,cursor})=>({id,url,types:JSON.parse(types),company,active:Boolean(active),cursor}))};
}
/** Pause/resume and configuration changes retain the scan cursor and all delivery history. */
export async function updateWebhook(env:ServerEnv,principal:OperationPrincipal,id:string,input:unknown,key:string) {
 const raw=v.object(input);if(Object.keys(raw).some(field=>!['url','types','company','active'].includes(field))) v.invalid('Campo de assinatura inválido.');
 return manageWebhook(env,principal,id,key,'webhooks.update',input,async({db,workspace,sub})=>{
  const url=raw.url===undefined?sub.url:webhookUrl(v.string(raw.url,'URL'));
  const types=raw.types===undefined?JSON.parse(sub.types):webhookTypes(raw.types);
  const company=raw.company===undefined?sub.company:raw.company===null?null:v.id(raw.company);
  const active=raw.active===undefined?sub.active:v.boolean(raw.active,false)?1:0;
  await authorizeOperation(db,workspace,principal,{action:'configuracoes.editar',scope:'events:write',company:company??undefined});
  await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'events:read',company:company??undefined});
  return {statements:[db.prepare('UPDATE webhook_subscriptions SET url=?,types=?,company=?,active=? WHERE id=?').bind(url,JSON.stringify(types),company,active,id)],data:{id,url,types,company,active:Boolean(active)},company};
 });
}
/** Rotate while paused so the receiver can install the new key before dispatch resumes. */
export async function rotateWebhookSecret(env:ServerEnv,principal:OperationPrincipal,id:string,input:unknown,key:string){
 if(Object.keys(v.object(input)).length)v.invalid('A rotação não recebe campos.');
 const result=await manageWebhook(env,principal,id,key,'webhooks.rotateSecret',input,async({db,sub})=>{
  if(sub.active)throw new OperationError(409,'webhook_must_be_paused','Pause a assinatura antes de trocar o segredo.');
  const secret=`whsec_${[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('')}`;
  const secretEncrypted=await seal(env,secret);
  return {statements:[db.prepare('UPDATE webhook_subscriptions SET secret=? WHERE id=?').bind(secretEncrypted,id)],data:{id,secretEncrypted}};
 }) as {data:{id:string;secretEncrypted:string}};
 const {sub}=await ownedWebhook(env,principal,id,true);
 if(sub.secret!==result.data.secretEncrypted)throw new OperationError(409,'rotation_superseded','Outra rotação substituiu este segredo.');
 return {data:{id,secret:await unseal(env,result.data.secretEncrypted)},documents:[]};
}
export async function deactivateWebhook(env:ServerEnv,principal:OperationPrincipal,id:string,key:string) {
 return manageWebhook(env,principal,id,key,'webhooks.deactivate',undefined,async({db})=>({statements:[db.prepare('UPDATE webhook_subscriptions SET active=0 WHERE id=?').bind(id)],data:{id,active:false}}));
}
export async function listWebhookDeliveries(env:ServerEnv,principal:OperationPrincipal,id:string,options:{limit?:number;cursor?:string}={}) {
 const {db,workspace}=await ownedWebhook(env,principal,id),limit=options.limit??50,cursor=Number(options.cursor??0);
 if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(cursor)||cursor<0) throw new OperationError(400,'invalid_pagination','Informe limite entre 1 e 100 e cursor válido.');
 const rows=(await db.prepare('SELECT d.rowid AS sequence,d.event_id,d.status,d.attempts,d.next_at,d.last_status,d.completed_at,e.company,e.type FROM webhook_deliveries d JOIN operation_events e ON e.id=d.event_id WHERE d.subscription_id=? AND d.rowid>? ORDER BY d.rowid LIMIT 500').bind(id,cursor).all<{sequence:number;event_id:string;company:string|null;[key:string]:unknown}>()).results;
 const data=[];let sequence=cursor;
 for(const row of rows){sequence=row.sequence;
  // Filters control future dispatch; retained history follows the caller's current access.
  try {await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'events:read',company:row.company??undefined});}
  catch(error){if(error instanceof OperationError&&error.status===403)continue;throw error;}
  const history=(await db.prepare('SELECT attempt,attempted_at,status_code,outcome FROM webhook_attempts WHERE subscription_id=? AND event_id=? ORDER BY attempt DESC LIMIT 100').bind(id,row.event_id).all()).results;
  data.push({...row,history});if(data.length>=limit)break;
 }
 return {data,nextCursor:String(sequence),hasMore:sequence<(rows.at(-1)?.sequence??sequence)||rows.length===500};
}
/** Explicit replay requeues one terminal delivery, never rewinds the subscription cursor. */
export async function replayWebhookDelivery(env:ServerEnv,principal:OperationPrincipal,id:string,eventId:string,key:string) {
 v.id(eventId);
 return manageWebhook(env,principal,id,key,'webhooks.replay',{eventId},async({db,workspace,sub})=>{
  const row=await db.prepare('SELECT d.status,e.company,e.type FROM webhook_deliveries d JOIN operation_events e ON e.id=d.event_id WHERE d.subscription_id=? AND d.event_id=?').bind(id,eventId).first<{status:string;company:string|null;type:string}>();
  if(!row||sub.company&&sub.company!==row.company||!(JSON.parse(sub.types) as string[]).some(t=>t==='*'||t===row.type)) throw new OperationError(404,'delivery_not_found','Entrega não encontrada na assinatura atual.');
  await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'events:read',company:row.company??undefined});
  if(!sub.active||!['complete','failed'].includes(row.status)) throw new OperationError(409,'delivery_not_replayable','Retome a assinatura e aguarde uma entrega concluída ou esgotada antes de repetir.');
  return {statements:[db.prepare("UPDATE webhook_deliveries SET status='pending',next_at=?,completed_at=NULL,retry_start_attempt=attempts WHERE subscription_id=? AND event_id=?").bind(new Date().toISOString(),id,eventId)],data:{id,eventId,status:'pending'}};
 });
}
/** At-least-once delivery: event ID is stable; recipients deduplicate it and validate the HMAC timestamp. */
export async function dispatchWebhooks(env:ServerEnv,send:typeof fetch=fetch) {
  if(!env.DB||!env.INTEGRATION_SECRET_KEY) return;
  const db=env.DB,workspace=env.WORKSPACE_ID||'default',now=new Date().toISOString();
  const subscriptions=(await db.prepare('SELECT * FROM webhook_subscriptions WHERE workspace_id=? AND active=1 ORDER BY last_polled_at, id LIMIT 100').bind(workspace).all<Subscription>()).results;
  let remaining=30;
  for(const sub of subscriptions) {
    if(remaining<=0) break;
    await db.prepare('UPDATE webhook_subscriptions SET last_polled_at=? WHERE id=?').bind(now,sub.id).run();
    const principal=JSON.parse(sub.principal) as OperationPrincipal;
    try {await authorizeOperation(db,workspace,principal,{action:'configuracoes.editar',scope:'events:write',company:sub.company??undefined});await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'events:read',company:sub.company??undefined});} catch {continue;}
    const rows=(await db.prepare('SELECT *, sequence AS seq FROM operation_events WHERE workspace_id=? AND sequence>? ORDER BY sequence LIMIT 100').bind(workspace,sub.cursor).all<EventRow>()).results;
    const types=JSON.parse(sub.types) as string[];
    const eligible=rows.filter(e=>(!sub.company||sub.company===e.company)&&(types.includes('*')||types.includes(e.type))&&(principal.companies===null||Boolean(e.company&&principal.companies.includes(e.company))));
    if(rows.length) await db.batch([...eligible.map(e=>db.prepare('INSERT OR IGNORE INTO webhook_deliveries(subscription_id,event_id,body,next_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM webhook_subscriptions WHERE id=? AND revision=? AND active=1)').bind(sub.id,e.id,JSON.stringify(eventPayload(e)),now,sub.id,sub.revision)),db.prepare('UPDATE webhook_subscriptions SET cursor=MAX(cursor,?) WHERE id=? AND revision=? AND active=1').bind(rows.at(-1)!.seq,sub.id,sub.revision)]);
    const deliveries=(await db.prepare("SELECT d.* FROM webhook_deliveries d JOIN operation_events e ON e.id=d.event_id WHERE d.subscription_id=? AND d.status IN ('pending','retry') AND d.next_at<=? AND (d.lease_until IS NULL OR d.lease_until<?) AND (? IS NULL OR e.company=?) AND EXISTS(SELECT 1 FROM json_each(?) WHERE value='*' OR value=e.type) ORDER BY d.next_at LIMIT 20").bind(sub.id,now,now,sub.company,sub.company,sub.types).all<Delivery>()).results;
    for(const delivery of deliveries) {
      if(remaining--<=0) break;
      const lease=crypto.randomUUID(),until=new Date(Date.now()+60000).toISOString();
      const claimed=await db.prepare("UPDATE webhook_deliveries SET lease_owner=?,lease_until=? WHERE subscription_id=? AND event_id=? AND status IN ('pending','retry') AND (lease_until IS NULL OR lease_until<?) AND EXISTS(SELECT 1 FROM webhook_subscriptions s WHERE s.id=subscription_id AND s.active=1 AND s.revision=?)").bind(lease,until,sub.id,delivery.event_id,now,sub.revision).run();
      if(!claimed.meta.changes) continue;
      let status=0,ok=false;
      try {
        const active=await db.prepare('SELECT active FROM webhook_subscriptions WHERE id=?').bind(sub.id).first<{active:number}>();
        if(!active?.active) continue;
        const event=JSON.parse(delivery.body) as {company?:string;type:string};
        if(sub.company&&sub.company!==event.company||!types.some(t=>t==='*'||t===event.type)) {await db.prepare('UPDATE webhook_deliveries SET lease_owner=NULL,lease_until=NULL WHERE subscription_id=? AND event_id=? AND lease_owner=?').bind(sub.id,delivery.event_id,lease).run();continue;}
        await authorizeOperation(db,workspace,principal,{action:'configuracoes.editar',scope:'events:write',company:event.company});
        await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'events:read',company:event.company});
        const timestamp=String(Math.floor(Date.now()/1000)),signature=await signWebhook(await unseal(env,sub.secret),timestamp,delivery.body);
        const response=await send(webhookUrl(sub.url),{method:'POST',headers:{'content-type':'application/json','x-g4-event-id':delivery.event_id,'x-g4-timestamp':timestamp,'x-g4-signature':`v1=${signature}`},body:delivery.body,redirect:'manual',signal:AbortSignal.timeout(10000)});
        status=response.status;ok=response.ok;await response.body?.cancel();
      } catch { /* Persist only status, never provider response bodies or credentials. */ }
      const attempts=delivery.attempts+1;
      await db.batch([db.prepare('INSERT INTO webhook_attempts(subscription_id,event_id,attempt,attempted_at,status_code,outcome) SELECT subscription_id,event_id,?,?,?,? FROM webhook_deliveries WHERE subscription_id=? AND event_id=? AND lease_owner=?').bind(attempts,new Date().toISOString(),status||null,ok?'complete':'failed',sub.id,delivery.event_id,lease),db.prepare('UPDATE webhook_deliveries SET status=?,attempts=?,next_at=?,lease_owner=NULL,lease_until=NULL,last_status=?,completed_at=? WHERE subscription_id=? AND event_id=? AND lease_owner=?').bind(ok?'complete':attempts-delivery.retry_start_attempt>=8?'failed':'retry',attempts,new Date(Date.now()+Math.min(86400000,60000*2**(attempts-delivery.retry_start_attempt))).toISOString(),status||null,ok?new Date().toISOString():null,sub.id,delivery.event_id,lease)]);
    }
  }
}
