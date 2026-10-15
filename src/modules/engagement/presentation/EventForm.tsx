"use client";
import { DateTimePicker } from "@/shared/ui/DateTimePicker";
import { useProgramEventOperation, ProgramEventOperationFeedback } from "./useProgramEventOperation";
import { OperationButton } from "@/shared/ui/OperationFeedback";
import { Combobox } from "@/shared/ui/Combobox";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";

import { useClientsState } from "@/modules/clients/infrastructure/state";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";

import type { ProgramEvent } from "@/modules/engagement/domain/models";
import { nextSlot, toDatetimeLocal } from "@/shared/lib/format";
import { Modal } from "@/shared/ui/Dialog";
import { FieldBlock, areaClass, fieldClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import { Button } from "@/shared/ui/primitives";

const kinds = [
  "Demo",
  "Workshop",
  "Treinamento",
  "Comitê",
  "Integração",
  "Imersão",
];

/** Create an event with its own trigger, or edit one when `event` and `open` are given. */
export function EventForm({
  defaultCompany,
  variant = "primary",
  label = "Agendar evento",
  event,
  open,
  onClose,
}: {
  defaultCompany?: string;
  variant?: "primary" | "ghost";
  label?: string;
  event?: ProgramEvent;
  open?: boolean;
  onClose?: () => void;
}) {
  const controlled = open !== undefined;
  const [own, setOwn] = useState(false);
  const isOpen = controlled ? open : own;
  const close = () => (controlled ? onClose?.() : setOwn(false));
  return (
    <>
      {!controlled && (
        <Button onClick={() => setOwn(true)} size="sm" variant={variant}>
          <Plus className="h-3.5 w-3.5" />
          {label}
        </Button>
      )}
      {isOpen && (
        <EventEditor
          key={event?.id ?? "new"}
          event={event}
          defaultCompany={defaultCompany}
          onClose={close}
        />
      )}
    </>
  );
}

function EventEditor({
  event,
  defaultCompany,
  onClose,
}: {
  event?: ProgramEvent;
  defaultCompany?: string;
  onClose: () => void;
}) {
  const { addEvent, updateEvent } = useEngagementState();
  const { clients } = useClientsState();
  const operation=useProgramEventOperation();
  const baselineCaptured=useRef(false);
  const [title, setTitle] = useState(event?.title ?? "");
  const [company, setCompany] = useState(
    event?.company ?? defaultCompany ?? clients[0]?.slug ?? "",
  );
  const [kind, setKind] = useState(event?.kind ?? "Demo");
  const [when, setWhen] = useState(
    event ? toDatetimeLocal(event.startsAt) : nextSlot(),
  );
  const [place, setPlace] = useState(event?.place ?? "");
  const [detail, setDetail] = useState(event?.detail ?? "");
  const editing = Boolean(event);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()||operation.pending||operation.busy) return;
    const next: ProgramEvent = {
      ...(event ?? { id: "e-" + Math.random().toString(36).slice(2, 8) }),
      company,
      title: title.trim(),
      kind,
      startsAt:event&&when===toDatetimeLocal(event.startsAt)?event.startsAt:new Date(when).toISOString(),
      place: place.trim() || "A definir",
      detail: detail.trim(),
    };
    const fields={title:next.title,kind:next.kind,startsAt:next.startsAt,place:next.place,detail:next.detail};
    const patch=event?Object.fromEntries(Object.entries(fields).filter(([key,value])=>value!==event[key as keyof ProgramEvent])):fields;
    void operation.run(editing?"program-events.update":"program-events.create",editing?{company:event!.company,eventId:event!.id,patch}:{company,event:fields},()=>{if(editing)updateEvent(next);else addEvent(next);},onClose);
  }

  return (
    <Modal
      open
      onClose={()=>{if(!operation.busy)onClose();}}
      title={editing ? "Editar evento" : "Agendar evento"}
      kicker="Organize os próximos momentos do cliente."
      footer={
        <>
          <Button type="button" variant="ghost" size="sm" disabled={operation.busy} onClick={onClose}>
            Cancelar
          </Button>
          <OperationButton
            operation={operation}
            busyLabel={editing ? "Salvando…" : "Agendando…"}
            type="submit"
            size="sm"
            form="event-form"
            disabled={!title.trim()}
          >
            {editing ? "Salvar evento" : "Agendar"}
          </OperationButton>
        </>
      }
    >
      <ProgramEventOperationFeedback operation={operation}/>
      <form id="event-form" onSubmit={submit} onFocusCapture={()=>{if(!baselineCaptured.current){baselineCaptured.current=true;operation.begin();}}}><fieldset disabled={operation.busy||operation.pending} className="min-w-0">
        <FieldBlock label="Título">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={fieldClass}
            placeholder="Demo copiloto de alta"
            autoFocus={!editing}
          />
        </FieldBlock>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldBlock label="Cliente">
            <Combobox
              label="Cliente"
              disabled={editing}
              value={company}
              onValueChange={(value) => setCompany(value)}
              className={fieldClass}
              options={clients.map((c) => ({ value: c.slug, label: c.name }))}
            />
          </FieldBlock>
          <FieldBlock label="Tipo">
            <Select
              label="Tipo do evento"
              value={kind}
              onValueChange={setKind}
              options={[...new Set([...kinds, kind])].map((k) => ({
                value: k,
                label: k,
              }))}
            />
          </FieldBlock>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldBlock label="Quando">
            <DateTimePicker label="Quando" required value={when} onValueChange={(next) => setWhen(next)} className={fieldClass} />
          </FieldBlock>
          <FieldBlock label="Onde">
            <input
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              className={fieldClass}
              placeholder="Remoto, sala, andar"
            />
          </FieldBlock>
        </div>
        <FieldBlock label="Detalhe">
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={3}
            className={areaClass}
          />
        </FieldBlock>
      </fieldset></form>
    </Modal>
  );
}
