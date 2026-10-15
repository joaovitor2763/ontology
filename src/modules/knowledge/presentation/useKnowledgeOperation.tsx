"use client";
import { useEffect, useRef, useState } from "react";
import { executeOperation, knowledgeOperationBaseline, operationAttempt, usesRemoteOperations } from "@/shared/infrastructure/operations";
import { isUncertainFailure } from "@/shared/infrastructure/operation-error";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { Button } from "@/shared/ui/primitives";
type Command = "knowledge.elements.save" | "knowledge.elements.remove" | "knowledge.connections.save" | "knowledge.connections.remove" | "knowledge.layout.update" | "knowledge.layout.reset" | "knowledge.history.restore";
type History = {past:number[];future:number[];version?:number};
type Result = {previousVersion:number;version:number};
const empty = ():History => ({past:[],future:[]});
function read(key:string):History {try {const value=JSON.parse(sessionStorage.getItem(key)??"null");return value&&Array.isArray(value.past)&&Array.isArray(value.future)&&[...value.past,...value.future].every((n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0)?value:empty();}catch{return empty();}}
export function useKnowledgeOperation(company:string) {
 const {can}=usePermissions();
 const key=`ontology.remote-history.v1.${company}`;
 const [history,setHistory]=useState<History>(()=>read(key));
 const [remote,setRemote]=useState<boolean|null>(null);
 const [busy,setBusy]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(""),[uncertain,setUncertain]=useState(false);
 const lock=useRef(false),request=useRef<null|(()=>Promise<void>)>(null),baseline=useRef<ReturnType<typeof knowledgeOperationBaseline>|null>(null);
 useEffect(()=>{let active=true;void usesRemoteOperations().then(value=>{if(active)setRemote(value);}).catch(()=>{});return()=>{active=false;};},[]);
 useEffect(()=>{try{sessionStorage.setItem(key,JSON.stringify(history));}catch{}},[key,history]);
 function begin(){baseline.current??=knowledgeOperationBaseline();}
 function reset(){if(lock.current)return;request.current=null;baseline.current=null;setPending(false);setError("");setUncertain(false);}
 async function retry(){if(lock.current||!request.current)return;lock.current=true;setBusy(true);setError("");try{await request.current();request.current=null;baseline.current=null;setPending(false);setUncertain(false);}catch(e){setUncertain(isUncertainFailure(e));setError(e instanceof Error?e.message:"Não foi possível confirmar a alteração.");}finally{lock.current=false;setBusy(false);}}
 function run(command:Command,input:unknown,local:()=>void,confirmed?:()=>void,mode:"record"|"layout"|"undo"|"redo"="record") {
  if(lock.current||request.current)return;
  if(!can("ontologia.editar",company)){setUncertain(false);setError("Você não tem permissão para editar este mapa.");return;}
  const body=structuredClone(input),attempt=operationAttempt(command,body),expected=baseline.current??knowledgeOperationBaseline();
  request.current=async()=>{if(await usesRemoteOperations()){
   const {data}=await executeOperation<Result>(command,body,attempt,expected);
   setHistory(h=>({...(mode==="layout"?h:mode==="undo"?{past:h.past.slice(0,-1),future:[...h.future,data.previousVersion]}:mode==="redo"?{past:[...h.past,data.previousVersion],future:h.future.slice(0,-1)}:data.version===data.previousVersion?h:{past:[...h.past.slice(-29),data.previousVersion],future:[]}),version:data.version}));
  }else local();confirmed?.();};setPending(true);void retry();
 }
 return {remote,history,busy,busyLabel:"Salvando…",pending,uncertain,error,begin,reset,retry,run,clearHistory:()=>{if(!lock.current){reset();setHistory(empty());}}};
}
export type KnowledgeOperation=ReturnType<typeof useKnowledgeOperation>;
/** Enquanto grava, quem informa é o botão; aqui só mora o erro. */
export function KnowledgeOperationFeedback({operation}:{operation:KnowledgeOperation}) {
 if(!operation.error)return null;
 return <div role="alert" className="my-3 rounded-lg border border-line bg-surface p-3 text-sm"><p className="text-rose">{operation.error}</p>{!operation.busy&&<div className="mt-2 flex flex-wrap gap-2">{operation.uncertain?<><Button size="sm" onClick={()=>void operation.retry()}>Verificar alteração</Button><Button size="sm" variant="ghost" onClick={operation.reset}>Revisar alteração</Button></>:<Button size="sm" onClick={()=>void operation.retry()}>Tentar novamente</Button>}<Button size="sm" variant="ghost" onClick={operation.clearHistory}>Limpar histórico de desfazer</Button></div>}</div>;
}
