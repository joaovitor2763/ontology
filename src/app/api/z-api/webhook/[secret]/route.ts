import {apiRoute} from '@/server/route';
import {readRequestJson,receiveZApi} from '@/server/z-api';
import {json,problem} from '@/server/context';
export function POST(request:Request,context:{params:Promise<{secret:string}>}){return apiRoute(request,async env=>{
 try{const {secret}=await context.params;if(!/^[a-f0-9]{64}$/.test(secret))return problem(403,'Webhook inválido.');const payload=await readRequestJson(request);const result=await receiveZApi(env,secret,payload);return json({accepted:result.accepted},{status:result.status,headers:{'referrer-policy':'no-referrer'}});}
 catch(error){return problem(error instanceof Error&&error.message==='body_too_large'?413:400,'Webhook não aceito.');}
});}
