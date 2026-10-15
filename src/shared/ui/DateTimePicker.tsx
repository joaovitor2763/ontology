"use client";

import { TimePicker } from "@g4ai/ds";
import { useId, useRef } from "react";
import { DatePicker, type DatePickerProps } from "./DatePicker";

/**
 * Data e horário locais ("2026-10-03T14:30"), sem fuso: quem chama mantém a
 * própria conversão. A data usa o `DatePicker` daqui (validação nativa,
 * min/max, somente leitura); o horário usa o `TimePicker` do G4OS-DS
 * (digitável: "9h30", "14:00", com lista de horários).
 */
export function DateTimePicker({ value, onValueChange, label, min, max, required, disabled,
  readOnly, className, id, name, ...rest }: DatePickerProps) {
  const [date = "", time = ""] = value.split("T");
  const timeId = useId();
  const timeProxy = useRef<HTMLInputElement>(null);
  const timeLocked = disabled || readOnly || !date;
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
    <div className="min-w-[150px] flex-1"><DatePicker {...rest} id={id} label={label}
      value={date} required={required} disabled={disabled} readOnly={readOnly} className={className}
      min={min?.slice(0, 10)} max={max?.slice(0, 10)}
      onValueChange={next => onValueChange(next ? `${next}T${time}` : "")} /></div>
    <div className="relative shrink-0">
      <label htmlFor={timeId} className="sr-only">{`Horário · ${label}`}</label>
      {/* g4os-ds-disable-next-line raw-input -- proxy invisível: o TimePicker do DS não tem `required`; mantém a validação nativa do formulário */}
      <input ref={timeProxy} type="text" className="sr-only" tabIndex={-1} aria-label={`Horário · ${label} · valor`}
        value={time} readOnly required={!timeLocked && (required || Boolean(date))}
        onInvalid={() => document.getElementById(timeId)?.focus()} />
      <TimePicker id={timeId} value={time} step={15} disabled={timeLocked} className="mb-0!"
        min={date && date === min?.slice(0, 10) ? min.slice(11, 16) : undefined}
        max={date && date === max?.slice(0, 10) ? max.slice(11, 16) : undefined}
        onChange={next => onValueChange(`${date}T${next}`)} />
    </div>
  </div>;
}
