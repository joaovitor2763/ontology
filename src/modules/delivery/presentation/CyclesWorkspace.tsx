"use client";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import type { CycleTaskSummary } from "@/modules/delivery/infrastructure/execution-cycles-collection";
import { ClientExecutionProvider, useScopedClientExecution } from "@/modules/delivery/infrastructure/ClientExecutionProvider";
import { ClientTaskDrawer } from "@/modules/workspace/presentation/ClientTaskDrawer";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";

import { useCatalog } from "@/modules/catalog/presentation/catalog";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { padMilestone } from "@/shared/lib/format";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";
import { ArrowUpRight, CalendarDays, List, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import type { Delivery } from "@/modules/delivery/domain/models";
import {
  cycleStatusLabel,
  serviceDate,
  type ServiceCycle,
} from "@/modules/delivery/domain/services";
import { CycleDetail } from "@/modules/delivery/presentation/CycleDetail";
import { CycleForm } from "@/modules/delivery/presentation/CycleForm";
import { CycleList } from "@/modules/delivery/presentation/CycleList";
import { NewDeliveryForm } from "@/modules/delivery/presentation/NewDeliveryForm";
import { ServiceTimeline } from "@/modules/delivery/presentation/ServiceTimeline";
import { useServices } from "@/modules/delivery/presentation/state";
import { TaskDrawer } from "@/modules/delivery/presentation/TaskDrawer";
import { cn } from "@/shared/lib/cn";
import { paths } from "@/shared/lib/routes";
import { NOW, formatDate } from "@/shared/lib/format";
import {
  DensityControl,
  useCollectionDisplay,
} from "@/shared/ui/DisplayControls";
import { Drawer } from "@/shared/ui/Drawer";
import { FacetFilter } from "@/shared/ui/FacetFilter";
import { ListPanel } from "@/shared/ui/ListPanel";
import { PageHeading } from "@/shared/ui/PageHeading";
import { Button, Empty } from "@/shared/ui/primitives";
import { TableToolbar } from "@/shared/ui/TableToolbar";
import { Combobox } from "@/shared/ui/Combobox";
import { Modal } from "@/shared/ui/Dialog";

export function CyclesWorkspace({
  ...props
}: WorkspaceProps) {
  const { cycles, storageError, products } = useServices();
  const { statusMap, extraTasks, taskPatches, patchTask } = useDeliveryState();
  const { clientBySlug } = useClientsState();
  const { journeyOf } = useCatalog();
  const milestoneLabel = (cycle: ServiceCycle) => {
    if (!cycle.milestone) return null;
    const client = clientBySlug(cycle.company);
    const item = client?.slug ? journeyOf(client).milestones.find(m => m.n === cycle.milestone) : undefined;
    return `${padMilestone(cycle.milestone)}${item ? ` · ${item.name}` : ""}`;
  };
  const tasks = deliveriesFor(props.company, statusMap, extraTasks, taskPatches);
  return <CyclesWorkspaceSurface {...props} execution={{ cycles, storageError, products,
    tasks, localTasks: tasks,
    patchTask, milestoneLabel }} />;
}

type WorkspaceProps = {
  company?: string;
  cycleIds?: string[];
  schedule?: boolean;
  embedded?: boolean;
  initialClients?: string[];
  heading?: React.ReactNode;
};

type WorkspaceExecution = {
  cycles: ServiceCycle[];
  tasks: CycleTaskSummary[];
  products: ReturnType<typeof useServices>['products'];
  storageError?: string | null;
  localTasks?: Delivery[];
  patchTask?: (id: string, patch: Partial<Delivery>) => void;
  milestoneLabel: (cycle: ServiceCycle) => string | null;
  remote?: boolean;
  onCommitted?: () => void;
};

export function CyclesWorkspaceSurface({
  company,
  cycleIds,
  schedule = false,
  embedded = false,
  initialClients,
  heading,
  execution,
}: WorkspaceProps & { execution: WorkspaceExecution }) {
  const { cycles: allCycles, tasks: allTasks, storageError, products,
    patchTask, milestoneLabel, remote, onCommitted } = execution;
  const cycles = cycleIds ? allCycles.filter(c => cycleIds.includes(c.id)) : allCycles;
  const { clients: companies } = useClientsState();
  /** Inside a client, cycles are grouped by the milestone they execute. */
  const groupsOf = (list: ServiceCycle[]) => {
    if (!company) return [{ key: "all", label: null as string | null, items: list }];
    const map = new Map<number, ServiceCycle[]>();
    for (const c of list) {
      const key = c.milestone ?? 0;
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] === 0 ? 1 : b[0] === 0 ? -1 : a[0] - b[0]))
      .map(([n, items]) => ({
        key: String(n),
        label: n ? milestoneLabel(items[0]) : "Sem marco do plano",
        items,
      }));
  };
  const { allMeetings, allEvents } = useEngagementState();
  const { resolve } = useTeam();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [clients, setClients] = useState<string[]>(initialClients ?? []);
  const [productFilters, setProductFilters] = useState<string[]>([]);
  const productName = (id?: string) =>
    products.find((p) => p.id === id)?.name ?? "Produto não definido";
  const [statuses, setStatuses] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  /** `?marco=N` arrives from the plan: open the form with that milestone preselected. */
  const requestedMilestone = useSearchParams().get("marco");
  const [editing, setEditing] = useState<ServiceCycle | "new" | null>(
    requestedMilestone && company ? "new" : null,
  );
  // The form portals into document.body, so it only renders after hydration.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [openTask, setOpenTask] = useState<CycleTaskSummary | null>(null);
  const [adding, setAdding] = useState<ServiceCycle | null>(null);
  const { density, setDensity } = useCollectionDisplay(
    `cycles.${company ?? "all"}`,
    "list",
  );
  const [offset, setOffset] = useState(0);
  const [days, setDays] = useState(28);
  /** Inside a client the cycle is a page; the global view keeps the drawer. */
  const openCycle = (id: string) =>
    company ? router.push(paths.clientCycle(company, id)) : setSelected(id);
  const all = cycles.filter((c) => !company || c.company === company);
  const rows = all.filter(
    (c) =>
      (!clients.length || clients.includes(c.company)) &&
      (!statuses.length || statuses.includes(c.status)) &&
      (!productFilters.length || productFilters.includes(c.productId ?? "")) &&
      `${c.name} ${c.goal} ${productName(c.productId)} ${companies.find((x) => x.slug === c.company)?.name}`
        .toLocaleLowerCase("pt-BR")
        .includes(q.trim().toLocaleLowerCase("pt-BR")),
  );
  const rank = { "em-aceite": 0, "em-curso": 1, planejado: 2, concluido: 3 };
  if (!schedule)
    rows.sort(
      (a, b) =>
        rank[a.status] - rank[b.status] || a.endsAt.localeCompare(b.endsAt),
    );
  const current = all.find((c) => c.id === selected);
  const active = all.filter((c) => c.status === "em-curso");
  const review = all.filter((c) => c.status === "em-aceite");
  const late = all.filter(
    (c) => c.status !== "concluido" && c.endsAt < NOW.slice(0, 10),
  );
  const from = serviceDate(NOW);
  from.setDate(from.getDate() - ((from.getDay() + 6) % 7) - 7 + offset);
  const to = new Date(from);
  to.setDate(to.getDate() + days - 1);
  const filteredCompanies = new Set(rows.map((c) => c.company));
  const calendarItems = [
    ...allTasks
      .filter((t) => t.status !== "entregue")
      .map((t) => ({
        id: t.id,
        company: t.company,
        name: t.title,
        at: t.dueAt,
        kind: "Tarefa",
        task: t,
        href: undefined as string | undefined,
      })),
    ...allMeetings.map((m) => ({
      id: m.id,
      company: m.company,
      name: m.title,
      at: m.startsAt,
      kind: "Reunião",
      task: undefined as Delivery | undefined,
      href: paths.meeting(m.id),
    })),
    ...allEvents
      .filter((e) => !company || e.company === company)
      .map((e) => ({
      id: e.id,
      company: e.company,
      name: e.title,
      at: e.startsAt,
        kind: "Encontro",
        task: undefined as Delivery | undefined,
        href: paths.clientAgenda(e.company),
      })),
  ]
    .filter(
      (i) =>
        filteredCompanies.has(i.company) &&
        serviceDate(i.at) >= from &&
        serviceDate(i.at) <= to &&
        i.at.slice(0, 10) >= NOW.slice(0, 10),
    )
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 8);
  const ownerName = (id: string) => resolve(id).name;
  /** Inside a client with few cycles, the list is the list: no indicators, no filters. */
  const compactClient = embedded && !!company && all.length < 8;

  return (
    <div className="space-y-5" data-density={density}>
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {heading ?? <span />}
          <div className="flex flex-wrap items-center gap-2">
            {!schedule && (
              <DensityControl
                density={density}
                onChange={setDensity}
              />
            )}
            <Button onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" />
              Novo ciclo
            </Button>
          </div>
        </div>
      ) : (
      <PageHeading
        compact={!!company}
        title={schedule ? "Cronograma" : "Ciclos"}
        description={
          schedule
            ? "Prazos, ciclos e encontros para coordenar o trabalho com cada cliente."
            : "Abra ciclos a partir dos produtos contratados e adapte as tarefas para cada cliente."
        }
        actions={
          <>
            {!schedule && (
              <DensityControl
                density={density}
                onChange={setDensity}
              />
            )}
            <Button onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" />
              Novo ciclo
            </Button>
          </>
        }
      />
      )}
      {storageError && (
        <p role="alert" className="text-[13px] text-amber">
          {storageError}
        </p>
      )}
      {!compactClient && (
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-line py-3 text-[12px] text-muted">
        <span>
          <strong className="mr-1.5 text-[18px] font-semibold text-ink">
            {active.length}
          </strong>
          em andamento
        </span>
        <span>
          <strong className="mr-1.5 text-[18px] font-semibold text-ink">
            {review.length}
          </strong>
          aguardando aceite
        </span>
        <span>
          <strong
            className={cn(
              "mr-1.5 text-[18px] font-semibold",
              late.length ? "text-rose" : "text-ink",
            )}
          >
            {late.length}
          </strong>
          fora do prazo
        </span>
        {!embedded && (
          <Link
            className="ml-auto inline-flex items-center gap-1.5 text-ink-soft hover:text-ink"
            href={
              company
                ? paths.clientPlan(company, schedule ? "ciclos" : "cronograma")
                : paths.execution(schedule ? "ciclos" : "cronograma")
            }
          >
            {schedule ? (
              <List className="h-3.5 w-3.5" />
            ) : (
              <CalendarDays className="h-3.5 w-3.5" />
            )}
            {schedule ? "Ver ciclos" : "Ver cronograma"}
          </Link>
        )}
      </div>
      )}
      {!compactClient && (
      <TableToolbar
        query={q}
        onQuery={setQ}
        placeholder="Buscar ciclo ou objetivo…"
        shown={rows.length}
        total={all.length}
        noun="ciclo"
        dirty={
          !!(q || clients.length || statuses.length || productFilters.length)
        }
        onClear={() => {
          setQ("");
          setClients([]);
          setStatuses([]);
          setProductFilters([]);
        }}
      >
        {!company && (
          <FacetFilter
            label="Cliente"
            options={companies.map((c) => ({ id: c.slug, label: c.name }))}
            value={clients}
            onChange={setClients}
          />
        )}
        <FacetFilter
          label="Produto"
          options={products.map((p) => ({ id: p.id, label: p.name }))}
          value={productFilters}
          onChange={setProductFilters}
        />
        <FacetFilter
          label="Situação"
          options={Object.entries(cycleStatusLabel).map(([id, label]) => ({
            id,
            label,
          }))}
          value={statuses}
          onChange={setStatuses}
        />
      </TableToolbar>
      )}
      {!rows.length ? (
        <Empty
          title="Nenhum ciclo neste recorte"
          hint="Ajuste os filtros ou planeje o próximo resultado com o cliente."
          action={
            <Button variant="ghost" size="sm" onClick={() => setEditing("new")}>
              Planejar ciclo
            </Button>
          }
        />
      ) : schedule ? (
        <>
          <ServiceTimeline
            cycles={rows}
            tasks={allTasks}
            from={from}
            days={days}
            onDays={setDays}
            onMove={(direction) => setOffset((v) => v + direction * days)}
            onToday={() => setOffset(0)}
            onSelect={openCycle}
            ownerName={ownerName}
          />
          {company ? (
            <p className="text-[12.5px] text-muted">
              Reuniões e eventos do período ficam na{" "}
              <Link
                href={paths.clientAgenda(company)}
                className="text-blue hover:underline"
              >
                agenda do cliente
              </Link>
              .
            </p>
          ) : (
          <ListPanel
            title="Próximos compromissos"
            icon={<CalendarDays />}
            action={<Link href={paths.agenda}>Ver agenda</Link>}
          >
            <ul className="divide-y divide-line">
              {calendarItems.map((i) => {
                const content = (
                  <>
                    <div className="min-w-0 flex-1">
                      <span className="text-[11px] text-muted">
                        {i.kind}
                        {!company &&
                          ` · ${companies.find((c) => c.slug === i.company)?.name}`}
                      </span>
                      <span className="mt-0.5 block text-[13px] font-medium">
                        {i.name}
                      </span>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted">
                      {formatDate(i.at)}
                    </span>
                  </>
                );
                return (
                  <li key={i.id}>
                    {i.task ? (
                      <button
                        onClick={() => setOpenTask(i.task!)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-soft"
                      >
                        {content}
                      </button>
                    ) : (
                      <Link
                        href={i.href!}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-soft"
                      >
                        {content}
                      </Link>
                    )}
                  </li>
                );
              })}
              {!calendarItems.length && (
                <li className="p-4 text-[13px] text-muted">
                  Nenhum compromisso neste período.
                </li>
              )}
            </ul>
          </ListPanel>
          )}
        </>
      ) : (
        <div className="space-y-5">
          {groupsOf(rows).map((group) => (
            <div key={group.key}>
              {group.label && (
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                  {group.label}
                </p>
              )}
              <CycleList
                cycles={group.items}
                tasks={allTasks}
                company={company}
                ownerName={ownerName}
                productName={productName}
                milestoneLabel={company ? undefined : milestoneLabel}
                onSelect={openCycle}
              />
            </div>
          ))}
        </div>
      )}
      <Drawer
        open={!!current}
        onClose={() => { setSelected(null); if (remote) onCommitted?.(); }}
        title={current?.name ?? ""}
        kicker={
          current
            ? companies.find((c) => c.slug === current.company)?.name
            : undefined
        }
      >
        {current && (
          <div className="mb-4 flex justify-end">
            <Link
              href={paths.clientCycle(current.company, current.id)}
              onClick={() => setSelected(null)}
              className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink"
            >
              Abrir página
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
        {current && (remote ? <RemoteCycleDetail company={current.company} cycleId={current.id}
          onEdit={(cycle) => { setEditing(cycle); setSelected(null); }}
          onOpenTask={(task) => { setSelected(null); setOpenTask(task); }}
          onAddDelivery={(cycle) => { setSelected(null); setAdding(cycle); }}
          onDeleted={() => { setSelected(null); onCommitted?.(); }}
          onDuplicated={(id) => { setSelected(id); onCommitted?.(); }} /> :
          <CycleDetail
            key={current.id}
            cycle={current}
            tasks={execution.localTasks ?? []}
            onEdit={(cycle) => {
              setEditing(cycle);
              setSelected(null);
            }}
            onOpenTask={(task) => {
              setSelected(null);
              setOpenTask(task);
            }}
            onAddDelivery={(cycle) => { setSelected(null); setAdding(cycle); }}
            onDeleted={() => setSelected(null)}
            onDuplicated={(id) => openCycle(id)}
          />)}
      </Drawer>
      {editing && hydrated && (
        remote ? <RemoteCycleForm cycle={editing === "new" ? undefined : editing}
          company={company} initialClient={initialClients?.[0]}
          onClose={() => { setEditing(null); onCommitted?.(); }} /> :
          <CycleForm cycle={editing === "new" ? undefined : editing}
            company={company} onClose={() => setEditing(null)} />
      )}
      {adding && (
        remote ? <RemoteCycleTaskForm cycle={adding}
          onClose={() => { setAdding(null); onCommitted?.(); }} /> : <NewDeliveryForm
          company={adding.company}
          cycle={cycles.find((c) => c.id === adding.id) ?? adding}
          onClose={() => setAdding(null)}
        />
      )}
      {remote ? (openTask ? <ClientTaskDrawer key={`${openTask.company}:${openTask.id}`}
        company={openTask.company} taskId={openTask.id}
        onClose={() => { setOpenTask(null); onCommitted?.(); }} /> : null) :
        <TaskDrawer task={execution.localTasks?.find(task => task.id === openTask?.id) ?? null}
          onClose={() => setOpenTask(null)} onChange={patchTask!} />}
    </div>
  );
}

function RemoteCycleDetail({ company, cycleId, onEdit, onOpenTask,
  onAddDelivery, onDeleted, onDuplicated }: {
  company: string; cycleId: string;
  onEdit: (cycle: ServiceCycle) => void;
  onOpenTask: (task: Delivery) => void;
  onAddDelivery: (cycle: ServiceCycle) => void;
  onDeleted: () => void;
  onDuplicated: (id: string) => void;
}) {
  return <ClientExecutionProvider company={company}>
    <ScopedCycleDetail cycleId={cycleId} onEdit={onEdit} onOpenTask={onOpenTask}
      onAddDelivery={onAddDelivery} onDeleted={onDeleted}
      onDuplicated={onDuplicated} />
  </ClientExecutionProvider>;
}

function ScopedCycleDetail({ cycleId, onEdit, onOpenTask, onAddDelivery,
  onDeleted, onDuplicated }: Omit<Parameters<typeof RemoteCycleDetail>[0], 'company'>) {
  const scoped = useScopedClientExecution();
  const cycle = scoped?.cycles.find(row => row.id === cycleId);
  if (!cycle || !scoped)
    return <p className="p-4 text-sm text-muted">Este ciclo mudou. Atualize a lista para abri-lo.</p>;
  return <CycleDetail key={cycle.id} cycle={cycle} tasks={scoped.tasks}
    onEdit={onEdit} onOpenTask={onOpenTask} onAddDelivery={onAddDelivery}
    onDeleted={onDeleted} onDuplicated={onDuplicated} />;
}

function RemoteCycleForm({ cycle, company, initialClient, onClose }: {
  cycle?: ServiceCycle; company?: string; initialClient?: string;
  onClose: () => void;
}) {
  const { clients } = useClientsState();
  const [chosen, setChosen] = useState(company ?? cycle?.company ?? initialClient ?? '');
  const [ready, setReady] = useState(Boolean(company || cycle));
  if (!ready) return <Modal open onClose={onClose} title="Novo ciclo"
    description="Escolha o cliente para planejar o ciclo."
    footer={<Button disabled={!chosen} onClick={() => setReady(true)}>Continuar</Button>}>
    <div className="px-6 py-5">
      <Combobox label="Cliente" value={chosen} onValueChange={setChosen}
        options={clients.map(client => ({ value: client.slug, label: client.name }))}
        placeholder="Selecione o cliente" />
    </div>
  </Modal>;
  return <ClientExecutionProvider key={chosen} company={chosen}>
    <ScopedCycleForm cycle={cycle} company={chosen} onClose={onClose} />
  </ClientExecutionProvider>;
}

function ScopedCycleForm({ cycle, company, onClose }: {
  cycle?: ServiceCycle; company: string; onClose: () => void;
}) {
  const scoped = useScopedClientExecution();
  const current = cycle ? scoped?.cycles.find(row => row.id === cycle.id) : undefined;
  if (!scoped || (cycle && !current))
    return <p className="p-4 text-sm text-muted">Este ciclo mudou. Atualize a lista para editá-lo.</p>;
  return <CycleForm cycle={current} company={company} onClose={onClose} />;
}

function RemoteCycleTaskForm({ cycle, onClose }: {
  cycle: ServiceCycle; onClose: () => void;
}) {
  return <ClientExecutionProvider company={cycle.company}>
    <ScopedCycleTaskForm cycleId={cycle.id} onClose={onClose} />
  </ClientExecutionProvider>;
}

function ScopedCycleTaskForm({ cycleId, onClose }: { cycleId: string; onClose: () => void }) {
  const scoped = useScopedClientExecution();
  const cycle = scoped?.cycles.find(row => row.id === cycleId);
  if (!cycle)
    return <p className="p-4 text-sm text-muted">Este ciclo mudou. Atualize a lista para adicionar a tarefa.</p>;
  return <NewDeliveryForm company={cycle.company} cycle={cycle} onClose={onClose} />;
}
