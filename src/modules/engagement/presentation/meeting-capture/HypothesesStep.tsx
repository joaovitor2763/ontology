"use client";
import { TextareaField } from "@g4ai/ds";
import { Checkbox } from "@/shared/ui/Checkbox";
import { Plus, Trash2 } from "lucide-react";
import {
  evidenceKindLabel,
  hypothesisStatusLabel,
} from "@/modules/engagement/domain/hypotheses";
import type { HypothesisEvidenceKind } from "@/modules/engagement/domain/models";
import { cn } from "@/shared/lib/cn";
import { FieldBlock, areaClass, fieldClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import { Badge, Button } from "@/shared/ui/primitives";
import { EVIDENCE_KINDS, uid } from "./shared";
import type { CaptureDraft } from "./useCaptureDraft";

export function HypothesesStep({ draft }: { draft: CaptureDraft }) {
  const { evidence, setEvidence, newHypotheses, setNewHypotheses } = draft;
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] leading-relaxed text-muted">
        O que esta conversa mostrou sobre as hipóteses em teste? Marque as que
        ganharam evidência e registre o que confirmou, contradisse ou refinou
        cada uma.
      </p>
      {draft.existingHypotheses.length === 0 && newHypotheses.length === 0 && (
        <p className="rounded-xl border border-dashed border-line px-4 py-3 text-[13px] text-muted">
          Este cliente ainda não tem hipóteses abertas. Registre a primeira
          abaixo ou avance.
        </p>
      )}
      {draft.existingHypotheses.map((h) => {
        const marked = evidence[h.id];
        return (
          <div key={h.id} className="rounded-xl border border-line p-3">
            <Checkbox
              label={h.statement}
              hideLabel={false}
              checked={!!marked}
              onCheckedChange={(checked) =>
                setEvidence((all) => {
                  const next = { ...all };
                  if (checked) next[h.id] = { kind: "confirma", note: "" };
                  else delete next[h.id];
                  return next;
                })
              }
              description={h.rootCause || undefined}
            >
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={h.status === "em-teste" ? "warn" : "neutral"}>
                  {hypothesisStatusLabel[h.status]}
                </Badge>
                <span className="font-medium leading-snug">{h.statement}</span>
              </span>
            </Checkbox>
            {marked && (
              <div className="mt-3 grid gap-3 pl-7 sm:grid-cols-[160px_minmax(0,1fr)]">
                <Select
                  label={`O que a reunião mostrou sobre ${h.statement}`}
                  value={marked.kind}
                  onValueChange={(value) =>
                    setEvidence((all) => ({
                      ...all,
                      [h.id]: {
                        ...all[h.id],
                        kind: value as HypothesisEvidenceKind,
                      },
                    }))
                  }
                  options={EVIDENCE_KINDS.map((k) => ({
                    value: k,
                    label: evidenceKindLabel[k],
                  }))}
                />
                <TextareaField
                  label={`Evidência sobre ${h.statement}`}
                  hideLabel
                  value={marked.note}
                  onChange={(note) =>
                    setEvidence((all) => ({
                      ...all,
                      [h.id]: { ...all[h.id], note },
                    }))
                  }
                  minRows={2}
                  className="mb-0!"
                  placeholder="O que foi dito ou observado que sustenta isso."
                />
              </div>
            )}
          </div>
        );
      })}
      {newHypotheses.map((h, index) => (
        <div key={h.id} className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center justify-between text-[12px] text-muted">
            <span>Nova hipótese {index + 1}</span>
            <button
              type="button"
              aria-label={`Remover hipótese ${index + 1}`}
              onClick={() =>
                setNewHypotheses((xs) => xs.filter((x) => x.id !== h.id))
              }
              className="hover:text-rose"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <FieldBlock label="Hipótese">
            <textarea
              value={h.statement}
              onChange={(e) =>
                setNewHypotheses((xs) =>
                  xs.map((x) =>
                    x.id === h.id ? { ...x, statement: e.target.value } : x,
                  ),
                )
              }
              rows={2}
              className={areaClass}
              placeholder="A alta atrasa porque a prescrição chega à farmácia sem revisão."
            />
          </FieldBlock>
          <FieldBlock label="Causa raiz presumida">
            <input
              value={h.rootCause ?? ""}
              onChange={(e) =>
                setNewHypotheses((xs) =>
                  xs.map((x) =>
                    x.id === h.id ? { ...x, rootCause: e.target.value } : x,
                  ),
                )
              }
              className={fieldClass}
              placeholder="Ausência de conciliação antes da assinatura"
            />
          </FieldBlock>
          {draft.linkablePains.length > 0 && (
            <fieldset>
              <legend className="mb-1.5 text-[12.5px] text-muted">
                Dores relacionadas
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {draft.linkablePains.map((p) => {
                  const on = h.painIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setNewHypotheses((xs) =>
                          xs.map((x) =>
                            x.id === h.id
                              ? {
                                  ...x,
                                  painIds: on
                                    ? x.painIds.filter((id) => id !== p.id)
                                    : [...x.painIds, p.id],
                                }
                              : x,
                          ),
                        )
                      }
                      className={cn(
                        "rounded-lg px-2.5 py-1.5 text-[12.5px] ring-1",
                        on
                          ? "bg-ink text-on-ink ring-ink"
                          : "bg-surface text-ink-soft ring-line hover:bg-soft",
                      )}
                    >
                      {p.title || "Dor sem título"}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() =>
          setNewHypotheses((xs) => [
            ...xs,
            {
              id: uid("hyp"),
              company: draft.company,
              statement: "",
              rootCause: "",
              status: "aberta",
              painIds: [],
              ownerId: draft.me.id,
              evidence: [],
              createdAt: new Date().toISOString(),
            },
          ])
        }
      >
        <Plus className="h-3.5 w-3.5" />
        Nova hipótese
      </Button>
    </div>
  );
}
