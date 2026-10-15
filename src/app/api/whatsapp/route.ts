import { apiRoute } from '@/server/route';
import { resolveOperationPrincipal } from '@/server/operations/principal';
import { readWhatsAppMessages } from '@/server/operations/whatsapp';
import { OperationError } from '@/server/operations/errors';

/** Compatibility entry point: client identity is mandatory; arbitrary groups are no longer accepted. */
function read(request:Request,input:Record<string,unknown>){
 return apiRoute(request,async(env)=>{
 try{
  const principal=await resolveOperationPrincipal(request,env);
  if(typeof input.company!=='string'||!input.company)throw new OperationError(422,'client_required','Atualize a página para consultar a conversa pelo cliente.');
  if(input.before!==undefined&&typeof input.before!=='string')throw new OperationError(422,'invalid_input','Página inválida.');
  if(input.refresh!==undefined&&typeof input.refresh!=='boolean')throw new OperationError(422,'invalid_input','Atualização inválida.');
  const result=await readWhatsAppMessages(env,principal,{company:input.company,before:input.before as string|undefined,refresh:input.refresh as boolean|undefined});
  return Response.json(result.data,{headers:{'cache-control':'no-store'}});
 }catch(error){return Response.json({error:error instanceof OperationError?error.message:'Não foi possível consultar a conversa.'},{status:error instanceof OperationError?error.status:500});}
 });
}
export async function POST(request:Request){const body=await request.json().catch(()=>null);return read(request,body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:{});}
export async function GET(request:Request){const query=new URL(request.url).searchParams;return read(request,{company:query.get('company'),before:query.get('before')??undefined});}
