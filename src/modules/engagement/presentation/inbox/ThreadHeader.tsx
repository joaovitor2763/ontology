"use client";
import { Bot, Building2, LayoutTemplate, MailOpen, Pin, PinOff } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { spaceTitle } from "@/modules/engagement/domain/threads";
import type { Thread } from "@/modules/engagement/domain/models";
import { MeetingForm } from "../MeetingForm";
import type { InboxOperation } from "../useInboxOperation";
import { Faces } from "./Faces";
import { KindChip } from "./KindIcon";

export function ThreadHeader({
  thread: t,
  tint,
  peopleOn,
  team,
  mine,
  onToggleMine,
  pinned,
  onTogglePin,
  onMarkUnread,
  onOpenClient,
  onOpenTemplates,
  operation,
}: {
  thread: Thread;
  tint: string;
  peopleOn: string[];
  team: string[];
  mine: boolean;
  onToggleMine: () => void;
  pinned: boolean;
  onTogglePin: () => void;
  onMarkUnread: () => void;
  onOpenClient: () => void;
  onOpenTemplates: () => void;
  operation: InboxOperation;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-line px-4 py-4 sm:px-5">
      <div className="min-w-0 basis-full 2xl:basis-auto">
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-words text-[16px] font-semibold leading-snug tracking-tight">
            {spaceTitle(t)}
          </span>
          <KindChip thread={t} />
          {t.bot && (
            <span className="inline-flex items-center gap-1 rounded-full bg-soft px-2 py-0.5 text-[11px] text-muted ring-1 ring-line">
              <Bot className="h-3 w-3" />
              Integração de WhatsApp (demonstração)
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] leading-relaxed text-muted">
          <Faces names={peopleOn} tint={tint} />
          <span className="truncate">
            {t.kind === "call"
              ? `${t.durationMin ?? 0} min · ${peopleOn.length} na call`
              : `${peopleOn.length} no espaço`}
          </span>
          {team.length > 0 && (
            <span className="basis-full text-ink-soft xl:basis-auto">
              Equipe: {team.map((n) => n.split(" ")[0]).join(", ")}
            </span>
          )}
        </div>
      </div>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2.5 2xl:w-auto">
        <button
          type="button"
          onClick={onToggleMine}
          className={cn(
            "inline-flex h-8 items-center rounded-full px-3 text-[13px] ring-1 ring-line",
            mine ? "bg-ink text-on-ink ring-ink" : "hover:bg-soft",
          )}
        >
          {mine ? "Minhas mensagens" : "Todas as mensagens"}
        </button>
        <button
          type="button"
          disabled={operation.busy || operation.pending}
          onClick={onTogglePin}
          aria-pressed={pinned}
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] ring-1 ring-line hover:bg-soft"
        >
          {pinned ? (
            <PinOff className="h-3.5 w-3.5" />
          ) : (
            <Pin className="h-3.5 w-3.5" />
          )}
          {pinned ? "Desafixar" : "Fixar"}
        </button>
        <button
          type="button"
          disabled={operation.busy || operation.pending}
          onClick={onMarkUnread}
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] ring-1 ring-line hover:bg-soft"
        >
          <MailOpen className="h-3.5 w-3.5" />
          Marcar como não lida
        </button>
        <button
          type="button"
          onClick={onOpenClient}
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] ring-1 ring-line hover:bg-soft"
        >
          <Building2 className="h-3.5 w-3.5" />
          Cliente
        </button>
        <button
          type="button"
          onClick={onOpenTemplates}
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] ring-1 ring-line hover:bg-soft"
        >
          <LayoutTemplate className="h-3.5 w-3.5" />
          Usar modelo
        </button>
        <MeetingForm defaultCompany={t.company} />
      </div>
    </header>
  );
}
