"use client";
import { Checkbox } from "@/shared/ui/Checkbox";
import { CheckCircle2, FlaskConical, Pencil } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { meetingFormatLabel } from "@/modules/engagement/domain/meetings";
import type { Hypothesis, Meeting } from "@/modules/engagement/domain/models";

type PrepItem = { id: string; label: string; done: boolean };

export function PrepPanel({
  meeting,
  items,
  done,
  upcoming,
  hypotheses,
  onToggle,
  onEdit,
}: {
  meeting: Meeting;
  items: PrepItem[];
  done: number;
  upcoming: boolean;
  hypotheses: Hypothesis[];
  onToggle: (id: string) => void;
  onEdit: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="text-[12px] uppercase tracking-wide text-muted">
          Preparação
        </div>
        <span
          className={cn(
            "text-[12.5px] tabular-nums",
            done === items.length ? "text-ok" : "text-muted",
          )}
        >
          {done}/{items.length}
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map((item) => {
          const toggleable = ["homework", "preread", "rehearsal"].includes(
            item.id,
          );
          return (
            <li key={item.id}>
              <Checkbox
                label={item.label}
                hideLabel={false}
                checked={item.done}
                disabled={!toggleable}
                onCheckedChange={() => onToggle(item.id)}
              />
            </li>
          );
        })}
      </ul>
      {meeting.kind === "apresentacao" &&
        (meeting.prep?.purpose || meeting.prep?.format) && (
          <dl className="mt-4 space-y-2 border-t border-line pt-3 text-[12.5px]">
            {meeting.prep?.purpose && (
              <div>
                <dt className="text-muted">Propósito</dt>
                <dd className="text-ink-soft">{meeting.prep.purpose}</dd>
              </div>
            )}
            {meeting.prep?.importance && (
              <div>
                <dt className="text-muted">Importância</dt>
                <dd className="text-ink-soft">{meeting.prep.importance}</dd>
              </div>
            )}
            {meeting.prep?.preview && (
              <div>
                <dt className="text-muted">Prévia</dt>
                <dd className="text-ink-soft">{meeting.prep.preview}</dd>
              </div>
            )}
            {meeting.prep?.format && (
              <div>
                <dt className="text-muted">Formato</dt>
                <dd className="text-ink-soft">
                  {meetingFormatLabel[meeting.prep.format]}
                </dd>
              </div>
            )}
            {meeting.prep?.speakers && (
              <div>
                <dt className="text-muted">Quem fala o quê</dt>
                <dd className="whitespace-pre-line text-ink-soft">
                  {meeting.prep.speakers}
                </dd>
              </div>
            )}
          </dl>
        )}
      {meeting.kind === "entrevista" &&
        (hypotheses.length > 0 || meeting.prep?.questions) && (
          <div className="mt-4 space-y-3 border-t border-line pt-3 text-[12.5px]">
            {hypotheses.length > 0 && (
              <div>
                <div className="text-muted">Hipóteses a testar</div>
                <ul className="mt-1 space-y-1">
                  {hypotheses.map((h) => (
                    <li
                      key={h.id}
                      className="flex items-start gap-1.5 text-ink-soft"
                    >
                      <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
                      {h.statement}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {meeting.prep?.questions && (
              <div>
                <div className="text-muted">Perguntas planejadas</div>
                <p className="mt-1 whitespace-pre-line text-ink-soft">
                  {meeting.prep.questions}
                </p>
              </div>
            )}
          </div>
        )}
      {upcoming && done < items.length && (
        <button
          type="button"
          onClick={onEdit}
          className="mt-3 inline-flex items-center gap-1 text-[12.5px] text-blue hover:underline"
        >
          <Pencil className="h-3.5 w-3.5" /> Completar preparação
        </button>
      )}
      {!upcoming && done === items.length && (
        <p className="mt-3 inline-flex items-center gap-1 text-[12.5px] text-ok">
          <CheckCircle2 className="h-3.5 w-3.5" /> Preparação completa
        </p>
      )}
    </div>
  );
}
