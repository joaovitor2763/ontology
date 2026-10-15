"use client";
import type { ProgramEvent } from "../../domain/models";
import { EventLifecycleDialog } from "../EventLifecycleDialog";
import { activeMeetingActions } from "@/modules/engagement/domain/meeting-lifecycle";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";

import { useStakeholders } from "@/modules/clients/infrastructure/stakeholders-state";

import { PageHeading } from "@/shared/ui/PageHeading";

import { useClientsState } from "@/modules/clients/infrastructure/state";
import {
  agendaEntries,
  type AgendaEntry,
} from "@/modules/engagement/application/agenda";
import { useLiveThreads } from "@/modules/engagement/infrastructure/relationship-state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";

import { Drawer } from "@/shared/ui/Drawer";
import { ListPanel } from "@/shared/ui/ListPanel";
import { Button } from "@/shared/ui/primitives";
import {
  ArrowUpRight,
  CalendarDays,
  Gavel,
  HeartPulse,
  LayoutTemplate,
  FlaskConical,
  Lightbulb,
  MessageCircle,
  Pencil,
  Stethoscope,
  Trash2,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { openPains, severityRank } from "@/modules/engagement/domain/diagnosis";
import { CommunicationTemplates } from "@/modules/engagement/presentation/CommunicationTemplates";
import {
  HypothesisList,
  PainList,
  SolutionList,
} from "@/modules/engagement/presentation/DiagnosisLists";
import type { Hypothesis } from "@/modules/engagement/domain/models";
import { openHypothesisStatuses } from "@/modules/engagement/domain/hypotheses";
import { EventForm } from "@/modules/engagement/presentation/EventForm";
import { ScheduleMenu } from "@/modules/engagement/presentation/ScheduleMenu";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import {
  NOW,
  formatDate,
  formatDateTime,
  meetingLabel,
} from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { MonthCalendar } from "@/shared/ui/MonthCalendar";

export default function ClientAgendaScreen() {
  const { slug } = useParams<{ slug: string }>();
  const { contacts } = useStakeholders();
  const {
    allMeetings,
    allEvents,
    eventsIncludingRemoved,
    allPains,
    allSolutions,
    allHypotheses,
  } = useEngagementState();
  const hypotheses = allHypotheses.filter((h) => h.company === slug);
  const openHypotheses = hypotheses.filter((h) =>
    openHypothesisStatuses.includes(h.status),
  );
  const [editingHypothesis, setEditingHypothesis] = useState<
    Hypothesis | "new" | null
  >(null);
  const params = useSearchParams();
  const router = useRouter();
  /** `?visao=diagnostico` deep-links the diagnosis (alerts and the meeting page point here). */
  const view: "agenda" | "diagnostico" =
    params.get("visao") === "diagnostico" ? "diagnostico" : "agenda";
  const setView = (next: "agenda" | "diagnostico") =>
    router.replace(
      next === "diagnostico"
        ? `${paths.clientAgenda(slug)}?visao=diagnostico`
        : paths.clientAgenda(slug),
    );
  const [templates, setTemplates] = useState(false);
  const pains = allPains
    .filter((p) => p.company === slug)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const open = openPains(pains);
  const solutions = allSolutions.filter((s) => s.company === slug);
  const { resolve } = useTeam();
  const { clientBySlug } = useClientsState();
  const [selected, setSelected] = useState<AgendaEntry | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [removed,setRemoved]=useState<ProgramEvent|null>(null);
  const [restoring,setRestoring]=useState(false);
  const meets = allMeetings.filter((m) => m.company === slug);
  const conv = useLiveThreads(slug);
  const evs = allEvents.filter((e) => e.company === slug);
  const entries = agendaEntries(evs, meets);
  const tint = clientBySlug(slug)?.tint;
  const cal = entries.map((e) => ({
    id: e.id,
    title: e.title,
    startsAt: e.startsAt,
    href: e.meetingId ? paths.meeting(e.meetingId) : undefined,
    onSelect: e.meetingId ? undefined : () => setSelected(e),
    kicker: e.kind,
    tint,
  }));
  const decisions = meets
    .filter((m) => m.startsAt <= NOW)
    .flatMap((m) => m.decisions.map((text) => ({ meeting: m, text })))
    .slice(0, 6);
  const selectedEvent = selected
    ? eventsIncludingRemoved.find((e) => `event:${e.id}` === selected.id)
    : undefined;
  const closeDrawer = () => {
    setSelected(null);
    setConfirm(false);
  };

  return (
    <div className="space-y-6">
      <PageHeading
        compact
        title={
          view === "agenda" ? "Agenda do cliente" : "Diagnóstico do cliente"
        }
        description={
          view === "agenda"
            ? "Reuniões, eventos, decisões e conversas recentes deste cliente."
            : "Dores levantadas nas reuniões, hipóteses de causa raiz em teste e opções propostas para cada uma."
        }
        actions={
          <>
            <SegmentedControl
              label="Visão"
              value={view}
              onChange={setView}
              options={[
                { value: "agenda", label: "Agenda", icon: <CalendarDays /> },
                {
                  value: "diagnostico",
                  label: "Diagnóstico",
                  icon: <Stethoscope />,
                },
              ]}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTemplates(true)}
            >
              <LayoutTemplate className="h-3.5 w-3.5" />
              Usar modelo
            </Button>
            <ScheduleMenu defaultCompany={slug} />
          </>
        }
      />
      {view === "diagnostico" && (
        <section className="space-y-6">
          <ListPanel
            title="Dores"
            icon={<HeartPulse />}
            count={pains.length}
            tone={open.length > 0 ? "attention" : "neutral"}
          >
            <PainList pains={pains} solutions={solutions} showMeeting />
          </ListPanel>
          <ListPanel
            title="Hipóteses"
            icon={<FlaskConical />}
            count={hypotheses.length}
            tone={openHypotheses.length > 0 ? "attention" : "neutral"}
            action={
              <button
                type="button"
                onClick={() => setEditingHypothesis("new")}
                className="text-blue hover:underline"
              >
                Nova hipótese
              </button>
            }
          >
            <HypothesisList
              hypotheses={hypotheses}
              pains={pains}
              company={slug}
              editing={editingHypothesis}
              onEditingChange={setEditingHypothesis}
            />
          </ListPanel>
          <ListPanel
            title="Opções e soluções"
            icon={<Lightbulb />}
            count={solutions.length}
          >
            <SolutionList solutions={solutions} pains={pains} />
          </ListPanel>
        </section>
      )}
      {view === "agenda" && (
        <>
          <MonthCalendar items={cal} />

          <section className="grid items-start gap-6 lg:grid-cols-2">
            <ListPanel
              title="Reuniões"
              icon={<Video />}
              count={meets.length}
              action={<Link href={paths.meetings}>Lista completa</Link>}
            >
              <ul className="divide-y divide-line">
                {meets.length === 0 && (
                  <li className="p-5 text-[13px] text-muted">
                    Nenhuma reunião registrada.
                  </li>
                )}
                {meets.map((m) => {
                  const actions = activeMeetingActions(m);
                  return (
                  <li key={m.id}>
                    <Link
                      href={paths.meeting(m.id)}
                      className="block px-4 py-3 hover:bg-soft/50"
                    >
                      <div className="text-[12.5px] text-muted">
                        {meetingLabel[m.kind]} · {formatDateTime(m.startsAt)}
                        {m.startsAt >= NOW && (
                          <span className="ml-2 text-blue">agendada</span>
                        )}
                      </div>
                      <div className="mt-1 font-medium leading-snug">
                        {m.title}
                      </div>
                      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
                        {m.summary}
                      </p>
                      <div className="mt-1.5 text-[12px] text-muted">
                        {m.attendeeIds
                          .map(
                            (id) =>
                              (
                                contacts.find(
                                  (s) => s.company === slug && s.id === id,
                                ) ?? resolve(id)
                              ).name.split(" ")[0],
                          )
                          .join(", ")}
                        {actions.length > 0 &&
                          ` · ${actions.filter((a) => !a.done).length} de ${actions.length} ações abertas`}
                      </div>
                    </Link>
                  </li>
                  );
                })}
              </ul>
            </ListPanel>

            <ListPanel
              title="Decisões recentes"
              icon={<Gavel />}
              count={decisions.length}
            >
              <ul className="divide-y divide-line">
                {decisions.length === 0 && (
                  <li className="p-5 text-[13px] text-muted">
                    Nenhuma decisão registrada nas reuniões realizadas.
                  </li>
                )}
                {decisions.map((d, i) => (
                  <li key={`${d.meeting.id}-${i}`}>
                    <Link
                      href={paths.meeting(d.meeting.id)}
                      className="block px-4 py-3 hover:bg-soft/50"
                    >
                      <div className="text-[14px] leading-relaxed">
                        {d.text}
                      </div>
                      <div className="mt-1 text-[12px] text-muted">
                        {d.meeting.title} · {formatDate(d.meeting.startsAt)}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </ListPanel>
          </section>

          <section className="grid items-start gap-6 lg:grid-cols-2">
            <ListPanel
              title="Conversas"
              icon={<MessageCircle />}
              count={conv.length}
              action={
                <Link href={paths.clientConversations(slug)}>
                  Abrir conversas
                </Link>
              }
            >
              <ul className="divide-y divide-line">
                {conv.length === 0 && (
                  <li className="p-5 text-[13px] text-muted">
                    Nenhuma conversa registrada.
                  </li>
                )}
                {conv.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={paths.clientConversations(slug, t.id)}
                      className="block px-4 py-3 hover:bg-soft/50"
                    >
                      <div className="text-[14px] font-medium">{t.title}</div>
                      <div className="text-[12.5px] text-muted">
                        {t.counterpart}
                        {t.unread > 0
                          ? ` · ${t.unread} não lida${t.unread === 1 ? "" : "s"}`
                          : ""}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </ListPanel>
            <ListPanel
              title="Dores abertas"
              icon={<HeartPulse />}
              count={open.length}
              tone={open.length > 0 ? "attention" : "neutral"}
              action={
                <button type="button" onClick={() => setView("diagnostico")}>
                  Ver diagnóstico
                </button>
              }
            >
              <PainList
                pains={open.slice(0, 5)}
                solutions={solutions}
                emptyHint="Nenhuma dor aberta. Registre uma reunião realizada para capturar novas dores."
              />
            </ListPanel>
          </section>

          <section className="grid items-start gap-6 lg:grid-cols-2">
            <ListPanel
              title="Eventos"
              icon={<CalendarDays />}
              count={evs.length}
            >
              <ul className="divide-y divide-line">
                {evs.length === 0 && (
                  <li className="p-5 text-[13px] text-muted">
                    Nenhum evento registrado.
                  </li>
                )}
                {evs.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelected(
                          entries.find((x) => x.id === `event:${e.id}`) ?? null,
                        )
                      }
                      className="block w-full px-4 py-3 text-left hover:bg-soft/50"
                    >
                      <div className="text-[12.5px] text-muted">
                        {formatDateTime(e.startsAt)}
                      </div>
                      <div className="text-[14px] font-medium">{e.title}</div>
                      <div className="text-[12.5px] text-muted">{e.place}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </ListPanel>
          </section>
        </>
      )}
      <CommunicationTemplates
        company={slug}
        open={templates}
        onClose={() => setTemplates(false)}
      />
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
              <Button href={paths.agenda} variant="ghost" size="sm">
                Ver agenda geral
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )
        }
      >
        {selected && (
          <div className="space-y-4 text-[14px]">
            <p className="text-muted">
              {formatDateTime(selected.startsAt)}
              {selected.place ? ` · ${selected.place}` : ""}
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
    </div>
  );
}
