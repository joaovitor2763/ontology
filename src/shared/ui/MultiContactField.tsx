"use client";

import { MAX_CONTACT_POINTS } from "@/shared/lib/contact-points";
import { TextField } from "@g4ai/ds";
import { Plus, X } from "lucide-react";
import { useId } from "react";
import { FieldBlock } from "./Drawer";
import { Button } from "./primitives";

export function MultiContactField({
  label,
  type,
  values,
  onChange,
  primaryHint,
}: {
  label: string;
  type: "email" | "tel";
  values: string[];
  onChange: (values: string[]) => void;
  primaryHint?: string;
}) {
  const baseId = useId();
  const rows = values.length ? values : [""];
  const noun = type === "email" ? "e-mail" : "telefone";
  return (
    <FieldBlock label={label}>
      <div className="space-y-2">
        {rows.map((value, index) => (
          <div className="flex items-center gap-2" key={`${type}-${index}`}>
            <TextField
              id={`${baseId}-${index}`}
              type={type}
              autoComplete={index === 0 ? type : "off"}
              className="mb-0! flex-1"
              value={value}
              onChange={(next) => {
                const updated = [...rows];
                updated[index] = next;
                onChange(updated);
              }}
              placeholder={type === "email" ? "nome@empresa.com" : "+55 31 99999-9999"}
              label={`${label} ${index + 1}`}
              hideLabel
            />
            {rows.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="px-2.5"
                aria-label={`Remover ${noun} ${index + 1}`}
                onClick={() => onChange(rows.filter((_, item) => item !== index))}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-start justify-between gap-3">
        <p className="text-[12px] leading-5 text-muted">
          {primaryHint ?? `O primeiro ${noun} é o principal.`}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={rows.length >= MAX_CONTACT_POINTS}
          onClick={() => onChange([...rows, ""])}
        >
          <Plus className="h-4 w-4" />
          Adicionar
        </Button>
      </div>
    </FieldBlock>
  );
}
