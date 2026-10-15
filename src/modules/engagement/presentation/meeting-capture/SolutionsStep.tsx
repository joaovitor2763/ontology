"use client";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/primitives";
import { SolutionEditor } from "./SolutionEditor";
import { uid } from "./shared";
import type { CaptureDraft } from "./useCaptureDraft";

export function SolutionsStep({ draft }: { draft: CaptureDraft }) {
  const { linkablePains, solutions, setSolutions } = draft;
  return (
    <div className="space-y-4">
      {linkablePains.length === 0 && (
        <p className="rounded-xl border border-dashed border-line px-4 py-3 text-[13px] text-muted">
          Sem dores registradas, não há o que resolver. Avance se a reunião não
          gerou soluções.
        </p>
      )}
      {solutions.map((solution, index) => (
        <SolutionEditor
          key={solution.id}
          solution={solution}
          index={index}
          pains={linkablePains}
          owners={draft.attendees.map((p) => ({
            value: p.id,
            label: p.name,
            description: p.role,
          }))}
          onChange={(next) =>
            setSolutions((xs) =>
              xs.map((s) => (s.id === solution.id ? next : s)),
            )
          }
          onRemove={() =>
            setSolutions((xs) => xs.filter((s) => s.id !== solution.id))
          }
        />
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={linkablePains.length === 0}
        onClick={() =>
          setSolutions((xs) => [
            ...xs,
            {
              id: uid("sol"),
              company: draft.company,
              meetingId: draft.meetingId,
              title: "",
              description: "",
              painIds: linkablePains.length === 1 ? [linkablePains[0].id] : [],
              hypothesis: "",
              ownerId: draft.me.id,
              status: "proposta",
              createdAt: new Date().toISOString(),
            },
          ])
        }
      >
        <Plus className="h-3.5 w-3.5" />
        Adicionar solução
      </Button>
    </div>
  );
}
