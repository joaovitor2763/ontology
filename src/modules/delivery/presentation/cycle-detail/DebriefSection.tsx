"use client";
import { MessageSquareQuote } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { formatDate } from "@/shared/lib/format";
import { Button } from "@/shared/ui/primitives";
import type { ServiceCycle } from "@/modules/delivery/domain/services";

export function DebriefSection({
  cycle,
  resolve,
  onOpen,
}: {
  cycle: ServiceCycle;
  resolve: (id: string) => { name: string };
  onOpen: () => void;
}) {
  if (cycle.status !== "concluido" && !cycle.debrief) return null;
  return (
    <section aria-label="Debrief do cliente">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="inline-flex items-center gap-1.5 text-[13px] font-medium">
          <MessageSquareQuote className="h-3.5 w-3.5 text-muted" />
          Debrief do cliente
        </h3>
        {cycle.debrief && (
          <button
            type="button"
            onClick={onOpen}
            className="text-[12px] text-muted hover:text-ink"
          >
            Editar
          </button>
        )}
      </div>
      {cycle.debrief ? (
        <div className="space-y-1.5 text-[12.5px]">
          <div
            className="flex items-center gap-1"
            aria-label={`Nota ${cycle.debrief.score} de 5`}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <span
                key={n}
                aria-hidden
                className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  n <= cycle.debrief!.score ? "bg-ink" : "bg-line-strong",
                )}
              />
            ))}
            <span className="ml-1.5 tabular-nums text-muted">
              {cycle.debrief.score}/5
            </span>
          </div>
          {cycle.debrief.comment && (
            <p className="leading-relaxed">{cycle.debrief.comment}</p>
          )}
          <p className="text-muted">
            Chamaria de novo:{" "}
            <span
              className={cycle.debrief.wouldRehire ? "text-ok" : "text-rose"}
            >
              {cycle.debrief.wouldRehire ? "Sim" : "Não"}
            </span>
          </p>
          <p className="text-[11.5px] text-muted">
            {formatDate(cycle.debrief.at)} · {resolve(cycle.debrief.by).name}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[12px] leading-relaxed text-muted">
            O que o cliente achou do ciclo? Registre antes de esquecer.
          </p>
          <Button variant="ghost" size="sm" onClick={onOpen}>
            Registrar debrief
          </Button>
        </div>
      )}
    </section>
  );
}
