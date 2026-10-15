"use client";
import { useMemo, useState } from "react";
import type { Channel, Thread, ThreadMessage } from "@/modules/engagement/domain/models";
import { latestNote } from "@/modules/engagement/domain/threads";
import { threadUnread } from "../../infrastructure/relationship-state";
import { mastersOn } from "./helpers";

export type Filter = Channel | "all" | "unread";

export const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Tudo" },
  { id: "unread", label: "Não lidas" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "call", label: "Calls" },
  { id: "note", label: "Notas" },
];

/** Search, channel and ownership of the conversation list, plus what survives them. */
export function useInboxFilters({
  threads,
  spaces,
  inbox,
  drafts,
  company,
  isMine,
}: {
  threads: Thread[];
  spaces: Thread[];
  inbox: { read: string[]; unread: string[]; pinned: string[] };
  drafts: Record<string, ThreadMessage[]>;
  company?: string;
  isMine: (name: string) => boolean;
}) {
  const [ch, setCh] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);

  const pinned = new Set(inbox.pinned);
  const all = [...spaces, ...threads]
    .filter((thread) => thread.kind !== "notes")
    .map((thread) => ({
      ...thread,
      unread: threadUnread(thread, inbox),
      preview: latestNote(drafts[thread.id])?.text ?? thread.preview,
      lastAt: latestNote(drafts[thread.id])?.at ?? thread.lastAt,
    }))
    .sort(
      (a, b) =>
        Number(pinned.has(b.id)) - Number(pinned.has(a.id)) ||
        b.lastAt.localeCompare(a.lastAt),
    );

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((t) => {
      if (ch === "unread" && t.unread === 0) return false;
      if (ch !== "all" && ch !== "unread" && t.channel !== ch) return false;
      if (mine && !mastersOn(t).some((n) => isMine(n))) return false;
      if (needle) {
        const hay = [
          t.counterpart,
          t.title,
          t.preview,
          ...t.messages.map((m) => m.text),
          ...(drafts[t.id] ?? []).map((m) => m.text),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [all, ch, q, mine, drafts, isMine]);

  const grouped = useMemo(() => {
    if (company) return [{ slug: company, items: list }];
    const map = new Map<string, Thread[]>();
    list.forEach((t) => map.set(t.company, [...(map.get(t.company) ?? []), t]));
    return [...map.entries()].map(([slug, items]) => ({ slug, items }));
  }, [list, company]);

  return {
    ch,
    setCh,
    q,
    setQ,
    mine,
    setMine,
    pinned,
    list,
    grouped,
    clear: () => {
      setQ("");
      setCh("all");
      setMine(false);
    },
  };
}
