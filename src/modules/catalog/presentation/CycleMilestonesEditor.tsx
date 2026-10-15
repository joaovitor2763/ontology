"use client";
import type { CycleTemplate } from "../domain/products";
import { fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
export function CycleMilestonesEditor({
  draft,
  onChange,
}: {
  draft: CycleTemplate;
  onChange: (draft: CycleTemplate) => void;
}) {
  const milestones = draft.milestones ?? [
    { id: "resultado", name: draft.name || "Resultado do ciclo" },
  ];
  return (
    <fieldset className="mb-5 space-y-2">
      <legend className="mb-2 text-sm font-medium">Marcos do ciclo</legend>
      {milestones.map((m, i) => (
        <div key={m.id} className="flex gap-2">
          <input
            aria-label={`Nome do marco ${i + 1}`}
            className={fieldClass}
            value={m.name}
            onChange={(e) =>
              onChange({
                ...draft,
                milestones: milestones.map((row) =>
                  row.id === m.id ? { ...row, name: e.target.value } : row,
                ),
              })
            }
          />
          <Button
            size="sm"
            variant="ghost"
            type="button"
            disabled={milestones.length === 1}
            onClick={() => {
              const next = milestones.filter((row) => row.id !== m.id);
              onChange({
                ...draft,
                milestones: next,
                deliveries: draft.deliveries.map((d) =>
                  d.milestoneId === m.id
                    ? { ...d, milestoneId: next[0].id }
                    : d,
                ),
              });
            }}
          >
            Remover
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() =>
          onChange({
            ...draft,
            milestones: [
              ...milestones,
              { id: crypto.randomUUID(), name: "Novo marco" },
            ],
          })
        }
      >
        Adicionar marco
      </Button>
    </fieldset>
  );
}
