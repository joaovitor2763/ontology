"use client";
import { cn } from "@/shared/lib/cn";
import { FieldBlock } from "@/shared/ui/Drawer";
import { statuses, type DeliveryDraft } from "./useDeliveryDraft";

export function StatusPicker({ editor }: { editor: DeliveryDraft }) {
  const { live, activeBlocker, blocking, evidence } = editor;
  return (
    <FieldBlock label="Status">
      <div className="flex flex-wrap gap-1.5">
        {statuses.map((s) => (
          <button
            key={s.id}
            aria-pressed={live.status === s.id}
            type="button"
            onClick={() => {
              if (s.id === "bloqueado") {
                if (!activeBlocker) editor.setBlocking(true);
                return;
              }
              editor.save({ status: s.id });
            }}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-[12.5px] ring-1 ring-line",
              live.status === s.id
                ? "bg-ink font-medium text-on-ink ring-ink"
                : "hover:bg-soft",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      {evidence.awaitingApproval && (
        <p className="mt-1.5 text-[11.5px] text-amber">
          Concluída, mas aguarda um documento aprovado na revisão.
        </p>
      )}
      {!activeBlocker && !blocking && (
        <p className="mt-1.5 text-[11.5px] text-muted">
          Escolher “Bloqueada” pede o motivo e quem resolve.
        </p>
      )}
    </FieldBlock>
  );
}
