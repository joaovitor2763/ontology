import { authenticate } from "./auth";
import { resolveMember } from "./authz";
import { getServerEnv, json, problem, workspaceOf } from "./context";
import { instrumentQueries } from "./timing";
import { canConfigureComposio, executeRead, originAllowed, type Toolkit } from "./composio";

export async function composioGuard(request:Request, mutation=false, admin=false) {
 const {env}=instrumentQueries(await getServerEnv(),request);
 if(!env.DB) return {error:problem(503,"Banco de dados não configurado.")};
 const user=await authenticate(request,env); if(!user) return {error:problem(401,"Faça login para continuar.")};
 const workspace=workspaceOf(env); const {member}=await resolveMember(env.DB,workspace,user.email);
 if(!member?.active) return {error:problem(403,"Seu acesso não está ativo.")};
 if(admin && !canConfigureComposio(member.access)) return {error:problem(403,"Somente administradores podem configurar o Composio.")};
 if(mutation && !originAllowed(request)) return {error:problem(403,"Origem da requisição inválida.")};
 return {env,db:env.DB,user,member,workspace};
}
export function composioUserId(workspace:string,memberId:string){return `ontology:${workspace}:${memberId}`;}
export function publicError(e:unknown){return problem(502,e instanceof Error?e.message:"Falha na integração Composio.");}
export async function ownAccount(db:D1Database,workspace:string,memberId:string,toolkit:Toolkit){return db.prepare("SELECT connected_account_id,status,created_at FROM composio_connections WHERE workspace_id=? AND member_id=? AND toolkit_slug=?").bind(workspace,memberId,toolkit).first<{connected_account_id:string;status:string;created_at:string}>();}
export async function readOwn(env:Parameters<typeof executeRead>[0],db:D1Database,workspace:string,memberId:string,toolkit:Toolkit,kind: "mail" | "calendar" = "calendar"){const row=await ownAccount(db,workspace,memberId,toolkit);if(!row||row.status!=="ACTIVE")throw new Error("Conecte esta conta antes de consultar.");return executeRead(env,workspace,toolkit,row.connected_account_id,composioUserId(workspace,memberId),kind);}
export {json,problem};
