"use client";

import { Popover } from "@base-ui/react/popover";
import {
  Calendar,
  cn,
  fieldClass,
  formatIsoDate,
  popupClass,
  sheetBackdropClass,
  sheetPositionerClass,
  todayIso,
  useFieldContext,
} from "@g4ai/ds";
import { CalendarDays } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/*
 * Seletor de data com o Calendar e as classes do G4OS-DS. Não reexporta o
 * DatePicker do DS porque as telas daqui dependem do que ele não tem:
 * validação nativa de formulário (`required`, `min`/`max` com mensagem),
 * `readOnly`, `name`, `defaultOpen`/`onOpenChange` e `aria-describedby`.
 * O valor é sempre só-data ("2026-09-30"), sem passar por `Date`.
 */
export type DatePickerProps = {
  value: string;
  onValueChange: (value: string) => void;
  /** Nome acessível. O rótulo visível fica com o `FieldBlock` ou o texto ao redor. */
  label: string;
  disabled?: boolean;
  className?: string;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Gatilho próprio (ex.: chip); `className` passa a ser só dele. */
  triggerContent?: ReactNode;
  min?: string;
  max?: string;
  required?: boolean;
  readOnly?: boolean;
  id?: string;
  name?: string;
  "aria-describedby"?: string;
  /** Texto do campo vazio. */
  placeholder?: string;
};

const footerButton =
  "rounded-md px-2 py-1 text-[12.5px] text-ink-soft hover:bg-soft hover:text-ink disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent";

export function DatePicker({
  value,
  onValueChange,
  label,
  disabled,
  readOnly,
  required,
  id,
  name,
  "aria-describedby": describedBy,
  className,
  defaultOpen = false,
  onOpenChange,
  triggerContent,
  min,
  max,
  placeholder = "Selecione a data",
}: DatePickerProps) {
  const field = useFieldContext();
  const [open, setOpen] = useState(defaultOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const triggerRef = useCallback((node: HTMLButtonElement | null) => {
    buttonRef.current = node;
    // O <dialog> modal (Drawer) deixa inerte o que fica fora dele: o popup vai para dentro.
    if (node) setContainer(node.closest("dialog") ?? document.body);
  }, []);
  const outOfRange = (iso: string) => Boolean((min && iso < min) || (max && iso > max));
  useEffect(() => {
    inputRef.current?.setCustomValidity(
      value && outOfRange(value) ? "Selecione uma data dentro do período permitido." : "",
    );
  });
  const changeOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const pick = (iso: string) => {
    onValueChange(iso);
    changeOpen(false);
  };
  const today = todayIso();
  const invalid = Boolean(field?.invalid);
  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      {/* Proxy focável de validação: mantém required/min/max nativos sem calendário nativo. */}
      {/* g4os-ds-disable-next-line raw-input -- proxy invisível de validação nativa do formulário, não é campo de digitação */}
      <input
        ref={inputRef}
        type="text"
        className="sr-only"
        tabIndex={-1}
        aria-label={`${label} · valor`}
        name={name}
        value={value}
        readOnly={readOnly}
        disabled={disabled}
        required={required}
        pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
        onChange={(event) => onValueChange(event.target.value)}
        onInvalid={() => {
          buttonRef.current?.focus();
          if (!readOnly && !disabled) changeOpen(true);
        }}
      />
      <Popover.Trigger
        id={id ?? field?.id}
        ref={triggerRef}
        disabled={disabled || readOnly}
        aria-label={value ? `${label}: ${formatIsoDate(value)}` : label}
        aria-describedby={describedBy ?? field?.describedBy}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        className={
          triggerContent
            ? className
            : cn(
                fieldClass,
                "flex items-center justify-between gap-2 text-left font-normal outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:bg-soft/60 disabled:text-muted",
                invalid && "border-rose/50",
                className,
              )
        }
      >
        {triggerContent ?? (
          <>
            <span className={cn("truncate tabular-nums", !value && "text-muted")}>
              {value ? formatIsoDate(value) : placeholder}
            </span>
            <CalendarDays aria-hidden className="size-4 shrink-0 text-muted" />
          </>
        )}
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Backdrop className={sheetBackdropClass} />
        <Popover.Positioner
          sideOffset={6}
          align="start"
          collisionPadding={12}
          className={cn("z-[100]", sheetPositionerClass)}
        >
          <Popover.Popup
            ref={popupRef}
            className={popupClass}
            aria-label={`Calendário · ${label}`}
            initialFocus={() =>
              popupRef.current?.querySelector<HTMLElement>('[data-iso][tabindex="0"]') ?? true
            }
          >
            <Calendar
              selected={value || null}
              min={min}
              max={max}
              now={today}
              label={label}
              onDayClick={pick}
            />
            <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
              <button
                type="button"
                disabled={outOfRange(today)}
                onClick={() => pick(today)}
                className={footerButton}
              >
                Hoje
              </button>
              {!required && (
                <button
                  type="button"
                  disabled={!value}
                  onClick={() => pick("")}
                  className={footerButton}
                >
                  Limpar data
                </button>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
