"use client";
import { useRef, useState } from "react";
import type { Meeting } from "../domain/models";
import { useEngagementState } from "../infrastructure/state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { executeOperation, meetingOperationBaseline, operationAttempt, usesRemoteOperations } from "@/shared/infrastructure/operations";
import { Modal } from "@/shared/ui/Dialog";
import { Button } from "@/shared/ui/primitives";
import { RadioGroup } from "@g4ai/ds";

export type MeetingLifecycleSelection={meeting:Meeting;restore?:boolean;actionId?:string};
/** The selected record and request survive polling, including after a lost success response. */
export function MeetingLifecycleDialog({selection,onClose,onConfirmed}:{selection:MeetingLifecycleSelection;onClose:()=>void;onConfirmed?:()=>void}) {
  const {restore=false,actionId}=selection;
  const {can}=usePermissions();const {me}=useTeam();const {lifecycle,meetingsIncludingRemoved}=useEngagementState();
  const meeting=meetingsIncludingRemoved.find(m=>m.id===selection.meeting.id)??selection.meeting;
  const [choice,setChoice]=useState<"keep"|"cancel"|"">("");
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [pending,setPending]=useState(false);
  const locked=useRef(false);const request=useRef<null|(()=>Promise<void>)>(null);
  const calendar=!restore&&!actionId&&!!meeting.google?.eventId&&!meeting.cancelledAt&&!meeting.google?.cancelled;
  async function run(){
    if(locked.current||!can("reunioes.agendar",meeting.company))return;
    locked.current=true;setBusy(true);setError("");
    try{
      if(!request.current){
        if(calendar&&!choice)throw new Error("Escolha o que fazer com o evento no Google.");
        const command=actionId?(restore?"meetings.actions.restore":"meetings.actions.remove"):(restore?"meetings.restore":"meetings.remove");
        const input={meetingId:meeting.id,...(actionId?{actionId}:{}),...(calendar&&choice==="keep"?{keepCalendar:true}:{})};
        if(await usesRemoteOperations()){
          let baseline=meetingOperationBaseline();const attempt=operationAttempt(command,input);
          const cancelInput={meetingId:meeting.id};const cancelAttempt=operationAttempt("meetings.cancel",cancelInput);
          let cancelComplete=!(calendar&&choice==="cancel");
          request.current=async()=>{
            if(!cancelComplete){
              const result=await executeOperation<{operation?:{status:string}|null}>("meetings.cancel",cancelInput,cancelAttempt,baseline);
              if(result.data.operation&&result.data.operation.status!=="complete")throw new Error("Cancelamento ainda sem confirmação. Verifique esta tentativa antes de remover.");
              cancelComplete=true;baseline=meetingOperationBaseline();
            }
            await executeOperation(command,input,attempt,baseline);
          };
        }else{
          if(calendar&&choice==="cancel")throw new Error("Conecte ao servidor para cancelar o convite. Você pode manter o evento e remover apenas o registro.");
          request.current=async()=>{lifecycle(meeting.id,restore,me.id,actionId);};
        }
        setPending(true);
      }
      await request.current();request.current=null;setPending(false);onConfirmed?.();onClose();
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível confirmar a alteração.");}
    finally{locked.current=false;setBusy(false);}
  }
  return <Modal open onClose={()=>{if(!locked.current)onClose();}} title={`${restore?"Restaurar":"Remover"} ${actionId?"ação":"reunião"}?`} description={restore?"O registro volta à plataforma sem reenviar convites. Tarefas e histórico são preservados.":"O registro fica disponível para restauração. Tarefas vinculadas e histórico são preservados."} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>Fechar</Button><Button disabled={busy||(!pending&&calendar&&!choice)||!can("reunioes.agendar",meeting.company)} onClick={run}>{busy?(restore?"Restaurando…":"Removendo…"):pending?"Verificar alteração":restore?"Restaurar":"Confirmar remoção"}</Button></>}>
    <p className="mb-3 text-sm font-medium">{actionId?meeting.actions.find(a=>a.id===actionId)?.text:meeting.title}</p>
    {calendar&&<RadioGroup<"keep"|"cancel"> label="Evento no Google Agenda" name="calendar-lifecycle" className="mb-0!" value={choice||null} onChange={setChoice} options={[{value:"keep",label:"Manter evento e convites no Google",disabled:busy||pending},{value:"cancel",label:"Cancelar convite antes de remover",disabled:busy||pending}]}/>}
    {error&&<p role="alert" className="mt-3 text-sm text-rose">{error}</p>}
    {pending&&error&&!busy&&<><p className="mt-2 text-xs text-muted">Verifique a mesma tentativa para recuperar a confirmação.</p><Button variant="ghost" size="sm" onClick={()=>{request.current=null;setPending(false);setError("");}}>Revisar escolha</Button></>}
  </Modal>;
}
