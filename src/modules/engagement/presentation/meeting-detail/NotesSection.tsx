"use client";
import { TextareaField } from "@g4ai/ds";
import { useState } from "react";
import { Button } from "@/shared/ui/primitives";
import type { Meeting } from "@/modules/engagement/domain/models";
import type { MeetingContent } from "./useMeetingDetail";

export function NotesSection({
  meeting,
  content,
  notes,
}: {
  meeting: Meeting;
  content: MeetingContent;
  notes: Record<string, string>;
}) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [saved, setSaved] = useState(false);
  const draft =
    editing?.id === meeting.id
      ? editing.text
      : (notes[meeting.id] ?? meeting.notes ?? "");
  const setDraft = (text: string) => {
    content.begin();
    setEditing({ id: meeting.id, text });
  };
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium">Notas da reunião</h2>
        {saved && (
          <span className="text-[12.5px] text-blue">Gravação confirmada</span>
        )}
      </div>
      <TextareaField
        label="Notas da reunião"
        hideLabel
        value={draft}
        onChange={setDraft}
        minRows={7}
        maxRows={24}
        className="mt-3 mb-0!"
      />
      <div className="mt-3">
        <Button
          size="sm"
          onClick={() => {
            void content.update(
              { ...meeting, notes: draft },
              null,
              () => {
                setSaved(true);
                window.setTimeout(() => setSaved(false), 2000);
              },
              { notes: draft },
            );
          }}
        >
          Salvar notas
        </Button>
      </div>
    </section>
  );
}
