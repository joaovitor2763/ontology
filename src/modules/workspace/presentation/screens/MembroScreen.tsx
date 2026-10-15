"use client";
import { clientEntry } from "@/shared/infrastructure/client-entry";
import { normalizeAccess } from "@/modules/workspace/domain/permissions";
import { GoogleAccountCard } from "@/modules/workspace/presentation/GoogleAccountCard";
import { allocationRoleName } from "@/modules/clients/domain/allocation";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import type { MemberWorkSummary } from "@/modules/clients/domain/portfolio-summary";
import type { Delivery } from "@/modules/delivery/domain/models";
import { cycleStatusLabel } from "@/modules/delivery/domain/services";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { TaskDrawer } from "@/modules/delivery/presentation/TaskDrawer";
import { useAllClientsProgress } from "@/modules/delivery/presentation/useClientProgress";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { accessLabel } from "@/modules/workspace/domain/models";
import { emailOf } from "@/modules/workspace/infrastructure/queries";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { useAlertAcknowledgments } from "@/modules/workspace/presentation/useAlertAcknowledgments";
import { MemberForm } from "@/modules/workspace/presentation/MemberForm";
import { useAlerts } from "@/modules/workspace/presentation/useAlerts";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { ClientTaskDrawer } from "@/modules/workspace/presentation/ClientTaskDrawer";
import { useMemberWorkSummary } from "@/modules/workspace/presentation/useMemberWorkSummary";
import {
  NOW,
  dueMeta,
  formatDateTime,
  formatWeekday,
  severityLabel,
} from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { ListPanel } from "@/shared/ui/ListPanel";
import { PageHeading } from "@/shared/ui/PageHeading";
import { DataTable } from "@g4ai/ds";
import { MemberActiveDialog } from "../MemberActiveDialog";
import {
  Avatar,
  Badge,
  Button,
  Empty,
  HealthDot,
  Metric,
  Page,
  StatusBadge,
} from "@/shared/ui/primitives";
import {
  ArrowUpRight,
  Bell,
  Briefcase,
  CalendarDays,
  ClipboardList,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

/** One member of the team: allocations, open deliveries, meetings and alerts. Also the profile of the current user. */
export function MembroScreen({
  memberId,
  self = false,
}: {
  memberId: string;
  self?: boolean;
}) {
  const { mode, resolved } = useSyncStatus();
  if (!resolved) return <Page><p className="py-8 text-sm text-muted">Carregando membro…</p></Page>;
  return mode === "remote" ? <RemoteMembroScreen memberId={memberId} self={self} /> :
    <LocalMembroScreen memberId={memberId} self={self} />;
}

function RemoteMembroScreen({ memberId, self }: { memberId: string; self: boolean }) {
  const { clients } = useClientsState();
  const { hiddenAlerts } = useWorkspaceState();
  // A ciência é por pessoa e não muda documento: a marca relê a contagem de alertas.
  const acknowledged = useAlertAcknowledgments();
  const refreshOn = useMemo(() => [clients, hiddenAlerts, acknowledged], [clients, hiddenAlerts, acknowledged]);
  const { data, error, retry } = useMemberWorkSummary(memberId, refreshOn);
  if (!data) return <Page><div role={error ? "alert" : "status"} className="py-8 text-sm text-muted">
    {error ?? "Carregando membro…"}
    {error && <Button className="ml-3" size="sm" variant="ghost" onClick={retry}>Tentar novamente</Button>}
  </div></Page>;
  return <MembroContent memberId={memberId} self={self} work={data} remote
    error={error} retry={retry} />;
}

function LocalMembroScreen({ memberId, self }: { memberId: string; self: boolean }) {
  const { clients, allocations } = useClientsState();
  const { cycles } = useDeliveryState();
  const progress = useAllClientsProgress();
  const { alerts } = useAlerts();
  const allocated = new Set(allocations.filter(row => row.memberId === memberId).map(row => row.company));
  const tasks = Object.values(progress).flatMap(row => row.open)
    .filter(task => task.ownerId === memberId)
    .sort((a, b) => Number(!a.dueAt) - Number(!b.dueAt) || a.dueAt.localeCompare(b.dueAt));
  const work: MemberWorkSummary = {
    taskCount: tasks.length,
    hours: tasks.reduce((total, task) => total + task.hours, 0),
    tasks: tasks.slice(0, 6),
    alerts: alerts.filter(alert => clients.some(client => client.slug === alert.company && allocated.has(client.slug))),
    clients: Object.fromEntries(clients.filter(client => allocated.has(client.slug)).map(client => {
      const p = progress[client.slug];
      const cycle = cycles.find(row => row.company === client.slug &&
        (row.status === "em-curso" || row.status === "em-aceite"));
      return [client.slug, { planned: p?.planned.length ?? 0, done: p?.done.length ?? 0,
        percent: p?.percent ?? 0,
        cycle: cycle ? { id: cycle.id, name: cycle.name, status: cycle.status as "em-curso" | "em-aceite" } : null }];
    })),
  };
  return <MembroContent memberId={memberId} self={self} work={work} remote={false}
    localTasks={tasks} error={null} retry={() => {}} />;
}

function LocalMemberTaskDrawer({ task, onClose }: { task: Delivery; onClose: () => void }) {
  const { patchTask } = useDeliveryState();
  return <TaskDrawer task={task} onClose={onClose} onChange={patchTask} />;
}

function MembroContent({ memberId, self, work, remote, localTasks, error, retry }: {
  memberId: string; self: boolean; work: MemberWorkSummary; remote: boolean;
  localTasks?: Delivery[]; error: string | null; retry: () => void;
}) {
  const { clients, allocations } = useClientsState();
  const { workspaceName, allocationRoles } = useWorkspaceState();
  const { allMeetings } = useEngagementState();
  const { members, deactivated, me } = useTeam();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<{id:string;name:string;active:boolean}|null>(null);
  const [openTask, setOpenTask] = useState<{ id: string; company: string } | null>(null);
  const member = members.find((p) => p.id === memberId);
  if (!member)
    return (
      <Page>
        <Empty
          title="Membro não encontrado"
          hint="Este endereço não corresponde a um membro da equipe."
          action={
            <Button href={paths.teamMembers} variant="ghost" size="sm">
              Ver equipe
            </Button>
          }
        />
      </Page>
    );
  const off = deactivated.has(member.id);
  const myAllocations = allocations.filter((a) => a.memberId === member.id);
  const mine = clients.filter((c) =>
    myAllocations.some((a) => a.company === c.slug),
  );
  const tasks = work.tasks;
  const alerts = work.alerts;
  const meetings = allMeetings.filter((m) => m.attendeeIds.includes(member.id));
  const upcoming = meetings
    .filter((m) => m.startsAt >= NOW)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const recent = meetings
    .filter((m) => m.startsAt < NOW)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const agenda = upcoming.length ? upcoming : recent;
  const dedication = myAllocations.reduce((s, a) => s + a.percent, 0);
  const capacity = member.capacityHoursWeek;
  const currentTask = openTask && localTasks?.find(task => task.id === openTask.id);

  return (
    <Page>
      {error && <div role="alert" className="mb-4 rounded-xl border border-line bg-soft p-3 text-sm">
        {error} Os dados abaixo podem estar desatualizados.
        <Button className="ml-3" size="sm" variant="ghost" onClick={retry}>Tentar novamente</Button>
      </div>}
      <PageHeading
        title={member.name}
        kicker={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Avatar initials={member.initials} size="sm" />
            {workspaceName}
            {self ? " · Meu perfil" : ""}
            <Badge tone={member.access === "admin" ? "accent" : "neutral"}>
              {accessLabel[normalizeAccess(member.access)]}
            </Badge>
            {off && <Badge tone="warn">Inativo</Badge>}
          </span>
        }
        description={`${member.role} · ${emailOf(member)}${capacity != null ? ` · ${capacity} h/semana` : ""}`}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              {self ? "Editar perfil" : "Editar membro"}
            </Button>
            {self ? (
              <Button href={paths.settings} variant="ghost" size="sm">
                Ver como outro membro
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirm({id:member.id,name:member.name,active:off})}
                disabled={member.id === me.id}
              >
                {off ? "Reativar" : "Desativar"}
              </Button>
            )}
          </>
        }
      />

      <div className="mt-8 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric
          label="Clientes alocados"
          value={String(mine.length)}
          icon={<Briefcase className="h-3.5 w-3.5" />}
        />
        <Metric
          label="Tarefas abertas"
          value={String(work.taskCount)}
          icon={<ClipboardList className="h-3.5 w-3.5" />}
        />
        <Metric
          label={capacity ? "Dedicação alocada" : "Horas previstas"}
          value={
            capacity
              ? `${dedication}% · ${Math.round((capacity * dedication) / 100)} h`
              : `${work.hours} h`
          }
          icon={<Clock className="h-3.5 w-3.5" />}
          tone={dedication > 100 ? "bad" : "neutral"}
          bar={capacity ? Math.min(100, dedication) : undefined}
        />
        <Metric
          label="Alertas nos clientes"
          value={String(alerts.length)}
          tone={alerts.some((a) => a.severity === "critico") ? "bad" : alerts.length ? "warn" : "ok"}
          icon={<Bell className="h-3.5 w-3.5" />}
        />
      </div>

      {self && (
        <div className="mt-8">
          <GoogleAccountCard />
        </div>
      )}
      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[15px] font-medium">Clientes e alocações</h2>
          <Link
            href={paths.teamAllocation(member.id)}
            className="text-[13px] text-muted hover:text-ink"
          >
            Gerenciar alocação
          </Link>
        </div>
        <DataTable
          label="Clientes e alocações"
          rows={mine}
          rowKey={(c) => c.slug}
          rowLabel={(c) => c.name}
          empty={
            <p className="p-4 text-[13.5px] text-muted">
              {self
                ? "Você ainda não está alocado em nenhum cliente."
                : "Sem alocação em clientes."}
            </p>
          }
          columns={[
            {
              key: "client",
              header: "Cliente",
              primary: true,
              cell: (c) => (
                <Link
                  href={clientEntry(c.slug)}
                  className="inline-flex items-center gap-2 font-medium hover:underline"
                >
                  <HealthDot flag={c.healthFlag} />
                  {c.name}
                </Link>
              ),
            },
            {
              key: "role",
              header: "Papel · dedicação",
              className: "text-ink-soft",
              cell: (c) =>
                myAllocations
                  .filter((a) => a.company === c.slug)
                  .map((a) => `${allocationRoleName(a.role, allocationRoles)} · ${a.percent}%`)
                  .join(", "),
            },
            {
              key: "cycle",
              header: "Ciclo atual",
              wide: true,
              className: "text-ink-soft",
              cell: (c) => {
                const cycle = work.clients[c.slug]?.cycle;
                return (
                  <>
                    <Link href={paths.clientPlan(c.slug, "ciclos")} className="hover:underline">
                      {cycle?.name ?? "Planejar ciclo"}
                    </Link>
                    {cycle && (
                      <span className="ml-2 text-[12px] text-muted">
                        {cycleStatusLabel[cycle.status]}
                      </span>
                    )}
                  </>
                );
              },
            },
            {
              key: "tasks",
              header: "Tarefas",
              className: "tabular-nums text-ink-soft",
              cell: (c) => {
                const p = work.clients[c.slug];
                return p ? `${p.done}/${p.planned} · ${p.percent}%` : "—";
              },
            },
          ]}
        />
      </section>

      <div className="mt-10 grid items-start gap-6 lg:grid-cols-3">
        <ListPanel
          title="Tarefas abertas"
          icon={<ClipboardList />}
          count={work.taskCount}
          action={<Link href={paths.execution()}>Ver execução</Link>}
        >
          {work.taskCount ? (
            <ul className="divide-y divide-line">
              {tasks.map((d) => {
                const due = dueMeta(d.dueAt);
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => setOpenTask(d)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-soft/50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium">{d.title}</div>
                        <div className="mt-0.5 text-[12px] text-muted">
                          {clients.find((c) => c.slug === d.company)?.name} ·{" "}
                          <span className={due.tone === "bad" ? "text-rose" : undefined}>
                            {due.label}
                          </span>
                        </div>
                      </div>
                      <StatusBadge status={d.status} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty framed={false} title="Nenhuma tarefa aberta" hint="Nada atribuído a este membro no momento." />
          )}
        </ListPanel>
        <ListPanel
          title={upcoming.length ? "Próximas reuniões" : "Últimas reuniões"}
          icon={<CalendarDays />}
          action={<Link href={paths.agenda}>Ver agenda</Link>}
        >
          {agenda.length ? (
            <ul className="divide-y divide-line">
              {agenda.slice(0, 5).map((m) => (
                <li key={m.id}>
                  <Link
                    href={paths.meeting(m.id)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-soft/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium">{m.title}</div>
                      <div className="mt-0.5 text-[12px] text-muted">
                        {clients.find((c) => c.slug === m.company)?.name} ·{" "}
                        {formatWeekday(m.startsAt)}
                      </div>
                    </div>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty framed={false} title="Nenhuma reunião" hint="Este membro ainda não participou de reuniões registradas." />
          )}
        </ListPanel>
        <ListPanel
          title="Alertas nos clientes"
          icon={<Bell />}
          count={alerts.length}
          tone={alerts.length ? "attention" : "neutral"}
          action={<Link href={paths.alerts()}>Ver alertas</Link>}
        >
          {alerts.length ? (
            <ul className="divide-y divide-line">
              {alerts.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <Link
                    href={paths.alerts(a.company)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-soft/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium">{a.title}</div>
                      <div className="mt-0.5 text-[12px] text-muted">
                        {clients.find((c) => c.slug === a.company)?.name} ·{" "}
                        {formatDateTime(a.openedAt)}
                      </div>
                    </div>
                    <Badge
                      tone={
                        a.severity === "critico"
                          ? "bad"
                          : a.severity === "atencao"
                            ? "warn"
                            : "neutral"
                      }
                    >
                      {severityLabel[a.severity]}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty framed={false} title="Nenhum alerta" hint="Os clientes deste membro estão em dia." />
          )}
        </ListPanel>
      </div>
      {editing && <MemberForm member={member} onClose={() => setEditing(false)} />}
      {confirm&&<MemberActiveDialog memberId={confirm.id} name={confirm.name} active={confirm.active} onClose={()=>setConfirm(null)}/>}
      {openTask && (remote
        ? <ClientTaskDrawer company={openTask.company} taskId={openTask.id}
            onClose={() => setOpenTask(null)} />
        : currentTask && <LocalMemberTaskDrawer task={currentTask}
            onClose={() => setOpenTask(null)} />)}
    </Page>
  );
}
