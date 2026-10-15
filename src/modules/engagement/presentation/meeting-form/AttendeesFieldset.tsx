"use client";
import { Checkbox } from "@/shared/ui/Checkbox";
import { stakeholderRoles } from "@/modules/clients/domain/stakeholders";
import { Combobox } from "@/shared/ui/Combobox";
import { FieldBlock, areaClass } from "@/shared/ui/Drawer";
import type { MeetingDraft } from "./useMeetingDraft";

export function AttendeesFieldset({ draft }: { draft: MeetingDraft }) {
  const { google, editing, future, canSchedule, modality } = draft;
  return (
    <fieldset className="mb-5">
      <legend className="mb-2 text-[13px] font-medium">Participantes</legend>
      <p className="mb-3 text-[12px] text-muted">
        Selecione a equipe e os stakeholders deste cliente.
      </p>
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
      <FieldBlock label="Convidados externos (e-mails, um por linha)">
        <textarea
          value={draft.guestsText}
          onChange={(e) => draft.setGuestsText(e.target.value)}
          rows={2}
          className={areaClass}
          placeholder="fulano@cliente.com"
        />
      </FieldBlock>
      {!editing && future && google.enabled && !google.connected && (
        <p className="mt-3 rounded-xl border border-dashed border-line p-3 text-[12.5px] leading-relaxed text-muted">
          Para criar esta reunião no Google Agenda com link do Meet e convites,{" "}
          <a
            href="/api/google/auth"
            className="font-medium text-blue hover:underline"
          >
            conecte sua conta Google
          </a>
          . Fica no seu perfil, leva um minuto; depois volte e agende.
        </p>
      )}
      {canSchedule && modality === "online" && !google.canConfigureMeet && (
        <p className="mt-3 text-[13px] text-muted">
          Para ativar gravação e transcrição automáticas,{" "}
          <a className="underline" href="/api/google/auth">
            reconecte sua conta Google
          </a>{" "}
          antes de agendar.
        </p>
      )}
      {canSchedule && (
        <div className="mt-3 rounded-xl border border-line p-3">
          <Checkbox
            label={`Agendar no Google Agenda${modality === "online" ? " com link do Meet" : ""}`}
            hideLabel={false}
            description={`Na agenda de ${google.accountEmail}. Equipe, stakeholders com e-mail e convidados externos recebem o convite. No Meet, solicitamos gravação e transcrição automáticas quando alguém autorizado entrar.`}
            checked={draft.onGoogle}
            onCheckedChange={draft.setOnGoogle}
          />
        </div>
      )}
    </fieldset>
  );
}
