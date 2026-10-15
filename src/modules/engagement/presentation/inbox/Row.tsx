"use client";
import { Bot, Pin, Radar } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { relativeFrom } from "@/shared/lib/format";
import { spaceTitle } from "@/modules/engagement/domain/threads";
import type { Thread } from "@/modules/engagement/domain/models";
import { mastersOn } from "./helpers";
import { Faces } from "./Faces";
import { KindIcon } from "./KindIcon";

export function Row({
  thread,
  on,
  onPick,
  pinned,
  signals = 0,
}: {
  thread: Thread;
  on: boolean;
  onPick: () => void;
  pinned?: boolean;
  signals?: number;
}) {
  const team = mastersOn(thread);
  return (
    <button
      onClick={onPick}
      className={cn(
        "flex w-full items-start gap-3 px-5 py-5 text-left",
        on ? "bg-soft" : "hover:bg-soft/50",
      )}
    >
      <KindIcon thread={thread} />
      <span className="min-w-0 flex-1">
        <span className="block">
          <span
            className={cn(
              "line-clamp-2 text-[13.5px] leading-snug",
              thread.unread > 0 ? "font-semibold" : "font-medium",
            )}
          >
            {spaceTitle(thread)}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] text-muted">
          {thread.preview}
        </span>
        <span className="mt-2.5 flex flex-wrap items-center gap-2.5">
          {pinned && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted">
              <Pin className="h-3 w-3" />
              fixada
            </span>
          )}
          {thread.bot && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted">
              <Bot className="h-3 w-3" />
              demonstração
            </span>
          )}
          {signals > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber">
              <Radar className="h-3 w-3" />
              {signals} {signals === 1 ? "sinal" : "sinais"}
            </span>
          )}
          {team.length > 0 && <Faces names={team} />}
          <span className="ml-auto whitespace-nowrap text-[11px] text-muted">
            {relativeFrom(thread.lastAt)}
          </span>
        </span>
      </span>
      {thread.unread > 0 && (
        <span className="mt-1 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose px-1.5 text-[10px] font-medium text-on-ink">
          {thread.unread}
        </span>
      )}
    </button>
  );
}
