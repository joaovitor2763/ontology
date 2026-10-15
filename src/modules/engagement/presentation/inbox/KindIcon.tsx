"use client";
import { MessageCircle, Phone, StickyNote } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { channelLabel } from "@/shared/lib/format";
import type { Thread } from "@/modules/engagement/domain/models";

export function KindIcon({ thread }: { thread: Thread }) {
  const base =
    "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full";
  const cls = cn(base, "bg-soft text-ink-soft");
  if (thread.channel === "call")
    return (
      <span className={cls}>
        <Phone className="h-3.5 w-3.5" />
      </span>
    );
  if (thread.channel === "note")
    return (
      <span className={cls}>
        <StickyNote className="h-3.5 w-3.5" />
      </span>
    );
  return (
    <span className={cn(base, "bg-ok-soft text-ok")}>
      <MessageCircle className="h-3.5 w-3.5" />
    </span>
  );
}

export function KindChip({ thread }: { thread: Thread }) {
  return (
    <span className="inline-flex items-center rounded-full bg-soft px-2 py-0.5 text-[11.5px] text-ink-soft">
      {channelLabel[thread.channel]}
    </span>
  );
}
