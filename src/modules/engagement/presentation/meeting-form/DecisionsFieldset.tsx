"use client";
import { Trash2 } from "lucide-react";
import { fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import type { MeetingDraft } from "./useMeetingDraft";

export function DecisionsFieldset({ draft }: { draft: MeetingDraft }) {
  const { decisions } = draft;
  return (
    <fieldset className="mb-5">
      <legend className="mb-2 text-[13px] font-medium">Decisões</legend>
      {decisions.length > 0 && (
        <ol className="mb-3 divide-y divide-line rounded-xl border border-line">
          {decisions.map((d, i) => (
            <li key={`${d}-${i}`} className="flex items-start gap-3 px-3 py-2.5">
              <span className="mt-0.5 w-4 shrink-0 text-[12px] tabular-nums text-muted">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 text-[13.5px] leading-relaxed">
                {d}
              </span>
              <button
                type="button"
                aria-label={`Remover decisão ${i + 1}`}
                onClick={() => draft.removeDecision(i)}
                className="text-muted hover:text-rose"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex gap-2">
        <input
          value={draft.decisionDraft}
          onChange={(e) => draft.setDecisionDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              draft.addDecision();
            }
          }}
          className={fieldClass}
          placeholder="O que ficou decidido"
          aria-label="Nova decisão"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={draft.addDecision}
          disabled={!draft.decisionDraft.trim()}
        >
          Adicionar
        </Button>
      </div>
    </fieldset>
  );
}
