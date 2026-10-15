"use client";
import { useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import {
  partyOfRole,
  referenceOwnerRoles,
  type ReferenceTask,
  type TaskSchedule,
} from "@/modules/catalog/domain/models";
import {
  scheduleBaseLabel,
  scheduleModeLabel,
  scheduleSummary,
  validateSchedules,
} from "@/modules/catalog/domain/schedule";
import { deliverableTemplates } from "@/modules/catalog/infrastructure/journey";
import { cn } from "@/shared/lib/cn";
import { fieldClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import { Checkbox, TextField, TextareaField } from "@g4ai/ds";

export function ListEditor({
  label,
  addLabel,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  addLabel: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="mb-5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12.5px] text-muted">{label}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink"
          onClick={() => onChange([...values, ""])}
        >
          <Plus className="h-3 w-3" />
          {addLabel}
        </button>
      </div>
      <div className="space-y-2">
        {values.map((value, i) => (
          <div key={i} className="flex items-center gap-2">
            <TextField
              label={`${label} ${i + 1}`}
              hideLabel
              className="min-w-0 flex-1"
              value={value}
              placeholder={placeholder}
              onChange={(next) =>
                onChange(values.map((v, j) => (j === i ? next : v)))
              }
            />
            <button
              type="button"
              aria-label="Remover item"
              className="shrink-0 rounded p-1 text-muted hover:text-rose"
              onClick={() => onChange(values.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {!values.length && (
          <p className="text-[12px] text-muted">
            Nenhum item. O ciclo usa os critérios de aceite do modelo.
          </p>
        )}
      </div>
    </div>
  );
}

const roleOptions = referenceOwnerRoles.map((role) => ({
  value: role,
  label: role,
}));
const templateOptions = [
  { value: "", label: "Sem modelo" },
  ...deliverableTemplates.map((t) => ({ value: t.id, label: t.name })),
];
const modeOptions = (
  Object.keys(scheduleModeLabel) as TaskSchedule["mode"][]
).map((mode) => ({ value: mode, label: scheduleModeLabel[mode] }));
const baseOptions = (Object.keys(scheduleBaseLabel) as ("inicio" | "venda")[]).map(
  (base) => ({ value: base, label: scheduleBaseLabel[base] }),
);

export function TaskListEditor({
  milestoneId,
  tasks,
  onChange,
}: {
  milestoneId: string;
  tasks: ReferenceTask[];
  onChange: (tasks: ReferenceTask[]) => void;
}) {
  const [advanced, setAdvanced] = useState<string | null>(null);
  const nextId = () => {
    let n = tasks.length + 1;
    while (tasks.some((t) => t.id === `${milestoneId}-t${n}`)) n += 1;
    return `${milestoneId}-t${n}`;
  };
  const patch = (i: number, changes: Partial<ReferenceTask>) =>
    onChange(tasks.map((t, j) => (j === i ? { ...t, ...changes } : t)));
  const scheduleProblem = validateSchedules(tasks);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12.5px] text-muted">Tarefas de referência</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink"
          onClick={() =>
            onChange([
              ...tasks,
              {
                id: nextId(),
                title: "",
                description: "",
                hours: 4,
                completion: "deliverable",
                ownerRole: "Responsável",
                party: "equipe",
                requiresEvidence: true,
                approvalRequired: true,
              },
            ])
          }
        >
          <Plus className="h-3 w-3" />
          Tarefa
        </button>
      </div>
      <div className="space-y-2">
        {tasks.map((t, i) => {
          const open = advanced === t.id;
          const schedule: TaskSchedule = t.schedule ?? { mode: "none" };
          const others = tasks.filter((x, j) => j < i && x.title.trim());
          return (
            <fieldset
              key={t.id}
              className="rounded-lg border border-line p-2.5"
              aria-label={`Tarefa de referência ${i + 1}`}
            >
              <div className="flex items-center gap-2">
                <TextField
                  label={`Título da tarefa de referência ${i + 1}`}
                  hideLabel
                  className="min-w-0 flex-1"
                  value={t.title}
                  placeholder="Título da tarefa"
                  onChange={(title) => patch(i, { title })}
                />
                <button
                  type="button"
                  aria-label="Remover tarefa de referência"
                  className="shrink-0 rounded p-1 text-muted hover:text-rose"
                  onClick={() => onChange(tasks.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <label className="text-[11px] text-muted">
                  Responsável
                  <div className="mt-1">
                    <Select
                      label="Papel responsável"
                      value={t.ownerRole ?? "Responsável"}
                      onValueChange={(v) =>
                        patch(i, { ownerRole: v, party: partyOfRole(v) })
                      }
                      options={roleOptions}
                    />
                  </div>
                </label>
                <label className="text-[11px] text-muted">
                  Tipo
                  <div className="mt-1">
                    <Select
                      label="Tipo da tarefa de referência"
                      value={t.completion}
                      onValueChange={(v) => {
                        const completion = v as ReferenceTask["completion"];
                        patch(i, {
                          completion,
                          requiresEvidence: completion === "deliverable",
                          approvalRequired: completion === "deliverable",
                        });
                      }}
                      options={[
                        { value: "deliverable", label: "Entregável" },
                        { value: "checklist", label: "Checklist" },
                      ]}
                    />
                  </div>
                </label>
                <label className="text-[11px] text-muted">
                  Esforço (h)
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    className={cn(fieldClass, "mt-1")}
                    value={t.hours}
                    onChange={(e) =>
                      patch(i, { hours: Number(e.target.value) || 0 })
                    }
                  />
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-muted">
                <span>{scheduleSummary(t.schedule, tasks)}</span>
                <button
                  type="button"
                  aria-expanded={open}
                  className="inline-flex items-center gap-1 hover:text-ink"
                  onClick={() => setAdvanced(open ? null : t.id)}
                >
                  Detalhes
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 transition-transform",
                      !open && "-rotate-90",
                    )}
                  />
                </button>
              </div>
              {open && (
                <div className="mt-3 space-y-3 border-t border-line pt-3">
                  <TextareaField
                    label="Resultado esperado"
                    hideLabel
                    minRows={2}
                    value={t.description}
                    placeholder="Resultado esperado"
                    onChange={(description) => patch(i, { description })}
                  />
                  {t.completion === "deliverable" && (
                    <label className="block text-[11px] text-muted">
                      Modelo de entregável
                      <div className="mt-1">
                        <Select
                          label="Modelo de entregável"
                          value={t.deliverableTemplateId ?? ""}
                          placeholder="Sem modelo"
                          onValueChange={(v) =>
                            patch(i, { deliverableTemplateId: v || undefined })
                          }
                          options={templateOptions}
                        />
                      </div>
                    </label>
                  )}
                  <div className="flex flex-wrap gap-4">
                    <Checkbox
                      label="Exige evidência"
                      checked={Boolean(t.requiresEvidence)}
                      onCheckedChange={(checked) =>
                        patch(i, { requiresEvidence: checked })
                      }
                    />
                    <Checkbox
                      label="Exige aprovação"
                      checked={Boolean(t.approvalRequired)}
                      onCheckedChange={(checked) =>
                        patch(i, { approvalRequired: checked })
                      }
                    />
                  </div>
                  <TextareaField
                    label="Checklist (um item por linha)"
                    autosize={false}
                    rows={3}
                    value={(t.checklistItems ?? []).join("\n")}
                    placeholder={"Razão social\nCNPJ\nPraça"}
                    onChange={(value) =>
                      patch(i, {
                        checklistItems: value.split("\n"),
                      })
                    }
                  />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <label className="text-[11px] text-muted">
                      Prazo
                      <div className="mt-1">
                        <Select
                          label="Modo de prazo"
                          value={schedule.mode}
                          onValueChange={(v) => {
                            const mode = v as TaskSchedule["mode"];
                            patch(i, {
                              schedule:
                                mode === "none"
                                  ? { mode }
                                  : mode === "date"
                                    ? { mode, base: "inicio", offsetDays: 0 }
                                    : {
                                        mode,
                                        predecessorId: others.at(-1)?.id ?? "",
                                        offsetDays: 1,
                                      },
                            });
                          }}
                          options={modeOptions}
                        />
                      </div>
                    </label>
                    {schedule.mode === "date" && (
                      <label className="text-[11px] text-muted">
                        Base
                        <div className="mt-1">
                          <Select
                            label="Data base"
                            value={schedule.base}
                            onValueChange={(v) =>
                              patch(i, {
                                schedule: {
                                  ...schedule,
                                  base: v as "inicio" | "venda",
                                },
                              })
                            }
                            options={baseOptions}
                          />
                        </div>
                      </label>
                    )}
                    {schedule.mode === "task" && (
                      <label className="text-[11px] text-muted">
                        Depois de
                        <div className="mt-1">
                          <Select
                            label="Tarefa anterior"
                            value={schedule.predecessorId}
                            placeholder="Escolher tarefa"
                            onValueChange={(v) =>
                              patch(i, {
                                schedule: { ...schedule, predecessorId: v },
                              })
                            }
                            options={others.map((o) => ({
                              value: o.id,
                              label: o.title,
                            }))}
                          />
                        </div>
                      </label>
                    )}
                    {schedule.mode !== "none" && (
                      <label className="text-[11px] text-muted">
                        Deslocamento (dias)
                        <input
                          type="number"
                          min={-365}
                          max={365}
                          className={cn(fieldClass, "mt-1")}
                          value={schedule.offsetDays}
                          onChange={(e) =>
                            patch(i, {
                              schedule: {
                                ...schedule,
                                offsetDays: Number(e.target.value) || 0,
                              },
                            })
                          }
                        />
                      </label>
                    )}
                  </div>
                </div>
              )}
            </fieldset>
          );
        })}
        {!tasks.length && (
          <p className="text-[12px] text-muted">
            Nenhuma tarefa de referência. Elas são sugeridas ao abrir um ciclo
            para este marco.
          </p>
        )}
        {scheduleProblem && (
          <p role="alert" className="text-[12px] text-rose">
            {scheduleProblem}
          </p>
        )}
      </div>
    </div>
  );
}
