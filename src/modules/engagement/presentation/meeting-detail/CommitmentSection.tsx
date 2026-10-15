"use client";
import { Checkbox } from "@/shared/ui/Checkbox";
import type { Meeting } from "@/modules/engagement/domain/models";
import type { MeetingContent } from "./useMeetingDetail";

export function CommitmentSection({
  meeting,
  content,
}: {
  meeting: Meeting;
  content: MeetingContent;
}) {
  return (
    <section aria-label="Compromisso do cliente">
      <h2 className="text-[15px] font-medium">Compromisso do cliente</h2>
      <div className="mt-3 rounded-2xl border border-line px-4 py-3">
        <Checkbox
          label="Acordo e compromisso obtidos"
          hideLabel={false}
          description="Peça acordo e compromisso antes de encerrar: recomendação reforçada, próximos passos específicos e quem faz o quê."
          checked={Boolean(meeting.commitmentObtained)}
          onCheckedChange={(checked) =>
            content.update(
              { ...meeting, commitmentObtained: checked },
              checked
                ? "Compromisso registrado"
                : "Compromisso desmarcado",
            )
          }
        />
      </div>
    </section>
  );
}
