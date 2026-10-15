"use client";
import type { ProgramEvent } from "../domain/models";
import { useEngagementState } from "../infrastructure/state";
import { Modal } from "@/shared/ui/Dialog";
import { Button } from "@/shared/ui/primitives";
import { useProgramEventOperation, ProgramEventOperationFeedback } from "./useProgramEventOperation";
import { OperationButton } from "@/shared/ui/OperationFeedback";
export function EventLifecycleDialog({event,restore=false,onClose,onConfirmed}:{event:ProgramEvent;restore?:boolean;onClose:()=>void;onConfirmed:()=>void}){
 const operation=useProgramEventOperation();const {removeEvent,restoreEvent}=useEngagementState();
 return <Modal open onClose={()=>{if(!operation.busy)onClose();}} title={restore?"Restaurar evento?":"Excluir este evento?"} description="O registro é preservado e pode voltar à agenda. Esta ação não envia convites." footer={<><Button variant="ghost" disabled={operation.busy} onClick={onClose}>Cancelar</Button><OperationButton operation={operation} busyLabel={restore?"Restaurando…":"Excluindo…"} onClick={()=>void operation.run(restore?"program-events.restore":"program-events.remove",{company:event.company,eventId:event.id},()=>restore?restoreEvent(event.id):removeEvent(event.id),onConfirmed)}>{restore?"Restaurar evento":"Excluir evento"}</OperationButton></>}><p className="text-sm">{event.title}</p><ProgramEventOperationFeedback operation={operation}/></Modal>;
}
