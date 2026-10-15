"use client";
import {
  influenceLevels,
  stakeholderCoverage,
  stakeholderRoles,
  stakeholderStances,
  type Stakeholder,
  type StakeholderCoverage,
  type StakeholderStance,
} from "@/modules/clients/domain/stakeholders";
import { useStakeholders } from "@/modules/clients/infrastructure/stakeholders-state";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { cn } from "@/shared/lib/cn";
import { NOW, formatDate, relativeFrom } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { Modal } from "@/shared/ui/Dialog";
import { FacetFilter } from "@/shared/ui/FacetFilter";
import { ActionMenu } from "@/shared/ui/Menu";
import { PageHeading } from "@/shared/ui/PageHeading";
import { Avatar, Badge, Button, Empty } from "@/shared/ui/primitives";
import { TableToolbar } from "@/shared/ui/TableToolbar";
import { Switch } from "@/shared/ui/Switch";
import { DataTable } from "@g4ai/ds";
import {
  Mail,
  Pencil,
  Phone,
  Plus,
  Star,
  UserMinus,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { StakeholderForm } from "./stakeholders/StakeholderForm";
import { contactEmails, contactPhones } from "@/shared/lib/contact-points";

const stanceTone: Record<StakeholderStance, "ok" | "neutral" | "bad"> = {
  apoiador: "ok",
  neutro: "neutral",
  cetico: "bad",
  desconhecido: "neutral",
};

const stanceDot: Record<StakeholderStance, string> = {
  apoiador: "bg-ok",
  neutro: "bg-line-strong",
  cetico: "bg-rose",
  desconhecido: "bg-line",
};

function StanceBadge({ stance }: { stance: StakeholderStance }) {
  if (stance === "desconhecido")
    return <span className="text-[12px] text-muted">Não avaliado</span>;
  return <Badge tone={stanceTone[stance]}>{stakeholderStances[stance]}</Badge>;
}

/** Compact block on the client overview: who they are and where the relationship stands. */
export function StakeholderSummary({ company }: { company: string }) {
  const { forCompany } = useStakeholders();
  const contacts = forCompany(company)
    .filter((s) => s.active)
    .sort((a, b) => Number(b.primary) - Number(a.primary));
  return (
    <section className="mt-6 border-t border-line pt-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-medium">
          <UsersRound className="h-4 w-4 text-muted" />
          Stakeholders{" "}
          <span className="text-[12px] text-muted">{contacts.length}</span>
        </h2>
        <Link
          className="text-[12px] text-muted hover:text-ink"
          href={paths.clientStakeholders(company)}
        >
          Mapa de relações →
        </Link>
      </div>
      <div className="mt-3 divide-y divide-line">
        {contacts.slice(0, 3).map((s) => (
          <Link
            key={s.id}
            href={paths.clientStakeholders(company)}
            className="flex items-center gap-3 py-3 hover:bg-soft/40"
          >
            <Avatar initials={s.initials} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[13px] font-medium">
                <span
                  aria-label={stakeholderStances[s.stance ?? "desconhecido"]}
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    stanceDot[s.stance ?? "desconhecido"],
                  )}
                />
                {s.name}
              </p>
              <p className="mt-1 text-[12px] text-muted">
                {s.role} · {stakeholderRoles[s.accountRole]}
                {s.primary ? " · Contato principal" : ""}
              </p>
            </div>
          </Link>
        ))}
      </div>
      {!contacts.length && (
        <p className="mt-3 text-[13px] text-muted">
          Cadastre os contatos que participam das decisões e tarefas.
        </p>
      )}
    </section>
  );
}

/**
 * The relationship map of a client: who decides, how each person receives us,
 * and who was never heard. Relationships are the backbone of the work; a
 * decision-maker the team never met is a support gap before any recommendation.
 */
