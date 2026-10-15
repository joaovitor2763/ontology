import {apiRoute} from '@/server/route';
import {zApiAdmin,json,problem} from '@/server/z-api-access';
import {testZApi} from '@/server/z-api';
export function POST(request:Request){return apiRoute(request,async env=>{const c=await zApiAdmin(request,env,true);if('error' in c)return c.error;try{return json(await testZApi(env));}catch{return problem(502,'Não foi possível verificar a Z-API. Confira os tokens e o painel do provedor.');}});}
