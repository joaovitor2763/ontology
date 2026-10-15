"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { InteractionTagPicker } from "@/modules/engagement/presentation/InteractionTags";
import { Combobox } from "@/shared/ui/Combobox";
import type { Meeting, MeetingKind } from "@/modules/engagement/domain/models";
import { Drawer, FieldBlock, areaClass, fieldClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import { Button } from "@/shared/ui/primitives";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { ClientExecutionProvider, useScopedClientExecution } from "@/modules/delivery/infrastructure/ClientExecutionProvider";

import { kinds } from "./meeting-form/shared";
import { useMeetingDraft } from "./meeting-form/useMeetingDraft";
import { PrepFieldset } from "./meeting-form/PrepFieldset";
import { ScheduleFields } from "./meeting-form/ScheduleFields";
import { AttendeesFieldset } from "./meeting-form/AttendeesFieldset";
import { DecisionsFieldset } from "./meeting-form/DecisionsFieldset";
import { ActionsFieldset } from "./meeting-form/ActionsFieldset";

/**
 * Agenda or register a meeting. Without `meeting` it renders its own trigger button;
 * with `open`/`onClose` it is controlled by the caller (edit mode when `meeting` is given).
 */
export function MeetingForm({
  defaultCompany,
  defaultKind,
  variant = "primary",
  label = "Agendar reunião",
  meeting,
  open,
  onClose,
}: {
  defaultCompany?: string;
  /** Pre-selected kind for a new meeting (e.g. "entrevista" from the schedule menu). */
  defaultKind?: MeetingKind;
  variant?: "primary" | "ghost";
  label?: string;
  meeting?: Meeting;
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
        <Button
          onClick={() => setOwn(true)}
          size="sm"
          variant={variant}
          className={variant === "ghost" ? "w-full justify-start" : undefined}
        >
          <Plus className="h-3.5 w-3.5" />
          {label}
        </Button>
      )}
      {isOpen && (
        <MeetingEditorWithExecution
          key={meeting?.id ?? "new"}
          meeting={meeting}
          defaultCompany={defaultCompany}
          defaultKind={defaultKind}
          onClose={close}
        />
      )}
    </>
  );
}

/** A global meeting editor reads one client's execution, including after it changes clients. */
function MeetingEditorWithExecution(props: {
  meeting?: Meeting;
  defaultCompany?: string;
  defaultKind?: MeetingKind;
  onClose: () => void;
}) {
  const { mode } = useSyncStatus();
  const scoped = useScopedClientExecution();
  const { clients } = useClientsState();
  const [initialCompany] = useState(() => props.meeting?.company ?? props.defaultCompany ?? clients[0]?.slug ?? "");
  if (mode !== "remote" || scoped) return <MeetingEditor {...props} />;
  if (!initialCompany) return <div role="alert" className="p-6 text-sm text-muted">Cadastre um cliente antes de agendar uma reunião.</div>;
  return (
    <ClientExecutionProvider company={initialCompany}>
      <MeetingEditor {...props} />
    </ClientExecutionProvider>
  );
}

function MeetingEditor({
  meeting,
  defaultCompany,
  defaultKind,
  onClose,
}: {
  meeting?: Meeting;
  defaultCompany?: string;
  defaultKind?: MeetingKind;
  onClose: () => void;
}) {
  const draft = useMeetingDraft({
    meeting,
    defaultCompany,
    defaultKind,
    onClose,
  });
  const { editing, future, saving, pendingOperation, canSchedule } = draft;
  return (
    <Drawer
      open
      onClose={() => {
        if (!draft.submitting.current) onClose();
      }}
      title={editing ? "Editar reunião" : "Agendar reunião"}
      kicker={
        editing
          ? "Ajuste a pauta, os presentes, as decisões e as ações."
          : "Defina a pauta e reserve um momento com o cliente."
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form="meeting-form"
            disabled={!draft.title.trim() || saving}
          >
            {saving
              ? "Salvando…"
              : pendingOperation
                ? "Consultar resultado"
                : editing
                  ? "Salvar reunião"
                  : future
                    ? canSchedule && draft.onGoogle
                      ? "Agendar no Google"
                      : "Agendar"
                    : "Registrar"}
          </Button>
        </div>
      }
    >
      <form id="meeting-form" onSubmit={draft.submit}>
        <fieldset disabled={saving || pendingOperation} className="min-w-0">
          <p className="mb-4 text-[13px] text-muted">
            Organizador: {draft.organizerEmail}
          </p>
          <InteractionTagPicker value={draft.tags} onChange={draft.setTags} />
          <FieldBlock label="Título">
            <input
              value={draft.title}
              onChange={(e) => draft.setTitle(e.target.value)}
              className={fieldClass}
              placeholder="Alinhamento de piloto"
              autoFocus={!editing}
            />
          </FieldBlock>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldBlock label="Cliente">
              <Combobox
                label="Cliente"
                value={draft.company}
                disabled={editing}
                onValueChange={(value) => {
                  draft.setCompany(value);
                  draft.setCycleId("");
                  draft.setDeliveryId("");
                  draft.setAttendees((ids) =>
                    ids.filter((id) =>
                      draft.attendees.some(
                        (p) => p.id === id && p.org === "praxis",
                      ),
                    ),
                  );
                }}
                className={fieldClass}
                options={draft.clients.map((c) => ({
                  value: c.slug,
                  label: c.name,
                }))}
              />
              {editing && <p className="mt-1 text-xs text-muted">O cliente de uma reunião registrada não pode ser alterado.</p>}
            </FieldBlock>
            <FieldBlock label="Tipo">
              <Select
                label="Tipo da reunião"
                value={draft.kind}
                onValueChange={(value) => draft.setKind(value as MeetingKind)}
                options={kinds.map((k) => ({
                  value: k.id,
                  label: k.label,
                  description: k.hint,
                }))}
              />
            </FieldBlock>
          </div>
          {draft.hasPrep && <PrepFieldset draft={draft} />}
          <ScheduleFields draft={draft} />
          <AttendeesFieldset draft={draft} />
          {editing && (
            <FieldBlock label="Síntese">
              <textarea
                value={draft.summary}
                onChange={(e) => draft.setSummary(e.target.value)}
                rows={3}
                className={areaClass}
                placeholder="Resumo em duas frases do que aconteceu."
              />
            </FieldBlock>
          )}
          <FieldBlock label={future && !editing ? "Pauta" : "Notas"}>
            <textarea
              value={draft.notes}
              onChange={(e) => draft.setNotes(e.target.value)}
              rows={5}
              className={areaClass}
              placeholder={
                future && !editing
                  ? "O que precisa estar na mesa."
                  : "Decisões, bloqueios, próximo passo."
              }
            />
          </FieldBlock>

          <DecisionsFieldset draft={draft} />
          <ActionsFieldset draft={draft} onClose={onClose} />
          {draft.error && (
            <p role="alert" className="mt-3 text-[13px] text-rose">
              {draft.error}
            </p>
          )}
        </fieldset>
      </form>
    </Drawer>
  );
}
