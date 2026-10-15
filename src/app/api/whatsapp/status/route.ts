import {json} from '@/server/context';
import {apiRoute} from '@/server/route';
import {whatsappStatus} from '@/server/whatsapp';
import {zApiEnabled} from '@/server/z-api';
export function GET(request:Request){return apiRoute(request,async env=>{if(await zApiEnabled(env))return json({enabled:true,configured:true,source:'z-api',table:'z_api_messages',groupColumn:'channel',groupNameColumn:''});return json(whatsappStatus(env));});}
