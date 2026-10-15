"use client";
import type { ProgramEvent } from "../../domain/models";
import { EventLifecycleDialog } from "../EventLifecycleDialog";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { formatDateTime } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";

import { Drawer } from "@/shared/ui/Drawer";
import { agendaEntries, type AgendaEntry } from "../../application/agenda";

import { useLocalStorageState } from "@/shared/infrastructure/useLocalStorageState";
import {
  DensityControl,
  useCollectionDisplay,
} from "@/shared/ui/DisplayControls";
import { PageHeading } from "@/shared/ui/PageHeading";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";

import { useClientsState } from "@/modules/clients/infrastructure/state";
import { ArrowUpRight, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { EventForm } from "@/modules/engagement/presentation/EventForm";
import { EventList } from "@/modules/engagement/presentation/EventList";
import { ScheduleMenu } from "@/modules/engagement/presentation/ScheduleMenu";
import { FacetFilter } from "@/shared/ui/FacetFilter";
import { MonthCalendar } from "@/shared/ui/MonthCalendar";
import { Button, Page } from "@/shared/ui/primitives";
import { TableToolbar } from "@/shared/ui/TableToolbar";

export default function AgendaScreen() {
  const { density, setDensity } = useCollectionDisplay("agenda");
  const { allEvents, allMeetings, eventsIncludingRemoved } = useEngagementState();
  const { clients, clientBySlug } = useClientsState();
  const [view, setView] = useLocalStorageState<"lista" | "calendario">(
    "ontology.eventos.view",
    "calendario",
  );
  const [selected, setSelected] = useState<AgendaEntry | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [removed,setRemoved]=useState<ProgramEvent|null>(null);
  const [restoring,setRestoring]=useState(false);
  const [q, setQ] = useState("");
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const all = useMemo(
    () => agendaEntries(allEvents, allMeetings),
    [allEvents, allMeetings],
  );
  const kindOpts = [...new Set(all.map((e) => e.kind))].map((k) => ({
    id: k,
    label: k,
  }));
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return all.filter((e) => {
      if (clientFilter.length && !clientFilter.includes(e.company))
        return false;
      if (kinds.length && !kinds.includes(e.kind)) return false;
      if (!query) return true;
      const name = clientBySlug(e.company)?.name ?? "";
      return `${e.title} ${e.kind} ${e.place} ${e.meta ?? ""} ${e.detail} ${name}`
        .toLowerCase()
        .includes(query);
    });
  }, [all, q, clientFilter, kinds, clientBySlug]);
  const selectedEvent = selected
    ? eventsIncludingRemoved.find((e) => `event:${e.id}` === selected.id)
    : undefined;
  const closeDrawer = () => {
    setSelected(null);
    setConfirm(false);
  };

  return (
    <Page density={density} className="max-w-none">
      <PageHeading
        title="Agenda"
        description="Reuniões e eventos de todos os clientes."
        actions={
          <>
            {view === "lista" && (
              <DensityControl density={density} onChange={setDensity} />
            )}
            <SegmentedControl
              label="Visualização de agenda"
              value={view}
              onChange={setView}
              options={[
                { value: "lista", label: "Lista" },
                { value: "calendario", label: "Calendário" },
              ]}
            />
            <Button href={paths.meetings} variant="ghost" size="sm">
              Lista de reuniões
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
            <ScheduleMenu />
          </>
        }
      />

      <div className="mt-6">
        <TableToolbar
          query={q}
          onQuery={setQ}
          placeholder="Buscar compromisso, lugar ou cliente"
          shown={list.length}
          total={all.length}
          dirty={Boolean(q.trim() || clientFilter.length || kinds.length)}
          onClear={() => {
            setQ("");
            setClientFilter([]);
            setKinds([]);
          }}
          noun="compromisso"
        >
          <FacetFilter
            label="Cliente"
            options={clients.map((c) => ({ id: c.slug, label: c.name }))}
            value={clientFilter}
            onChange={setClientFilter}
          />
          <FacetFilter
            label="Tipo"
            options={kindOpts}
            value={kinds}
            onChange={setKinds}
          />
        </TableToolbar>
      </div>

      {view === "calendario" ? (
        <div className="mt-4">
          <MonthCalendar
            items={list.map((e) => ({
              id: e.id,
              title: e.title,
              startsAt: e.startsAt,
              href: e.meetingId ? paths.meeting(e.meetingId) : undefined,
              onSelect: e.meetingId ? undefined : () => setSelected(e),
              kicker: [
                e.kind,
                clientBySlug(e.company)?.name,
                e.place || e.meta,
              ]
                .filter(Boolean)
                .join(" · "),
              tint: clientBySlug(e.company)?.tint,
            }))}
          />
        </div>
      ) : (
        <EventList
          events={list}
          onOpenEvent={setSelected}
          onEditEvent={(e) => {
            setSelected(e);
            setEditing(true);
          }}
          onDeleteEvent={(e) => {
            setSelected(e);
            setConfirm(true);
          }}
        />
      )}
      <Drawer
        open={!!selected && !editing&&!confirm}
        onClose={closeDrawer}
        title={selected?.title ?? ""}
        kicker={selected?.kind}
        footer={
          selected && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirm(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Excluir
                </Button>
              </span>
              <Button
                href={paths.clientAgenda(selected.company)}
                variant="ghost"
                size="sm"
              >
                Abrir cliente
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )
        }
      >
        {selected && (
          <div className="space-y-4 text-[14px]">
            <p>{clientBySlug(selected.company)?.name}</p>
            <p className="text-muted">
              {formatDateTime(selected.startsAt)}
              {selected.place ? ` · ${selected.place}` : ""}
              {selected.meta ? ` · ${selected.meta}` : ""}
            </p>
            <p className="whitespace-pre-wrap leading-relaxed">
              {selected.detail || "Sem observações."}
            </p>
          </div>
        )}
      </Drawer>
      {confirm&&selectedEvent&&<EventLifecycleDialog event={selectedEvent} onClose={()=>setConfirm(false)} onConfirmed={()=>{setRemoved(selectedEvent);closeDrawer();}}/>}
      {removed&&<div className="my-4 flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 text-sm"><span>Evento removido: {removed.title}</span><Button variant="ghost" size="sm" onClick={()=>setRestoring(true)}>Restaurar evento</Button></div>}
      {restoring&&removed&&<EventLifecycleDialog event={removed} restore onClose={()=>setRestoring(false)} onConfirmed={()=>{setRestoring(false);setRemoved(null);}}/>}
      {selectedEvent && (
        <EventForm
          event={selectedEvent}
          open={editing}
          onClose={() => {
            setEditing(false);
            closeDrawer();
          }}
        />
      )}
    </Page>
  );
}
