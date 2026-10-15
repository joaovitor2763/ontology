"use client";
import { useState } from "react";
import { Pencil } from "lucide-react";
import type { Company } from "../domain/models";
import { ChangeResponsible } from "./ChangeResponsible";
import { Avatar } from "@/shared/ui/primitives";

type Member = { id: string; name: string; initials: string };

export function ResponsibleMembers({ members, company, editable }: { members: Member[]; company: Company; editable: boolean }) {
  const [open, setOpen] = useState(false);
  const content = (
    <span className="inline-flex min-w-0 flex-wrap gap-x-3 gap-y-1.5">
      {!members.length && <span className="text-muted">Sem responsável</span>}
      {members.map(member => (
        <span key={member.id} title={member.name} className="inline-flex items-center gap-2">
          <Avatar initials={member.initials} size="sm" />
          {member.name}
        </span>
      ))}
    </span>
  );
  if (!editable) return content;
  return <><button type="button" aria-label={`Alterar responsável de ${company.name}`}
    className="relative z-10 inline-flex min-h-9 min-w-0 items-center gap-2 rounded-md text-left hover:text-blue focus-visible:outline-2 focus-visible:outline-blue"
    onClick={() => setOpen(true)}>{content}<Pencil className="h-3.5 w-3.5 shrink-0 text-muted" /></button>
    {open && <ChangeResponsible company={company} onClose={() => setOpen(false)} />}</>;
}
