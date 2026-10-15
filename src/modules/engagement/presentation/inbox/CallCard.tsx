"use client";
import { Phone } from "lucide-react";
import { formatDateTime } from "@/shared/lib/format";
import { Attachs } from "../NoteAttachments";
import type { ThreadMessage } from "@/modules/engagement/domain/models";
import { Faces } from "./Faces";

export function CallCard({
  msg,
  duration,
  people,
  tint,
}: {
  msg: ThreadMessage;
  duration?: number;
  people: string[];
  tint: string;
}) {
  return (
    <article className="mb-4 rounded-2xl bg-surface p-4 ring-1 ring-line">
      <div className="flex items-center gap-2 text-[12.5px] text-muted">
        <Phone className="h-3.5 w-3.5" />
        Call · {duration ?? 0} min · {formatDateTime(msg.at)}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Faces names={people} tint={tint} />
        <span className="text-[12.5px] text-muted">{people.join(" · ")}</span>
      </div>
      <p className="mt-3 text-input leading-relaxed text-ink-soft">
        {msg.text}
      </p>
      <Attachs files={msg.attachments} docs={msg.files} />
      <div className="mt-3 text-[12px] text-muted">Nota da call · {msg.from}</div>
    </article>
  );
}
