"use client";
import { Bot } from "lucide-react";
import type { RefObject } from "react";
import type { Thread, ThreadMessage } from "@/modules/engagement/domain/models";
import type { InboxOperation } from "../useInboxOperation";
import { Bubble } from "./Bubble";
import { CallCard } from "./CallCard";
import { NoteCard } from "./NoteCard";
import { dayLabel } from "./helpers";

export function MessageStream({
  thread: t,
  tint,
  peopleOn,
  visible,
  meName,
  operation,
  editableIds,
  onEdit,
  endRef,
}: {
  thread: Thread;
  tint: string;
  peopleOn: string[];
  visible: ThreadMessage[];
  meName: string;
  operation: InboxOperation;
  editableIds: string[];
  onEdit: (
    noteId: string,
    patch: { at?: string; text?: string },
    confirmed: () => void,
  ) => void;
  endRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface px-5 py-6 sm:px-6">
      {t.bot && t.channel === "whatsapp" && (
        <div className="mb-5 flex items-start gap-2 rounded-2xl bg-surface px-4 py-3 text-[13px] leading-relaxed text-ink-soft ring-1 ring-line">
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          <span>
            Conversa demonstrativa de uma integração de WhatsApp. O que você
            escreve abaixo é nota interna no Ontology; a equipe vê, o cliente
            não.
          </span>
        </div>
      )}

      {visible.map((msg, i) => {
        const prev = visible[i - 1];
        const stamp = dayLabel(msg.at);
        const showDay = !prev || dayLabel(prev.at) !== stamp;
        return (
          <div key={msg.id ?? i}>
            {showDay && (
              <div className="mb-4 mt-2 flex items-center gap-3 text-[11px] font-medium tracking-wide text-muted">
                <span className="h-px flex-1 bg-line" />
                {stamp}
                <span className="h-px flex-1 bg-line" />
              </div>
            )}
            {msg.kind === "call" ? (
              <CallCard
                msg={msg}
                duration={t.durationMin}
                people={peopleOn}
                tint={tint}
              />
            ) : msg.kind === "note" || t.channel === "note" ? (
              <NoteCard
                operation={operation}
                msg={msg}
                tint={tint}
                meName={meName}
                onEdit={
                  msg.id && editableIds.includes(msg.id)
                    ? (patch, confirmed) => onEdit(msg.id!, patch, confirmed)
                    : undefined
                }
              />
            ) : (
              <Bubble msg={msg} tint={tint} meName={meName} />
            )}
          </div>
        );
      })}
      {visible.length === 0 && (
        <p className="py-12 text-center text-[13.5px] text-muted">
          Nada neste recorte.
        </p>
      )}
      <div ref={endRef} />
    </div>
  );
}
