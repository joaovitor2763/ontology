"use client";
import { clientEntry } from "@/shared/infrastructure/client-entry";
import { nextOpenTask } from "@/modules/delivery/application/progress";
import { monthShort } from "@/shared/lib/dates";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import type { HomeSummary } from "@/modules/clients/domain/portfolio-summary";
import { usePortfolioSummary } from "@/modules/clients/presentation/usePortfolioSummary";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";

import { DeliveryOverview } from "@/modules/delivery/presentation/DeliveryOverview";
import { useAllClientsProgress } from "@/modules/delivery/presentation/useClientProgress";
import { useAlerts } from "@/modules/workspace/presentation/useAlerts";
import { primaryAlertFor } from "@/modules/workspace/domain/derived-alerts";
import { useAllClientsHealth } from "@/modules/clients/presentation/useClientHealth";
import { agendaEntries } from "@/modules/engagement/application/agenda";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Repeat2,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { cycleStatusLabel } from "@/modules/delivery/domain/services";
import { MeetingForm } from "@/modules/engagement/presentation/MeetingForm";
import { cn } from "@/shared/lib/cn";
import { ClientMark } from "@/modules/clients/presentation/ClientMark";
import { DataTable } from "@g4ai/ds";
import {
  NOW,
  formatDateTime,
  formatWeekday,
} from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { ListPanel } from "@/shared/ui/ListPanel";
import { PageHeading } from "@/shared/ui/PageHeading";
import {
  Badge,
  Button,
  Empty,
  FilterChip,
  HealthDot,
} from "@/shared/ui/primitives";
import { StickyHeader } from "@/shared/ui/StickyHeader";
import { useAlertAudience } from "@/modules/workspace/presentation/useAlertAudience";

export default function OverviewPage() {
  const { mode, resolved } = useSyncStatus();
  if (!resolved) return <div className="p-8 text-sm text-muted">Carregando visão geral…</div>;
  return mode === "remote" ? <RemoteOverview /> : <LocalOverview />;
}

function RemoteOverview() {
  const { clients } = useClientsState();
  const { home, error, loading, retry } = usePortfolioSummary(clients);
  return <OverviewContent home={home} error={error} loading={loading} retry={retry} />;
}

function LocalOverview() {
  const { clients } = useClientsState();
  const progress = useAllClientsProgress();
  const { alerts } = useAlerts();
  const healthOf = useAllClientsHealth();
  const home: HomeSummary = {
    clients: {}, taskCounts: { fila: 0, "em-curso": 0, revisao: 0, entregue: 0, bloqueado: 0 },
    openTasks: 0, blocked: 0, activeCycles: 0, inReview: 0, pendingAcceptance: [],
  };
  for (const client of clients) {
    const p = progress[client.slug];
    if (!p) continue;
    const primary = primaryAlertFor(client.slug, alerts, {
      today: NOW, health: healthOf[client.slug],
      nextStep: client.nextMilestone
        ? { text: client.nextMilestone, dueAt: client.nextMilestoneAt || undefined } : null,
    });
    const current = p.currentCycle;
    home.clients[client.slug] = {
      planned: p.planned.length, done: p.done.length, percent: p.percent,
      currentCycle: current ? { id: current.id, name: current.name, status: current.status } : null,
      health: healthOf[client.slug],
      primary: primary && primary.kind !== "sem-reuniao"
        ? { company: primary.company, kind: primary.kind, rank: primary.rank,
          severity: primary.severity, title: primary.title,
          action: primary.action, target: primary.target } : null,
      nextTaskTitle: nextOpenTask(p.open)?.title ?? null,
    };
    for (const task of p.planned) home.taskCounts[task.status] += 1;
    home.openTasks += p.open.length;
    home.blocked += p.blocked.length;
    const activeCycles = p.cycles.filter(cycle =>
      cycle.status === "em-curso" || cycle.status === "em-aceite");
    home.activeCycles += activeCycles.length;
    home.inReview += activeCycles.filter(cycle => cycle.status === "em-aceite").length;
    home.pendingAcceptance.push(...activeCycles.filter(cycle => cycle.status === "em-aceite")
      .map(cycle => ({ id: cycle.id, company: cycle.company, name: cycle.name,
        endsAt: cycle.endsAt, acceptanceRequestedAt: cycle.acceptanceRequestedAt })));
  }
  home.pendingAcceptance.sort((a, b) => a.endsAt.localeCompare(b.endsAt));
  return <OverviewContent home={home} error={null} loading={false} retry={() => {}} />;
}

