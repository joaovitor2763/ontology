import type { ServerEnv } from '../context';
import { getDoc } from '../db.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { canonical, commitOperation, receipt, requestHash } from './transaction.ts';
import { OperationError } from './errors.ts';
import * as v from './input.ts';
import { initialsOf, memberError, type Person } from '../../modules/workspace/domain/models.ts';
import { normalizeAccess } from '../../modules/workspace/domain/permissions.ts';
import { people } from '../../modules/workspace/infrastructure/seed.ts';
import { projectStakeholders } from '../../modules/clients/infrastructure/stakeholders-snapshot.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
import { currentAllocations, effectiveClientAllocations } from './allocation-relations.ts';
import { mergeContactPoints, normalizeContactPoints } from '../../shared/lib/contact-points.ts';
import { contactInput } from './contact-input.ts';
const CONTACTS='ontology.stakeholders.v1';
type State={extraMembers:Person[];memberEdits:Record<string,Partial<Person>>;deactivatedIds:string[]};
function normalize(raw:unknown):State{return{extraMembers:[],memberEdits:{},deactivatedIds:[],...(raw as Partial<State>??{})};}
function project(state:State){return[...state.extraMembers,...people.filter(p=>p.org==='praxis'&&!state.extraMembers.some(e=>e.id===p.id))].map(p=>mergeContactPoints(p,state.memberEdits[p.id]));}
function fields(raw:Record<string,unknown>,allowed:string[]){if(Object.keys(raw).some(key=>!allowed.includes(key)))v.invalid('Campo de membro inválido.');}
async function context(env:ServerEnv,principal:OperationPrincipal,write:boolean,admin=false,company?:string){if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');const db=env.DB,workspace=env.WORKSPACE_ID||'default',auth=await authorizeOperation(db,workspace,principal,{action:write||admin?'equipe.gerenciar':'clientes.ver',scope:write?'workspace:write':'workspace:read',company}),key=auth.find(g=>g.key.startsWith('ontology.workspace.'))!.key,doc=await getDoc(db,workspace,key);return{db,workspace,auth,key,doc,state:normalize(doc?.value)};}
/** Workspace membership changes preserve allocations and audit history, and cannot remove the last usable admin login. */
export async function executeMemberCommand(env:ServerEnv,principal:OperationPrincipal,command:string,input:unknown,key:string,expectedVersions:Record<string,number>={}){
 if(!['members.create','members.update','members.setActive','members.approve'].includes(command))v.invalid('Operação de membro inválida.');const raw=v.object(input);fields(raw,command==='members.create'?['member']:command==='members.update'?['memberId','patch']:command==='members.setActive'?['memberId','active']:['email','access']);const ctx=await context(env,principal,true),{db,workspace}=ctx,hash=await requestHash(command,input),saved=await receipt(db,workspace,principal.id,key,command,hash);if(saved)return saved.result;
 const contactsDoc=await getDoc(db,workspace,CONTACTS),versions=new Map<string,number>();for(const guard of [...ctx.auth,{key:ctx.key,version:ctx.doc?.version??0},{key:CONTACTS,version:contactsDoc?.version??0}]){if(versions.has(guard.key)&&versions.get(guard.key)!==guard.version)throw new OperationError(409,'version_conflict','As permissões mudaram.');versions.set(guard.key,guard.version);}for(const [name,version] of Object.entries(expectedVersions)){if(!Number.isSafeInteger(version)||version<0)v.invalid('Versão inválida.');if(versions.has(name)&&versions.get(name)!==version)throw new OperationError(409,'version_conflict','Atualize a equipe antes de continuar.');}
 let state=ctx.state;const all=project(state),at=new Date().toISOString(),statements:D1PreparedStatement[]=[];let member:Person,active=true;
 if(command==='members.create'||command==='members.approve'){
  let body:Record<string,unknown>;if(command==='members.approve'){const email=v.string(raw.email,'e-mail',undefined,320).toLowerCase(),user=await db.prepare('SELECT u.id,u.email,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id=? AND lower(u.email)=?').bind(workspace,email).first<{id:string;email:string;name:string|null}>();if(!user)throw new OperationError(404,'pending_member_not_found','Pessoa não encontrada entre os acessos deste workspace.');if(all.some(m=>m.email?.toLowerCase()===email))throw new OperationError(409,'member_exists','Este e-mail já está cadastrado. Edite o membro existente.');const access=v.choice(raw.access,['admin','gestor','ai_master','leitor'] as const);body={name:user.name?.trim()||user.email,email:user.email.toLowerCase(),role:access==='leitor'?'Visualização':access==='gestor'?'Gestão':'AI Master',access,capacityHoursWeek:40};member={id:`member-${crypto.randomUUID()}`,name:'',role:'',org:'praxis',initials:'',createdAt:at,updatedAt:at};statements.push(db.prepare('UPDATE memberships SET member_id=?,access=? WHERE workspace_id=? AND user_id=?').bind(member.id,access,workspace,user.id));}
  else{body=v.object(raw.member);member={id:`member-${crypto.randomUUID()}`,name:'',role:'',org:'praxis',initials:'',createdAt:at,updatedAt:at};}
  member=apply(member,body,true);state={...state,extraMembers:[...state.extraMembers,member]};
 }else{
  const id=v.id(raw.memberId),found=all.find(m=>m.id===id);if(!found)throw new OperationError(404,'member_not_found','Membro não encontrado.');member=found;active=!state.deactivatedIds.includes(id);
  if(command==='members.setActive'){active=v.boolean(raw.active,false);if(raw.active===undefined)v.invalid('Informe o estado ativo.');if(active!==!state.deactivatedIds.includes(id)){member={...member,updatedAt:at};state={...state,memberEdits:{...state.memberEdits,[id]:member},deactivatedIds:active?state.deactivatedIds.filter(x=>x!==id):[...new Set([...state.deactivatedIds,id])]};}}
  else{const body=v.object(raw.patch);if(!Object.keys(body).length)v.invalid('Informe uma alteração.');member=apply(member,body,false);if(!state.extraMembers.some(m=>m.id===id)&&member.email!==found.email)throw new OperationError(409,'seed_login_unavailable','Cadastre um novo membro para habilitar um login; o exemplo não possui identidade de acesso.');state={...state,memberEdits:{...state.memberEdits,[id]:member}};}
 }
 function apply(previous:Person,body:Record<string,unknown>,creating:boolean){fields(body,['name','email','emails','phone','phones','role','access','capacityHoursWeek']);let next={...previous};for(const field of ['name','role'] as const)if(creating||Object.hasOwn(body,field))next[field]=v.string(body[field],field,undefined,500);if(creating||Object.hasOwn(body,'access'))next.access=v.choice(body.access,['admin','gestor','ai_master','leitor'] as const);next={...next,...contactInput(body,previous)};if(Object.hasOwn(body,'capacityHoursWeek'))next.capacityHoursWeek=v.number(body.capacityHoursWeek,40,0,80);next.initials=initialsOf(next.name);next.updatedAt=at;const issue=memberError(next,[...all,...projectStakeholders(contactsDoc?.value as Parameters<typeof projectStakeholders>[0])]);if(issue)v.invalid(issue);return normalizeContactPoints(next);}
 const realAdmins=(s:State)=>project(s).filter(p=>s.extraMembers.some(m=>m.id===p.id)&&p.email?.trim()&&!s.deactivatedIds.includes(p.id)&&normalizeAccess(p.access)==='admin');const beforeAdmins=realAdmins(ctx.state),afterAdmins=realAdmins(state);if(beforeAdmins.length&&!afterAdmins.length)throw new OperationError(409,'last_admin','Mantenha ao menos um administrador ativo com e-mail de acesso.');if(beforeAdmins.length===1&&beforeAdmins[0].id===member.id&&beforeAdmins[0].email?.toLowerCase()!==member.email?.toLowerCase())throw new OperationError(409,'last_admin_login','Cadastre outro administrador ativo antes de alterar o último login administrativo.');
 const changed=canonical(state)!==canonical(ctx.state);return commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash, checked: true,id:crypto.randomUUID(),guards:[...versions].map(([key,version])=>({key,version})),writes:changed?[{key:ctx.key,value:state}]:[],statements,events:changed?[{type:command,subject:member.id}]:[],result:{data:{member,active},documents:principal.kind==='session'?[{key:ctx.key,value:state,version:(ctx.doc?.version??0)+(changed?1:0),updatedAt:changed?at:ctx.doc?.updatedAt??at}]:[]}});
}
function pagination(input:{limit?:number;offset?:number}){const limit=input.limit??50,offset=input.offset??0;if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)v.invalid('Paginação inválida.');return{limit,offset};}
export async function readMembers(env:ServerEnv,principal:OperationPrincipal,input:{limit?:number;offset?:number;includeInactive?:boolean;company?:string;role?:string}={}) {
 const company=input.company===undefined?undefined:v.id(input.company,'cliente'),role=input.role===undefined?undefined:v.id(input.role,'papel');
 const ctx=await context(env,principal,false,false,company),{limit,offset}=pagination(input),include=v.boolean(input.includeInactive,false);
 let rows=project(ctx.state).filter(m=>include||!ctx.state.deactivatedIds.includes(m.id));
 if(company||role) {
  const clients=projectClients((await getDoc(ctx.db,ctx.workspace,'ontology.clients.v3'))?.value??{});
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const current=effectiveClientAllocations(clients,currentAllocations(clients,today));
  const ids=new Set(current.filter(a=>(!company||a.company===company)&&(!role||a.role===role)).map(a=>a.memberId));
  rows=rows.filter(m=>ids.has(m.id));
 }
 rows.sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 return{data:rows.slice(offset,offset+limit).map(m=>({...m,active:!ctx.state.deactivatedIds.includes(m.id)})),total:rows.length,nextOffset:offset+limit<rows.length?offset+limit:null};
}
export async function readPendingMembers(env:ServerEnv,principal:OperationPrincipal,input:{limit?:number;offset?:number}={}){const ctx=await context(env,principal,false,true),{limit,offset}=pagination(input),all=project(ctx.state),result=await ctx.db.prepare('SELECT u.email,u.name,u.last_seen_at FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id=? ORDER BY u.last_seen_at DESC,u.email').bind(ctx.workspace).all<{email:string;name:string|null;last_seen_at:string|null}>(),rows=(result.results??[]).filter(u=>!all.some(m=>m.email?.toLowerCase()===u.email.toLowerCase()));return{data:rows.slice(offset,offset+limit).map(u=>({email:u.email,name:u.name??'',lastSeenAt:u.last_seen_at})),nextOffset:offset+limit<rows.length?offset+limit:null};}
