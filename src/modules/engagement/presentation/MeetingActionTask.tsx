"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import type { ActionItem, Meeting } from "../domain/models";
import { deliveryFromAction, linkAction } from "../domain/meetings";
import { useEngagementState } from "../infrastructure/state";
import { useCatalogState } from "@/modules/catalog/infrastructure/state";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { enrollmentCanReceiveWork } from "@/modules/clients/domain/product-enrollments";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";
import { validDate } from "@/modules/delivery/application/plan-execution";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { useStakeholders } from "@/modules/clients/infrastructure/stakeholders-state";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { executeOperation, meetingOperationBaseline, operationAttempt, usesRemoteOperations } from "@/shared/infrastructure/operations";
import { paths } from "@/shared/lib/routes";
import { Button } from "@/shared/ui/primitives";
import { Combobox } from "@/shared/ui/Combobox";

/** Keep mounted after polling links the action, so an uncertain request can still be confirmed. */
export function MeetingActionTask({meeting,action}:{meeting:Meeting;action:ActionItem}) {
  const {can}=usePermissions();
  const {enrollments,clientBySlug}=useClientsState();
  const {products}=useCatalogState();
  const productName=(id:string)=>products.find(p=>p.id===id)?.name??"Produto indisponível";
  const {addTask,companyJourney,cycles,statusMap,extraTasks,taskPatches}=useDeliveryState();
  const {active,me}=useTeam();
  const {forCompany}=useStakeholders();
  const {updateMeeting}=useEngagementState();
  const [selected,setSelected]=useState("");
  const [busy,setBusy]=useState(false);
  const [uncertain,setUncertain]=useState(false);
  const [error,setError]=useState("");
  const locked=useRef(false);
  const pending=useRef<null|(()=>Promise<void>)>(null);
  const choices=(meeting.enrollmentIds??[]).map(id=>enrollments.find(e=>e.id===id&&e.company===meeting.company));
  const enrollmentId=choices.length===1?choices[0]?.id:choices.length>1?selected:null;
  const permitted=can("reunioes.agendar",meeting.company)&&can("entregas.editar",meeting.company);
  async function convert() {
    if(locked.current||!permitted) return;
    locked.current=true;setBusy(true);setError("");
    try {
      if(!pending.current) {
        if(meeting.cancelledAt) throw new Error("A reunião está cancelada.");
        if(meeting.schedulingStatus==="pending"||meeting.schedulingStatus==="uncertain") throw new Error("Conclua a operação pendente da reunião antes de converter uma ação.");
        if(!action.id) throw new Error("Esta ação precisa de um identificador antes de criar a tarefa.");
        if(choices.some(e=>!e)|| (choices.length&&!enrollmentId)) throw new Error("Selecione uma contratação válida desta reunião.");
        const enrollment=enrollmentId?choices.find(e=>e?.id===enrollmentId):undefined;
        if(enrollment&&!enrollmentCanReceiveWork(enrollment)) throw new Error("A contratação está encerrada ou arquivada.");
        const input={meetingId:meeting.id,actionId:action.id,enrollmentId:enrollmentId??null};
        const baseline=meetingOperationBaseline();
        if(await usesRemoteOperations()) {
          const attempt=operationAttempt("meetings.actions.createTask",input);
          pending.current=async()=>{await executeOperation("meetings.actions.createTask",input,attempt,baseline);};
          setUncertain(true);
        } else {
          if(action.deliveryId) return;
          if(!action.text.trim()||!validDate(action.dueAt)) throw new Error("Revise o texto e o prazo da ação antes de criar a tarefa.");
          if(!active.some(p=>p.id===action.ownerId)&&!forCompany(meeting.company).some(p=>p.id===action.ownerId&&p.active)) throw new Error("Escolha um responsável ativo da equipe ou deste cliente.");
          const context=[meeting.cycleId?cycles.find(c=>c.id===meeting.cycleId&&c.company===meeting.company):undefined,meeting.deliveryId?deliveriesFor(meeting.company,statusMap,extraTasks,taskPatches).find(t=>t.id===meeting.deliveryId):undefined];
          if((meeting.cycleId&&!context[0])||(meeting.deliveryId&&!context[1])||context.some(row=>row&&((row.enrollmentId??null)!==(enrollmentId??null)||(enrollment&&row.productId&&row.productId!==enrollment.productId)))) throw new Error("O vínculo da reunião não corresponde à contratação. Revise a reunião.");
          const task={...deliveryFromAction(meeting,action,`d-${crypto.randomUUID()}`),status:"fila" as const,origin:"reuniao" as const,startsAt:action.dueAt,requestedBy:me.id,
            ...(enrollment?{enrollmentId:enrollment.id,productId:enrollment.productId,journeyId:enrollment.planId}:{journeyId:companyJourney[meeting.company]??clientBySlug(meeting.company)?.journeyId})};
          addTask(task);updateMeeting(linkAction(meeting,action.id,task.id),"Tarefa criada a partir da ação");return;
        }
      }
      await pending.current();pending.current=null;setUncertain(false);
    } catch(e) {setError(e instanceof Error?e.message:"Não foi possível confirmar a tarefa.");}
    finally {locked.current=false;setBusy(false);}
  }
  if(action.deliveryId&&!uncertain) return <Link href={paths.clientDelivery(meeting.company,action.deliveryId)} className="text-sm text-blue">Ver tarefa</Link>;
  if(!permitted) return null;
  return <div className="w-full space-y-2 sm:max-w-sm" aria-label={`Criar tarefa de ${action.text}`}>
    {choices.length>1?<Combobox label="Contratação da tarefa" value={selected} disabled={busy||uncertain} onValueChange={setSelected} options={choices.filter(e=>!!e).map(e=>({value:e.id,label:`${productName(e.productId)} · ${e.startsAt??"sem data"} · ${e.id.slice(0,8)}`}))}/>:<p className="text-xs text-muted">{choices[0]?`Contratação: ${productName(choices[0].productId)} · ${choices[0].startsAt??"sem data"}`:choices.length?"Contratação indisponível; revise a reunião.":"Tarefa avulsa, sem contratação."}</p>}
    {error&&<p role="alert" className="text-sm text-rose">{error}</p>}
    {uncertain&&!busy&&<p className="text-xs text-muted">Gravação sem confirmação. Verifique a mesma tentativa antes de criar outra tarefa.</p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="ghost" disabled={busy||(!uncertain&&choices.length>0&&!enrollmentId)} onClick={convert}>{busy?"Convertendo…":uncertain?"Verificar tarefa":"Converter em tarefa"}</Button>
      {uncertain&&error&&!busy&&<Button size="sm" variant="ghost" onClick={()=>{if(locked.current)return;pending.current=null;setUncertain(false);setError("");}}>Revisar seleção</Button>}
    </div>
  </div>;
}
