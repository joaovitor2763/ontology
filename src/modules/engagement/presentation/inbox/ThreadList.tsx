"use client";
import Link from "next/link";
import { Bot, Radar, Search } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { paths } from "@/shared/lib/routes";
import { Button, Empty } from "@/shared/ui/primitives";
import type { Thread } from "@/modules/engagement/domain/models";
import { Row } from "./Row";
import { FILTERS, type Filter } from "./useInboxFilters";

export function ThreadList({
  company,
  demo,
  onLeaveDemo,
  q,
  onSearch,
  ch,
  onFilter,
  grouped,
  empty,
  onClear,
  clientName,
  openSignalsOf,
  signalsOf,
  currentId,
  pinned,
  onPick,
}: {
  company?: string;
  demo: boolean;
  onLeaveDemo: () => void;
  q: string;
  onSearch: (value: string) => void;
  ch: Filter;
  onFilter: (value: Filter) => void;
  grouped: { slug: string; items: Thread[] }[];
  empty: boolean;
  onClear: () => void;
  clientName: (slug: string) => string | undefined;
  openSignalsOf: (slug: string) => number;
  signalsOf: (threadId: string) => number;
  currentId?: string;
  pinned: Set<string>;
  onPick: (threadId: string) => void;
}) {
  return (
    <>
      {company && demo && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-amber-soft/50 px-5 py-2 text-[12px] text-amber">
          <span className="inline-flex items-center gap-1.5">
            <Bot className="h-3.5 w-3.5" /> Conversa demonstrativa
          </span>
          <button
            type="button"
            onClick={onLeaveDemo}
            className="font-medium hover:underline"
          >
            Sair
          </button>
        </div>
      )}
      <div className="shrink-0 space-y-3 px-5 py-5">
        <div className="flex items-center gap-2">
          <div className="focus-field flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted" />
            <input
              aria-label="Buscar conversas e notas"
              value={q}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Buscar"
              className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted"
            />
          </div>
        </div>
        <div className="-mx-1 flex gap-0.5 overflow-x-auto px-1 text-[12.5px] whitespace-nowrap">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              aria-pressed={ch === f.id}
              onClick={() => onFilter(f.id)}
              className={cn(
                "shrink-0 rounded-lg px-1.5 py-1.5",
                ch === f.id
                  ? "bg-soft font-medium text-ink ring-1 ring-line"
                  : "text-muted hover:bg-soft",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {grouped.map((g) => {
          const name = clientName(g.slug);
          const openSignals = openSignalsOf(g.slug);
          return (
            <div key={g.slug}>
              {!company && name && (
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-surface px-5 py-4 text-[11px] font-medium tracking-wide text-muted">
                  <span>{name}</span>
                  {openSignals > 0 && (
                    <Link
                      href={`${paths.clientConversations(g.slug)}?visao=sinais`}
                      className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-amber hover:underline"
                    >
                      <Radar className="h-3 w-3" />
                      {openSignals}{" "}
                      {openSignals === 1 ? "sinal aberto" : "sinais abertos"}
                    </Link>
                  )}
                </div>
              )}
              {g.items.map((thread) => (
                <Row
                  key={thread.id}
                  thread={thread}
                  on={currentId === thread.id}
                  onPick={() => onPick(thread.id)}
                  pinned={pinned.has(thread.id)}
                  signals={signalsOf(thread.id)}
                />
              ))}
            </div>
          );
        })}
        {empty && (
          <div className="p-3">
            <Empty
              title="Nenhuma conversa encontrada"
              hint="Tente outro nome ou remova os filtros."
              action={
                <Button variant="ghost" size="sm" onClick={onClear}>
                  Limpar filtros
                </Button>
              }
            />
          </div>
        )}
      </div>
    </>
  );
}
