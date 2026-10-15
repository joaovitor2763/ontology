"use client";
import { useState } from "react";
import type { Company } from "../domain/models";

import { useClientsState } from "../infrastructure/state";
import { useCatalogState } from "@/modules/catalog/infrastructure/state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { useAllocationOperation, AllocationOperationFeedback } from "@/modules/workspace/presentation/useAllocationOperation";
import { Modal } from "@/shared/ui/Dialog";
import { Combobox } from "@/shared/ui/Combobox";
import { FieldBlock, fieldClass } from "@/shared/ui/Drawer";

import { OperationButton } from "@/shared/ui/OperationFeedback";
import { Button } from "@/shared/ui/primitives";


export function ChangeResponsible({ company, enrollmentId, onClose }: { company: Company; enrollmentId?: string; onClose: () => void }) {
  const clients = useClientsState();
  const { products } = useCatalogState();
  const { active } = useTeam();
  const operation = useAllocationOperation();
  const [memberId, setMemberId] = useState("");
  const enrollment = clients.enrollments.find(row => row.id === enrollmentId);
  const product = products.find(row => row.id === enrollment?.productId);
  const close = () => { if (!operation.pending) onClose(); };
  return <Modal open title={enrollmentId ? "Responsável pelo produto" : "Responsável pelo cliente"} kicker={enrollmentId ? `${company.name} · ${product?.name ?? "Produto"}` : company.name} onClose={close} size="sm"
    footer={<><Button variant="ghost" disabled={operation.pending} onClick={close}>Cancelar</Button>
      <OperationButton operation={operation} type="submit" form="change-responsible" disabled={!memberId}>Salvar responsável</OperationButton></>}>
    <AllocationOperationFeedback operation={operation} />
    <form id="change-responsible" onSubmit={event => {
      event.preventDefault();
      if (!memberId) return;
      const nextMember = memberId === "__none__" ? null : memberId;
      void operation.run("clients.setResponsible", { company: company.slug, memberId: nextMember, ...(enrollmentId ? { enrollmentId } : {}) },
        () => clients.setResponsible(company.slug, nextMember, enrollmentId), onClose);
    }}>
      <fieldset disabled={operation.pending} className="space-y-4">
        <FieldBlock label="Novo responsável"><Combobox label="Novo responsável" className={fieldClass}
          value={memberId} onValueChange={setMemberId} options={[{ value: "__none__", label: "Sem responsável" }, ...active.map(member => ({ value: member.id, label: member.name }))]} /></FieldBlock>
        <p className="text-[13px] leading-relaxed text-muted">{enrollmentId
          ? "Essa escolha vale somente para este produto contratado."
          : "Essa escolha vale para a relação com o cliente. Os produtos mantêm seus próprios responsáveis."} As tarefas mantêm seus responsáveis.</p>
      </fieldset>
    </form>
  </Modal>;
}

export function ChangeResponsibleButton({ company, enrollmentId }: { company: Company; enrollmentId?: string }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" size="sm" onClick={() => setOpen(true)}>{enrollmentId ? "Alterar responsável do produto" : "Alterar responsável do cliente"}</Button>
    {open && <ChangeResponsible company={company} enrollmentId={enrollmentId} onClose={() => setOpen(false)} />}</>;
}
