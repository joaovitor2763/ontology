"use client";
import { DatePicker } from "@/shared/ui/DatePicker";
import { Combobox } from "@/shared/ui/Combobox";
import { useClientsState } from "@/modules/clients/infrastructure/state";

import type { JourneyMilestone } from "@/modules/catalog/domain/models";
import { deliverableTemplates } from "@/modules/catalog/infrastructure/journey";
import type { Company } from "@/modules/clients/domain/models";
import type { Delivery } from "@/modules/delivery/domain/models";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { useId, useState } from "react";

import { padMilestone } from "@/shared/lib/format";
import { areaClass, Drawer, FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { Select } from "@/shared/ui/Select";

export function JourneyTaskForm({
  company,
  milestone,
  onClose,
  onCreate,
}: {
  company: Company;
  milestone: JourneyMilestone;
  onClose: () => void;
  onCreate: (task: Delivery) => void;
}) {
  const { active, resolve } = useTeam();
  const { assigned } = useClientsState();
  const formId = useId();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwner] = useState(
    assigned(company).leadId,
  );
  const [dueAt, setDueAt] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  const [hours, setHours] = useState("2");
  const [completion, setCompletion] = useState<"checklist" | "deliverable">(
    "checklist",
  );
  const [template, setTemplate] = useState<string>("");
  return (
    <Drawer
      open
      onClose={onClose}
      title="Nova tarefa"
      kicker={`${padMilestone(milestone.n)} · ${milestone.name}`}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={!title.trim()}>
            Criar tarefa
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          onCreate({
            id: `local-${crypto.randomUUID()}`,
            company: company.slug,
            title: title.trim(),
            description: description.trim(),
            ownerId,
            dueAt,
            hours: Number(hours) || 0,
            status: "fila",
            milestone: milestone.n,
            workstream: milestone.stage,
            completion,
            deliverable:
              completion === "deliverable" && template ? template : undefined,
            kind: "journey",
          });
        }}
      >
        <FieldBlock label="Nome da tarefa">
          <input
            autoFocus
            required
            className={fieldClass}
            placeholder="O que precisa ser feito?"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </FieldBlock>
        <FieldBlock label="Resultado esperado">
          <textarea
            className={areaClass}
            rows={3}
            placeholder="Descreva o resultado e como validá-lo."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FieldBlock>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <FieldBlock label="Responsável">
            <Combobox
              label="Responsável"
              className={fieldClass}
              value={ownerId}
              onValueChange={(value) => setOwner(value)}
              options={[
                ...active,
                ...(active.some((person) => person.id === ownerId)
                  ? []
                  : [resolve(ownerId)]),
              ].map((person) => ({
                value: person.id,
                label: person.name,
              }))}
            />
          </FieldBlock>
          <FieldBlock label="Prazo">
            <DatePicker label="Prazo" required className={fieldClass} value={dueAt} onValueChange={(next) => setDueAt(next)} />
          </FieldBlock>
          <FieldBlock label="Tipo">
            <Select
              label="Tipo"
              value={completion}
              onValueChange={(v) =>
                setCompletion(v as "checklist" | "deliverable")
              }
              options={[
                { value: "checklist", label: "Checklist" },
                { value: "deliverable", label: "Entregável" },
              ]}
            />
          </FieldBlock>
          <FieldBlock label="Esforço previsto (h)">
            <input
              type="number"
              min="0"
              step="0.5"
              className={fieldClass}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </FieldBlock>
          {completion === "deliverable" && (
            <FieldBlock label="Modelo de entregável">
              <Combobox
                label="Modelo de entregável"
                className={fieldClass}
                value={template}
                onValueChange={(value) => setTemplate(value)}
                options={[
                  { value: "", label: "Sem modelo" },
                  ...deliverableTemplates.map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                ]}
              />
            </FieldBlock>
          )}
        </div>
      </form>
    </Drawer>
  );
}
