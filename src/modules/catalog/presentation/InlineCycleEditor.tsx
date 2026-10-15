"use client";
import { CatalogOperationFeedback, type CatalogOperationUI } from "./useCatalogOperations";
import { TaskDeadlineFields } from "@/modules/catalog/presentation/TaskDeadlineFields";
import { CycleMilestonesEditor } from "./CycleMilestonesEditor";
import { Select } from "@/shared/ui/Select";
import {
  templateError,
  type BaseDelivery,
  type CycleTemplate,
} from "@/modules/catalog/domain/products";
import { areaClass, FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { Check, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { TextareaField } from "@g4ai/ds";

export function InlineCycleEditor({
  operation,
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: CycleTemplate;
  onChange: (draft: CycleTemplate) => void;
  onCancel: () => void;
  operation?: CatalogOperationUI;
  onSave: (draft: CycleTemplate) => void;
}) {
  const [error, setError] = useState("");
  const [acceptance, setAcceptance] = useState(draft.acceptance.join("\n"));
  function patchDelivery(id: string, patch: Partial<BaseDelivery>) {
    onChange({
      ...draft,
      deliveries: draft.deliveries.map((d) =>
        d.id === id ? { ...d, ...patch } : d,
      ),
    });
  }
  return (
    <><CatalogOperationFeedback operation={operation} /><fieldset disabled={operation?.busy}><form
      id="inline-cycle-form"
      onSubmit={(event) => {
        event.preventDefault();
        if(operation?.busy)return;
        const next = {
          ...draft,
          name: draft.name.trim(),
          goal: draft.goal.trim(),
          acceptance: acceptance
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          deliveries: draft.deliveries.map((d) => ({
            ...d,
            title: d.title.trim(),
            description: d.description.trim(),
          })),
        };
        const issue = templateError(next);
        if (issue) {
          setError(issue);
          return;
        }
        onSave(next);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-6">
        <div>
          <h3 className="text-[15px] font-medium">Editar ciclo</h3>
          <p className="mt-1 text-[12px] text-muted">
            As alterações serão usadas nos próximos ciclos dos clientes.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={operation?.busy}>
            <Check className="h-3.5 w-3.5" />
            {operation?.busy ? "Salvando…" : "Salvar alterações"}
          </Button>
        </div>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 px-4 py-5 sm:px-6">
          <FieldBlock label="Nome do ciclo">
            <input
              required
              className={fieldClass}
              value={draft.name}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
            />
          </FieldBlock>
          <FieldBlock label="Objetivo">
            <textarea
              required
              rows={2}
              className={areaClass}
              value={draft.goal}
              onChange={(e) => onChange({ ...draft, goal: e.target.value })}
            />
          </FieldBlock>
          <CycleMilestonesEditor draft={draft} onChange={onChange} />
          <h4 className="mb-3 text-[13px] font-medium">Tarefas base</h4>
          <div className="space-y-4">
            {draft.deliveries.map((d, i) => (
              <fieldset
                key={d.id}
                className="min-w-0 border-b border-line pb-4"
              >
                <legend className="sr-only">Tarefa {i + 1}</legend>
                <div className="grid grid-cols-[minmax(0,1fr)_32px] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_70px_70px_32px]">
                  <div className="min-w-0">
                    <label
                      htmlFor={`delivery-title-${d.id}`}
                      className="mb-1.5 block text-[11px] text-muted"
                    >
                      Tarefa {i + 1}
                    </label>
                    <input
                      id={`delivery-title-${d.id}`}
                      aria-label={`Título da tarefa ${i + 1}`}
                      required
                      className={fieldClass}
                      value={d.title}
                      onChange={(e) =>
                        patchDelivery(d.id, { title: e.target.value })
                      }
                      placeholder="Nome da tarefa"
                    />
                  </div>
                  <div className="col-start-1 row-start-2 mt-2 grid grid-cols-2 gap-2 sm:contents">
                    <div>
                      <label
                        htmlFor={`delivery-day-${d.id}`}
                        className="mb-1.5 block text-[11px] text-muted"
                      >
                        Dia
                      </label>
                      <input
                        id={`delivery-day-${d.id}`}
                        aria-label={`Dia da tarefa ${i + 1}`}
                        required
                        type="number"
                        min={1}
                        max={draft.durationDays}
                        step={1}
                        className={fieldClass}
                        readOnly={!!d.deadline && d.deadline.mode !== "fixed"}
                title="Dia inicial usado quando não há vínculo de prazo"
                value={d.day}
                        onChange={(e) =>
                          patchDelivery(d.id, { day: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`delivery-hours-${d.id}`}
                        className="mb-1.5 block text-[11px] text-muted"
                      >
                        Horas
                      </label>
                      <input
                        id={`delivery-hours-${d.id}`}
                        aria-label={`Esforço da tarefa ${i + 1}`}
                        required
                        type="number"
                        min={0}
                        step={0.5}
                        className={fieldClass}
                        value={d.hours}
                        onChange={(e) =>
                          patchDelivery(d.id, { hours: Number(e.target.value) })
                        }
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remover tarefa ${i + 1}`}
                    onClick={() =>
                      onChange({
                        ...draft,
                        deliveries: draft.deliveries.filter(
                          (row) => row.id !== d.id,
                        ),
                      })
                    }
                    className="col-start-2 row-start-1 mt-6 rounded-lg p-2 text-muted hover:bg-rose-soft hover:text-rose sm:col-start-4"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3">
                  <Select
                    label={`Marco da tarefa ${i + 1}`}
                    value={
                      d.milestoneId ?? draft.milestones?.[0]?.id ?? "resultado"
                    }
                    onValueChange={(value) =>
                      patchDelivery(d.id, { milestoneId: value })
                    }
                    options={(
                      draft.milestones ?? [
                        {
                          id: "resultado",
                          name: draft.name || "Resultado do ciclo",
                        },
                      ]
                    ).map((m) => ({ value: m.id, label: m.name }))}
                  />
                </div>
                <TaskDeadlineFields template value={d.deadline} onChange={deadline=>patchDelivery(d.id,{deadline})} tasks={draft.deliveries.filter(t=>t.id!==d.id)} />
                <TextareaField
                  label="Checklist (um item por linha)"
                  className="mt-3"
                  autosize={false}
                  rows={3}
                  value={d.checklistItems?.join("\n") ?? ""}
                  onChange={(value) =>
                    patchDelivery(d.id, {
                      checklistItems: value.split("\n"),
                    })
                  }
                />
                <TextareaField
                  label={`Descrição da tarefa ${i + 1}`}
                  hideLabel
                  minRows={1}
                  className="mt-2"
                  value={d.description}
                  placeholder="Adicionar descrição ou resultado esperado…"
                  onChange={(value) =>
                    patchDelivery(d.id, { description: value })
                  }
                />
              </fieldset>
            ))}
          </div>
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-ink-soft hover:text-ink"
            onClick={() =>
              onChange({
                ...draft,
                deliveries: [
                  ...draft.deliveries,
                  {
                    id: crypto.randomUUID(),
                    title: "",
                    description: "",
                    day: draft.durationDays,
                    hours: 0,
                  },
                ],
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar tarefa
          </button>
        </div>
        <aside className="min-w-0 border-t border-line bg-soft/20 px-4 py-5 sm:px-6 lg:border-l lg:border-t-0">
          <FieldBlock label="Duração padrão (dias)">
            <input
              required
              type="number"
              min={1}
              max={365}
              step={1}
              className={fieldClass}
              value={draft.durationDays}
              onChange={(e) =>
                onChange({ ...draft, durationDays: Number(e.target.value) })
              }
            />
          </FieldBlock>
          <FieldBlock label="Critérios de aceite">
            <textarea
              rows={6}
              required
              className={areaClass}
              value={acceptance}
              onChange={(e) => setAcceptance(e.target.value)}
              placeholder="Um critério por linha"
            />
          </FieldBlock>
          <p className="text-[11px] leading-5 text-muted">
            Use um critério por linha. O dia 1 de cada tarefa corresponde ao
            início do ciclo.
          </p>
        </aside>
      </div>
      {error && (
        <p
          role="alert"
          className="mx-4 mb-4 rounded-lg bg-rose-soft px-3 py-2 text-[13px] text-rose sm:mx-6"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[11px] text-muted sm:px-6">
        <span>Os ciclos já abertos mantêm suas tarefas.</span>
        <button type="submit" className="font-medium text-ink hover:underline">
          Salvar alterações →
        </button>
      </div>
    </form></fieldset></>
  );
}
