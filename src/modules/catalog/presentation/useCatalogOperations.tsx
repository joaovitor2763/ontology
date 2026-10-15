"use client";
import { useRef, useState } from 'react';
import { clientOperationBaseline, executeOperation, operationAttempt, usesRemoteOperations, type OperationAttempt } from '@/shared/infrastructure/operations';
import { isUncertainFailure } from '@/shared/infrastructure/operation-error';
import { notify } from '@/shared/ui/Feedback';
import { Button } from '@/shared/ui/primitives';
type Command='products.save'|'plans.save'|'plans.remove'|'plans.publish';
export type CatalogOperationUI={busy:boolean;busyLabel:string;pending:boolean;uncertain:boolean;error:string;retry:()=>Promise<boolean>|undefined};
/** Retains the exact request and baseline after an uncertain response, even if polling updates props. */
export function useCatalogOperations(){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
 const lock=useRef(false),attempt=useRef<OperationAttempt|null>(null),retryAction=useRef<(()=>Promise<boolean>)|null>(null);
 async function run(command:Command,input:unknown,local:()=>unknown,confirmed:()=>void,message:string){
  if(lock.current)return false;
  const frozen=structuredClone(input) as {product?:Record<string,unknown>;plan?:Record<string,unknown>},baseline=clientOperationBaseline();
  // Server-owned bookkeeping is not part of an editor's intent after a polling refresh.
  if(command==="products.save"&&frozen.product)delete frozen.product.version;
  if(command==="plans.save"&&frozen.plan)for(const field of ["version","publishedAt","createdAt","updatedAt","draftUpdatedAt"])delete frozen.plan[field];
  async function execute(){
   if(lock.current)return false;lock.current=true;setBusy(true);setError('');setUncertain(false);
   try{
    if(await usesRemoteOperations()){attempt.current=operationAttempt(command,frozen,attempt.current);await executeOperation(command,frozen,attempt.current,baseline);notify(message);}
    else await local();
    attempt.current=null;retryAction.current=null;confirmed();return true;
   }catch(error){setUncertain(isUncertainFailure(error));setError(error instanceof TypeError?'Não foi possível confirmar a gravação. Tente novamente para verificar o resultado.':error instanceof Error?error.message:'Não foi possível salvar. Tente novamente.');return false;}
   finally{lock.current=false;setBusy(false);}
  }
  retryAction.current=execute;return execute();
 }
 return{busy,busyLabel:'Salvando…',pending:busy,uncertain,error,run,retry:()=>retryAction.current?.()};
}
/** Enquanto grava, quem informa é o botão; aqui só mora o erro. */
export function CatalogOperationFeedback({operation}:{operation?:CatalogOperationUI}){
 if(!operation?.error)return null;
 return <div role="alert" className="my-3 space-y-2 rounded-lg border border-line p-3 text-sm"><p className="text-rose">{operation.error}</p>{!operation.busy&&<Button size="sm" onClick={()=>void operation.retry()}>{operation.uncertain?"Verificar alteração":"Tentar novamente"}</Button>}</div>;
}
