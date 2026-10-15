"use client";
import { Modal } from "@/shared/ui/Dialog";
import { Button } from "@/shared/ui/primitives";
import { useWorkspaceState } from "../infrastructure/state";
import { useTeam } from "./useTeam";
import { MemberOperationFeedback, useMemberOperation } from "./useMemberOperation";
import { OperationButton } from "@/shared/ui/OperationFeedback";
export function MemberActiveDialog({memberId,name,active,onClose}:{memberId:string;name:string;active:boolean;onClose:()=>void}){
 const operation=useMemberOperation();const {toggleMember}=useWorkspaceState();const {deactivated}=useTeam();
 function close(){if(!operation.busy){operation.reset();onClose();}}
 return <Modal open onClose={close} title={active?"Reativar membro?":"Desativar membro?"} description={active?`${name} volta a aparecer nas alocações e nos responsáveis.`:`${name} deixa de ser oferecido como responsável. As alocações e o histórico são preservados.`} footer={<><Button variant="ghost" disabled={operation.busy} onClick={close}>Cancelar</Button><OperationButton operation={operation} busyLabel={active?"Reativando…":"Desativando…"} variant={active?"primary":"danger"} onClick={()=>void operation.run("members.setActive",{memberId,active},()=>{if(deactivated.has(memberId)===active)toggleMember(memberId);},onClose)}>{active?"Reativar":"Desativar"}</OperationButton></>}><MemberOperationFeedback operation={operation}/></Modal>;
}
