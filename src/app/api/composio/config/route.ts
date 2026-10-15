import {readRequestJson} from "@/server/connector-body";
import { composioGuard, publicError } from "@/server/composio-route";
import { configGet, configSave, setupManagedAuth } from "@/server/composio";
import { json, problem } from "@/server/context";
export async function GET(request:Request){const c=await composioGuard(request);if("error" in c)return c.error;const value=await configGet(c.env,c.workspace);if(c.member.access!=="admin")return json({configured:value.configured,authConfigs:value.authConfigs});return json(value);}
export async function PUT(request:Request){const c=await composioGuard(request,true,true);if("error" in c)return c.error;try{const b=await readRequestJson(request,8192) as {apiKey?:string;authConfigs?:Record<string,string>};if(typeof b.apiKey!=="string"||!b.authConfigs||typeof b.authConfigs!=="object"||Array.isArray(b.authConfigs))return problem(400,"Informe API key e Auth Configs.");await configSave(c.env,c.workspace,b.apiKey,b.authConfigs);await setupManagedAuth(c.env,c.workspace);return json({ok:true});}catch(e){return publicError(e);}}
