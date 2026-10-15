"use client";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";
import { Avatar } from "@/shared/ui/primitives";
import { Attachs } from "../NoteAttachments";
import type { ThreadMessage } from "@/modules/engagement/domain/models";
import { initials, isPraxis } from "./helpers";

export function Bubble({
  msg,
  tint,
  meName,
}: {
  msg: ThreadMessage;
  tint: string;
  meName: string;
}) {
  const mine = msg.from.startsWith(meName);
  const praxis = isPraxis(msg.from);
  return (
    <div
      className={cn("mb-5 flex items-start gap-3", mine && "flex-row-reverse")}
    >
      <Avatar
        initials={initials(msg.from)}
        tint={mine || praxis ? undefined : tint}
        size="sm"
      />
      <div
        className={cn(
          "min-w-0 max-w-[calc(100%-2.5rem)] sm:max-w-[80%] xl:max-w-[72%]",
          mine && "text-right",
        )}
      >
        <div
          className={cn(
            "mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11.5px] leading-relaxed text-muted",
            mine && "justify-end",
          )}
        >
          <span className="font-medium text-ink-soft">{msg.from}</span>
          {praxis && !mine && <span>Equipe</span>}
          {msg.source === "bot" && <span>bot</span>}
          <time className="whitespace-nowrap" dateTime={msg.at}>
            {formatDateTime(msg.at)}
          </time>
        </div>
        <div
          className={cn(
            "inline-block max-w-full break-words rounded-2xl px-4 py-3 text-left text-[14px] leading-relaxed",
            mine
              ? "bg-ink text-on-ink"
              : praxis
                ? "bg-surface text-ink ring-1 ring-line"
                : "bg-surface text-ink ring-1 ring-line",
          )}
        >
          {msg.text}
        </div>
        <Attachs
          files={msg.attachments}
          docs={msg.files}
          align={mine ? "right" : "left"}
        />
      </div>
    </div>
  );
}