function OverviewContent({ home, error, loading, retry }: {
  home: HomeSummary | null; error: string | null; loading: boolean; retry: () => void;
}) {
  const { allMeetings, allEvents } = useEngagementState();
  const { clients, configFor, allocations } = useClientsState();
  const { me } = useTeam();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [health, setHealth] = useState<"all" | "yellow" | "red">("all");
  // "Precisa de atenção" leva a /alertas: segue o mesmo recorte da fila e do contador.
  const audience = useAlertAudience();
  const primaries = Object.values(home?.clients ?? {}).flatMap(row => row.primary ? [row.primary] : [])
    .filter(p => !audience || audience.has(p.company))
    .sort((a, b) => a.rank - b.rank);
  const targetHref = (p: NonNullable<HomeSummary["clients"][string]["primary"]>) =>
    p.target.type === "delivery"
      ? paths.clientDelivery(p.company, p.target.id)
      : p.target.type === "cycle"
        ? paths.clientCycle(p.company, p.target.id)
        : p.target.type === "meeting"
          ? paths.meeting(p.target.id)
          : clientEntry(p.company);
  const blocked = home?.blocked ?? 0;
  const openTasks = home?.openTasks ?? 0;
  const inReview = home?.inReview ?? 0;
  const mineSlugs = new Set(
    allocations.filter((a) => a.memberId === me.id).map((a) => a.company),
  );
  const scoped = clients.filter(
    (c) => scope === "all" || mineSlugs.has(c.slug),
  );
  const visible = scoped.filter(
    (c) => health === "all" || (home?.clients[c.slug]?.health.flag ?? "green") === health,
  );
  const entries = agendaEntries(allEvents, allMeetings);
  const future = entries.filter((e) => e.startsAt >= NOW).slice(0, 4);
  const past = entries
    .filter((e) => e.startsAt < NOW && e.meetingId)
    .reverse()
    .slice(0, 4);
  const upcomingTitle = future.length ? "Próximos compromissos" : "Últimas reuniões";
  const upcoming = (future.length ? future : past).map((e) => ({
    ...e,
    href: e.meetingId ? paths.meeting(e.meetingId) : paths.clientAgenda(e.company),
    subtitle: [e.kind, e.meta || e.place, clients.find((c) => c.slug === e.company)?.name]
      .filter(Boolean)
      .join(" · "),
  }));
  const pendingAcceptance = home?.pendingAcceptance ?? [];
  const shortcuts = [
    {
      href: paths.execution(),
      title: "Tarefas em aberto",
      value: openTasks,
      hint: blocked
        ? `${blocked} bloqueadas precisam de atenção`
        : "Nenhuma tarefa bloqueada",
      icon: ClipboardList,
      tone: blocked ? "text-amber" : "text-blue",
    },
    {
      href: paths.agenda,
      title: "Reuniões nos próximos 7 dias",
      value: allMeetings.filter(
        (m) =>
          m.startsAt >= NOW &&
          new Date(m.startsAt).getTime() <
            new Date(NOW).getTime() + 7 * 86400000,
      ).length,
      hint: "Alinhamentos e decisões com os clientes",
      icon: CalendarDays,
      tone: "text-muted",
    },
    {
      href: paths.execution("ciclos"),
      title: "Ciclos em andamento",
      value: home?.activeCycles ?? 0,
      hint: inReview
        ? `${inReview} aguardando aceite do cliente`
        : "Nenhum ciclo aguardando aceite",
      icon: Repeat2,
      tone: inReview ? "text-amber" : "text-blue",
    },
  ];
  if (!home) return (
    <div className="home-scroll flex-1 overflow-y-auto px-5 py-8 sm:px-7 lg:px-10">
      <PageHeading sticky={false} breadcrumb={false} title="Visão geral" description="Acompanhe seus clientes e tarefas." />
      <div className="mt-6 rounded-xl border border-line p-4 text-sm text-muted">
        <p>{error ?? (loading ? "Carregando visão geral…" : "A visão geral não está disponível.")}</p>
        {error && <Button className="mt-3" variant="ghost" onClick={retry}>Tentar novamente</Button>}
      </div>
    </div>
  );
  return (
    <div className="home-scroll enter min-h-0 flex-1 overflow-y-auto px-5 sm:px-7 lg:px-10">
      <StickyHeader className="home-hero mx-auto max-w-[1440px] pt-7 lg:pt-8">
        <p className="mb-3 text-[11px] first-letter:uppercase text-muted">
          {formatWeekday(NOW)}
        </p>
        <PageHeading
          sticky={false}
          breadcrumb={false}
          title={`Olá, ${me.name.split(" ")[0]}.`}
          description="O que precisa de você hoje, com o contexto para dar o próximo passo."
          actions={<MeetingForm />}
        />
      </StickyHeader>
      <div className="mx-auto max-w-[1440px] pb-10">
        {error && <div role="alert" className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-soft p-3 text-sm">
          <span>{error} Os dados abaixo podem estar desatualizados.</span>
          <Button size="sm" variant="ghost" onClick={retry}>Tentar novamente</Button>
        </div>}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {shortcuts.map(({ href, title, value, hint, icon: Icon, tone }) => (
            <Link
              key={href}
              href={href}
              className="home-metric surface-card surface-interactive group min-w-0 rounded-xl border border-line px-4 py-3 hover:border-line-strong"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-muted">{title}</span>
                <Icon
                  className="hidden h-4 w-4 text-muted sm:block"
                  strokeWidth={1.5}
                />
              </div>
              <div className="home-metric-value mt-1 text-[24px] font-semibold leading-tight tracking-tight tabular-nums">
                {value}
              </div>
              <p className={cn("mt-1 text-[12px] leading-relaxed", tone)}>
                {hint}
              </p>
            </Link>
          ))}
        </div>

        <DeliveryOverview counts={home.taskCounts} />
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
          <ListPanel
            title="Precisa de atenção"
            icon={<TriangleAlert />}
            count={primaries.length}
            tone={primaries.length ? "attention" : "neutral"}
            action={<Link href={paths.alerts()}>Ver alertas</Link>}
          >
            {primaries.length ? (
              <div className="divide-y divide-line">
                {primaries.slice(0, 5).map((p) => (
                  <Link
                    key={p.company}
                    href={targetHref(p)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-soft/40"
                  >
                    <HealthDot flag={home.clients[p.company]?.health.flag ?? "green"} />
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 text-[11px] text-muted">
                        {clients.find((c) => c.slug === p.company)?.name}
                      </div>
                      <div className="truncate text-[13px] font-medium">
                        {p.title}
                      </div>
                    </div>
                    <Badge tone={p.severity === "critico" ? "bad" : "warn"}>
                      {p.action}
                    </Badge>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted" />
                  </Link>
                ))}
              </div>
            ) : (
              <Empty
                framed={false}
                title="Tudo revisado"
                hint="Nenhum alerta aberto. Continue acompanhando as tarefas dos seus clientes."
                icon={<CheckCircle2 className="h-5 w-5 text-ok" />}
                action={
                  <Button href={paths.execution()} variant="ghost" size="sm">
                    Ver tarefas
                  </Button>
                }
              />
            )}
          </ListPanel>
          <ListPanel
            title={upcomingTitle}
            icon={<CalendarDays />}
            action={<Link href={paths.agenda}>Ver agenda</Link>}
          >
            {upcoming.length ? (
              <div className="divide-y divide-line">
                {upcoming.map((e) => (
                  <Link
                    key={`${e.kind}-${e.id}`}
                    href={e.href}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-soft/40"
                  >
                    <div className="flex w-10 shrink-0 flex-col items-center rounded-lg border border-line bg-soft/30 py-1">
                      <span className="text-[10px] uppercase text-muted">
                        {monthShort(new Date(e.startsAt))}
                      </span>
                      <span className="text-[18px] font-semibold leading-tight tabular-nums">
                        {new Date(e.startsAt).getDate()}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">
                        {e.title}
                      </div>
                      <p className="mt-1 truncate text-[11px] text-muted">
                        {formatDateTime(e.startsAt)} · {e.subtitle}
                      </p>
                    </div>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted" />
                  </Link>
                ))}
              </div>
            ) : (
              <Empty
                framed={false}
                title="Espaço para a próxima reunião"
                hint="Agende uma reunião para manter a evolução dos clientes em movimento."
                action={<MeetingForm variant="ghost" />}
              />
            )}
          </ListPanel>
        </div>
        {pendingAcceptance.length > 0 && (
          <div className="mt-6">
            <ListPanel
              title="Aceites pendentes"
              icon={<Repeat2 />}
              count={pendingAcceptance.length}
              action={<Link href={paths.execution("ciclos")}>Ver ciclos</Link>}
            >
              <div className="divide-y divide-line">
                {pendingAcceptance.slice(0, 4).map((cycle) => {
                  const since =
                    (cycle as { acceptanceRequestedAt?: string })
                      .acceptanceRequestedAt ?? cycle.endsAt;
                  const days = Math.max(
                    0,
                    Math.round(
                      (Date.parse(`${NOW.slice(0, 10)}T00:00:00`) -
                        Date.parse(`${since.slice(0, 10)}T00:00:00`)) /
                        86400000,
                    ),
                  );
                  return (
                    <Link
                      key={cycle.id}
                      href={paths.clientCycle(cycle.company, cycle.id)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-soft/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 text-[11px] text-muted">
                          {clients.find((c) => c.slug === cycle.company)?.name}
                        </div>
                        <div className="truncate text-[13px] font-medium">
                          {cycle.name}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 text-[12px]",
                          days > 5 ? "text-amber" : "text-muted",
                        )}
                      >
                        {days === 0
                          ? "enviado hoje"
                          : `aguardando há ${days} ${days === 1 ? "dia" : "dias"}`}
                      </span>
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted" />
                    </Link>
                  );
                })}
              </div>
            </ListPanel>
          </div>
        )}
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold">
                {scope === "mine" ? "Meus clientes" : "Todos os clientes"}
              </h2>
              <span className="rounded-md bg-soft px-1.5 py-0.5 text-[11px] text-muted">
                {visible.length}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip on={scope === "mine"} onClick={() => setScope("mine")}>
                Meus
              </FilterChip>
              <FilterChip on={scope === "all"} onClick={() => setScope("all")}>
                Todos
              </FilterChip>
              <span className="mx-1 h-5 w-px bg-line" aria-hidden />
              <FilterChip on={health === "all"} onClick={() => setHealth("all")}>
                Qualquer saúde
              </FilterChip>
              <FilterChip
                on={health === "yellow"}
                onClick={() => setHealth("yellow")}
              >
                Atenção
              </FilterChip>
              <FilterChip on={health === "red"} onClick={() => setHealth("red")}>
                Críticos
              </FilterChip>
              <Link
                href={paths.clients}
                aria-label="Ver todos os clientes"
                className="ml-2 inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink"
              >
                Ver todos <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
          <DataTable
            label="Carteira de clientes"
            rows={visible}
            rowKey={(c) => c.slug}
            rowLabel={(c) => c.name}
            empty={
              <Empty
                title={
                  scope === "mine" && !scoped.length
                    ? "Você ainda não está alocado em nenhum cliente"
                    : "Nenhum cliente nesta condição"
                }
                hint={
                  scope === "mine" && !scoped.length
                    ? "Peça uma alocação ou veja todos os clientes do workspace."
                    : "Os clientes estão em outras faixas de acompanhamento."
                }
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setHealth("all");
                      setScope("all");
                    }}
                  >
                    Mostrar todos os clientes
                  </Button>
                }
              />
            }
            columns={[
              {
                key: "client",
                header: "Cliente",
                primary: true,
                cell: (c) => (
                  <Link
                    href={clientEntry(c.slug)}
                    className="flex items-center gap-2.5 font-medium"
                  >
                    <ClientMark company={c} className="h-7 w-7 rounded-lg text-[11px]" />
                    <span className="min-w-0">
                      {c.name}
                      <span className="mt-0.5 block text-[11px] font-normal text-muted">
                        {c.sector}
                      </span>
                    </span>
                  </Link>
                ),
              },
              {
                key: "scope",
                header: "Escopo",
                mobileHidden: true,
                className: "text-ink-soft",
                cell: (c) => configFor(c.slug).name,
              },
              {
                key: "cycle",
                header: "Ciclo atual",
                cell: (c) => {
                  const cycle = home.clients[c.slug]?.currentCycle;
                  return (
                    <Link
                      href={
                        cycle
                          ? paths.clientCycle(c.slug, cycle.id)
                          : paths.clientPlan(c.slug, "ciclos")
                      }
                      className="block max-w-[240px] text-[12px] hover:text-blue"
                    >
                      {cycle?.name ?? "Planejar ciclo"}
                      {cycle && (
                        <span className="mt-1 block text-[11px] text-muted">
                          {cycleStatusLabel[cycle.status]}
                        </span>
                      )}
                    </Link>
                  );
                },
              },
              {
                key: "tasks",
                header: "Tarefas",
                mobileHidden: true,
                className: "text-[12px] tabular-nums text-ink-soft",
                cell: (c) => {
                  const p = home.clients[c.slug];
                  return (
                    <>
                      {p ? `${p.done}/${p.planned}` : "—"}
                      {p && <span className="ml-1 text-muted">· {p.percent}%</span>}
                    </>
                  );
                },
              },
              {
                key: "attention",
                header: "Atenção",
                mobileHidden: true,
                className: "max-w-[270px]",
                cell: (c) => {
                  const primary = primaries.find((x) => x.company === c.slug);
                  return (
                    <div className="flex items-center gap-2">
                      <HealthDot flag={home.clients[c.slug]?.health.flag ?? "green"} />
                      <span className="min-w-0 truncate text-[12px] text-muted">
                        {primary ? (
                          <>
                            <span className="text-ink">{primary.action}</span>
                            {" · "}
                            {primary.title}
                          </>
                        ) : (
                          <>
                            <span className="text-[10px] uppercase tracking-wider">
                              Próxima tarefa
                            </span>{" "}
                            {home.clients[c.slug]?.nextTaskTitle ?? "Sem tarefas abertas"}
                          </>
                        )}
                      </span>
                    </div>
                  );
                },
              },
            ]}
          />
        </section>
      </div>
    </div>
  );
}
