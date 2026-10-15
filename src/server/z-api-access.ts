import {authenticate} from './auth.ts';
import type {ResolvedMember} from './authz.ts';
import {resolveMember} from './authz.ts';
import {json,problem,workspaceOf,type ServerEnv} from './context.ts';
export async function zApiAdmin(request:Request,env:ServerEnv,mutation=false):Promise<{error:Response}|{db:D1Database;workspace:string;member:ResolvedMember;user:{email:string;name:string}}>{
 if(!env.DB)return {error:problem(503,'Banco indisponível.')};
 const user=await authenticate(request,env);if(!user)return {error:problem(401,'Faça login para continuar.')};
 const workspace=workspaceOf(env);const {member}=await resolveMember(env.DB,workspace,user.email);
 if(!member?.active||member.access!=='admin')return {error:problem(403,'Somente administradores configuram a Z-API.')};
 if(mutation&&request.headers.get('origin')!==new URL(request.url).origin)return {error:problem(403,'Origem não permitida.')};
 return {db:env.DB,workspace,member,user};
}
export {json,problem};
