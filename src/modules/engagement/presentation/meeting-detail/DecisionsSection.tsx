"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/primitives";
import { fieldClass } from "@/shared/ui/Drawer";
import { setDecisions } from "@/modules/engagement/domain/meetings";
import type { Meeting } from "@/modules/engagement/domain/models";
import type { MeetingContent } from "./useMeetingDetail";

export function DecisionsSection({
  meeting,
  content,
}: {
  meeting: Meeting;
  content: MeetingContent;
}) {
  const [decisionDraft, setDecisionDraft] = useState("");
  const add = () => {
    content.update(
      setDecisions(meeting, [...meeting.decisions, decisionDraft]),
      "Decisão registrada",
      () => setDecisionDraft(""),
    );
  };
  return (
    <section>
      <h2 className="text-[15px] font-medium">Decisões</h2>
      {meeting.decisions.length > 0 ? (
        <ol className="mt-3 overflow-hidden rounded-2xl border border-line">
          {meeting.decisions.map((d, i) => (
            <li
              key={`${d}-${i}`}
              className="flex gap-3 border-b border-line px-4 py-3 last:border-0"
            >
              <span className="mt-0.5 w-5 shrink-0 text-[12.5px] tabular-nums text-muted">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 text-input leading-relaxed">
                {d}
              </span>
              <button
                type="button"
                aria-label={`Remover decisão ${i + 1}`}
                onClick={() =>
                  content.update(
                    setDecisions(
                      meeting,
                      meeting.decisions.filter((_, j) => j !== i),
                    ),
                    "Decisão removida",
                  )
                }
                className="text-muted hover:text-rose"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-[13.5px] text-muted">
          Nenhuma decisão registrada. Anote o que ficou combinado.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <input
          value={decisionDraft}
          onChange={(e) => {
            content.begin();
            setDecisionDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && decisionDraft.trim()) {
              e.preventDefault();
              add();
            }
          }}
          className={fieldClass}
          placeholder="Registrar decisão"
          aria-label="Nova decisão"
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={!decisionDraft.trim()}
          onClick={add}
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar
        </Button>
      </div>
    </section>
  );
}
