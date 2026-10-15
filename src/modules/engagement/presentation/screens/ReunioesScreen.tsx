"use client";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";

import { useStakeholders } from "@/modules/clients/infrastructure/stakeholders-state";
import { useLocalStorageState } from "@/shared/infrastructure/useLocalStorageState";
import {
  DensityControl,
  useCollectionDisplay,
} from "@/shared/ui/DisplayControls";
import { PageHeading } from "@/shared/ui/PageHeading";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";

import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { paths } from "@/shared/lib/routes";
import {
  ArrowUpRight,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { meetingPrepChecklist } from "@/modules/engagement/domain/meetings";
import type { Meeting, MeetingKind } from "@/modules/engagement/domain/models";
import { MeetingForm } from "@/modules/engagement/presentation/MeetingForm";
import { cn } from "@/shared/lib/cn";
import { NOW, formatDateTime, meetingLabel } from "@/shared/lib/format";
import { MeetingLifecycleDialog, type MeetingLifecycleSelection } from "../MeetingLifecycleDialog";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { FacetFilter } from "@/shared/ui/FacetFilter";
import { TableToolbar } from "@/shared/ui/TableToolbar";
import { DataTable } from "@g4ai/ds";
import { ActionMenu } from "@/shared/ui/Menu";
import { MonthCalendar } from "@/shared/ui/MonthCalendar";
import { AvatarGroup, Button, Empty, Page } from "@/shared/ui/primitives";

const kindOptions = (Object.keys(meetingLabel) as MeetingKind[]).map((id) => ({
  id,
  label: meetingLabel[id],
}));

type SortKey = "startsAt" | "title" | "company" | "kind";

export default function ReunioesPage() {
  const { density, setDensity } = useCollectionDisplay("meetings");
  const { allMeetings, meetingsIncludingRemoved, removedMeetingIds } = useEngagementState();
  const {can}=usePermissions();
  const { resolve } = useTeam();
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [lifecycleSelection,setLifecycleSelection]=useState<MeetingLifecycleSelection|null>(null);
  const { clients, clientBySlug } = useClientsState();
  const companyOptions = clients.map((c) => ({ id: c.slug, label: c.name }));
  const { contacts } = useStakeholders();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [kinds, setKinds] = useState<string[]>([]);
  const [clientFilter, setClients] = useState<string[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [view, setView] = useLocalStorageState<"lista" | "calendario">(
    "ontology.reunioes.view",
    "lista",
  );
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "startsAt",
    dir: "desc",
  });

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const rows = allMeetings.filter((m) => {
      if (
        periods.length &&
        !periods.includes(m.startsAt > NOW ? "future" : "past")
      )
        return false;
      if (kinds.length && !kinds.includes(m.kind)) return false;
      if (clientFilter.length && !clientFilter.includes(m.company))
        return false;
      if (!query) return true;
      const names = m.attendeeIds
        .map(
          (id) =>
            (
              contacts.find((s) => s.company === m.company && s.id === id) ??
              resolve(id)
            ).name,
        )
        .join(" ");
      const hay =
        `${m.title} ${m.summary} ${m.notes} ${meetingLabel[m.kind]} ${clientBySlug(m.company)?.name ?? ""} ${names}`.toLowerCase();
      return hay.includes(query);
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (sort.key === "startsAt")
        return (
          dir *
          (new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
        );
      if (sort.key === "kind")
        return dir * a.kind.localeCompare(b.kind, "pt-BR");
      if (sort.key === "company") {
        const an = clientBySlug(a.company)?.name ?? "";
        const bn = clientBySlug(b.company)?.name ?? "";
        return dir * an.localeCompare(bn, "pt-BR");
      }
      return dir * a.title.localeCompare(b.title, "pt-BR");
    });
    return rows;
  }, [
    allMeetings,
    q,
    kinds,
    clientFilter,
    periods,
    sort,
    contacts,
    resolve,
    clientBySlug,
  ]);

  const activeFilters =
    kinds.length + clientFilter.length + periods.length + (q.trim() ? 1 : 0);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "startsAt" ? "desc" : "asc" },
    );
  }

  return (
    <Page density={density} className="max-w-none">
      <PageHeading
        title="Reuniões"
        description="Prepare os próximos encontros e encontre decisões e tarefas das reuniões anteriores."
        actions={
          <>
            <Button href={paths.agenda} variant="ghost" size="sm">
              Agenda
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
            {view === "lista" && (
              <DensityControl density={density} onChange={setDensity} />
            )}
            <SegmentedControl
              label="Visualização de reuniões"
              value={view}
              onChange={setView}
              options={[
                { value: "lista", label: "Lista" },
                { value: "calendario", label: "Calendário" },
              ]}
            />
            <MeetingForm />
          </>
        }
      />

      <div className="mt-6">
        <TableToolbar
          query={q}
          onQuery={setQ}
          placeholder="Filtrar reuniões…"
          shown={filtered.length}
          total={allMeetings.length}
          noun="reunião"
          nounPlural="reuniões"
          dirty={activeFilters > 0}
          onClear={() => {
            setQ("");
            setKinds([]);
            setClients([]);
            setPeriods([]);
          }}
        >
          <FacetFilter
            label="Tipo"
            options={kindOptions}
            value={kinds}
            onChange={setKinds}
          />
          <FacetFilter
            label="Cliente"
            options={companyOptions}
            value={clientFilter}
            onChange={setClients}
          />
          <FacetFilter
            label="Período"
            options={[
              { id: "future", label: "Próximas reuniões" },
              { id: "past", label: "Reuniões realizadas" },
            ]}
            value={periods}
            onChange={setPeriods}
          />
        </TableToolbar>
      </div>

      {view === "calendario" ? (
        <div className="mt-6">
          <MonthCalendar
            items={filtered.map((m) => ({
              id: m.id,
              title: m.title,
              startsAt: m.startsAt,
              href: paths.meeting(m.id),
              kicker: `${meetingLabel[m.kind]} · ${clientBySlug(m.company)?.name}`,
              tint: clientBySlug(m.company)?.tint,
            }))}
          />
        </div>
      ) : (
        <DataTable
          className="mt-4"
          label="Reuniões"
          density={density}
          rows={filtered}
          rowKey={(m) => m.id}
          rowLabel={(m) => `Abrir reunião: ${m.title}`}
          onRowClick={(m) => router.push(paths.meeting(m.id))}
          sort={{ sort, toggle: (key) => toggleSort(key as SortKey) }}
          empty={
            <Empty
              title="Nenhuma reunião encontrada"
              hint="Limpe os filtros ou agende a próxima conversa com seu cliente."
            />
          }
          columns={[
            {
              key: "startsAt",
              header: "Quando",
              sortKey: "startsAt",
              nowrap: true,
              className: "whitespace-nowrap tabular-nums text-ink-soft",
              cell: (m) => (
                <>
                  {formatDateTime(m.startsAt)}
                  {m.startsAt >= NOW && (
                    <span className="ml-2 text-meta text-blue">agendada</span>
                  )}
                </>
              ),
            },
            {
              key: "kind",
              header: "Tipo",
              sortKey: "kind",
              className: "text-ink-soft",
              cell: (m) => (
                <>
                  {meetingLabel[m.kind]}
                  {m.startsAt >= NOW &&
                    (() => {
                      const items = meetingPrepChecklist(m);
                      if (!items.length) return null;
                      const done = items.filter((i) => i.done).length;
                      return (
                        <span
                          className={cn(
                            "block text-meta",
                            done === items.length ? "text-ok" : "text-muted",
                          )}
                        >
                          Preparação {done}/{items.length}
                        </span>
                      );
                    })()}
                </>
              ),
            },
            {
              key: "company",
              header: "Cliente",
              sortKey: "company",
              cell: (m) => clientBySlug(m.company)?.name,
            },
            {
              key: "title",
              header: "Reunião",
              sortKey: "title",
              primary: true,
              className: "max-w-[360px]",
              cell: (m) => (
                <>
                  <Link
                    href={paths.meeting(m.id)}
                    className="font-medium hover:underline"
                  >
                    {m.title}
                  </Link>
                  <div
                    data-collection-secondary=""
                    className="truncate text-label font-normal text-muted"
                  >
                    {m.summary}
                  </div>
                </>
              ),
            },
            {
              key: "attendees",
              header: "Presentes",
              wide: true,
              cell: (m) => (
                <AvatarGroup
                  people={m.attendeeIds.map((id) => {
                    const p =
                      contacts.find(
                        (s) => s.company === m.company && s.id === id,
                      ) ?? resolve(id);
                    return {
                      name: p.name,
                      initials: p.initials,
                      tint: undefined,
                    };
                  })}
                />
              ),
            },
            {
              key: "decisions",
              header: "Decisões",
              className: "tabular-nums text-ink-soft",
              cell: (m) => m.decisions.length,
            },
            {
              key: "actions",
              header: <span className="sr-only">Ações</span>,
              action: true,
              align: "right",
              cell: (m) => (
                <ActionMenu
                  label={`Ações de ${m.title}`}
                  actions={[
                    {
                      label: "Abrir reunião",
                      icon: <ArrowUpRight />,
                      href: paths.meeting(m.id),
                    },
                    {
                      label: "Editar",
                      icon: <Pencil />,
                      onSelect: () => setEditing(m),
                    },
                    {
                      label: "Excluir",
                      icon: <Trash2 />,
                      tone: "danger",
                      separator: true,
                      onSelect: () => setLifecycleSelection({meeting:m}),
                      disabled: !can("reunioes.agendar",m.company),
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      )}
      {editing && (
        <MeetingForm
          meeting={editing}
          open
          onClose={() => setEditing(null)}
        />
      )}
      {removedMeetingIds.length>0&&<section className="mt-8 rounded-xl border border-line p-4"><h2 className="text-base font-medium">Reuniões removidas</h2><p className="mt-1 text-sm text-muted">Restaurar não reenvia convites nem altera tarefas.</p><ul className="mt-3 space-y-3">{meetingsIncludingRemoved.filter(m=>removedMeetingIds.includes(m.id)&&(!clientFilter.length||clientFilter.includes(m.company))).map(m=><li key={m.id} className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm">{m.title}</span>{can("reunioes.agendar",m.company)&&<Button size="sm" variant="ghost" onClick={()=>setLifecycleSelection({meeting:m,restore:true})}>Restaurar reunião</Button>}</li>)}</ul></section>}
      {lifecycleSelection&&<MeetingLifecycleDialog selection={lifecycleSelection} onClose={()=>setLifecycleSelection(null)}/>}

    </Page>
  );
}
