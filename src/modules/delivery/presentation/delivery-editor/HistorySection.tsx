"use client";
import { History } from "lucide-react";
import { historyCount, historyFieldLabel } from "@/modules/delivery/domain/history";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";
import type { DeliveryDraft } from "./useDeliveryDraft";

export function HistorySection({
  editor,
  layout,
}: {
  editor: DeliveryDraft;
  layout: "drawer" | "page";
}) {
  const { history, who, valueLabel } = editor;
  // O resumo conta as alterações antigas que foram condensadas: o total continua certo.
  const total = historyCount(history);
  return (
    <details
      className={cn(layout === "drawer" && "mt-5 border-t border-line pt-4")}
      open={layout === "page"}
    >
      <summary className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-medium">
        <History className="h-3.5 w-3.5 text-muted" />
        Histórico
        {total > 0 && <span className="text-[11px] text-muted">{total}</span>}
      </summary>
      <ol className="mt-3 space-y-2 text-[12.5px]">
        {history.map((h, i) => (
          <li key={`${h.at}-${i}`} className="flex flex-wrap gap-x-2 gap-y-0.5">
            <time
              dateTime={h.at}
              className="w-28 shrink-0 tabular-nums text-muted"
            >
              {formatDateTime(h.at)}
            </time>
            <span className="min-w-0">
              {h.field === "resumo" ? (
                <span className="text-muted">
                  {h.count} {h.count === 1 ? "alteração anterior" : "alterações anteriores"}
                </span>
              ) : (
                <>
                  <span className="font-medium">{who(h.by)}</span>{" "}
                  {h.field === "comment"
                    ? "comentou"
                    : h.field === "blocker"
                      ? h.to
                        ? `bloqueou: ${h.to}`
                        : "resolveu o bloqueio"
                      : `alterou ${historyFieldLabel[h.field].toLowerCase()} de ${valueLabel(h.field, h.from)} para ${valueLabel(h.field, h.to)}`}
                </>
              )}
            </span>
          </li>
        ))}
        {!history.length && (
          <li className="text-muted">Nenhuma alteração registrada.</li>
        )}
      </ol>
    </details>
  );
}
