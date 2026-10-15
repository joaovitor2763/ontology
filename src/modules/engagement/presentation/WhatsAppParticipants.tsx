"use client";
import { useRef, useState } from "react";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { initialsOf } from "@/modules/workspace/domain/models";
import { useStakeholders } from "@/modules/clients/infrastructure/stakeholders-state";
import { participantFor, phoneKey } from "../application/participants";
import { Drawer, FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import { Combobox } from "@/shared/ui/Combobox";
import { clientOperationBaseline } from "@/shared/infrastructure/operations";
import { Button } from "@/shared/ui/primitives";
import { contactPhones } from "@/shared/lib/contact-points";

import { MemberOperationFeedback, useMemberOperation } from "@/modules/workspace/presentation/useMemberOperation";

export function ParticipantEditor({
  company,
  number,
  onClose,
}: {
  company: string;
  number: string;
  onClose: () => void;
}) {
  const memberOperation = useMemberOperation();
  const { members, active } = useTeam();
  const { updateMember, storageError: teamError } = useWorkspaceState();
  const { contacts, saveStakeholder, storageError } = useStakeholders();
  const { can } = usePermissions();
  const existing = participantFor(number, members, contacts, company);
  const teamAllowed = can("equipe.gerenciar");
  const clientAllowed = can("stakeholders.editar", company);
  const [kind, setKind] = useState(
    existing?.org === "praxis" ? "member" : "stakeholder",
  );
  const [selected, setSelected] = useState(existing?.id ?? "");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const [newId] = useState(() => `stakeholder-${crypto.randomUUID()}`);
  const [baseline] = useState(clientOperationBaseline);
  const candidates =
    kind === "member"
      ? active
      : contacts.filter((p) => p.company === company && p.active);
  const target = candidates.find((p) => p.id === selected);
  const allowed = kind === "member" ? teamAllowed : clientAllowed;
  async function save() {
    if (inFlight.current) return;
    const phone = phoneKey(number);
    if (!allowed || !phone) return;
    const conflict = [
      ...members,
      ...contacts,
    ].find((p) => contactPhones(p).includes(phone) && p.id !== selected);
    if (conflict) {
      setError(
        `Este número já pertence a ${conflict.name}. Corrija o telefone no cadastro dessa pessoa antes de vincular novamente.`,
      );
      return;
    }
    if (kind === "stakeholder" && selected === "new" && (!name.trim() || !role.trim())) {
      setError("Informe o nome e o cargo."); return;
    }
    inFlight.current = true; setSaving(true); setError("");
    try {
    if (kind === "member") {
      if (!target) return;
      const phones=[...new Set([...contactPhones(target),phone])];
      const problem = await memberOperation.run("members.update",{memberId:target.id,patch:{phones}},()=>updateMember({...target,phone:phones[0]??"",phones}),()=>{setError("");setSubmitted(true);});
      if(problem)return;
    } else if (selected === "new") {
      await saveStakeholder({
        id: newId,
        name: name.trim(),
        role: role.trim(),
        initials: initialsOf(name),
        org: "client",
        company,
        phone,
        phones: [phone],
        email: "",
        emails: [],
        area: "",
        accountRole: "outro",
        primary: false,
        active: true,
        notes: "",
      }, baseline);
    } else {
      const contact = contacts.find(
        (p) => p.company === company && p.id === selected,
      );
      if (!contact) return;
      const phones=[...new Set([...contactPhones(contact),phone])];
      await saveStakeholder({ ...contact, phone:phones[0]??"", phones }, baseline);
    }
    setError("");
    setSubmitted(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível salvar o vínculo. Tente novamente.");
    } finally { inFlight.current = false; setSaving(false); }
  }
  return (
    <Drawer
      open
      title="Identificar participante"
      kicker={number}
      onClose={() => { if (!inFlight.current && !memberOperation.busy) onClose(); }}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving || memberOperation.busy}>
            Fechar
          </Button>
          <Button
            disabled={!allowed || !phoneKey(number) || !selected || submitted || saving || memberOperation.pending}
            onClick={() => void save()}
          >
            {saving ? "Salvando…" : "Salvar vínculo"}
          </Button>
        </div>
      }
    >
      <p className="mb-5 text-[13px] text-muted">
        O nome aparecerá também nas mensagens antigas. O vínculo com a equipe
        vale em todos os clientes; stakeholders pertencem a este cliente.
      </p>
      <MemberOperationFeedback operation={memberOperation}/>
      <fieldset disabled={saving || memberOperation.pending} className="contents">
      <FieldBlock label="Vincular a">
        <Select
          label="Tipo de participante"
          value={kind}
          onValueChange={(v) => {
            setKind(v);
            setSelected("");
            setSubmitted(false);
          }}
          options={[
            { value: "stakeholder", label: "Stakeholder do cliente" },
            { value: "member", label: "Membro da equipe" },
          ]}
        />
      </FieldBlock>
      {!allowed && (
        <p className="mb-4 text-[13px] text-muted">
          Seu acesso não permite editar este cadastro.
          {kind === "member"
            ? " Peça a um admin para vincular o membro da equipe."
            : ""}
        </p>
      )}
      <FieldBlock label="Pessoa">
        <Combobox
          label="Pessoa"
          disabled={!allowed || submitted}
          value={selected}
          onValueChange={setSelected}
          options={[
            ...candidates.map((p) => ({
              value: p.id,
              label: p.name,
              description: p.email || p.role,
            })),
            ...(kind === "stakeholder"
              ? [{ value: "new", label: "Criar stakeholder com este número" }]
              : []),
          ]}
        />
      </FieldBlock>
      {selected === "new" && (
        <>
          <FieldBlock label="Nome">
            <input
              className={fieldClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FieldBlock>
          <FieldBlock label="Cargo">
            <input
              className={fieldClass}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
          </FieldBlock>
        </>
      )}
      {target && !contactPhones(target).includes(phoneKey(number)) && (
        <p className="mb-4 text-[13px]">
          Ao salvar, {number} será adicionado aos telefones de {target.name}.
        </p>
      )}
      {submitted && !storageError && !teamError && (
        <p role="status" className="text-[13px] text-ok">
          {kind === "stakeholder" ? "Vínculo salvo." : "Vínculo aplicado. Acompanhe a confirmação de sincronização no menu lateral."}
        </p>
      )}
      {(error || storageError || teamError) && (
        <p role="alert" className="text-[13px] text-rose">
          {error || storageError || teamError}
        </p>
      )}
      </fieldset>
    </Drawer>
  );
}
