import { readRequestJson } from './connector-body.ts';
export { readRequestJson } from './connector-body.ts';
import { seal, unseal } from './google.ts';
import type { WhatsAppMessage } from '../modules/engagement/application/whatsapp.ts';
export type ZApiEnv = { DB?: D1Database; WORKSPACE_ID?: string; INTEGRATION_SECRET_KEY?: string };
type Settings = {instance_id:string;credentials_enc:string;webhook_secret_enc:string;webhook_hash:string;enabled:number;updated_at:string};
export type ChannelMapping = {channel:string;company:string};
const workspace = (env:ZApiEnv) => env.WORKSPACE_ID || 'default';
export const Z_API_RETENTION_DAYS = 90;
export async function zApiSettings(env:ZApiEnv):Promise<Settings|null> {
 if(!env.DB)return null;
 try{return await env.DB.prepare('SELECT instance_id,credentials_enc,webhook_secret_enc,webhook_hash,enabled,updated_at FROM z_api_settings WHERE workspace_id=?').bind(workspace(env)).first<Settings>();}
 catch(error){if(String(error).includes('no such table: z_api_settings'))return null;throw error;}
}
export async function zApiEnabled(env:ZApiEnv){return Boolean(env.INTEGRATION_SECRET_KEY && (await zApiSettings(env))?.enabled);}
export function normalizeChannel(value:unknown):string|null {
 if(typeof value!=='string')return null;
 const raw=value.trim().replace(/@(?:c\.us|s\.whatsapp\.net)$/,'').replace(/-group$/,'@g.us');
 if(/^\d{8,30}(?:-\d{5,20})?@g\.us$/.test(raw))return raw;
 const phone=raw.replace(/[+()\s-]/g,'');
 return /^\d{8,20}$/.test(phone)?phone:null;
}
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
function token(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');}
export async function zApiPublicConfig(env:ZApiEnv,origin:string){
 const row=await zApiSettings(env);const mappings=env.DB?(await env.DB.prepare('SELECT channel,company FROM z_api_channels WHERE workspace_id=? ORDER BY company').bind(workspace(env)).all<ChannelMapping>()).results:[];
 let webhookUrl:string|undefined;
 if(row&&env.INTEGRATION_SECRET_KEY){const secret=await unseal(env.INTEGRATION_SECRET_KEY,row.webhook_secret_enc);webhookUrl=`${origin}/api/z-api/webhook/${secret}`;}
 return {configured:Boolean(row),storageReady:Boolean(env.INTEGRATION_SECRET_KEY),enabled:Boolean(row?.enabled),instanceId:row?.instance_id||'',mappings,webhookUrl,retentionDays:Z_API_RETENTION_DAYS};
}
export async function saveZApiConfig(env:ZApiEnv,input:{instanceId:unknown;instanceToken?:unknown;clientToken?:unknown;enabled:unknown;mappings:unknown}){
 if(!env.DB||!env.INTEGRATION_SECRET_KEY||env.INTEGRATION_SECRET_KEY.length<32)throw new Error('Configure INTEGRATION_SECRET_KEY com pelo menos 32 caracteres no Worker.');
 if(typeof input.instanceId!=='string'||! /^[A-Za-z0-9_-]{4,120}$/.test(input.instanceId))throw new Error('Informe o ID da instância Z-API.');
 if(typeof input.enabled!=='boolean'||!Array.isArray(input.mappings)||input.mappings.length>200)throw new Error('Configuração inválida.');
 const previous=await zApiSettings(env);
 const saved=previous?JSON.parse(await unseal(env.INTEGRATION_SECRET_KEY,previous.credentials_enc)) as {instanceToken:string;clientToken:string}:null;
 if(previous&&previous.instance_id!==input.instanceId&&(!input.instanceToken||!input.clientToken))throw new Error('Ao trocar instância, informe os dois tokens.');
 const instanceToken=input.instanceToken||saved?.instanceToken,clientToken=input.clientToken||saved?.clientToken;
 if(typeof instanceToken!=='string'||typeof clientToken!=='string'||!/^\S{8,512}$/.test(instanceToken)||!/^\S{8,512}$/.test(clientToken))throw new Error('Informe os tokens da instância e da conta Z-API.');
 const mappings:ChannelMapping[]=[];
 for(const item of input.mappings){if(!item||typeof item!=='object')throw new Error('Associação inválida.');const channel=normalizeChannel(item.channel);if(!channel||typeof item.company!=='string'||! /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.company))throw new Error('Use número com DDI ou ID de grupo e um cliente válido.');mappings.push({channel,company:item.company});}
 if(new Set(mappings.map(m=>m.channel)).size!==mappings.length||new Set(mappings.map(m=>m.company)).size!==mappings.length)throw new Error('Cada cliente e conversa devem ter uma associação única.');
 const secret=previous&&previous.instance_id===input.instanceId?await unseal(env.INTEGRATION_SECRET_KEY,previous.webhook_secret_enc):token();
 const settings=env.DB.prepare('INSERT INTO z_api_settings VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET instance_id=excluded.instance_id,credentials_enc=excluded.credentials_enc,webhook_secret_enc=excluded.webhook_secret_enc,webhook_hash=excluded.webhook_hash,enabled=excluded.enabled,updated_at=excluded.updated_at').bind(workspace(env),input.instanceId,await seal(env.INTEGRATION_SECRET_KEY,JSON.stringify({instanceToken,clientToken})),await seal(env.INTEGRATION_SECRET_KEY,secret),await hash(secret),input.enabled?1:0,new Date().toISOString());
 await env.DB.batch([settings,env.DB.prepare('DELETE FROM z_api_channels WHERE workspace_id=?').bind(workspace(env)),...mappings.map(m=>env.DB!.prepare('INSERT INTO z_api_channels VALUES(?,?,?)').bind(workspace(env),m.channel,m.company))]);
}
export async function zApiGroup(db:D1Database,workspaceId:string,company:string){
 try {const row=await db.prepare('SELECT c.channel FROM z_api_channels c JOIN z_api_settings s ON s.workspace_id=c.workspace_id WHERE c.workspace_id=? AND c.company=? AND s.enabled=1').bind(workspaceId,company).first<{channel:string}>();return row?{id:`z-api:${row.channel}`}:null;}
 catch(error){if(/no such table: z_api_(?:channels|settings)/.test(String(error)))return null;throw error;}
}
export function parseZApiMessage(payload:unknown):Omit<WhatsAppMessage,'group'> & {channel:string}|null {
 if(!payload||typeof payload!=='object')return null;const p=payload as Record<string,unknown>;
 if(p.type!==undefined&&p.type!=='ReceivedCallback')return null;
 if(typeof p.messageId!=='string'||!p.messageId||p.messageId.length>200||typeof p.fromMe!=='boolean')return null;
 const channel=normalizeChannel(p.phone);if(!channel)return null;
 const moment=Number(p.momment??p.moment??p.timestamp);if(!Number.isFinite(moment)||moment<=0)return null;
 const millis=moment<1e12?moment*1000:moment;if(millis<Date.UTC(2000,0,1)||millis>Date.now()+3600000)return null;
 const text=p.text&&typeof p.text==='object'?(p.text as {message?:unknown}).message:null;
 const media=['image','audio','video','document','sticker'].find(key=>p[key]);
 if(typeof text!=='string'&&!media)return null;
 const sender=p.senderName??p.participantPhone??p.senderPhone??p.phone;
 return {id:p.messageId,channel,at:new Date(millis).toISOString(),from:typeof sender==='string'?sender.slice(0,200):'Participante',text:typeof text==='string'?text.slice(0,16000):`[Mídia não arquivada: ${media}]`,fromMe:p.fromMe};
}
export async function receiveZApi(env:ZApiEnv,secret:string,payload:unknown){
 const settings=await zApiSettings(env);if(!settings?.enabled||!env.DB||!env.INTEGRATION_SECRET_KEY||! /^[a-f0-9]{64}$/.test(secret))return {status:403,accepted:false};
 const wanted=await hash(secret);let diff=0;for(let i=0;i<64;i++)diff|=wanted.charCodeAt(i)^settings.webhook_hash.charCodeAt(i);if(diff)return {status:403,accepted:false};
 if(!payload||typeof payload!=='object'||(payload as {instanceId?:unknown}).instanceId!==settings.instance_id)return {status:403,accepted:false};
 const message=parseZApiMessage(payload);if(!message)return {status:202,accepted:false};
 const mapping=await env.DB.prepare('SELECT company FROM z_api_channels WHERE workspace_id=? AND channel=?').bind(workspace(env),message.channel).first<{company:string}>();if(!mapping)return {status:202,accepted:false};
 // Conditional insert rechecks activation, instance and channel in the same statement as persistence.
 await env.DB.prepare('INSERT OR IGNORE INTO z_api_messages(workspace_id,instance_id,message_id,channel,company,at,sender,body,from_me,received_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM z_api_settings s JOIN z_api_channels c ON c.workspace_id=s.workspace_id WHERE s.workspace_id=? AND s.enabled=1 AND s.instance_id=? AND s.webhook_hash=? AND c.channel=? AND c.company=?)').bind(workspace(env),settings.instance_id,message.id,message.channel,mapping.company,message.at,message.from,message.text,message.fromMe?1:0,new Date().toISOString(),workspace(env),settings.instance_id,settings.webhook_hash,message.channel,mapping.company).run();
 return {status:200,accepted:true};
}
type Stored = {message_id:string;at:string;sender:string;body:string;from_me:number;channel:string};
const asMessage=(row:Stored):WhatsAppMessage=>({id:row.message_id,at:row.at,from:row.sender,text:row.body,fromMe:Boolean(row.from_me),group:row.channel});
export async function zApiHistory(env:ZApiEnv,channel:string,before:{at:string;id:string}|null=null){
 if(!env.DB||!await zApiEnabled(env))throw new Error('Z-API não está ativa.');
 const rows=(await env.DB.prepare('SELECT message_id,at,sender,body,from_me,channel FROM z_api_messages WHERE workspace_id=? AND instance_id=(SELECT instance_id FROM z_api_settings WHERE workspace_id=?) AND channel=? AND company=(SELECT company FROM z_api_channels WHERE workspace_id=? AND channel=?) AND (? IS NULL OR at<? OR (at=? AND message_id<?)) ORDER BY at DESC,message_id DESC LIMIT 51').bind(workspace(env),workspace(env),channel,workspace(env),channel,before?.at??null,before?.at??null,before?.at??null,before?.id??null).all<Stored>()).results;
 const page=rows.slice(0,50);const last=page.at(-1);return {messages:page.map(asMessage).reverse(),nextCursor:rows.length>50&&last?JSON.stringify({at:last.at,id:last.message_id}):null};
}
export async function zApiMessagePage(env:ZApiEnv,channel:string,range:{since:string;until:string;at?:string|null;id?:string|null}){
 if(!env.DB||!await zApiEnabled(env))throw new Error('Z-API não está ativa.');
 const rows=(await env.DB.prepare('SELECT message_id,at,sender,body,from_me,channel FROM z_api_messages WHERE workspace_id=? AND instance_id=(SELECT instance_id FROM z_api_settings WHERE workspace_id=?) AND channel=? AND company=(SELECT company FROM z_api_channels WHERE workspace_id=? AND channel=?) AND at>=? AND at<=? AND (? IS NULL OR at>? OR (at=? AND message_id>?)) ORDER BY at,message_id LIMIT 100').bind(workspace(env),workspace(env),channel,workspace(env),channel,new Date(range.since).toISOString(),new Date(range.until).toISOString(),range.at?new Date(range.at).toISOString():null,range.at?new Date(range.at).toISOString():null,range.at?new Date(range.at).toISOString():null,range.id??null).all<Stored>()).results;
 return rows.map(asMessage);
}
export async function pruneZApi(env:ZApiEnv){if(env.DB)await env.DB.prepare('DELETE FROM z_api_messages WHERE received_at<?').bind(new Date(Date.now()-Z_API_RETENTION_DAYS*86400000).toISOString()).run();}
export async function testZApi(env:ZApiEnv){
 const row=await zApiSettings(env);if(!row||!env.INTEGRATION_SECRET_KEY)throw new Error('Configure a instância primeiro.');
 const c=JSON.parse(await unseal(env.INTEGRATION_SECRET_KEY,row.credentials_enc)) as {instanceToken:string;clientToken:string};
 const response=await fetch(`https://api.z-api.io/instances/${encodeURIComponent(row.instance_id)}/token/${encodeURIComponent(c.instanceToken)}/status`,{headers:{'Client-Token':c.clientToken},redirect:'manual',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('A Z-API recusou a consulta. Confira instância e tokens.');
 const data=await readRequestJson(response,16000) as {connected?:unknown;smartphoneConnected?:unknown};
 return {connected:data.connected===true,smartphoneConnected:data.smartphoneConnected===true};
}
