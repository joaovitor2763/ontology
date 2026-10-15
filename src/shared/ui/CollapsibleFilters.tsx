"use client";

import { Button, SearchInput, Sheet } from "@g4ai/ds";
import { RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

/** Filtro aplicado, mostrado como chip removível no celular. */
export type ActiveFilter = { key: string; label: string; onRemove: () => void };

/**
 * Barra de busca e filtros de uma lista no padrão do `FilterBar` do G4OS-DS,
 * para listas cujo estado vive em `useState` próprio (visões salvas, URL):
 * a partir de 640px os filtros ficam em linha; abaixo, sobra a busca e um
 * botão "Filtros (N)" que abre os mesmos controles numa folha inferior, com os
 * filtros ativos como chips removíveis. Os dois lugares leem e gravam o mesmo
 * estado, então visões salvas e endereço não mudam.
 *
 * Candidato a `src/shared/ui` quando outras áreas adotarem o padrão.
 */
export function CollapsibleFilters({
  query,
  onQuery,
  placeholder = "Buscar…",
  showSearch = true,
  showCount = true,
  active,
  onClear,
  shown,
  total,
  noun = "resultado",
  nounPlural,
  children,
  sheet,
  label = "Busca e filtros",
  className,
}: {
  query: string;
  onQuery: (value: string) => void;
  placeholder?: string;
  showSearch?: boolean;
  /** Falso quando a tela já mostra a contagem em outro lugar. */
  showCount?: boolean;
  /** Filtros aplicados (sem a busca): viram contagem e chips no celular. */
  active: ActiveFilter[];
  /** Limpa busca e filtros. */
  onClear: () => void;
  shown: number;
  total: number;
  noun?: string;
  nounPlural?: string;
  /** Controles de filtro em linha (FacetFilter, Combobox, Select, Switch…). */
  children: ReactNode;
  /**
   * Os mesmos filtros para a folha do celular, com rótulo visível e sem
   * popups próprios (CheckboxGroup, MultiSelect, Combobox, DatePicker). Sem
   * ele, a folha empilha `children`.
   */
  sheet?: ReactNode;
  label?: string;
  className?: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const plural = nounPlural ?? `${noun}s`;
  const count =
    shown === total
      ? `${total} ${total === 1 ? noun : plural}`
      : `${shown} de ${total} ${total === 1 ? noun : plural}`;
  const dirty = active.length > 0 || Boolean(query.trim());
  return (
    <div role="search" aria-label={label} className={cn("space-y-2.5", className)}>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {showSearch && (
          <SearchInput
            value={query}
            onChange={onQuery}
            placeholder={placeholder}
            className="min-w-0 flex-1 sm:min-w-[220px] sm:max-w-[360px]"
          />
        )}
        <div className="hidden sm:contents">{children}</div>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className={cn(
            "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-surface px-3 text-label ring-1 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:hidden",
            active.length ? "font-medium text-ink ring-line-strong" : "text-ink-soft ring-line",
          )}
        >
          <SlidersHorizontal aria-hidden className="h-3.5 w-3.5" />
          Filtros
          {active.length > 0 && (
            <span className="rounded-md bg-primary px-1.5 text-meta font-medium text-on-primary">
              {active.length}
            </span>
          )}
        </button>
        {dirty && (
          <button
            type="button"
            onClick={onClear}
            className="hidden h-10 items-center gap-1 rounded-lg px-2.5 text-control text-muted hover:bg-soft hover:text-ink sm:inline-flex"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
            Limpar
          </button>
        )}
        {showCount && (
          <span aria-live="polite" className={cn("ml-auto whitespace-nowrap text-caption tabular-nums text-muted", showSearch && "hidden sm:inline")}>
            {count}
          </span>
        )}
      </div>
      {((showSearch && showCount) || dirty) && <div className="flex flex-wrap items-center gap-1.5 sm:hidden">
        {active.length > 0 && (
          <ul aria-label="Filtros ativos" className="contents">
            {active.map((filter) => (
              <li key={filter.key} className="inline-flex h-8 max-w-full items-center overflow-hidden rounded-lg bg-surface text-label ring-1 ring-line-strong">
                <span className="min-w-0 truncate pl-2.5 pr-1">{filter.label}</span>
                <button
                  type="button"
                  aria-label={`Remover filtro ${filter.label}`}
                  onClick={filter.onRemove}
                  className="inline-flex h-full w-7 shrink-0 items-center justify-center text-muted hover:bg-soft hover:text-ink"
                >
                  <X aria-hidden className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {dirty && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-label text-muted hover:bg-soft hover:text-ink"
          >
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
            Limpar tudo
          </button>
        )}
        {showSearch && showCount && (
          <span aria-live="polite" className="ml-auto whitespace-nowrap text-caption tabular-nums text-muted">
            {count}
          </span>
        )}
      </div>}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Filtros"
        footer={
          <>
            {active.length > 0 && (
              <Button variant="ghost" size="sm" onClick={onClear}>
                Limpar filtros
              </Button>
            )}
            <Button size="sm" onClick={() => setSheetOpen(false)}>
              {shown === 1 ? `Ver 1 ${noun}` : `Ver ${shown} ${plural}`}
            </Button>
          </>
        }
      >
        {sheet ? (
          <div className="space-y-5">{sheet}</div>
        ) : (
          <div className="flex flex-col items-stretch gap-3 [&>*]:w-full [&>*]:max-w-none">
            {children}
          </div>
        )}
      </Sheet>
    </div>
  );
}
