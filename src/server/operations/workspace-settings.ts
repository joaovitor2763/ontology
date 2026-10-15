import type { ServerEnv } from '../context';
import { getDoc } from '../db.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { canonical, commitOperation, receipt, requestHash } from './transaction.ts';
import { OperationError } from './errors.ts';
import { object, string, invalid } from './input.ts';
import { defaultAlertRules, alertRulesError, deliveryRoles, normalizeAllocationRoles, normalizeMemberRoles, type AlertRules, type NamedRole, type Person } from '../../modules/workspace/domain/models.ts';
import { systemAllocationRoleLabels } from '../../modules/clients/domain/allocation.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
import { people } from '../../modules/workspace/infrastructure/seed.ts';

const CLIENTS='ontology.clients.v3';
const folded=(value:string)=>value.toLocaleLowerCase('pt-BR');

export async function executeWorkspaceSettings(env:ServerEnv,principal:OperationPrincipal,input:unknown,key:string,expectedVersions:Record<string,number>={}) {
 if(!env.DB) throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const db=env.DB,workspace=env.WORKSPACE_ID||'default',command='workspace.settings.update';
 const auth=await authorizeOperation(db,workspace,principal,{action:'configuracoes.editar',scope:'workspace:write'});
 const hash=await requestHash(command,input),saved=await receipt(db,workspace,principal.id,key,command,hash);if(saved)return saved.result;
 const raw=object(input);if(!Object.keys(raw).length||Object.keys(raw).some(k=>!['workspaceName','alertRules','memberRoles','allocationRoles'].includes(k)))invalid('Configuração inválida.');
 const docKey=auth.find(g=>g.key.startsWith('ontology.workspace.'))!.key;
 const [doc,clientsDoc]=await Promise.all([getDoc(db,workspace,docKey),raw.allocationRoles===undefined?Promise.resolve(null):getDoc(db,workspace,CLIENTS)]);
 const versions=new Map<string,number>();
 for(const guard of [...auth,{key:docKey,version:doc?.version??0},...(raw.allocationRoles===undefined?[]:[{key:CLIENTS,version:clientsDoc?.version??0}])]){if(versions.has(guard.key)&&versions.get(guard.key)!==guard.version)throw new OperationError(409,'version_conflict','As permissões mudaram.');versions.set(guard.key,guard.version);}
 for(const [name,version] of Object.entries(expectedVersions)){if(!Number.isSafeInteger(version)||version<0)invalid('Versão inválida.');if(versions.has(name)&&versions.get(name)!==version)throw new OperationError(409,'version_conflict','Atualize as configurações antes de continuar.');}
 const before=(doc?.value??{}) as Record<string,unknown>,next={...before};
 if(raw.workspaceName!==undefined){const name=string(raw.workspaceName,'nome',undefined,120).trim();if(!name)invalid('Informe o nome do workspace.');next.workspaceName=name;}
 if(raw.alertRules!==undefined){const rules=object(raw.alertRules);if(Object.keys(rules).some(k=>!Object.hasOwn(defaultAlertRules,k))||Object.values(rules).some(v=>typeof v!=='number'))invalid('Regras de alerta inválidas.');const issue=alertRulesError(rules as Partial<AlertRules>);if(issue)invalid(issue);next.alertRules=rules;}
 if(raw.memberRoles!==undefined){
  if(!Array.isArray(raw.memberRoles)||raw.memberRoles.length>50||raw.memberRoles.some(role=>typeof role!=='string'))invalid('Cargos da equipe inválidos.');
  const roles=normalizeMemberRoles(raw.memberRoles),systemRoles=new Set(deliveryRoles.map(folded));if(roles.length!==raw.memberRoles.length||roles.some(role=>systemRoles.has(folded(role))))invalid('Os cargos precisam ser únicos, diferentes dos cargos padrão e ter até 80 caracteres.');
  const previous=normalizeMemberRoles(before.memberRoles),allowed=new Set([...deliveryRoles,...roles].map(folded));
  const removed=new Set(previous.filter(role=>!allowed.has(folded(role))).map(folded));
  const roster=before as {extraMembers?:Person[];memberEdits?:Record<string,Partial<Person>>};
  const effective=[...(roster.extraMembers??[]),...people.filter(person=>person.org==='praxis')].map(person=>({...person,...roster.memberEdits?.[person.id]}));
  if(effective.some(person=>removed.has(folded(person.role))))invalid('Não é possível remover ou renomear um cargo que está em uso.');
  next.memberRoles=roles;
 }
 if(raw.allocationRoles!==undefined){
  if(!Array.isArray(raw.allocationRoles)||raw.allocationRoles.length>50||raw.allocationRoles.some(role=>!role||typeof role!=='object'||Array.isArray(role)||Object.keys(role).some(key=>!['id','label'].includes(key))))invalid('Papéis de alocação inválidos.');
  const roles=normalizeAllocationRoles(raw.allocationRoles),labels=roles.map(role=>folded(role.label)),systemLabels=new Set(Object.values(systemAllocationRoleLabels).map(folded));
  if(roles.length!==raw.allocationRoles.length||roles.some(role=>Object.hasOwn(systemAllocationRoleLabels,role.id))||new Set(labels).size!==labels.length||labels.some(label=>systemLabels.has(label)))invalid('Os papéis precisam ter identificadores e nomes únicos, diferentes dos papéis padrão e com até 80 caracteres.');
  const allowed=new Set([...Object.keys(systemAllocationRoleLabels),...roles.map(role=>role.id)]);
  if(projectClients(clientsDoc?.value??{}).allocations.some(allocation=>!allowed.has(allocation.role)))invalid('Não é possível remover um papel que está em uso.');
  next.allocationRoles=roles;
 }
 const changed=canonical(before)!==canonical(next),at=new Date().toISOString();
 return commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash, checked: true,id:crypto.randomUUID(),guards:[...versions].map(([key,version])=>({key,version})),writes:changed?[{key:docKey,value:next}]:[],events:changed?[{type:command,subject:workspace,data:{fields:Object.keys(raw)}}]:[],result:{data:{workspaceName:next.workspaceName,alertRules:next.alertRules??{},memberRoles:next.memberRoles??[],allocationRoles:next.allocationRoles??[]},documents:principal.kind==='session'?[{key:docKey,value:next,version:(doc?.version??0)+(changed?1:0),updatedAt:changed?at:doc?.updatedAt??at}]:[]}});
}

export async function readWorkspaceSettings(env:ServerEnv,principal:OperationPrincipal){
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const workspace=env.WORKSPACE_ID||'default';
 const auth=await authorizeOperation(env.DB,workspace,principal,{action:'configuracoes.editar',scope:'workspace:read'});
 const docKey=auth.find(g=>g.key.startsWith('ontology.workspace.'))!.key,doc=await getDoc(env.DB,workspace,docKey);
 const value=(doc?.value??{}) as {workspaceName?:string;alertRules?:Partial<AlertRules>;memberRoles?:unknown;allocationRoles?:NamedRole[]};
 return {data:{workspaceName:value.workspaceName||'Meu workspace',alertRules:{...defaultAlertRules,...value.alertRules},memberRoles:normalizeMemberRoles(value.memberRoles),allocationRoles:normalizeAllocationRoles(value.allocationRoles)},versions:{[docKey]:doc?.version??0}};
}
