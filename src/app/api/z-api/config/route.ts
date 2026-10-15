import {apiRoute} from '@/server/route';
import {zApiAdmin,json,problem} from '@/server/z-api-access';
import {zApiPublicConfig,saveZApiConfig,readRequestJson} from '@/server/z-api';
import {getDoc} from '@/server/db';
import {projectClients} from '@/modules/clients/infrastructure/snapshot';
export function GET(request:Request){return apiRoute(request,async env=>{const c=await zApiAdmin(request,env);if('error' in c)return c.error;try{return json(await zApiPublicConfig(env,new URL(request.url).origin));}catch{return problem(503,'Não foi possível ler a configuração Z-API. Confira migrações e chave mestra.');}});}
export function PUT(request:Request){return apiRoute(request,async env=>{
 const c=await zApiAdmin(request,env,true);if('error' in c)return c.error;
 try{
 const body=await readRequestJson(request,32000) as Parameters<typeof saveZApiConfig>[1];
 if(!body||!Array.isArray(body.mappings))return problem(400,'Informe as associações de clientes.');
 const doc=await getDoc(c.db,c.workspace,'ontology.clients.v3');const clients=projectClients(doc?.value as object).clients;const archived=((doc?.value??{}) as {archivedClients?:string[]}).archivedClients??[];
 if(body.mappings.some((item:unknown)=>!item||typeof item!=='object'||!clients.some(client=>client.slug===(item as {company?:unknown}).company)||archived.includes((item as {company:string}).company)))return problem(400,'Selecione clientes ativos desta instalação.');
 await saveZApiConfig(env,body);return json({ok:true});
 }catch(error){const message=error instanceof Error?error.message:'';if(message==='body_too_large')return problem(413,'Configuração muito grande.');return problem(400,/^(Informe|Use |Cada |Configuração|Configure |Ao trocar)/.test(message)?message:'Não foi possível salvar a configuração Z-API.');}
});}
