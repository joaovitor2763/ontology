"use client";
import { DatePicker } from "@/shared/ui/DatePicker";
import { Combobox } from "@/shared/ui/Combobox";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";

import { useStakeholders } from "@/modules/clients/infrastructure/stakeholders-state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { deliveryOperationBaseline, deliveryOperationPatch, executeOperation, operationAttempt, usesRemoteOperations, type OperationAttempt } from "@/shared/infrastructure/operations";

import type { Company } from "@/modules/clients/domain/models";
import type { Delivery } from "@/modules/delivery/domain/models";
import { NOW, originLabel, priorityLabel } from "@/shared/lib/format";
import { Drawer, FieldBlock, areaClass, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { Select } from "@/shared/ui/Select";

export function RequestForm({
  company,
  onCreated,
}: {
  company: Company;
  onCreated?: (task: Delivery) => void;
}) {
  const { addTask } = useDeliveryState();
  const { active } = useTeam();
  const { assigned } = useClientsState();
  const defaultOwner = assigned(company).leadId;
  const defaultDue = new Date(new Date(NOW).getTime() + 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  const { forCompany } = useStakeholders();
  const sponsor = forCompany(company.slug).find(
    (s) => s.primary && s.active,
  ) ?? { name: "" };
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const attempt = useRef<OperationAttempt | null>(null);
  const baseline = useRef<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requestedBy, setRequestedBy] = useState(sponsor.name);
  const [origin, setOrigin] =
    useState<NonNullable<Delivery["origin"]>>("whatsapp");
  const [priority, setPriority] =
    useState<NonNullable<Delivery["priority"]>>("media");
  const [ownerId, setOwnerId] = useState(defaultOwner);
  const [dueAt, setDueAt] = useState(defaultDue);

  function reset() {
    setError("");
    attempt.current = null;
    baseline.current = deliveryOperationBaseline();
    setTitle("");
    setDescription("");
    setRequestedBy(sponsor.name);
    setOrigin("whatsapp");
    setPriority("media");
    setOwnerId(defaultOwner);
    setDueAt(defaultDue);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (savingRef.current || !title.trim()) return;
    const task: Delivery = {
      id: "req-" + Math.random().toString(36).slice(2, 8),
      company: company.slug,
      title: title.trim(),
      description: description.trim(),
      status: "fila",
      ownerId,
      dueAt,
      hours: 4,
      workstream: "Solicitação",
      milestone: 0,
      completion: "checklist",
      kind: "request",
      origin,
      requestedBy: requestedBy.trim() || sponsor.name,
      priority,
    };
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      let created = task;
      if (await usesRemoteOperations()) {
        const input = { company: company.slug, task: deliveryOperationPatch({ ...task }) };
        attempt.current = operationAttempt("tasks.create", input, attempt.current);
        const result = await executeOperation<{ task: Delivery }>("tasks.create", input, attempt.current, baseline.current);
        created = result.data.task;
      } else addTask(task);
      reset();
      setOpen(false);
      onCreated?.(created);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Não foi possível criar a solicitação."); }
    finally { savingRef.current = false; setSaving(false); }
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Plus className="h-3.5 w-3.5" />
        Novo ticket / solicitação
      </Button>
      <Drawer
        open={open}
        onClose={() => { if (!savingRef.current) setOpen(false); }}
        title="Registrar ticket ou solicitação"
        kicker="A tarefa associada será criada em A fazer, com o mesmo responsável e prazo."
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" form="request-form" disabled={saving || !title.trim()}>
              {saving ? "Criando…" : "Criar solicitação"}
            </Button>
          </div>
        }
      >
        <form id="request-form" onSubmit={submit}>
          <fieldset disabled={saving} className="disabled:opacity-60">
          <FieldBlock label="O que o cliente pediu?">
            <input
              className={fieldClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Incluir leito da semi no copiloto"
              autoFocus
              maxLength={240}
            />
          </FieldBlock>
          <FieldBlock label="Contexto">
            <textarea
              className={areaClass}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Resultado esperado, restrições, o que já foi combinado."
              maxLength={4000}
            />
          </FieldBlock>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldBlock label="Solicitada por">
              <input
                className={fieldClass}
                value={requestedBy}
                onChange={(e) => setRequestedBy(e.target.value)}
                placeholder="Nome do contato"
              />
            </FieldBlock>
            <FieldBlock label="Origem">
              <Select
                label="Origem"
                value={origin}
                onValueChange={(v) =>
                  setOrigin(v as NonNullable<Delivery["origin"]>)
                }
                options={(
                  Object.keys(originLabel) as Array<keyof typeof originLabel>
                ).map((k) => ({ value: k, label: originLabel[k] }))}
              />
            </FieldBlock>
            <FieldBlock label="Prioridade">
              <Select
                label="Prioridade"
                value={priority}
                onValueChange={(v) =>
                  setPriority(v as NonNullable<Delivery["priority"]>)
                }
                options={(
                  Object.keys(priorityLabel) as Array<
                    keyof typeof priorityLabel
                  >
                ).map((k) => ({ value: k, label: priorityLabel[k] }))}
              />
            </FieldBlock>
            <FieldBlock label="Prazo desejado">
              <DatePicker label="Prazo desejado" className={fieldClass} value={dueAt} onValueChange={(next) => setDueAt(next)} />
            </FieldBlock>
          </div>
          <FieldBlock label="Quem assume">
            <Combobox
              label="Quem assume"
              className={fieldClass}
              value={ownerId}
              onValueChange={(value) => setOwnerId(value)}
              options={active.map((p) => ({
                  value: p.id,
                label: [p.name, " · ", p.role].join(""),
              }))}
            />
          </FieldBlock>
          </fieldset>
          {error && <p role="alert" className="text-sm text-rose">{error}</p>}
        </form>
      </Drawer>
    </>
  );
}
