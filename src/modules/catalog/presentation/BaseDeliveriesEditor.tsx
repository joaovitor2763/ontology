"use client";
import { TaskDeadlineFields } from "@/modules/catalog/presentation/TaskDeadlineFields";
import type { BaseDelivery } from "@/modules/catalog/domain/products";
import { areaClass, FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { Plus, Trash2 } from "lucide-react";

export function BaseDeliveriesEditor({
  rows,
  onChange,
  maxDay,
}: {
  rows: BaseDelivery[];
  onChange: (rows: BaseDelivery[]) => void;
  maxDay: number;
}) {
  function patch(id: string, change: Partial<BaseDelivery>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
  }
  return (
    <div className="space-y-3">
      {rows.map((row, i) => (
        <fieldset
          key={row.id}
          className="min-w-0 rounded-xl border border-line p-3"
        >
          <legend className="px-1 text-[12px] text-muted">
            Tarefa {i + 1}
          </legend>
          <div className="mb-3 flex items-center gap-2">
            <input
              aria-label={`Título da tarefa ${i + 1}`}
              required
              className={fieldClass}
              value={row.title}
              onChange={(e) => patch(row.id, { title: e.target.value })}
              placeholder="O que será entregue?"
            />
            <button
              type="button"
              aria-label={`Remover tarefa ${i + 1}`}
              className="shrink-0 rounded-lg p-2 text-muted hover:bg-rose-soft hover:text-rose"
              onClick={() => onChange(rows.filter((d) => d.id !== row.id))}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <textarea
            aria-label={`Descrição da tarefa ${i + 1}`}
            className={areaClass}
            rows={2}
            placeholder="Descrição e resultado esperado"
            value={row.description}
            onChange={(e) => patch(row.id, { description: e.target.value })}
          />
          <TaskDeadlineFields template value={row.deadline} onChange={deadline=>patch(row.id,{deadline})} tasks={rows.filter(d=>d.id!==row.id)} />
          <label className="mt-3 block text-xs text-muted">
            Checklist (um item por linha)
            <textarea
              className={areaClass}
              rows={3}
              value={row.checklistItems?.join("\n") ?? ""}
              onChange={(e) =>
                patch(row.id, { checklistItems: e.target.value.split("\n") })
              }
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <FieldBlock label={`Dia da tarefa ${i + 1}`}>
              <input
                type="number"
                required
                min={1}
                max={maxDay}
                step={1}
                className={fieldClass}
                readOnly={!!row.deadline && row.deadline.mode !== "fixed"}
                title="Dia inicial usado quando não há vínculo de prazo"
                value={row.day}
                onChange={(e) => patch(row.id, { day: Number(e.target.value) })}
              />
            </FieldBlock>
            <FieldBlock label={`Esforço ${i + 1} (horas)`}>
              <input
                type="number"
                required
                min={0}
                step={0.5}
                className={fieldClass}
                value={row.hours}
                onChange={(e) =>
                  patch(row.id, { hours: Number(e.target.value) })
                }
              />
            </FieldBlock>
          </div>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() =>
          onChange([
            ...rows,
            {
              id: crypto.randomUUID(),
              title: "",
              description: "",
              day: Math.max(1, maxDay),
              hours: 0,
            },
          ])
        }
      >
        <Plus className="h-4 w-4" />
        Adicionar tarefa
      </Button>
    </div>
  );
}
