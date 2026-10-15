"use client";
import { DateTimePicker } from "@/shared/ui/DateTimePicker";
import { stakeholderRoles } from "@/modules/clients/domain/stakeholders";
import { Combobox } from "@/shared/ui/Combobox";
import { FieldBlock, areaClass, fieldClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import { NOW, toDatetimeLocal } from "@/shared/lib/format";
import type { MeetingKind } from "@/modules/engagement/domain/models";
import { kinds } from "./shared";
import type { CaptureDraft } from "./useCaptureDraft";

export function ContextStep({ draft }: { draft: CaptureDraft }) {
  return (
    <div>
      <FieldBlock label="Título">
        <input
          value={draft.title}
          onChange={(e) => draft.setTitle(e.target.value)}
          className={fieldClass}
          placeholder="Diagnóstico com a operação"
          autoFocus
        />
      </FieldBlock>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldBlock label="Cliente">
          <Combobox
            label="Cliente"
            value={draft.company}
            onValueChange={(value) => {
              draft.setCompany(value);
              draft.setAttendees((ids) =>
                ids.filter((id) => draft.active.some((p) => p.id === id)),
              );
              draft.setSolutions((xs) =>
                xs.map((s) => ({
                  ...s,
                  painIds: s.painIds.filter((id) =>
                    draft.pains.some((p) => p.id === id),
                  ),
                })),
              );
            }}
            className={fieldClass}
            options={draft.clients.map((c) => ({
              value: c.slug,
              label: c.name,
            }))}
          />
        </FieldBlock>
        <FieldBlock label="Tipo">
          <Select
            label="Tipo da reunião"
            value={draft.kind}
            onValueChange={(value) => draft.setKind(value as MeetingKind)}
            options={kinds.map((k) => ({ value: k.id, label: k.label }))}
          />
        </FieldBlock>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldBlock label="Quando aconteceu">
          <DateTimePicker label="Quando aconteceu" required value={draft.when} max={toDatetimeLocal(NOW)} onValueChange={(next) => draft.setWhen(next)} className={fieldClass} />
        </FieldBlock>
        <FieldBlock label="Duração">
          <Select
            label="Duração"
            value={String(draft.duration)}
            onValueChange={(value) => draft.setDuration(Number(value))}
            options={[30, 45, 60, 90, 120].map((n) => ({
              value: String(n),
              label: `${n} min`,
            }))}
          />
        </FieldBlock>
      </div>
      <FieldBlock label="Participantes">
        <Combobox
          multiple
          label="Participantes"
          placeholder="Buscar equipe ou stakeholders…"
          value={draft.attendeeIds}
          onValueChange={draft.setAttendees}
          options={draft.attendees.map((person) => ({
            value: person.id,
            label: person.name,
            description: `${person.role} · ${
              "accountRole" in person
                ? `Stakeholder · ${stakeholderRoles[person.accountRole as keyof typeof stakeholderRoles]}`
                : "Equipe"
            }`,
          }))}
        />
      </FieldBlock>
      <FieldBlock label="Síntese em duas frases">
        <textarea
          value={draft.summary}
          onChange={(e) => draft.setSummary(e.target.value)}
          rows={2}
          className={areaClass}
          placeholder="O que aconteceu e o que muda a partir daqui."
        />
      </FieldBlock>
      <FieldBlock label="Notas ou transcrição">
        <textarea
          value={draft.notes}
          onChange={(e) => draft.setNotes(e.target.value)}
          rows={6}
          className={areaClass}
          placeholder="Cole as anotações. Nos próximos passos você separa dores, soluções e decisões."
        />
      </FieldBlock>
      <p className="rounded-xl border border-dashed border-line px-4 py-3 text-[12.5px] leading-relaxed text-muted">
        Preparado para extração assistida: quando a inteligência estiver ligada,
        estas notas alimentam sugestões de dores e decisões, que você aprova
        antes de salvar.
      </p>
    </div>
  );
}
