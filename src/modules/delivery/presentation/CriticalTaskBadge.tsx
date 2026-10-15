import { Flag } from "lucide-react";
import type { Delivery } from "../domain/models";

/** One priority field drives the label everywhere the task is shown. */
export function CriticalTaskBadge({ priority }: { priority: Delivery["priority"] }) {
  if (priority !== "critica") return null;
  return (
    <span className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-md border border-rose/20 bg-rose-soft px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-rose no-underline" title="Tarefa crítica: muito importante para este ciclo">
      <Flag aria-hidden className="h-3 w-3" />
      Crítica
    </span>
  );
}
