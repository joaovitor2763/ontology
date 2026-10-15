"use client";

import { allocationRoleName } from "../domain/allocation";
import type { Company } from "../domain/models";
import { useClientsState } from "../infrastructure/state";
import { useWorkspaceState } from "../../workspace/infrastructure/state";
import { usePermissions } from "../../workspace/presentation/usePermissions";
import { useTeam } from "../../workspace/presentation/useTeam";
import { Avatar, Button } from "@/shared/ui/primitives";
import { Users } from "lucide-react";
import { useState } from "react";
import { ChangeResponsibleButton } from "./ChangeResponsible";
import { workspaceDate } from "@/shared/lib/format";
import { enrollmentIsCurrent } from "../domain/product-enrollments";
import { AllocationManager } from "./AllocationManager";

export function EnrollmentTeam({ company, enrollmentId }: { company: Company; enrollmentId: string }) {
  const { allocations, enrollments } = useClientsState();
  const { allocationRoles } = useWorkspaceState();
  const { resolve } = useTeam();
  const { can } = usePermissions();
  const [managing, setManaging] = useState(false);
  const today = workspaceDate();
  const rows = allocations.filter(row => row.company === company.slug && (!row.enrollmentId || row.enrollmentId === enrollmentId)).filter(row => (!row.from || row.from <= today) && (!row.to || row.to >= today));
  const owner = rows.find(row => row.role === "responsavel" && row.enrollmentId === enrollmentId);
  const editable = enrollments.some(row => row.id === enrollmentId && enrollmentIsCurrent(row)) && can("cliente.responsaveis", company.slug);
  return <>
    <section className="mb-4 rounded-xl border border-line bg-surface px-4 py-3" aria-label="Equipe desta contratação">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><Users className="h-4 w-4 text-muted" /><div><h2 className="text-[13px] font-medium">Equipe desta contratação</h2><p className="text-[11.5px] text-muted">Inclui a equipe geral do cliente e as pessoas deste produto.</p></div></div>
        {can("alocacao.editar") ? <Button size="sm" variant="ghost" onClick={() => setManaging(true)}>Gerenciar equipe</Button> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px]"><span>Responsável pelo produto: <strong>{owner ? resolve(owner.memberId).name : "Sem responsável"}</strong></span>{editable && <ChangeResponsibleButton company={company} enrollmentId={enrollmentId} />}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {rows.map(allocation => {
          const person = resolve(allocation.memberId);
          return <span key={allocation.id} className="inline-flex items-center gap-2 rounded-lg bg-soft px-2.5 py-1.5 text-[12px]"><Avatar initials={person.initials} name={person.name} size="sm" /><span><span className="font-medium">{person.name}</span><span className="text-muted"> · {allocation.role === "responsavel" ? (allocation.enrollmentId ? "Responsável pelo produto" : "Responsável pelo cliente") : `${allocationRoleName(allocation.role, allocationRoles)} · ${allocation.enrollmentId ? "Neste produto" : "Cliente inteiro"}`}</span></span></span>;
        })}
        {!rows.length ? <span className="text-[12px] text-muted">Nenhuma pessoa foi alocada a esta contratação.</span> : null}
      </div>
    </section>
    {managing ? <AllocationManager client={company} initialEnrollmentId={enrollmentId} onClose={() => setManaging(false)} /> : null}
  </>;
}
