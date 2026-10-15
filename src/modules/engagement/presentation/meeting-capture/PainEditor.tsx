"use client";
import { Trash2 } from "lucide-react";
import {
  painFrequencyLabel,
  painSeverityLabel,
} from "@/modules/engagement/domain/diagnosis";
import type { Pain } from "@/modules/engagement/domain/models";
import { FieldBlock, areaClass, fieldClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";

export function PainEditor({
  pain,
  index,
  onChange,
  onRemove,
}: {
  pain: Pain;
  index: number;
  onChange: (next: Pain) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="mb-2 flex items-center justify-between text-[12px] text-muted">
        <span>Dor {index + 1}</span>
        <button
          type="button"
          aria-label={`Remover dor ${index + 1}`}
          onClick={onRemove}
          className="hover:text-rose"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <FieldBlock label="Título">
        <input
          value={pain.title}
          onChange={(e) => onChange({ ...pain, title: e.target.value })}
          className={fieldClass}
          placeholder="Prescrição sai sem conciliação com a farmácia"
        />
      </FieldBlock>
      <FieldBlock label="Descrição">
        <textarea
          value={pain.description}
          onChange={(e) => onChange({ ...pain, description: e.target.value })}
          rows={2}
          className={areaClass}
          placeholder="Como acontece hoje e quem sente."
        />
      </FieldBlock>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldBlock label="Área">
          <input
            value={pain.area ?? ""}
            onChange={(e) => onChange({ ...pain, area: e.target.value })}
            className={fieldClass}
            placeholder="Operação"
          />
        </FieldBlock>
        <FieldBlock label="Severidade">
          <Select
            label="Severidade"
            value={pain.severity}
            onValueChange={(value) =>
              onChange({ ...pain, severity: value as Pain["severity"] })
            }
            options={(Object.keys(painSeverityLabel) as Pain["severity"][]).map(
              (id) => ({ value: id, label: painSeverityLabel[id] }),
            )}
          />
        </FieldBlock>
        <FieldBlock label="Frequência">
          <Select
            label="Frequência"
            value={pain.frequency ?? ""}
            placeholder="Não informada"
            onValueChange={(value) =>
              onChange({
                ...pain,
                frequency: (value || undefined) as Pain["frequency"],
              })
            }
            options={(
              Object.keys(painFrequencyLabel) as NonNullable<
                Pain["frequency"]
              >[]
            ).map((id) => ({ value: id, label: painFrequencyLabel[id] }))}
          />
        </FieldBlock>
        <FieldBlock label="Impacto">
          <input
            value={pain.impact ?? ""}
            onChange={(e) => onChange({ ...pain, impact: e.target.value })}
            className={fieldClass}
            placeholder="Atrasa a alta em 3 horas"
          />
        </FieldBlock>
      </div>
      <FieldBlock label={`Confiança · ${pain.confidence ?? 0}%`}>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={pain.confidence ?? 0}
          onChange={(e) =>
            onChange({ ...pain, confidence: Number(e.target.value) })
          }
          className="w-full"
          aria-label="Confiança na dor"
        />
      </FieldBlock>
    </div>
  );
}
