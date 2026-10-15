"use client";
import { Checkbox } from "@/shared/ui/Checkbox";
import { DatePicker } from "@/shared/ui/DatePicker";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Avatar, Button } from "@/shared/ui/primitives";
import { fieldClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import { cn } from "@/shared/lib/cn";
import { NOW, formatDate } from "@/shared/lib/format";
import { toggleAction, upsertAction } from "@/modules/engagement/domain/meetings";
import { activeMeetingActions } from "@/modules/engagement/domain/meeting-lifecycle";
import type { ActionItem, Meeting } from "@/modules/engagement/domain/models";
import { MeetingActionTask } from "../MeetingActionTask";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import type { MeetingContent, MeetingPerson } from "./useMeetingDetail";

const plusDays = (days: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export function ActionsSection({
  meeting,
  content,
  attendee,
  owners,
  meId,
  tint,
  onRemoveAction,
}: {
  meeting: Meeting;
  content: MeetingContent;
  attendee: (id: string) => MeetingPerson;
  owners: MeetingPerson[];
  meId: string;
  tint?: string;
  onRemoveAction: (actionId: string | undefined) => void;
}) {
  const [actionDraft, setActionDraft] = useState<ActionItem | null>(null);
  const { can } = usePermissions();
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium">Ações combinadas</h2>
        {!actionDraft && (
          <button
            type="button"
            onClick={() => {
              content.begin();
              setActionDraft({
                id: `${meeting.id}-a-${Math.random().toString(36).slice(2, 8)}`,
                text: "",
                ownerId: meId,
                dueAt: plusDays(7),
              });
            }}
            className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"
          >
            <Plus className="h-3.5 w-3.5" /> Nova ação
          </button>
        )}
      </div>
      {activeMeetingActions(meeting).length > 0 ? (
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {activeMeetingActions(meeting).map((a) => {
            const owner = attendee(a.ownerId);
            return (
              <li key={a.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    label={`Concluir ${a.text}`}
                    checked={Boolean(a.done)}
                    onCheckedChange={() => content.update(toggleAction(meeting, a.id!), null)}
                    className="mt-0.5"
                  />
                  <p
                    className={cn(
                      "min-w-0 flex-1 text-[14px] font-medium leading-relaxed",
                      a.done && "text-muted line-through",
                    )}
                  >
                    {a.text}
                  </p>
                  {can("reunioes.agendar", meeting.company) && (
                    <button
                      type="button"
                      aria-label={`Remover ação ${a.text}`}
                      onClick={() => onRemoveAction(a.id)}
                      className="text-muted hover:text-rose"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 pl-7">
                  <span className="inline-flex min-w-0 items-center gap-3 text-[13px]">
                    <Avatar
                      initials={owner.initials}
                      tint={owner.org === "praxis" ? undefined : tint}
                      size="sm"
                    />
                    <span className="leading-snug">{owner.name}</span>
                    <span className="text-[12px] tabular-nums text-muted">
                      Prazo · {a.dueAt ? formatDate(a.dueAt) : "sem prazo"}
                    </span>
                  </span>
                  <MeetingActionTask meeting={meeting} action={a} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        !actionDraft && (
          <p className="mt-2 text-[13.5px] text-muted">
            Nenhuma ação combinada. Registre quem faz o quê e até quando.
          </p>
        )
      )}
      {actionDraft && (
        <div className="mt-3 space-y-2 rounded-2xl border border-dashed border-line p-3">
          <input
            value={actionDraft.text}
            onChange={(e) =>
              setActionDraft({ ...actionDraft, text: e.target.value })
            }
            className={fieldClass}
            placeholder="O que foi combinado"
            aria-label="Texto da ação"
            autoFocus
          />
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto_auto]">
            <Select
              label="Responsável pela ação"
              value={actionDraft.ownerId}
              onValueChange={(value) =>
                setActionDraft({ ...actionDraft, ownerId: value })
              }
              options={owners.map((p) => ({
                value: p.id,
                label: p.name,
                description: p.role,
              }))}
            />
            <DatePicker
              label="Prazo da ação"
              value={actionDraft.dueAt}
              onValueChange={(next) =>
                setActionDraft({ ...actionDraft, dueAt: next })
              }
              className={fieldClass}
            />
            <Button
              size="sm"
              disabled={!actionDraft.text.trim()}
              onClick={() => {
                content.update(
                  upsertAction(meeting, {
                    ...actionDraft,
                    text: actionDraft.text.trim(),
                  }),
                  "Ação registrada",
                  () => setActionDraft(null),
                );
              }}
            >
              Adicionar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setActionDraft(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
