"use client";
import { DatePicker } from "@/shared/ui/DatePicker";

import {
  allocationError,
  allocationRoleName,
  allocationRoleOptions,
  type Allocation,
} from "@/modules/clients/domain/allocation";
import type { Company } from "@/modules/clients/domain/models";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useCatalogState } from "@/modules/catalog/infrastructure/state";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { AllocationOperationFeedback, useAllocationOperation } from "@/modules/workspace/presentation/useAllocationOperation";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { Combobox } from "@/shared/ui/Combobox";
import { Drawer, FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { OperationButton } from "@/shared/ui/OperationFeedback";
import { Button } from "@/shared/ui/primitives";
import { Select } from "@/shared/ui/Select";
import { Pencil, X } from "lucide-react";
import { useState } from "react";

const CLIENT_SCOPE = "__client__";

export function AllocationManager({ client, initialEnrollmentId, onClose }: {
  client: Company;
  initialEnrollmentId?: string;
  onClose: () => void;
}) {
  const operation = useAllocationOperation();
  const clients = useClientsState();
  const { products } = useCatalogState();
  const { allocationRoles } = useWorkspaceState();
  const { active, resolve } = useTeam();
  const { can } = usePermissions();
  const allocations = clients.allocationsFor(client.slug);
  const enrollments = clients.enrollments.filter(enrollment => enrollment.company === client.slug);
  const roleOptions = allocationRoleOptions(allocationRoles);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [memberId, setMemberId] = useState("");
  const [role, setRole] = useState("consultor");
  const [scope, setScope] = useState(initialEnrollmentId ?? CLIENT_SCOPE);
  const [percent, setPercent] = useState("20");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const canAllocate = can("alocacao.editar");
  const productName = (productId: string) => products.find(product => product.id === productId)?.name ?? productId;
  const scopeLabel = (allocation: Allocation) => {
    if (!allocation.enrollmentId) return "Cliente inteiro";
    const enrollment = enrollments.find(row => row.id === allocation.enrollmentId);
    return enrollment ? `${productName(enrollment.productId)}${enrollment.startsAt ? ` · ${enrollment.startsAt}` : ""}` : "Contratação não encontrada";
  };

  function clearForm() {
    setEditingId(null); setMemberId(""); setRole("consultor"); setScope(initialEnrollmentId ?? CLIENT_SCOPE); setPercent("20"); setFrom(""); setTo(""); setError("");
  }
  function close() { if (!operation.busy) { operation.reset(); onClose(); } }
  function editAllocation(allocation: Allocation) {
    if (operation.pending) return;
    operation.begin(); setEditingId(allocation.id); setMemberId(allocation.memberId); setRole(allocation.role); setScope(allocation.enrollmentId ?? CLIENT_SCOPE); setPercent(String(allocation.percent)); setFrom(allocation.from ?? ""); setTo(allocation.to ?? ""); setError("");
  }

  return <Drawer open onClose={close} kicker="Equipe alocada" title={client.name} footer={<>
    <Button variant="ghost" size="sm" disabled={operation.busy} onClick={close}>Fechar</Button>
    {canAllocate ? <OperationButton operation={operation} size="sm" type="submit" form="client-allocation-form">{editingId ? "Salvar alocação" : "Adicionar à equipe"}</OperationButton> : null}
  </>}>
    <p className="mb-5 text-[13px] leading-relaxed text-muted">O cargo da pessoa e o acesso ao workspace são independentes. Aqui você define sua atuação no cliente inteiro ou somente em uma contratação.</p>
    <AllocationOperationFeedback operation={operation} />
    <div className="mb-6">
      <div className="mb-2 text-[12.5px] text-muted">Equipe atual</div>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {allocations.map(allocation => <li key={allocation.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
          <span className="min-w-0 flex-1"><span className="font-medium">{resolve(allocation.memberId).name}</span><span className="mt-0.5 block text-[12px] text-muted">{allocationRoleName(allocation.role, allocationRoles)} · {scopeLabel(allocation)} · {allocation.percent}% da capacidade{allocation.from ? ` · desde ${allocation.from}` : ""}{allocation.to ? ` até ${allocation.to}` : ""}</span></span>
          {canAllocate ? <><button type="button" disabled={operation.pending} aria-label={`Editar alocação de ${resolve(allocation.memberId).name}`} onClick={() => editAllocation(allocation)} className="rounded-md p-1.5 text-muted hover:bg-soft hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button><button type="button" disabled={operation.pending} aria-label={`Remover ${resolve(allocation.memberId).name} da equipe`} onClick={() => void operation.run("allocations.remove", { company: client.slug, allocationId: allocation.id }, () => clients.deleteAllocation(allocation.id), () => { if (editingId === allocation.id) clearForm(); })} className="rounded-md p-1.5 text-muted hover:bg-soft hover:text-ink"><X className="h-3.5 w-3.5" /></button></> : null}
        </li>)}
        {!allocations.length ? <li className="px-3 py-3 text-[13px] text-muted">Ninguém alocado neste cliente ainda.</li> : null}
      </ul>
    </div>
    {canAllocate ? <form id="client-allocation-form" onSubmit={event => {
      event.preventDefault();
      const next: Allocation = { id: editingId ?? `alloc-${crypto.randomUUID()}`, company: client.slug, memberId, role, enrollmentId: scope === CLIENT_SCOPE ? undefined : scope, percent: Number(percent), from: from || undefined, to: to || undefined };
      const problem = allocationError(next);
      if (problem) { setError(problem); return; }
      setError("");
      const allocation = { ...(editingId ? { id: editingId } : {}), memberId: next.memberId, role: next.role, ...(next.enrollmentId ? { enrollmentId: next.enrollmentId } : {}), percent: next.percent, from: from || "", to: to || "" };
      void operation.run("allocations.save", { company: client.slug, allocation }, () => clients.saveAllocation(next), clearForm);
    }}>
      <fieldset disabled={operation.pending}>
        {editingId ? <div className="mb-3 flex items-center justify-between text-sm"><span>Editando alocação</span><Button size="sm" variant="ghost" onClick={() => { operation.reset(); clearForm(); }}>Cancelar edição</Button></div> : null}
        <FieldBlock label="Pessoa"><Combobox label="Pessoa" className={fieldClass} value={memberId} onValueChange={setMemberId} options={active.map(person => ({ value: person.id, label: person.name, description: `${person.role} · acesso ${person.access ?? "visualização"}` }))} /></FieldBlock>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldBlock label="Papel nesta equipe"><Select label="Papel nesta equipe" value={role} onValueChange={setRole} options={roleOptions.map(option => ({ value: option.id, label: option.label }))} /></FieldBlock>
          <FieldBlock label="Escopo da atuação"><Select label="Escopo da atuação" value={scope} onValueChange={setScope} options={[{ value: CLIENT_SCOPE, label: "Cliente inteiro" }, ...enrollments.map(enrollment => ({ value: enrollment.id, label: productName(enrollment.productId), description: enrollment.startsAt ? `Contratação iniciada em ${enrollment.startsAt}` : "Contratação sem início registrado" }))]} /></FieldBlock>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <FieldBlock label="Dedicação (% da semana)"><input type="number" min={0} max={100} className={fieldClass} value={percent} onChange={event => setPercent(event.target.value)} /></FieldBlock>
          <FieldBlock label="Início (opcional)"><DatePicker label="Início (opcional)" className={fieldClass}
              value={from}
              onValueChange={next => setFrom(next)} /></FieldBlock>
          <FieldBlock label="Término (opcional)"><DatePicker label="Término (opcional)" className={fieldClass}
              value={to}
              onValueChange={next => setTo(next)} /></FieldBlock>
        </div>
        {error ? <p role="alert" className="mt-3 text-[13px] text-rose">{error}</p> : null}
      </fieldset>
    </form> : null}
  </Drawer>;
}
