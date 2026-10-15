"use client";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { Checkbox } from "@/shared/ui/Checkbox";
import { formatDate } from "@/shared/lib/format";
import {
  acceptanceChannelLabel,
  type AcceptanceCriterion,
  type ServiceCycle,
} from "@/modules/delivery/domain/services";

export function AcceptanceSection({
  cycle,
  busy,
  personName,
  onApprove,
  onClear,
}: {
  cycle: ServiceCycle;
  busy: boolean;
  personName: (id: string) => string;
  onApprove: (criterion: AcceptanceCriterion) => void;
  onClear: (criterion: AcceptanceCriterion) => void;
}) {
  const approvedCount = cycle.acceptance.filter(
    (a) => a.done && a.approvedBy,
  ).length;
  return (
    <section aria-label="Critérios de aceite">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-medium">Critérios de aceite</h3>
        <span className="text-[11.5px] tabular-nums text-muted">
          {approvedCount}/{cycle.acceptance.length} aprovados
        </span>
      </div>
      {cycle.acceptance.length ? (
        <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
          {cycle.acceptance.map((a) => (
            <li
              key={a.id}
              className="flex items-start gap-3 px-3.5 py-2.5 text-[13px]"
            >
              <Checkbox
                id={`acc-${a.id}`}
                label={a.text}
                className="mt-px shrink-0"
                disabled={busy}
                checked={a.done}
                onCheckedChange={(checked) =>
                  checked ? onApprove(a) : onClear(a)
                }
              />
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={`acc-${a.id}`}
                  className={cn(
                    "block cursor-pointer leading-snug",
                    a.done && a.approvedBy && "text-ink-soft",
                  )}
                >
                  {a.text}
                </label>
                {a.done && (
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11.5px] text-muted">
                    {a.approvedBy ? (
                      <span className="inline-flex items-center gap-1 text-ok">
                        <CheckCircle2 className="h-3 w-3" />
                        {personName(a.approvedBy)}
                        {a.approvedAt ? ` · ${formatDate(a.approvedAt)}` : ""}
                        {a.channel
                          ? ` · ${acceptanceChannelLabel[a.channel]}`
                          : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-amber">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber" />
                        Sem registro de quem aprovou
                      </span>
                    )}
                    {a.note && <span>{a.note}</span>}
                  </p>
                )}
              </div>
              {a.done && (
                <button
                  type="button"
                  onClick={() => onApprove(a)}
                  className="shrink-0 text-[11.5px] text-muted hover:text-ink"
                >
                  {a.approvedBy ? "Editar" : "Registrar aprovação"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-muted">
          Edite o ciclo para definir o que precisa ser aprovado.
        </p>
      )}
    </section>
  );
}
