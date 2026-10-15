"use client";
import { CriticalTaskBadge } from "../CriticalTaskBadge";
import { TaskDeadlineFields } from "@/modules/catalog/presentation/TaskDeadlineFields";
import { deliveriesFor } from "../../infrastructure/queries";
import { deliverableTemplates } from "@/modules/catalog/infrastructure/journey";
import type { Delivery } from "@/modules/delivery/domain/models";
import { directDueDatePatch, directStartDatePatch } from "@/modules/delivery/domain/delivery-policy";
import { DatePicker } from "@/shared/ui/DatePicker";
import { formatDate, originLabel, priorityLabel } from "@/shared/lib/format";
import { Combobox } from "@/shared/ui/Combobox";
import { FieldBlock, areaClass, fieldClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import { Button } from "@/shared/ui/primitives";
import type { DeliveryDraft } from "./useDeliveryDraft";

export function DeliveryFields({ editor }: { editor: DeliveryDraft }) {
  const { draft, live, set, save, members, deactivated, linkedCycle } = editor;
  const relative = !!live.deadline && live.deadline.mode !== "fixed";
  const shownDue = (relative ? live.dueAt : draft.dueAt).slice(0, 10);
  return (
    <>
      <FieldBlock label="Título">
        <input
          className={fieldClass}
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          onBlur={() => save()}
        />
      </FieldBlock>
      <FieldBlock label="Descrição">
        <textarea
          className={areaClass}
          rows={4}
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
          onBlur={() => save()}
        />
      </FieldBlock>
      {draft.kind === "request" && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <FieldBlock label="Solicitada por">
            <input
              className={fieldClass}
              value={draft.requestedBy ?? ""}
              onChange={(e) => set("requestedBy", e.target.value)}
              onBlur={() => save()}
            />
          </FieldBlock>
          <FieldBlock label="Origem">
            <Select
              label="Origem"
              value={draft.origin ?? "outro"}
              onValueChange={(v) => save({ origin: v as Delivery["origin"] })}
              options={(
                Object.keys(originLabel) as Array<keyof typeof originLabel>
              ).map((k) => ({ value: k, label: originLabel[k] }))}
            />
          </FieldBlock>
        </div>
      )}
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <FieldBlock label="Responsável">
          <Combobox
            label="Responsável"
            className={fieldClass}
            value={String(draft.ownerId)}
            onValueChange={editor.transferOwner}
            options={members
              .filter((p) => p.id === draft.ownerId || !deactivated.has(p.id))
              .map((p) => ({ value: p.id, label: p.name }))}
          />
          <p className="mt-1 text-xs text-muted">Escolha outra pessoa para transferir a responsabilidade desta tarefa.</p>
        </FieldBlock>
        <FieldBlock label="Prioridade">
          <CriticalTaskBadge priority={live.priority} />
          <Select
            label="Prioridade"
            value={draft.priority ?? "media"}
            onValueChange={(v) => save({ priority: v as Delivery["priority"] })}
            tone={
              draft.priority === "critica"
                ? "bad"
                : draft.priority === "alta"
                  ? "warn"
                  : "neutral"
            }
            options={(
              Object.keys(priorityLabel) as Array<keyof typeof priorityLabel>
            ).map((k) => ({ value: k, label: priorityLabel[k] }))}
          />
          <p className="mt-1 text-xs text-muted">
            Escolha Crítica para destacar uma tarefa muito importante dentro do
            ciclo.
          </p>
        </FieldBlock>
        {draft.kind !== "request" && (
          <FieldBlock label="Tipo">
            <Combobox
              label="Tipo"
              className={fieldClass}
              value={String(draft.deliverable ?? draft.completion)}
              onValueChange={(value) => {
                const tpl = deliverableTemplates.find((t) => t.id === value);
                save(
                  tpl
                    ? { completion: "deliverable", deliverable: tpl.id }
                    : {
                        completion:
                          value === "deliverable" ? "deliverable" : "checklist",
                        deliverable: undefined,
                      },
                );
              }}
              options={[
                { value: "checklist", label: "Checklist" },
                { value: "deliverable", label: "Entregável" },
                ...deliverableTemplates.map((t) => ({
                  value: t.id,
                  label: t.name,
                  description: "Modelo de entregável",
                })),
              ]}
            />
          </FieldBlock>
        )}
        <FieldBlock label="Início previsto">
          <DatePicker
            label="Início previsto"
            value={draft.startsAt ?? ""}
            onValueChange={(value) => save(directStartDatePatch({ ...draft, dueAt: shownDue, deadline: live.deadline }, value))}
          />
          {draft.startsAt && (
            <button type="button" className="mt-1 text-xs text-muted underline-offset-2 hover:underline" onClick={() => save({ startsAt: undefined })}>
              Remover início
            </button>
          )}
        </FieldBlock>
        <FieldBlock label="Prazo">
          <DatePicker
            label="Prazo"
            value={shownDue}
            required={live.status !== "fila"}
            onValueChange={(value) => save(directDueDatePatch({ ...draft, deadline: live.deadline }, value))}
          />
          {relative && (
            <p className="mt-1 text-xs text-muted">
              Alterar a data troca a regra para Data fixa.
            </p>
          )}
          {live.status === "fila" && shownDue && (
            <button type="button" className="mt-1 text-xs text-muted underline-offset-2 hover:underline"
              onClick={() => save({ dueAt: "", deadline: { mode: "fixed" }, startsAt: undefined })}>
              Remover prazo (volta ao Backlog)
            </button>
          )}
          {!shownDue && (
            <p className="mt-1 text-xs text-muted">Sem prazo, a tarefa fica no Backlog.</p>
          )}
        </FieldBlock>
        {live.status === "entregue" && (
          <FieldBlock label="Conclusão efetiva">
            <p className="flex h-10 items-center rounded-lg border border-line bg-soft/50 px-3 text-sm">
              {live.completedAt ? formatDate(live.completedAt) : "Data não registrada (legado)"}
            </p>
          </FieldBlock>
        )}
        {live.status !== "entregue" && (
          <div className="col-span-full space-y-2">
            <TaskDeadlineFields
              value={draft.deadline}
              onChange={(deadline) =>
                editor.setDraft((d) => ({ ...d, deadline }))
              }
              tasks={deliveriesFor(
                draft.company,
                editor.statusMap,
                editor.extraTasks,
                editor.taskPatches,
              ).filter((t) => t.id !== draft.id)}
              cycleAvailable={!!linkedCycle}
            />
            <Button variant="ghost" size="sm" onClick={() => save()}>
              Aplicar regra de prazo
            </Button>
            {live.deadline && live.deadline.mode !== "fixed" && (
              <p className="text-xs text-muted">
                Prazo calculado: {formatDate(live.dueAt)}.
              </p>
            )}
            {linkedCycle && live.dueAt &&
              (live.dueAt < linkedCycle.startsAt ||
                live.dueAt > linkedCycle.endsAt) && (
                <p role="status" className="text-xs text-rose">
                  O prazo está fora do período do ciclo. Ajuste o ciclo ou a
                  regra da tarefa.
                </p>
              )}
          </div>
        )}
        {draft.kind !== "request" && (
          <>
            <FieldBlock label="Esforço previsto (h)">
              <input
                type="number"
                min={0}
                className={fieldClass}
                value={draft.hours}
                onChange={(e) => set("hours", Number(e.target.value) || 0)}
                onBlur={() => save()}
              />
            </FieldBlock>
            <FieldBlock label="Esforço realizado (h)">
              <input
                type="number"
                min={0}
                className={fieldClass}
                value={draft.effortActual ?? ""}
                placeholder="—"
                onChange={(e) =>
                  set(
                    "effortActual",
                    e.target.value === "" ? undefined : Number(e.target.value),
                  )
                }
                onBlur={() => save()}
              />
            </FieldBlock>
          </>
        )}
      </div>
    </>
  );
}
