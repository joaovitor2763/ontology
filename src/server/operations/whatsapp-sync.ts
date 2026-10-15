import {whatsappSourceAvailable} from '../whatsapp.ts';
import {configuredGroup} from '../insight-context.ts';
import type {ServerEnv} from '../context';
import {prepareWhatsAppSync,isWhatsAppQueueConflict} from '../whatsapp-jobs.ts';
import {authorizeOperation,type OperationPrincipal} from './principal.ts';
import {commitOperation,receipt,requestHash} from './transaction.ts';
import {object,id,invalid} from './input.ts';
import {OperationError} from './errors.ts';

export async function requestWhatsAppSync(env:ServerEnv,principal:OperationPrincipal,input:unknown,key:string){
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const raw=object(input),company=id(raw.company),days=raw.days??30;
 if(typeof days!=='number'||![2,30,90,365].includes(days))invalid('Escolha um período válido.');
 const db=env.DB,workspace=env.WORKSPACE_ID||'default',command='whatsapp.sync',hash=await requestHash(command,{company,days});
 for(let attempt=0;attempt<3;attempt++){
  const guards=await authorizeOperation(db,workspace,principal,{action:'whatsapp.sincronizar',scope:'engagement:write',company});
  const saved=await receipt(db,workspace,principal.id,key,command,hash);if(saved)return saved.result;
  if(!await whatsappSourceAvailable(env))throw new OperationError(503,'source_unavailable','Fonte do WhatsApp indisponível.');
  if(!await configuredGroup(db,workspace,company))throw new OperationError(409,'group_required','Defina o grupo em Configurar cliente › Recursos.');
  const plan=await prepareWhatsAppSync(env,company,days,principal.email);
  try{return await commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash, checked: true,id:crypto.randomUUID(),guards,writes:[],statements:plan.statements,events:plan.created?[{type:command,company,subject:plan.id,data:{days}}]:[],result:{data:{id:plan.id,company}}});}
  catch(error){if(!isWhatsAppQueueConflict(error))throw error;}
 }
 throw new OperationError(409,'queue_changed','A fila mudou durante a atualização. Tente novamente.');
}
