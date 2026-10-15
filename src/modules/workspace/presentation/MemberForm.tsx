"use client";
import {
  accessHint,
  accessLabel,
  normalizeAccess,
  deliveryRoles,
  initialsOf,
  memberError,
  type AccessLevel,
  type Person,
} from "@/modules/workspace/domain/models";
import { Drawer, FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { Select } from "@/shared/ui/Select";
import {
  contactEmails,
  contactPhones,
  normalizeContactPoints,
} from "@/shared/lib/contact-points";
import { MultiContactField } from "@/shared/ui/MultiContactField";
import { useStakeholders } from "@/modules/clients/infrastructure/stakeholders-state";
import { useState } from "react";
import { useWorkspaceState } from "../infrastructure/state";
import { useTeam } from "./useTeam";

import { MemberOperationFeedback, useMemberOperation } from "./useMemberOperation";
import { OperationButton } from "@/shared/ui/OperationFeedback";

/** Creates or edits one member of the internal team. */
export function MemberForm({
  member,
  onClose,
}: {
  member?: Person;
  onClose: () => void;
}) {
  const operation = useMemberOperation();
  function close(){if(!operation.busy){operation.reset();onClose();}}
  const { addMember, updateMember, memberRoles } = useWorkspaceState();
  const { members } = useTeam();
  const { contacts } = useStakeholders();
  const editing = Boolean(member);
  const [name, setName] = useState(member?.name ?? "");
  const [role, setRole] = useState(member?.role ?? "");
  const [phones, setPhones] = useState(() => contactPhones(member ?? { id: "" }));
  const [emails, setEmails] = useState(() => contactEmails(member ?? { id: "" }));
  const [access, setAccess] = useState<AccessLevel>(
    normalizeAccess(member?.access),
  );
  const [capacity, setCapacity] = useState(
    String(member?.capacityHoursWeek ?? 40),
  );
  const [error, setError] = useState("");
  const roles: string[] = [...new Set([...deliveryRoles, ...memberRoles])];
  if (member?.role && !roles.includes(member.role)) roles.push(member.role);
  const title = editing ? "Editar membro" : "Adicionar membro";
  return (
    <Drawer
      open
      title={title}
      kicker="Equipe"
      onClose={close}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={operation.busy} onClick={close}>
            Cancelar
          </Button>
          <OperationButton
            operation={operation}
            busyLabel={editing ? "Salvando…" : "Adicionando…"}
            type="submit"
            form="member-form"
          >
            {editing ? "Salvar membro" : "Adicionar membro"}
          </OperationButton>
        </div>
      }
    >
      <MemberOperationFeedback operation={operation}/>
      <form
        id="member-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const draft: Person = {
            ...(member ?? { org: "praxis" as const }),
            id: member?.id ?? `member-${crypto.randomUUID()}`,
            name: name.trim(),
            role: role.trim(),
            phones,
            emails,
            phone: phones[0]?.trim() ?? "",
            email: emails[0]?.trim().toLowerCase() ?? "",
            org: "praxis",
            initials: initialsOf(name),
            access,
            capacityHoursWeek: capacity.trim() ? Number(capacity) : undefined,
          };
          const problem =
            memberError(draft, [...members, ...contacts]);
          if (problem) {
            setError(problem);
            return;
          }
          const next = normalizeContactPoints(draft);
          const fields={name:next.name,email:next.email,emails:next.emails,phone:next.phone,phones:next.phones,role:next.role,access:next.access,capacityHoursWeek:next.capacityHoursWeek??40};
          void operation.run(editing?"members.update":"members.create",editing?{memberId:next.id,patch:fields}:{member:fields},()=>{if(editing)updateMember(next);else addMember(next);},onClose);
        }}
      >
        <fieldset disabled={operation.pending}>
        <FieldBlock label="Nome">
          <input
            required
            autoComplete="name"
            className={fieldClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome completo"
          />
        </FieldBlock>
        <MultiContactField
          label="E-mails"
          type="email"
          values={emails}
          onChange={setEmails}
          primaryHint="O primeiro e-mail é o contato principal e a identidade de acesso."
        />
        <MultiContactField
          label="Telefones / WhatsApp"
          type="tel"
          values={phones}
          onChange={setPhones}
        />
        <FieldBlock label="Cargo">
          <Select
            label="Cargo"
            value={role}
            onValueChange={setRole}
            placeholder="Selecione o cargo"
            options={roles.map((value) => ({ value, label: value }))}
          />
        </FieldBlock>
        <FieldBlock label="Acesso">
          <Select
            label="Acesso"
            value={access}
            onValueChange={(v) => setAccess(v as AccessLevel)}
            options={(Object.keys(accessLabel) as AccessLevel[]).map(
              (level) => ({
                value: level,
                label: accessLabel[level],
                description: accessHint[level],
              }),
            )}
          />
          <p className="mt-1.5 text-[12px] leading-5 text-muted">
            {accessHint[access]}
          </p>
        </FieldBlock>
        <FieldBlock label="Capacidade semanal (horas)">
          <input
            type="number"
            min={0}
            max={80}
            step={1}
            className={fieldClass}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </FieldBlock>
        <p className="text-[12px] leading-5 text-muted">
          O acesso define o que o membro pode ver e editar neste workspace. A
          capacidade alimenta a alocação por cliente.
        </p>
        {error && (
          <p role="alert" className="text-[13px] text-rose">
            {error}
          </p>
        )}
        </fieldset>
      </form>
    </Drawer>
  );
}
