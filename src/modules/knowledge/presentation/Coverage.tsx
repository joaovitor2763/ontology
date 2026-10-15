"use client";
import { cn } from "@/shared/lib/cn";
import { coverageBand, coverageCopy } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/primitives";
import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function CoverageBadge({
  value,
  withHint,
  withLegend,
}: {
  value: number;
  withHint?: boolean;
  /** Adds an info button that opens the legend in a small popover. */
  withLegend?: boolean;
}) {
  const band = coverageBand(value);
  const copy = coverageCopy[band];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex shrink-0 items-center gap-2">
      <Badge tone={copy.tone}>{copy.label}</Badge>
      <span
        className={cn(
          "tabular-nums text-[12.5px]",
          band === "fraca"
            ? "text-rose"
            : band === "parcial"
              ? "text-amber"
              : "text-ink-soft",
        )}
      >
        {value}%
      </span>
      {withHint && <span className="text-[12px] text-muted">{copy.hint}</span>}
      {withLegend && (
        <button
          type="button"
          aria-label="O que a cobertura mede"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-soft hover:text-ink"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      )}
      {withLegend && open && (
        <span
          role="dialog"
          aria-label="O que a cobertura mede"
          className="absolute left-0 top-full z-30 mt-2 block w-[min(360px,calc(100vw-48px))] shadow-lg shadow-black/5"
        >
          <CoverageLegend compact />
        </span>
      )}
    </span>
  );
}

export function CoverageLegend({
  className,
  compact,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn("rounded-2xl border border-line bg-surface p-4", className)}
    >
      <div className="text-[13px] font-medium">O que a cobertura mede</div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Avaliação manual do conhecimento mapeado: descrição, campos, exemplos do
        cliente e ligações no mapa. O percentual é definido pela equipe; a média
        resume os elementos do cliente. Não mede a precisão de nenhum sistema
        nem o uso da solução.
      </p>
      <div
        className={cn(
          "mt-4 grid gap-3",
          compact ? "grid-cols-1" : "sm:grid-cols-3",
        )}
      >
        {(Object.keys(coverageCopy) as Array<keyof typeof coverageCopy>).map(
          (id) => {
            const c = coverageCopy[id];
            return (
              <div key={id} className="rounded-xl bg-soft/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={c.tone}>{c.label}</Badge>
                  <span className="text-[11.5px] text-muted">{c.range}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-ink-soft">{c.hint}</p>
              </div>
            );
          },
        )}
      </div>
    </div>
  );
}
