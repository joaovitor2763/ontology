"use client";
import Link from "next/link";
import { Columns3, Search, X } from "lucide-react";
import { paths } from "@/shared/lib/routes";
import type { Filter } from "./shared";

export function MilestoneTasksHeader({
  companySlug,
  open,
  cyclesCount,
  itemsCount,
  countOf,
  filter,
  setFilter,
  query,
  setQuery,
}: {
  companySlug: string;
  open: number;
  cyclesCount: number;
  itemsCount: number;
  countOf: (value: Filter) => number;
  filter: Filter;
  setFilter: (value: Filter) => void;
  query: string;
  setQuery: (value: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-[13px] font-medium">
        Ciclos e tarefas
        <span className="text-[11px] font-normal text-muted">
          {cyclesCount} {cyclesCount === 1 ? "ciclo" : "ciclos"} · {itemsCount}{" "}
          {itemsCount === 1 ? "tarefa" : "tarefas"}
        </span>
      </h3>
      <div className="flex max-w-full flex-wrap items-center gap-2 overflow-x-auto">
        {itemsCount >= 8 && (
          <div
            role="group"
            aria-label="Filtrar tarefas"
            className="segmented-control"
          >
            {(
              [
                ["all", "Todas"],
                ["pending", "Pendentes"],
                ["blocked", "Bloqueadas"],
                ["done", "Concluídas"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
                <span className="ml-1 text-[10px] opacity-60">
                  {countOf(value)}
                </span>
              </button>
            ))}
          </div>
        )}
        {itemsCount >= 12 && (
          <label className="focus-field flex items-center gap-2 rounded-lg border border-line px-2.5">
            <Search className="h-3.5 w-3.5 text-muted" />
            <input
              aria-label="Buscar tarefa no marco"
              placeholder="Buscar…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 w-[140px] min-w-0 bg-transparent text-[12px] outline-none"
            />
            {query && (
              <button
                type="button"
                aria-label="Limpar busca de tarefas"
                onClick={() => setQuery("")}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </label>
        )}
        {itemsCount > 0 && (
          <Link
            href={paths.clientDeliveries(companySlug, undefined, open)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] text-muted hover:bg-soft hover:text-ink"
            title="Abrir estas tarefas no quadro, na seção Tarefas"
          >
            <Columns3 className="h-3.5 w-3.5" />
            Ver no quadro
          </Link>
        )}
      </div>
    </div>
  );
}
