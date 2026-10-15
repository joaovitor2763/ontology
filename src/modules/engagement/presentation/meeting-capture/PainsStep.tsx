"use client";
import { Checkbox } from "@/shared/ui/Checkbox";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/primitives";
import { PainEditor } from "./PainEditor";
import { uid } from "./shared";
import type { CaptureDraft } from "./useCaptureDraft";

export function PainsStep({ draft }: { draft: CaptureDraft }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line p-3">
        <Checkbox
          label="Nenhuma nova dor identificada nesta reunião"
          hideLabel={false}
          description="Marque para não registrar dores só por obrigação."
          checked={draft.noNewPains}
          onCheckedChange={draft.setNoNewPains}
        />
      </div>
      {draft.pains.map((pain, index) => (
        <PainEditor
          key={pain.id}
          pain={pain}
          index={index}
          onChange={(next) =>
            draft.setPains((xs) => xs.map((p) => (p.id === pain.id ? next : p)))
          }
          onRemove={() => {
            draft.setPains((xs) => xs.filter((p) => p.id !== pain.id));
            draft.setSolutions((xs) =>
              xs.map((s) => ({
                ...s,
                painIds: s.painIds.filter((id) => id !== pain.id),
              })),
            );
          }}
        />
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={draft.noNewPains}
        onClick={() =>
          draft.setPains((xs) => [
            ...xs,
            {
              id: uid("pain"),
              company: draft.company,
              meetingId: draft.meetingId,
              title: "",
              description: "",
              severity: "media",
              confidence: 70,
              status: "aberta",
              createdAt: new Date().toISOString(),
            },
          ])
        }
      >
        <Plus className="h-3.5 w-3.5" />
        Adicionar dor
      </Button>
      {draft.existingPains.length > 0 && (
        <p className="text-[12px] text-muted">
          Este cliente já tem {draft.existingPains.length} dor
          {draft.existingPains.length === 1 ? "" : "es"} aberta
          {draft.existingPains.length === 1 ? "" : "s"}. Soluções do próximo
          passo podem apontar para elas.
        </p>
      )}
    </div>
  );
}
