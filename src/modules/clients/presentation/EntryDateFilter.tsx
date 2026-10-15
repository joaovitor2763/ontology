"use client";

import { Popover } from "@base-ui/react/popover";
import { CalendarDays, ChevronDown } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { DatePicker } from "@/shared/ui/DatePicker";

export function EntryDateFilter({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
}) {
  const selected = Number(Boolean(from)) + Number(Boolean(to));
  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          "inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg bg-surface px-3 text-[13px] ring-1 outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          selected ? "font-medium ring-line-strong" : "ring-line hover:bg-soft",
        )}
      >
        <CalendarDays aria-hidden className="h-3.5 w-3.5 text-muted" />
        Data de entrada
        {selected > 0 && (
          <span className="rounded-sm bg-ink px-1.5 text-[11px] font-medium text-on-ink">
            {selected}
          </span>
        )}
        <ChevronDown aria-hidden className="h-3.5 w-3.5 text-muted" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-[100]"
        >
          <Popover.Popup className="w-[300px] max-w-[calc(100vw-16px)] rounded-xl border border-line bg-popover p-4 text-ink shadow-overlay outline-none">
            <Popover.Title className="text-[13px] font-semibold">
              Data de entrada
            </Popover.Title>
            <Popover.Description className="mt-1 text-[12px] text-muted">
              Mostre clientes que entraram dentro do período.
            </Popover.Description>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <span className="text-[12px] text-muted">A partir de</span>
                <DatePicker
                  label="Entrada a partir de"
                  value={from}
                  onValueChange={onFrom}
                  className="mt-1 text-[13px]"
                />
              </div>
              <div>
                <span className="text-[12px] text-muted">Até</span>
                <DatePicker
                  label="Entrada até"
                  value={to}
                  onValueChange={onTo}
                  className="mt-1 text-[13px]"
                />
              </div>
            </div>
            {selected > 0 && (
              <button
                type="button"
                onClick={() => {
                  onFrom("");
                  onTo("");
                }}
                className="mt-3 text-[12.5px] text-muted hover:text-ink hover:underline"
              >
                Limpar período
              </button>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
