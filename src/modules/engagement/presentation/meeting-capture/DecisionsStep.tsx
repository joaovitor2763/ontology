"use client";
import { DatePicker } from "@/shared/ui/DatePicker";
import { Plus, Trash2 } from "lucide-react";
import { FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import { Button } from "@/shared/ui/primitives";
import { kinds, plusDays, uid } from "./shared";
import type { CaptureDraft } from "./useCaptureDraft";

export function DecisionsStep({ draft }: { draft: CaptureDraft }) {
  const {
    decisions,
    setDecisions,
    attendees,
    me,
    title,
    kind,
    attendeeIds,
    pains,
    noNewPains,
    newHypotheses,
    solutions,
    hypothesisEvidence,
    personName,
  } = draft;
  return (
    <div className="space-y-4">
      {decisions.map((decision, index) => (
        <div key={decision.id} className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center justify-between text-[12px] text-muted">
            <span>Decisão {index + 1}</span>
            <button
              type="button"
              aria-label={`Remover decisão ${index + 1}`}
              onClick={() =>
                setDecisions((xs) => xs.filter((d) => d.id !== decision.id))
              }
              className="hover:text-rose"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <FieldBlock label="O que ficou decidido">
            <input
              value={decision.summary}
              onChange={(e) =>
                setDecisions((xs) =>
                  xs.map((d) =>
                    d.id === decision.id ? { ...d, summary: e.target.value } : d,
                  ),
                )
              }
              className={fieldClass}
              placeholder="Piloto começa pela UTI adulto"
            />
          </FieldBlock>
          <FieldBlock label="Próximo passo (vira uma ação combinada)">
            <input
              value={decision.nextStep ?? ""}
              onChange={(e) =>
                setDecisions((xs) =>
                  xs.map((d) =>
                    d.id === decision.id
                      ? { ...d, nextStep: e.target.value }
                      : d,
                  ),
                )
              }
              className={fieldClass}
              placeholder="Enviar o desenho do piloto para a chefia"
            />
          </FieldBlock>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldBlock label="Dono">
              <Select
                label="Dono da decisão"
                value={decision.ownerId ?? me.id}
                onValueChange={(value) =>
                  setDecisions((xs) =>
                    xs.map((d) =>
                      d.id === decision.id ? { ...d, ownerId: value } : d,
                    ),
                  )
                }
                options={attendees.map((p) => ({
                  value: p.id,
                  label: p.name,
                  description: p.role,
                }))}
              />
            </FieldBlock>
            <FieldBlock label="Prazo">
              <DatePicker
                label="Prazo"
                value={decision.dueAt ?? ""}
                onValueChange={(next) =>
                  setDecisions((xs) =>
                    xs.map((d) =>
                      d.id === decision.id ? { ...d, dueAt: next } : d,
                    ),
                  )
                }
                className={fieldClass}
              />
            </FieldBlock>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() =>
          setDecisions((xs) => [
            ...xs,
            {
              id: uid("dec"),
              summary: "",
              nextStep: "",
              ownerId: me.id,
              dueAt: plusDays(7),
              status: "registrada",
            },
          ])
        }
      >
        <Plus className="h-3.5 w-3.5" />
        Adicionar decisão
      </Button>
      <section className="rounded-xl bg-soft p-4 text-[13px]">
        <h3 className="font-medium">O que será salvo</h3>
        <ul className="mt-2 space-y-1 text-ink-soft">
          <li>
            Reunião “{title || "sem título"}” ·{" "}
            {kinds.find((k) => k.id === kind)?.label} · {attendeeIds.length}{" "}
            presente{attendeeIds.length === 1 ? "" : "s"}
          </li>
          <li>
            {pains.length} dor{pains.length === 1 ? "" : "es"}{" "}
            {noNewPains ? "(nenhuma nova)" : ""}
          </li>
          <li>
            {hypothesisEvidence().length} hipótese
            {hypothesisEvidence().length === 1 ? "" : "s"} com evidência nova
            {newHypotheses.length
              ? `, ${newHypotheses.length} nova${newHypotheses.length === 1 ? "" : "s"}`
              : ""}
          </li>
          <li>
            {solutions.length} opção{solutions.length === 1 ? "" : "ões"} de
            solução, {solutions.filter((s) => s.painIds.length).length} vinculada
            {solutions.filter((s) => s.painIds.length).length === 1 ? "" : "s"} a
            dores
          </li>
          <li>
            {decisions.length} decisão{decisions.length === 1 ? "" : "ões"},{" "}
            {decisions.filter((d) => d.nextStep?.trim()).length} com próximo
            passo (viram ações de {personName(me.id).split(" ")[0]} e outros)
          </li>
        </ul>
      </section>
    </div>
  );
}
