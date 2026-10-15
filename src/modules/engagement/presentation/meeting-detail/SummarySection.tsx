"use client";
import { TextareaField } from "@g4ai/ds";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/shared/ui/primitives";
import type { Meeting } from "@/modules/engagement/domain/models";
import type { MeetingContent } from "./useMeetingDetail";

export function SummarySection({
  meeting,
  content,
}: {
  meeting: Meeting;
  content: MeetingContent;
}) {
  const [summaryDraft, setSummaryDraft] = useState<string | null>(null);
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium">Síntese</h2>
        {summaryDraft === null && (
          <button
            type="button"
            onClick={() => {
              content.begin();
              setSummaryDraft(meeting.summary);
            }}
            className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"
          >
            <Pencil className="h-3.5 w-3.5" /> Editar
          </button>
        )}
      </div>
      {summaryDraft === null ? (
        <p className="mt-2 max-w-3xl text-[14px] leading-7 text-ink-soft">
          {meeting.summary || "Sem síntese registrada."}
        </p>
      ) : (
        <div className="mt-2">
          <TextareaField
            label="Síntese"
            hideLabel
            value={summaryDraft}
            onChange={setSummaryDraft}
            minRows={3}
            className="mb-0!"
            autoFocus
          />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                void content.update(
                  { ...meeting, summary: summaryDraft.trim() },
                  undefined,
                  () => setSummaryDraft(null),
                );
              }}
            >
              Salvar síntese
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSummaryDraft(null)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
