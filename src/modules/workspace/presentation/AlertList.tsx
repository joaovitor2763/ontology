"use client";
import { clientEntry } from "@/shared/infrastructure/client-entry";
import {useWorkspaceOperation} from "./useWorkspaceOperation";
import {OperationFeedback} from "@/shared/ui/OperationFeedback";
import {usePermissions} from "./usePermissions";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";

import { useClientsState } from "@/modules/clients/infrastructure/state";
import type { Delivery } from "@/modules/delivery/domain/models";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { TaskDrawer } from "@/modules/delivery/presentation/TaskDrawer";
import { useAllClientsProgress } from "@/modules/delivery/presentation/useClientProgress";
import { revalidateDocuments, useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { alertsAcknowledged } from "@/shared/infrastructure/persistence";
import { ClientTaskDrawer } from "./ClientTaskDrawer";
import { useAlertQueue, type AlertTaskPreview } from "./useAlertQueue";
import {
  alertSourceLabel,
  type Alert,
  type AlertSeverity,
  type AlertSource,
} from "@/modules/workspace/domain/models";
import { useAlerts } from "@/modules/workspace/presentation/useAlerts";
import { useAlertAudience } from "@/modules/workspace/presentation/useAlertAudience";
import { primaryAlertFor } from "@/modules/workspace/domain/derived-alerts";
import { ALERT_BATCH_LIMIT, ALERT_PAGE_SIZE, alertKey, alertSelection } from "@/modules/workspace/domain/alert-selection";
import { NOW } from "@/shared/lib/format";
import { CheckCircle2, X } from "lucide-react";
import { DataTable, SearchInput } from "@g4ai/ds";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { cn } from "@/shared/lib/cn";
import { formatDateTime, severityLabel } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { ConfirmDialog, Modal } from "@/shared/ui/Dialog";
import { Checkbox } from "@/shared/ui/Checkbox";
import {
  DensityControl,
  useCollectionDisplay,
} from "@/shared/ui/DisplayControls";
import { FacetFilter } from "@/shared/ui/FacetFilter";
import {
  Badge,
  Button,
  Empty,
  SeverityDot,
  StatusBadge,
} from "@/shared/ui/primitives";

const severityOptions: { id: AlertSeverity; label: string }[] = [
  { id: "critico", label: "Crítico" },
  { id: "atencao", label: "Atenção" },
  { id: "info", label: "Info" },
];
const sourceOptions: { id: AlertSource; label: string }[] = [
  { id: "registrado", label: "Registrado" },
  { id: "derivado", label: "Derivado dos dados" },
];

/** Where an alert leads: the delivery, the cycle, the agenda or the client. */
function contextFor(alert: Alert) {
  if (alert.relatedCycleId)
    return { label: "Ver ciclo", href: paths.clientPlan(alert.company, "ciclos") };
  const meetingId = (alert as { relatedMeetingId?: string }).relatedMeetingId;
  if (meetingId) return { label: "Abrir reunião", href: paths.meeting(meetingId) };
  if (alert.kind === "sem-reuniao" || alert.kind === "decisor-nao-ouvido")
    return { label: "Ver agenda", href: paths.clientAgenda(alert.company) };
  if (alert.kind === "hipotese-sem-evidencia")
    return {
      label: "Ver diagnóstico",
      href: `${paths.clientAgenda(alert.company)}?visao=diagnostico`,
    };
  return { label: "Ir para o cliente", href: clientEntry(alert.company) };
}

export function AlertList({ company }: { company?: string }) {
  const { mode, resolved } = useSyncStatus();
  if (!resolved) return <div className="py-8 text-sm text-muted">Carregando alertas…</div>;
  return mode === "remote" ? <RemoteAlertList company={company} /> :
    <LocalAlertList company={company} />;
}

function LocalAlertList({ company }: { company?: string }) {
  const { alerts: queue } = useAlerts(company);
  // A fila global segue o recorte do servidor; a de um cliente é navegação explícita.
  const audience = useAlertAudience();
  const alerts = useMemo(() => company || !audience ? queue :
    queue.filter(alert => audience.has(alert.company)), [queue, company, audience]);
  const progress = useAllClientsProgress();
  const relatedTasks = useMemo(() => Object.fromEntries(alerts.flatMap(alert => {
    const task = alert.relatedDeliveryId && progress[alert.company]?.all.find(row =>
      row.id === alert.relatedDeliveryId);
    return task ? [[alertKey(alert), task]] : [];
  })), [alerts, progress]);
  return <AlertListContent company={company} all={alerts} relatedTasks={relatedTasks}
    remote={false} loading={false} error={null} retry={() => {}} />;
}

/** A fila do servidor já é a de quem pede: sem o que a pessoa marcou e sem o arquivo da equipe. */
function RemoteAlertList({ company }: { company?: string }) {
  const { data, relatedTasks, loading, error, retry } = useAlertQueue(company);
  const all = useMemo(() => data ?? [], [data]);
  return <AlertListContent company={company} all={all} relatedTasks={relatedTasks}
    remote loading={loading} error={error} retry={retry} />;
}

function LocalAlertTaskDrawer({ task, onClose }: { task: Delivery; onClose: () => void }) {
  const { patchTask } = useDeliveryState();
  return <TaskDrawer task={task} onClose={onClose} onChange={patchTask} />;
}

function AlertListContent({ company, all: queue, relatedTasks, remote, loading, error, retry }: {
  company?: string; all: Alert[];
  relatedTasks: Record<string, AlertTaskPreview | Delivery>;
  remote: boolean; loading: boolean; error: string | null; retry: () => void;
}) {
  const { density, setDensity } = useCollectionDisplay(
    `alerts.${company ?? "all"}`,
  );
  const router = useRouter();
  const { acknowledge, acknowledgeMany } = useWorkspaceState();
  /**
   * Publicado, a ciência não muda documento nenhum: o que a pessoa acabou de
   * marcar sai da lista por aqui até a fila relida do servidor já vir sem ele.
   * Uma recusa devolve os alertas à lista.
   */
  const [justSeen, setJustSeen] = useState<Set<string>>(() => new Set());
  const all = useMemo(() => justSeen.size ? queue.filter(alert => !justSeen.has(alertKey(alert))) : queue,
    [queue, justSeen]);
  const hideNow = (alerts: Alert[], hidden: boolean) => setJustSeen(current => {
    const next = new Set(current);
    for (const alert of alerts) {
      if (hidden) next.add(alertKey(alert));
      else next.delete(alertKey(alert));
    }
    return next;
  });
  const operation=useWorkspaceOperation();
  const {can}=usePermissions();
  const audience = useAlertAudience();
  const scoped = !company && audience !== null;
  const [notice, setNotice] = useState("");
  /**
   * Ciência é idempotente: uma falha não prende a tela numa repetição da mesma
   * tentativa (com as versões de antes, um conflito se repetiria para sempre).
   * A tentativa é descartada, os documentos e a fila são relidos e o próximo
   * gesto parte do estado atual do servidor.
   */
  async function acknowledgeNow(command: "alerts.acknowledge" | "alerts.acknowledgeBatch", input: unknown,
    alerts: Alert[], local: () => void, confirmed: () => void) {
    setNotice("");
    const failure = await operation.run(command, input,
      remote ? () => hideNow(alerts, true) : local, confirmed);
    if (failure) {
      if (remote) hideNow(alerts, false);
      operation.reset();
      setNotice(failure);
    } else if (remote) alertsAcknowledged();
    if (remote) await revalidateDocuments();
    retry();
    return failure;
  }
  function markSeen(alert:Alert){void acknowledgeNow("alerts.acknowledge",{company:alert.company,alertId:alert.id},[alert],()=>acknowledge(alert.id),()=>setOpen(current=>current&&alertKey(current)===alertKey(alert)?null:current));}
  const { clients: allClients } = useClientsState();
  const companyName = useCallback(
    (slug: string) => allClients.find((c) => c.slug === slug)?.name ?? slug,
    [allClients],
  );
  const [open, setOpen] = useState<Alert | null>(null);
  const [task, setTask] = useState<AlertTaskPreview | Delivery | null>(null);
  const [q, setQ] = useState("");
  const [sevs, setSevs] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [clients, setClients] = useState<string[]>([]);
  const [primaryOnly, setPrimaryOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState<Alert[] | null>(null);
  const primaryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of allClients) {
      const p = primaryAlertFor(c.slug, all, {
        today: NOW,
        nextStep: c.nextMilestone
          ? { text: c.nextMilestone, dueAt: c.nextMilestoneAt || undefined }
          : null,
      });
      if (p?.alert) ids.add(p.alert.id);
    }
    return ids;
  }, [all, allClients]);

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return all.filter((a) => {
      if (primaryOnly && !primaryIds.has(a.id)) return false;
      if (sevs.length && !sevs.includes(a.severity)) return false;
      if (sources.length && !sources.includes(a.source ?? "registrado"))
        return false;
      if (clients.length && !clients.includes(a.company)) return false;
      if (!query) return true;
      const hay =
        `${a.title} ${a.detail} ${companyName(a.company)}`.toLowerCase();
      return hay.includes(query);
    });
  }, [all, q, sevs, sources, clients, companyName, primaryOnly, primaryIds]);
  const mayAcknowledge = (company: string) => can("alertas.ciencia", company);
  const selection = alertSelection(rows, selected, mayAcknowledge);
  const pages = Math.max(1, Math.ceil(rows.length / ALERT_PAGE_SIZE));
  // A página volta ao início quando o recorte muda.
  const pageKey = JSON.stringify([q, sevs, sources, clients, primaryOnly]);
  const [pageState, setPageState] = useState({ key: pageKey, page: 0 });
  const page = Math.min(pageState.key === pageKey ? pageState.page : 0, pages - 1);
  const setPage = (next: number) => setPageState({ key: pageKey, page: next });
  const pageRows = rows.slice(page * ALERT_PAGE_SIZE, (page + 1) * ALERT_PAGE_SIZE);
  const pageSelection = alertSelection(pageRows, selected, mayAcknowledge);
  const selectableRows = selection.selectable;
  const selectedAlerts = alertSelection(all, selected, mayAcknowledge).selectedRows;
  const allVisibleSelected = selection.all;
  function toggleSelected(alerts: Alert[], checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const alert of alerts) {
        if (checked) next.add(alertKey(alert));
        else next.delete(alertKey(alert));
      }
      return next;
    });
  }
  /** Seleções acima do limite do servidor vão em lotes seguidos; uma falha interrompe o restante. */
  async function markSelected(alerts: Alert[]) {
    setNotice("");
    for (let start = 0; start < alerts.length; start += ALERT_BATCH_LIMIT) {
      const chunk = alerts.slice(start, start + ALERT_BATCH_LIMIT);
      const input = { alerts: chunk.map((alert) => ({ company: alert.company, alertId: alert.id })) };
      const failure = await operation.run("alerts.acknowledgeBatch", input,
        remote ? () => hideNow(chunk, true) : () => acknowledgeMany(chunk.map((alert) => alert.id)),
        () => setSelected((current) => {
          const next = new Set(current);
          for (const alert of chunk) next.delete(alertKey(alert));
          return next;
        }));
      if (failure) {
        if (remote) hideNow(chunk, false);
        operation.reset();
        setNotice(start ? `${start} alertas foram marcados. ${failure}` : failure);
        break;
      }
    }
    if (remote) {
      alertsAcknowledged();
      await revalidateDocuments();
    }
    retry();
  }

  if (scoped && audience.size === 0)
    return <Empty title="Nenhum cliente alocado a você"
      hint="Aqui aparecem os alertas dos clientes em que você está alocado. Os alertas de um cliente continuam na página dele." />;
  if (all.length === 0 && (loading || error)) return (
    <div role={error ? "alert" : "status"} className="rounded-xl border border-line p-5 text-sm text-muted">
      <p>{error ?? "Carregando alertas…"}</p>
      {error && <Button className="mt-3" variant="ghost" onClick={retry}>Tentar novamente</Button>}
    </div>
  );
  if (all.length === 0) {
    return (
      <Empty
        framed={false}
        title="Tudo revisado por aqui"
        hint={scoped ? "Nenhum alerta aberto nos clientes em que você está alocado."
          : "Nenhum alerta aberto. Acompanhe as tarefas e registre os próximos passos do cliente."}
        icon={<CheckCircle2 className="h-5 w-5 text-ok" />}
        action={
          <Button
            href={company ? paths.clientDeliveries(company) : paths.execution()}
            variant="ghost"
            size="sm"
          >
            Acompanhar tarefas
          </Button>
        }
      />
    );
  }

  const relatedTask = open ? relatedTasks[alertKey(open)] : undefined;
  const dirty = Boolean(q.trim() || sevs.length || sources.length || clients.length);
  const context = open ? contextFor(open) : null;

  return (
    <div data-density={density}>
      {scoped && <p className="mb-3 text-[12.5px] text-muted">Mostrando alertas dos clientes em que você está alocado.</p>}
      <OperationFeedback operation={operation} inline />
      {notice && !operation.error && <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 text-[13px] text-rose">
        <span>{notice} A lista foi atualizada; revise a seleção e tente de novo.</span>
        <Button size="sm" variant="ghost" onClick={() => setNotice("")}>Fechar</Button>
      </div>}
      {error && <div role="alert" className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-soft p-3 text-sm">
        <span>{error} Os dados abaixo podem estar desatualizados.</span>
        <Button size="sm" variant="ghost" onClick={retry}>Tentar novamente</Button>
      </div>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput
          className="table-search basis-full sm:min-w-[220px] sm:flex-1"
          value={q}
          onChange={setQ}
          placeholder="Filtrar alertas…"
        />
        <FacetFilter
          label="Gravidade"
          options={severityOptions}
          value={sevs}
          onChange={setSevs}
        />
        <FacetFilter
          label="Origem"
          options={sourceOptions}
          value={sources}
          onChange={setSources}
        />
        {!company && (
          <FacetFilter
            label="Cliente"
            options={allClients.filter((c) => !scoped || audience.has(c.slug))
              .map((c) => ({ id: c.slug, label: c.name }))}
            value={clients}
            onChange={setClients}
          />
        )}
        {dirty && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setSevs([]);
              setSources([]);
              setClients([]);
            }}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[13px] text-muted hover:bg-soft hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
            Limpar
          </button>
        )}
        <div className="inline-flex items-center gap-2 text-[12.5px] text-ink-soft">
          <Checkbox label="Principal por cliente" checked={primaryOnly} onCheckedChange={setPrimaryOnly} />
          <span>Principal por cliente</span>
        </div>
        <div className="ml-auto">
          <DensityControl density={density} onChange={setDensity} />
        </div>
        <span className="text-[12.5px] text-muted">
          {rows.length} de {all.length}
        </span>
        {selectableRows.length > 0 && (
          <Button size="sm" variant="ghost" disabled={operation.busy}
            onClick={() => toggleSelected(selectableRows, !allVisibleSelected)}>
            {selection.label}
          </Button>
        )}
      </div>

      {selectedAlerts.length > 0 && (
        <div role="toolbar" aria-label="Ações dos alertas selecionados" className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-soft/50 px-3 py-2 text-[13px]">
          <span className="font-medium">{selectedAlerts.length} selecionado{selectedAlerts.length === 1 ? "" : "s"}</span>
          <Button size="sm" disabled={operation.busy || operation.pending} onClick={() => setConfirming(selectedAlerts)}>
            Marcar como vistos
          </Button>
          <Button size="sm" variant="ghost" disabled={operation.busy} onClick={() => setSelected(new Set())}>Limpar seleção</Button>
          {pages > 1 && pageSelection.all && !selection.all && (
            <button type="button" className="font-medium text-ink underline underline-offset-2 disabled:opacity-40" disabled={operation.busy}
              onClick={() => toggleSelected(selectableRows, true)}>
              Selecionar todos os {selectableRows.length} alertas filtrados
            </button>
          )}
          {pages > 1 && selection.all && <span className="text-muted">Todos os alertas filtrados, em todas as páginas.</span>}
        </div>
      )}

      <DataTable
        className="alert-table"
        label="Alertas"
        rows={pageRows}
        rowKey={alertKey}
        rowLabel={(a) => `Abrir alerta: ${a.title}`}
        onRowClick={setOpen}
        rowSelected={(a) => selected.has(alertKey(a))}
        empty={
          <Empty
            framed={false}
            title="Nenhum alerta encontrado"
            hint="Ajuste a gravidade, a origem ou o cliente para ver os demais alertas."
          />
        }
        columns={[
          {
            key: "select",
            selection: true,
            width: 48,
            header: (
              <Checkbox hideLabel label="Selecionar os alertas desta página" disabled={!pageSelection.selectable.length || operation.busy}
                checked={pageSelection.all} indeterminate={pageSelection.some}
                onCheckedChange={(checked) => toggleSelected(pageSelection.selectable, checked)} />
            ),
            cell: (a) => (
              <Checkbox hideLabel label={`Selecionar alerta: ${a.title}`} disabled={operation.busy || !can("alertas.ciencia",a.company)}
                checked={selected.has(alertKey(a))} onCheckedChange={(checked) => toggleSelected([a], checked)} />
            ),
          },
          {
            key: "alert",
            header: "Alerta",
            primary: true,
            cell: (a) => (
              <>
                <div className="flex items-start gap-2.5 font-medium"><span className="mt-2"><SeverityDot severity={a.severity} /></span><span>{a.title}</span></div>
                <div className="ml-5 text-[12.5px] text-muted">
                  {severityLabel[a.severity]}
                </div>
              </>
            ),
          },
          ...(company ? [] : [{
            key: "client",
            header: "Cliente",
            cell: (a: (typeof pageRows)[number]) => companyName(a.company),
          }]),
          {
            key: "source",
            header: "Origem",
            cell: (a) => (
              <Badge tone="neutral">
                {a.source === "derivado" ? "Derivado" : "Registrado"}
              </Badge>
            ),
          },
          {
            key: "since",
            header: "Desde",
            nowrap: true,
            className: "tabular-nums text-ink-soft",
            cell: (a) => formatDateTime(a.openedAt),
          },
          {
            key: "action",
            header: "Ação",
            action: true,
            align: "right",
            cell: (a) => (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  markSeen(a);
                }}
                disabled={operation.busy||operation.pending||!can("alertas.ciencia",a.company)}
                className="text-[12.5px] text-muted hover:text-ink disabled:opacity-40"
              >
                Marcar como visto
              </button>
            ),
          },
        ]}
      />
      {pages > 1 && (
        <nav aria-label="Páginas de alertas" className="mt-3 flex items-center justify-end gap-2 text-[12.5px] text-muted">
          <span>{page * ALERT_PAGE_SIZE + 1}–{Math.min(rows.length, (page + 1) * ALERT_PAGE_SIZE)} de {rows.length}</span>
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button>
          <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Próxima</Button>
        </nav>
      )}

      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        size="sm"
        kicker={
          open
            ? `${severityLabel[open.severity]} · ${companyName(open.company)} · ${alertSourceLabel[open.source ?? "registrado"]}`
            : undefined
        }
        title={open?.title ?? ""}
        footer={
          open &&
          context && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (relatedTask) {
                    setOpen(null);
                    setTask(relatedTask);
                    return;
                  }
                  setOpen(null);
                  router.push(context.href);
                }}
              >
                {relatedTask ? "Abrir tarefa" : context.label}
              </Button>
              <Button
                size="sm"
                disabled={operation.pending||!can("alertas.ciencia",open.company)}
                onClick={() => {
                  markSeen(open);
                }}
              >
                Marcar como visto
              </Button>
            </>
          )
        }
      >
        {open && (
          <div className="space-y-4">
            <p className="text-[14px] leading-relaxed">{open.detail}</p>
            <div className="text-[12.5px] text-muted">
              Desde {formatDateTime(open.openedAt)}
            </div>
            {relatedTask && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-soft px-3 py-2.5 text-[13px]">
                <span className="min-w-0 truncate font-medium">
                  {relatedTask.title}
                </span>
                <StatusBadge status={relatedTask.status} />
              </div>
            )}
            <div
              className={cn(
                "rounded-xl px-3 py-2.5 text-[12.5px]",
                open.severity === "critico"
                  ? "bg-rose-soft text-rose"
                  : open.severity === "atencao"
                    ? "bg-amber-soft text-amber"
                    : "bg-soft text-ink-soft",
              )}
            >
              {open.severity === "critico"
                ? "Crítico: compromete o prazo ou o aceite do cliente se não for tratado esta semana."
                : open.severity === "atencao"
                  ? "Atenção: acompanhe de perto e defina o próximo passo."
                  : "Informativo: não bloqueia, mas merece um olhar."}
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!confirming} onClose={() => setConfirming(null)}
        title={`Marcar ${confirming?.length ?? 0} alertas como vistos?`}
        description="Os alertas selecionados sairão da sua fila. Para o resto da equipe, eles continuam visíveis."
        confirmLabel="Marcar como vistos" onConfirm={() => { if (confirming) void markSelected(confirming); }} />
      {task && (remote
        ? <ClientTaskDrawer company={task.company} taskId={task.id} onClose={() => setTask(null)} />
        : <LocalAlertTaskDrawer task={task as Delivery} onClose={() => setTask(null)} />)}
    </div>
  );
}
