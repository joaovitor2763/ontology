"use client";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import {
  cycleStatusLabel,
  type ServiceCycle,
} from "@/modules/delivery/domain/services";

export const trail: ServiceCycle["status"][] = [
  "planejado",
  "em-curso",
  "em-aceite",
  "concluido",
];

export function CycleStepper({ status }: { status: ServiceCycle["status"] }) {
  return (
    <ol
      className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11.5px]"
      aria-label="Situação do ciclo"
    >
      {trail.map((step, index) => {
        const reached = trail.indexOf(status) >= index;
        const on = status === step;
        return (
          <li key={step} className="flex items-center gap-1">
            <span
              aria-current={on ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1",
                on
                  ? "bg-ink font-medium text-on-ink"
                  : reached
                    ? "text-ink"
                    : "text-muted",
              )}
            >
              {reached && !on ? (
                <CheckCircle2 className="h-3 w-3 text-ok" />
              ) : (
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    on ? "bg-surface" : "bg-line-strong",
                  )}
                />
              )}
              {cycleStatusLabel[step]}
            </span>
            {index < trail.length - 1 && (
              <span className="px-0.5 text-line-strong">›</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
