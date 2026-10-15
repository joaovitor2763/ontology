"use client";
import { TextareaField } from "@g4ai/ds";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/shared/ui/primitives";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import {
  interviewSummaryLabel,
  receptivenessLabel,
} from "@/modules/engagement/domain/meetings";
import type { InterviewSummaryField } from "@/modules/engagement/domain/meetings";
import type {
  Meeting,
  Receptiveness,
} from "@/modules/engagement/domain/models";
import type { MeetingContent } from "./useMeetingDetail";

export function InterviewSummarySection({
  meeting,
  content,
  summaryMissing,
}: {
  meeting: Meeting;
  content: MeetingContent;
  summaryMissing: InterviewSummaryField[];
}) {
  const [interviewDraft, setInterviewDraft] = useState<{
    learnings: string;
    implications: string;
  } | null>(null);
  return (
    <section aria-label="Resumo da entrevista">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium">Resumo da entrevista</h2>
        {interviewDraft === null ? (
          <button
            type="button"
            onClick={() => {
              content.begin();
              setInterviewDraft({
                learnings: meeting.learnings ?? "",
                implications: meeting.implications ?? "",
              });
            }}
            className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"
          >
            <Pencil className="h-3.5 w-3.5" /> Editar
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-[12.5px] text-muted">
        Não é transcrição: o que você aprendeu, o que isso muda e como a pessoa
        nos recebeu.
        {summaryMissing.length > 0 &&
          ` Falta: ${summaryMissing.map((f) => interviewSummaryLabel[f].toLowerCase()).join(", ")}.`}
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-[12px] uppercase tracking-wide text-muted">
            Aprendizados-chave
          </h3>
          {interviewDraft ? (
            <TextareaField
              label="Aprendizados-chave"
              hideLabel
              value={interviewDraft.learnings}
              onChange={(value) =>
                setInterviewDraft({
                  ...interviewDraft,
                  learnings: value,
                })
              }
              minRows={5}
              className="mt-2 mb-0!"
              placeholder="3 a 5 pontos: o que importa e como se relaciona com as hipóteses."
              autoFocus
            />
          ) : (
            <p className="mt-2 whitespace-pre-line text-[14px] leading-7 text-ink-soft">
              {meeting.learnings?.trim() || "Ainda não registrado."}
            </p>
          )}
        </div>
        <div>
          <h3 className="text-[12px] uppercase tracking-wide text-muted">
            Implicações
          </h3>
          {interviewDraft ? (
            <TextareaField
              label="Implicações"
              hideLabel
              value={interviewDraft.implications}
              onChange={(value) =>
                setInterviewDraft({
                  ...interviewDraft,
                  implications: value,
                })
              }
              minRows={5}
              className="mt-2 mb-0!"
              placeholder="O que investigar a seguir e quem mais ouvir."
            />
          ) : (
            <p className="mt-2 whitespace-pre-line text-[14px] leading-7 text-ink-soft">
              {meeting.implications?.trim() || "Ainda não registrado."}
            </p>
          )}
        </div>
      </div>
      {interviewDraft && (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              content.update(
                {
                  ...meeting,
                  learnings: interviewDraft.learnings.trim(),
                  implications: interviewDraft.implications.trim(),
                },
                "Resumo da entrevista salvo",
                () => setInterviewDraft(null),
              );
            }}
          >
            Salvar resumo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setInterviewDraft(null)}
          >
            Cancelar
          </Button>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-[12px] uppercase tracking-wide text-muted">
          Receptividade
        </span>
        <SegmentedControl<Receptiveness | "">
          label="Receptividade do entrevistado"
          value={meeting.receptiveness ?? ""}
          onChange={(value) =>
            content.update(
              { ...meeting, receptiveness: value || undefined },
              "Receptividade registrada",
            )
          }
          options={(Object.keys(receptivenessLabel) as Receptiveness[]).map(
            (id) => ({ value: id, label: receptivenessLabel[id] }),
          )}
        />
        <span className="text-[12px] text-muted">
          Aliado ou cético: isso vale ouro na hora de construir apoio.
        </span>
      </div>
    </section>
  );
}
