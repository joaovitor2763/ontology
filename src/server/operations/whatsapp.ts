import {configuredGroup} from '../insight-context.ts';
import {zApiSettings} from '../z-api.ts';
import type {ServerEnv} from '../context';
import {getDoc} from '../db.ts';
import {cachedIntegration} from '../integration-cache.ts';
import {fetchHistoryPage,parseMessageCursor,whatsappSourceAvailable} from '../whatsapp.ts';
import {whatsappGroupOf} from '../../modules/clients/domain/service-config.ts';
import {projectClients} from '../../modules/clients/infrastructure/snapshot.ts';
import {authorizeOperation,type OperationPrincipal} from './principal.ts';
import {forgetDocuments} from './request-context.ts';
import {OperationError} from './errors.ts';
import {id,invalid} from './input.ts';

/** The caller selects a client; the server resolves the configured source group. */
export async function readWhatsAppMessages(env:ServerEnv,principal:OperationPrincipal,input:{company:string;before?:string;refresh?:boolean}){
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const company=id(input.company),db=env.DB,workspace=env.WORKSPACE_ID||'default';
 const authorize=()=>authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'engagement:read',company});
 await authorize();
 const source=async()=>{
  const doc=await getDoc(db,workspace,'ontology.clients.v3');
  const state=projectClients(doc?.value as object);
  if(!state.clients.some(c=>c.slug===company))throw new OperationError(404,'client_not_found','Cliente não encontrado.');
  const value=(doc?.value??{}) as {configs?:Record<string,Parameters<typeof whatsappGroupOf>[0]>;archivedClients?:string[]};
  if(value.archivedClients?.includes(company))throw new OperationError(404,'client_not_found','Cliente arquivado.');
  const group=await configuredGroup(db,workspace,company);
  if(!group)throw new OperationError(409,'whatsapp_group_missing','Configure o grupo de WhatsApp deste cliente.');
  return group;
 };
 const group=await source();
 if(!await whatsappSourceAvailable(env))throw new OperationError(503,'whatsapp_not_configured','Fonte de conversas do WhatsApp não configurada.');
 let before;try{before=parseMessageCursor(input.before);}catch{invalid('Página inválida.');}
 if(input.refresh!==undefined&&typeof input.refresh!=='boolean')invalid('Atualização inválida.');
 const localSource=group.id?.startsWith('z-api:')?await zApiSettings(env):null;
 const key=JSON.stringify(['whatsapp',company,localSource?.instance_id,localSource?.updated_at,env.SUPABASE_URL,env.WHATSAPP_TABLE,env.WHATSAPP_GROUP_COLUMN,env.WHATSAPP_GROUP_NAME_COLUMN,group.id??'',group.name??'',before]);
 let cached;
 try{cached=await cachedIntegration(db,workspace,key,()=>fetchHistoryPage(env,group,before),{ttl:before?900000:60000,staleFor:86400000,force:input.refresh===true});}
 catch{throw new OperationError(502,'whatsapp_unavailable','Não foi possível consultar a conversa. Tente novamente.');}
 // Leitura externa concluída: revalidar contra o banco, não contra a memória.
 forgetDocuments(db);
 await authorize();
 if(JSON.stringify(await source())!==JSON.stringify(group))throw new OperationError(409,'version_conflict','O grupo do cliente mudou. Consulte novamente.');
 return {data:{company,...cached.value,fetchedAt:new Date(cached.fetchedAt).toISOString(),stale:cached.stale}};
}
