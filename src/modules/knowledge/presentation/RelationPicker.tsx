"use client";
import { normalized } from "@/modules/knowledge/domain/ontology";
import { cn } from "@/shared/lib/cn";
import { Check, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Relation name picker: suggested relations keep the vocabulary consistent,
 * and a new relation can still be created explicitly.
 */
export function RelationPicker({
  value,
  onChange,
  suggestions,
  className,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  className?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [seen, setSeen] = useState(value);
  // Adopt an external value change (e.g. swapping direction) without an effect.
  if (value !== seen) {
    setSeen(value);
    setQuery(value);
  }
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const needle = normalized(query.trim());
  const matches = suggestions.filter(
    (s) => !needle || normalized(s).includes(needle),
  );
  const exact = suggestions.some((s) => normalized(s) === needle);
  const canCreate = needle.length > 0 && !exact;
  const items: { key: string; label: string; create?: boolean }[] = [
    ...matches.map((s) => ({ key: s, label: s })),
    ...(canCreate
      ? [{ key: `__create__`, label: query.trim(), create: true }]
      : []),
  ];
  function choose(label: string) {
    onChange(label);
    setQuery(label);
    setOpen(false);
  }
  return (
    <div ref={ref} className="relative">
      {/* g4os-ds-disable-next-line raw-input -- combobox criável (sugestão ou relação nova em texto livre); o Combobox do DS só escolhe opções existentes. Rótulo vem do FieldBlock via id. */}
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && items[active] ? `${listId}-${active}` : undefined
        }
        required
        maxLength={70}
        className={className}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter" && open && items[active]) {
            e.preventDefault();
            choose(items[active].label);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Ex.: lidera, usa, depende de"
      />
      {open && items.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Relações sugeridas"
          className="absolute left-0 right-0 z-[100] mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-line bg-popover p-1.5 shadow-xl shadow-black/10"
        >
          {items.map((item, i) => (
            <li
              key={item.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={active === i}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(item.label)}
              className={cn(
                "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px]",
                active === i && "bg-soft",
                item.create && "text-blue",
              )}
            >
              {item.create ? (
                <>
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  Criar relação “{item.label}”
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1">{item.label}</span>
                  {normalized(item.label) === needle && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-blue" />
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
