"use client";
import { useRef, useState } from "react";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { clientOperationBaseline } from "@/shared/infrastructure/operations";
import {
  influenceLevels,
  stakeholderError,
  stakeholderRoles,
  stakeholderStances,
  type InfluenceLevel,
  type Stakeholder,
  type StakeholderStance,
} from "@/modules/clients/domain/stakeholders";
import { normalizeContactPoints } from "@/shared/lib/contact-points";
import { areaClass, Drawer, FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { MultiContactField } from "@/shared/ui/MultiContactField";
import { Select } from "@/shared/ui/Select";
import { Button } from "@/shared/ui/primitives";
import { Checkbox } from "@g4ai/ds";

export function StakeholderForm({
  contact,
  all,
  onClose,
  onSave,
}: {
  contact: Stakeholder;
  all: Stakeholder[];
  onClose: () => void;
  onSave: (s: Stakeholder, baseline: Record<string, string>) => Promise<void>;
}) {
  const { members } = useTeam();
  const [draft, setDraft] = useState(contact);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [baseline] = useState(clientOperationBaseline);
  return (
    <Drawer
      open
      onClose={() => { if (!submitting.current) onClose(); }}
      title={contact.name ? "Editar stakeholder" : "Adicionar stakeholder"}
      kicker="Contatos do cliente"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button form="stakeholder-form" type="submit" disabled={saving}>
            {saving ? "Salvando…" : "Salvar stakeholder"}
          </Button>
        </div>
      }
    >
      <form
        id="stakeholder-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting.current) return;
          const candidate: Stakeholder = {
            ...draft,
            name: draft.name.trim(),
            role: draft.role.trim(),
            email: draft.emails[0]?.trim().toLowerCase() ?? "",
            phone: draft.phones[0]?.trim() ?? "",
            area: draft.area.trim(),
            notes: draft.notes.trim(),
            communicationPreference: draft.communicationPreference?.trim() || undefined,
            helpOffered: draft.helpOffered?.trim() || undefined,
            initials: draft.name
              .trim()
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((n) => n[0])
              .join("")
              .toUpperCase(),
          };
          const issue = stakeholderError(candidate, [...members, ...all]);
          if (issue) {
            setError(issue);
            return;
          }
          const next = normalizeContactPoints(candidate);
          submitting.current = true; setSaving(true); setError("");
          try { await onSave(next, baseline); }
          catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível salvar. Tente novamente."); }
          finally { submitting.current = false; setSaving(false); }
        }}
      >
        <fieldset disabled={saving} className="contents">
        <FieldBlock label="Nome">
          <input
            required
            className={fieldClass}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </FieldBlock>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldBlock label="Cargo">
            <input
              required
              className={fieldClass}
              value={draft.role}
              onChange={(e) => setDraft({ ...draft, role: e.target.value })}
            />
          </FieldBlock>
          <FieldBlock label="Área">
            <input
              className={fieldClass}
              value={draft.area}
              onChange={(e) => setDraft({ ...draft, area: e.target.value })}
            />
          </FieldBlock>
        </div>
        <FieldBlock label="Papel no cliente">
          <Select
            label="Papel no cliente"
            value={draft.accountRole}
            onValueChange={(v) =>
              setDraft({
                ...draft,
                accountRole: v as Stakeholder["accountRole"],
              })
            }
            options={Object.entries(stakeholderRoles).map(([id, label]) => ({
              value: id,
              label,
            }))}
          />
        </FieldBlock>
        <MultiContactField
          label="E-mails"
          type="email"
          values={draft.emails}
          onChange={(emails) => setDraft({ ...draft, emails })}
        />
        <MultiContactField
          label="Telefones / WhatsApp"
          type="tel"
          values={draft.phones}
          onChange={(phones) => setDraft({ ...draft, phones })}
        />
        <FieldBlock label="Observações">
          <textarea
            rows={3}
            className={areaClass}
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="Responsabilidades e contexto para o relacionamento"
          />
        </FieldBlock>

        <div className="mb-3 mt-6 border-t border-line pt-5">
          <h3 className="text-[14px] font-medium">Relação</h3>
          <p className="mt-1 text-[12px] text-muted">
            Como a pessoa recebe o trabalho e o que precisa para apoiar as
            recomendações.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldBlock label="Postura">
            <Select
              label="Postura"
              value={draft.stance ?? "desconhecido"}
              onValueChange={(v) =>
                setDraft({ ...draft, stance: v as StakeholderStance })
              }
              options={Object.entries(stakeholderStances).map(([id, label]) => ({
                value: id,
                label,
              }))}
            />
          </FieldBlock>
          <FieldBlock label="Influência">
            <Select
              label="Influência"
              value={draft.influence ?? "media"}
              onValueChange={(v) =>
                setDraft({ ...draft, influence: v as InfluenceLevel })
              }
              options={Object.entries(influenceLevels).map(([id, label]) => ({
                value: id,
                label,
              }))}
            />
          </FieldBlock>
        </div>
        <FieldBlock label="Preferência de comunicação">
          <input
            className={fieldClass}
            value={draft.communicationPreference ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, communicationPreference: e.target.value })
            }
            placeholder="Ex.: resumo de uma página por e-mail antes da reunião"
          />
          <p className="mt-1.5 text-[12px] text-muted">
            Formato, tamanho e formalidade que a pessoa prefere.
          </p>
        </FieldBlock>
        <FieldBlock label="Ajuda oferecida">
          <textarea
            rows={2}
            className={areaClass}
            value={draft.helpOffered ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, helpOffered: e.target.value })
            }
            placeholder="Um insight, uma conexão, um material que entregamos em troca"
          />
          <p className="mt-1.5 text-[12px] text-muted">
            Nenhuma relação começa sem oferecer ajuda.
          </p>
        </FieldBlock>
        <Checkbox
          className="mb-4"
          label="Contato principal do cliente"
          description="Aparece no cabeçalho do cliente. Substitui o contato principal atual."
          checked={draft.primary}
          disabled={!draft.active}
          onCheckedChange={(primary) => setDraft({ ...draft, primary })}
        />
        <Checkbox
          label="Contato ativo"
          description="Contatos inativos permanecem no histórico das reuniões."
          checked={draft.active}
          onCheckedChange={(active) =>
            setDraft({
              ...draft,
              active,
              primary: active ? draft.primary : false,
            })
          }
        />
        {error && (
          <p role="alert" className="mt-4 text-[13px] text-rose">
            {error}
          </p>
        )}
        </fieldset>
      </form>
    </Drawer>
  );
}
