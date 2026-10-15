"use client";
import { Trash2 } from "lucide-react";
import { effortLabel } from "@/modules/engagement/domain/diagnosis";
import {
  tradeoffAxisLabel,
  tradeoffLevelLabel,
} from "@/modules/engagement/domain/hypotheses";
import type {
  OptionTradeoffs,
  Pain,
  Solution,
  TradeoffLevel,
} from "@/modules/engagement/domain/models";
import { cn } from "@/shared/lib/cn";
import { FieldBlock, areaClass, fieldClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";

export function SolutionEditor({
  solution,
  index,
  pains,
  owners,
  onChange,
  onRemove,
}: {
  solution: Solution;
  index: number;
  pains: Pain[];
  owners: { value: string; label: string; description?: string }[];
  onChange: (next: Solution) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="mb-2 flex items-center justify-between text-[12px] text-muted">
        <span>Solução {index + 1}</span>
        <button
          type="button"
          aria-label={`Remover solução ${index + 1}`}
          onClick={onRemove}
          className="hover:text-rose"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <FieldBlock label="Título">
        <input
          value={solution.title}
          onChange={(e) => onChange({ ...solution, title: e.target.value })}
          className={fieldClass}
          placeholder="Revisão da farmácia antes da assinatura"
        />
      </FieldBlock>
      <fieldset className="mb-5">
        <legend className="mb-1.5 text-[12.5px] text-muted">
          Resolve qual dor?
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {pains.map((p) => {
            const on = solution.painIds.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  onChange({
                    ...solution,
                    painIds: on
                      ? solution.painIds.filter((id) => id !== p.id)
                      : [...solution.painIds, p.id],
                  })
                }
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-[12.5px] ring-1",
                  on
                    ? "bg-ink text-on-ink ring-ink"
                    : "bg-surface text-ink-soft ring-line hover:bg-soft",
                )}
              >
                {p.title || "Dor sem título"}
              </button>
            );
          })}
        </div>
      </fieldset>
      <FieldBlock label="Hipótese">
        <textarea
          value={solution.hypothesis}
          onChange={(e) => onChange({ ...solution, hypothesis: e.target.value })}
          rows={2}
          className={areaClass}
          placeholder="Se fizermos X, esperamos Y porque Z."
        />
      </FieldBlock>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldBlock label="Dono">
          <Select
            label="Dono da solução"
            value={solution.ownerId ?? ""}
            placeholder="Escolher"
            onValueChange={(value) =>
              onChange({ ...solution, ownerId: value || undefined })
            }
            options={owners}
          />
        </FieldBlock>
        <FieldBlock label="Esforço">
          <Select
            label="Esforço"
            value={solution.effort ?? ""}
            placeholder="Não estimado"
            onValueChange={(value) =>
              onChange({
                ...solution,
                effort: (value || undefined) as Solution["effort"],
              })
            }
            options={(
              Object.keys(effortLabel) as NonNullable<Solution["effort"]>[]
            ).map((id) => ({ value: id, label: effortLabel[id] }))}
          />
        </FieldBlock>
      </div>
      <fieldset className="mb-5">
        <legend className="mb-1.5 text-[12.5px] text-muted">
          Custo da opção · tempo, capital e talento
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(tradeoffAxisLabel) as (keyof OptionTradeoffs)[]).map(
            (axis) => (
              <Select
                key={axis}
                label={`${tradeoffAxisLabel[axis]} da opção`}
                size="compact"
                value={solution.tradeoffs?.[axis] ?? ""}
                placeholder={tradeoffAxisLabel[axis]}
                onValueChange={(value) =>
                  onChange({
                    ...solution,
                    tradeoffs: {
                      ...solution.tradeoffs,
                      [axis]: (value || undefined) as TradeoffLevel | undefined,
                    },
                  })
                }
                options={(Object.keys(tradeoffLevelLabel) as TradeoffLevel[]).map(
                  (level) => ({
                    value: level,
                    label: `${tradeoffAxisLabel[axis]} ${tradeoffLevelLabel[level].toLowerCase()}`,
                  }),
                )}
              />
            ),
          )}
        </div>
      </fieldset>
      <FieldBlock label="Métrica de sucesso">
        <input
          value={solution.successMetric ?? ""}
          onChange={(e) =>
            onChange({ ...solution, successMetric: e.target.value })
          }
          className={fieldClass}
          placeholder="Altas revisadas pela farmácia por semana"
        />
      </FieldBlock>
    </div>
  );
}
