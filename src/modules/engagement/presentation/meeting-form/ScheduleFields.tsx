"use client";
import { DateTimePicker } from "@/shared/ui/DateTimePicker";
import {
  meetingModalityLabel,
  type MeetingModality,
} from "@/modules/engagement/domain/models";
import { FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import type { MeetingDraft } from "./useMeetingDraft";

export function ScheduleFields({ draft }: { draft: MeetingDraft }) {
  const { modality } = draft;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldBlock label="Quando">
          <DateTimePicker label="Quando" required value={draft.when} onValueChange={(next) => draft.setWhen(next)} className={fieldClass} />
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
        <FieldBlock label="Modalidade">
          <Select
            label="Modalidade"
            value={modality}
            onValueChange={(value) =>
              draft.setModality(value as MeetingModality)
            }
            options={(["online", "presencial"] as const).map((m) => ({
              value: m,
              label: meetingModalityLabel[m],
            }))}
          />
        </FieldBlock>
        <FieldBlock
          label={modality === "online" ? "Link da chamada" : "Endereço"}
        >
          <input
            value={draft.place}
            onChange={(e) => draft.setPlace(e.target.value)}
            placeholder={
              modality === "online" ? "https://meet…" : "Rua, número, sala"
            }
            className={fieldClass}
          />
        </FieldBlock>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {draft.executionLoading && <p role="status" className="sm:col-span-2 text-sm text-muted">Carregando ciclos e tarefas do cliente…</p>}
        {draft.executionError && <div role="alert" className="sm:col-span-2 flex flex-wrap items-center gap-2 text-sm text-rose">
          <span>{draft.executionError}</span>
          <button type="button" className="underline" onClick={draft.retryExecution}>Tentar novamente</button>
        </div>}
        <FieldBlock label="Ciclo (opcional)">
          <Select
            label="Ciclo"
            disabled={draft.executionLoading || Boolean(draft.executionError)}
            placeholder="Sem ciclo"
            value={draft.cycleId}
            onValueChange={(value) => {
              draft.setCycleId(value);
              draft.setDeliveryId("");
            }}
            options={[
              { value: "", label: "Sem ciclo" },
              ...draft.companyCycles.map((c) => ({
                value: c.id,
                label: c.name,
              })),
            ]}
          />
        </FieldBlock>
        <FieldBlock label="Tarefa (opcional)">
          <Select
            label="Tarefa"
            disabled={draft.executionLoading || Boolean(draft.executionError)}
            placeholder="Sem tarefa"
            value={draft.deliveryId}
            onValueChange={draft.setDeliveryId}
            options={[
              { value: "", label: "Sem tarefa" },
              ...draft.companyDeliveries.map((d) => ({
                value: d.id,
                label: d.title,
              })),
            ]}
          />
        </FieldBlock>
      </div>
    </>
  );
}
