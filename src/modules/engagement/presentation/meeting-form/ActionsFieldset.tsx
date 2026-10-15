"use client";
import { DatePicker } from "@/shared/ui/DatePicker";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { paths } from "@/shared/lib/routes";
import { fieldClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import { Button } from "@/shared/ui/primitives";
import type { MeetingDraft } from "./useMeetingDraft";

export function ActionsFieldset({
  draft,
  onClose,
}: {
  draft: MeetingDraft;
  onClose: () => void;
}) {
  const { actions, actionDraft, meeting, ownerName } = draft;
  return (
    <fieldset className="mb-2">
      <legend className="mb-2 text-[13px] font-medium">Ações combinadas</legend>
      <p className="mb-3 text-[12px] text-muted">
        Cada ação pode virar uma tarefa do cliente depois de registrada.
      </p>
      {actions.length > 0 && (
        <ul className="mb-3 divide-y divide-line rounded-xl border border-line">
          {actions
            .filter((a) => !a.removedAt)
            .map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] leading-relaxed">
                    {a.text}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted">
                    {ownerName(a.ownerId)} · {a.dueAt || "sem prazo"}
                    {a.deliveryId ? " · tarefa criada" : ""}
                  </span>
                </span>
                {!meeting?.actions.some((saved) => saved.id === a.id) && (
                  <button
                    type="button"
                    aria-label={`Remover ação ${a.text}`}
                    onClick={() => draft.removeAction(a.id!)}
                    className="text-muted hover:text-rose"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
        </ul>
      )}
      {meeting && (
        <p className="mb-3 text-xs text-muted">
          Para remover ou restaurar ações registradas,{" "}
          <Link
            className="text-blue"
            href={paths.meeting(meeting.id)}
            onClick={onClose}
          >
            abra a reunião
          </Link>
          .
        </p>
      )}
      <div className="space-y-2 rounded-xl border border-dashed border-line p-3">
        <input
          value={actionDraft.text}
          onChange={(e) =>
            draft.setActionDraft({ ...actionDraft, text: e.target.value })
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              draft.addAction();
            }
          }}
          className={fieldClass}
          placeholder="O que foi combinado"
          aria-label="Nova ação"
        />
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
          <Select
            label="Responsável pela ação"
            value={actionDraft.ownerId}
            onValueChange={(value) =>
              draft.setActionDraft({ ...actionDraft, ownerId: value })
            }
            options={draft.attendees.map((p) => ({
              value: p.id,
              label: p.name,
              description: p.role,
            }))}
          />
          <DatePicker
            label="Prazo da ação"
            value={actionDraft.dueAt}
            onValueChange={(next) =>
              draft.setActionDraft({ ...actionDraft, dueAt: next })
            }
            className={fieldClass}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={draft.addAction}
            disabled={!actionDraft.text.trim()}
          >
            Adicionar
          </Button>
        </div>
      </div>
    </fieldset>
  );
}
