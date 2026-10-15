"use client";
import type { TaskDeadline } from "@/modules/catalog/domain/task-deadlines";
import { Select } from "@/shared/ui/Select";
import { FieldBlock, fieldClass } from "@/shared/ui/Drawer";
export function TaskDeadlineFields({
  value,
  onChange,
  tasks,
  cycleAvailable = true,
  template = false,
}: {
  value?: TaskDeadline;
  onChange: (value: TaskDeadline) => void;
  tasks: { id: string; title: string }[];
  cycleAvailable?: boolean;
  template?: boolean;
}) {
  const mode = value?.mode ?? "fixed";
  return (
    <div className="space-y-3 rounded-lg border border-line p-3">
      <FieldBlock label="Regra do prazo">
        <Select
          label="Regra do prazo"
          value={mode}
          onValueChange={(v) =>
            onChange(
              v === "fixed"
                ? { mode: "fixed" }
                : v === "task"
                  ? { mode: "task", taskId: tasks[0]?.id ?? "", offsetDays: 0 }
                  : { mode: v as "cycle" | "client", offsetDays: 0 },
            )
          }
          options={[
            {
              value: "fixed",
              label: template ? "Dia do ciclo (sem vínculo)" : "Data fixa",
            },
            ...(cycleAvailable
              ? [{ value: "cycle", label: "Início do ciclo" }]
              : []),
            { value: "client", label: "Início do cliente" },
            { value: "task", label: "Prazo de outra tarefa" },
          ]}
        />
      </FieldBlock>
      {value?.mode === "task" && (
        <FieldBlock label="Tarefa de referência">
          <Select
            label="Tarefa de referência"
            value={value.taskId}
            onValueChange={(taskId) => onChange({ ...value, taskId })}
            options={tasks.map((t) => ({ value: t.id, label: t.title }))}
          />
        </FieldBlock>
      )}
      {value && value.mode !== "fixed" && (
        <FieldBlock label="Dias em relação à referência">
          <input
            aria-label="Dias em relação à referência"
            className={fieldClass}
            type="number"
            step={1}
            min={-3650}
            max={3650}
            value={value.offsetDays}
            onChange={(e) =>
              onChange({ ...value, offsetDays: Number(e.target.value) })
            }
          />
          <p className="mt-1 text-xs text-muted">
            Dias corridos. 0 = mesma data; positivo = depois; negativo = antes.
            O prazo acompanha a referência enquanto a tarefa estiver aberta.
          </p>
        </FieldBlock>
      )}
    </div>
  );
}