export function Stakeholders({ company }: { company: string }) {
  const { contacts, forCompany, saveStakeholder, removeStakeholder, storageError } =
    useStakeholders();
  const { allMeetings } = useEngagementState();
  const [editing, setEditing] = useState<Stakeholder | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [actionError, setActionError] = useState("");
  async function runAction(action: () => Promise<void>, close = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setActionError("");
    try { await action(); if (close) setRemoving(null); }
    catch (error) { setActionError(error instanceof Error ? error.message : "Não foi possível salvar. Tente novamente."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const [q, setQ] = useState("");
  const [inactive, setInactive] = useState(false);
  const [stances, setStances] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const all = forCompany(company);
  const meetings = allMeetings.filter((m) => m.company === company);
  const coverage = new Map(
    stakeholderCoverage(all, meetings, NOW).map((c) => [c.stakeholder.id, c]),
  );
  const active = all.filter((s) => s.active);
  const supporters = active.filter((s) => s.stance === "apoiador").length;
  const skeptics = active.filter((s) => s.stance === "cetico").length;
  const unassessed = active.filter(
    (s) => !s.stance || s.stance === "desconhecido",
  ).length;
  const unmet = [...coverage.values()].filter((c) => c.keyButUnmet).length;
  const rows = all
    .filter(
      (s) =>
        (inactive || s.active) &&
        (!stances.length || stances.includes(s.stance ?? "desconhecido")) &&
        (!roles.length || roles.includes(s.accountRole)) &&
        `${s.name} ${s.role} ${s.area} ${contactEmails(s).join(" ")} ${contactPhones(s).join(" ")}`
          .toLocaleLowerCase("pt-BR")
          .includes(q.toLocaleLowerCase("pt-BR")),
    )
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        Number(b.primary) - Number(a.primary) ||
        a.name.localeCompare(b.name),
    );
  const dirty = !!q || inactive || stances.length > 0 || roles.length > 0;
  function newContact() {
    setEditing({
      id: `stakeholder-${crypto.randomUUID()}`,
      company,
      name: "",
      role: "",
      org: "client",
      initials: "",
      area: "",
      email: "",
      emails: [],
      phone: "",
      phones: [],
      accountRole: "ponto-focal",
      primary: !all.some((s) => s.active && s.primary),
      active: true,
      notes: "",
      stance: "desconhecido",
      influence: "media",
    });
  }
  return (
    <div className="space-y-5">
      <PageHeading
        compact
        title="Stakeholders"
        description="Quem decide, acompanha e valida as tarefas, e como cada pessoa recebe o trabalho."
        actions={
          <Button onClick={newContact} disabled={busy}>
            <Plus className="h-4 w-4" />
            Adicionar stakeholder
          </Button>
        }
      />
      {(storageError || actionError) && (
        <p role="alert" className="text-[13px] text-rose">
          {actionError || storageError}
        </p>
      )}
      <div
        className="flex flex-wrap gap-x-6 gap-y-2 border-y border-line py-3 text-[12px] text-muted"
        aria-label="Resumo das relações"
      >
        <span>
          <strong className="mr-1.5 text-[18px] font-semibold text-ink">
            {supporters}
          </strong>
          {supporters === 1 ? "apoiador" : "apoiadores"}
        </span>
        <span>
          <strong
            className={cn(
              "mr-1.5 text-[18px] font-semibold",
              skeptics ? "text-rose" : "text-ink",
            )}
          >
            {skeptics}
          </strong>
          {skeptics === 1 ? "cético" : "céticos"}
        </span>
        <span>
          <strong className="mr-1.5 text-[18px] font-semibold text-ink">
            {unassessed}
          </strong>
          {unassessed === 1 ? "não avaliado" : "não avaliados"}
        </span>
        <span>
          <strong
            className={cn(
              "mr-1.5 text-[18px] font-semibold",
              unmet ? "text-amber" : "text-ink",
            )}
          >
            {unmet}
          </strong>
          {unmet === 1 ? "decisor nunca ouvido" : "decisores nunca ouvidos"}
        </span>
      </div>
      <TableToolbar
        query={q}
        onQuery={setQ}
        placeholder="Buscar contato, cargo ou área…"
        shown={rows.length}
        total={all.length}
        noun="stakeholder"
        dirty={dirty}
        onClear={() => {
          setQ("");
          setInactive(false);
          setStances([]);
          setRoles([]);
        }}
      >
        <FacetFilter
          label="Postura"
          options={Object.entries(stakeholderStances).map(([id, label]) => ({
            id,
            label,
          }))}
          value={stances}
          onChange={setStances}
        />
        <FacetFilter
          label="Papel"
          options={Object.entries(stakeholderRoles).map(([id, label]) => ({
            id,
            label,
          }))}
          value={roles}
          onChange={setRoles}
        />
        <Switch
          label="Mostrar inativos"
          checked={inactive}
          onCheckedChange={setInactive}
        />
      </TableToolbar>
      {/* g4os-ds-disable-next-line data-states -- documento local (useStakeholders) já hidratado, sem carregamento próprio; a falha de gravação aparece no alerta acima */}
      <DataTable
        label="Stakeholders"
        rows={rows}
        rowKey={(row) => row.id}
        columns={[
          {
            key: "contact",
            header: "Contato",
            primary: true,
            cell: (row) => <ContactCell contact={row} busy={busy} onEdit={() => setEditing({ ...row })} />,
          },
          {
            key: "role",
            header: "Papel",
            width: 150,
            cell: (row) => <span className={cn("text-ink-soft", !row.active && "opacity-60")}>{stakeholderRoles[row.accountRole]}</span>,
          },
          {
            key: "stance",
            header: "Postura",
            width: 130,
            cell: (row) => <span className={cn(!row.active && "opacity-60")}><StanceBadge stance={row.stance ?? "desconhecido"} /></span>,
          },
          {
            key: "influence",
            header: "Influência",
            width: 110,
            cell: (row) => <span className={cn("text-ink-soft", !row.active && "opacity-60")}>{influenceLevels[row.influence ?? "media"]}</span>,
          },
          {
            key: "last",
            header: "Última interação",
            width: 180,
            className: "tabular-nums",
            cell: (row) => <LastInteraction contact={row} coverage={coverage.get(row.id)} />,
          },
          {
            key: "actions",
            header: <span className="sr-only">Ações</span>,
            action: true,
            align: "right",
            width: 56,
            cell: (row) => (
              <ActionMenu
                label={`Ações de ${row.name}`}
                actions={[
                  { label: "Editar", icon: <Pencil />, onSelect: () => setEditing({ ...row }), disabled: busy },
                  ...(row.primary
                    ? []
                    : [{
                        label: "Marcar como contato principal",
                        icon: <Star />,
                        onSelect: () => void runAction(() => saveStakeholder({ ...row, primary: true, active: true })),
                        disabled: busy,
                      }]),
                  {
                    label: row.active ? "Inativar" : "Reativar",
                    icon: row.active ? <UserMinus /> : <UserRoundCheck />,
                    onSelect: row.active
                      ? () => { setActionError(""); setRemoving(row.id); }
                      : () => void runAction(() => saveStakeholder({ ...row, active: true })),
                    disabled: busy,
                  },
                ]}
              />
            ),
          },
        ]}
        empty={
          <Empty
            title="Nenhum stakeholder neste recorte"
            hint="Adicione os contatos do cliente ou ajuste a busca."
          />
        }
      />
      <Modal
        open={removing !== null}
        onClose={() => { if (!inFlight.current) setRemoving(null); }}
        title="Inativar stakeholder?"
        description={`${all.find((s) => s.id === removing)?.name ?? "O contato"} ficará inativo. Seus vínculos e histórico serão preservados.`}
        size="sm"
        footer={<>
          <Button variant="ghost" disabled={busy} onClick={() => setRemoving(null)}>Cancelar</Button>
          <Button variant="danger" disabled={busy} onClick={() => { if (removing) void runAction(() => removeStakeholder(removing, company), true); }}>
            {busy ? "Inativando…" : "Inativar"}
          </Button>
        </>}
      >
        {actionError && <p role="alert" className="text-[13px] text-rose">{actionError}</p>}
      </Modal>
      {editing && (
        <StakeholderForm
          contact={editing}
          all={contacts}
          onClose={() => setEditing(null)}
          onSave={async (next, baseline) => {
            await saveStakeholder(next, baseline);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ContactCell({ contact: s, busy, onEdit }: { contact: Stakeholder; busy: boolean; onEdit: () => void }) {
  return (
        <div className={cn("flex items-center gap-3 font-normal", !s.active && "opacity-60")}>
          <Avatar initials={s.initials} size="sm" />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
              <button
                type="button"
                onClick={onEdit}
                disabled={busy}
                className="text-left hover:text-blue"
              >
                {s.name}
              </button>
              {s.primary && <Badge tone="ok">Contato principal</Badge>}
              {!s.active && <Badge tone="neutral">Inativo</Badge>}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-caption text-muted">
              <span>
                {s.role}
                {s.area ? ` · ${s.area}` : ""}
              </span>
              {contactEmails(s).map((email) => (
                <a
                  key={email}
                  href={`mailto:${email}`}
                  className="inline-flex items-center gap-1 hover:text-blue"
                >
                  <Mail className="h-3 w-3" />
                  <span className="sr-only">E-mail</span>
                  {email}
                </a>
              ))}
              {contactPhones(s).map((phone) => (
                <a
                  key={phone}
                  href={`tel:${phone.replace(/[^+\d]/g, "")}`}
                  className="inline-flex items-center gap-1 hover:text-blue"
                >
                  <Phone className="h-3 w-3" />
                  <span className="sr-only">Telefone</span>
                  {phone}
                </a>
              ))}
            </p>
            {s.communicationPreference && (
              <p className="mt-0.5 text-[11.5px] text-muted">
                Prefere: {s.communicationPreference}
              </p>
            )}
          </div>
        </div>
  );
}

function LastInteraction({ contact, coverage }: { contact: Stakeholder; coverage?: StakeholderCoverage }) {
  const lastAt = coverage?.lastAt ?? null;
  return (
    <span className={cn(!contact.active && "opacity-60")}>
      {lastAt ? (
        <span className="text-ink-soft" title={formatDate(lastAt)}>
          {relativeFrom(lastAt)}
        </span>
      ) : coverage?.keyButUnmet ? (
        <span className="inline-flex items-center gap-1.5 text-amber">
          <span className="h-1.5 w-1.5 rounded-full bg-amber" />
          Nunca · decide e não foi ouvido
        </span>
      ) : (
        <span className="text-muted">Nunca</span>
      )}
    </span>
  );
}
