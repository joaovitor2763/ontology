"use client";
import { useTaskRemovalConfirmation } from "./useTaskRemovalConfirmation";
import { useTaskOperations } from "./useTaskOperations";
import { requestCompletion } from "../infrastructure/completion-request";
import type { TaskScope } from "../domain/task-scope";
import { filterBoardTasks } from "../application/board-filters";
import { directDueDatePatch } from "../domain/delivery-policy";
import { boardColumns, boardLane, boardLaneLabel, boardOrder, expandColumn, laneStatus, type BoardLane } from "../application/board";
import { blockedMoveMessage, droppedMovesMessage } from "../application/board-moves";
import { KanbanCard } from "./KanbanCard";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { useScopedClientExecution } from '@/modules/delivery/infrastructure/ClientExecutionProvider';
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";

import { useServices } from "@/modules/delivery/presentation/state";

import { useClientsState } from "@/modules/clients/infrastructure/state";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";
import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CirclePause,
  Inbox,
  Plus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";

import { useCatalog } from "@/modules/catalog/presentation/catalog";
import type {
  Delivery,
  DeliveryStatus,
} from "@/modules/delivery/domain/models";
import { NewDeliveryForm } from "@/modules/delivery/presentation/NewDeliveryForm";
import { TaskDrawer } from "@/modules/delivery/presentation/TaskDrawer";
import { useEvidenceEvaluatorForCycles } from "@/modules/delivery/presentation/useEvidence";
import { TaskList } from "@/modules/delivery/presentation/TaskList";
import { cn } from "@/shared/lib/cn";
import {
  dueMeta,
  formatDate,
  NOW,
  padMilestone,
} from "@/shared/lib/format";
import {
  DisplayControls,
  useCollectionDisplay,
} from "@/shared/ui/DisplayControls";
import { KanbanFilters, MY_CLIENTS } from "./KanbanFilters";
import { Button, Empty } from "@/shared/ui/primitives";
import { notify } from "@/shared/ui/Feedback";
import { SavedViews } from "@/shared/ui/SavedViews";

/** Identidade estável: uma coluna sem expansão não invalida a memoização. */
const EMPTY_SHOWN: Partial<Record<BoardLane, number>> = {};
const EMPTY_PINNED: string[] = [];
/** Opção do filtro Cliente que acompanha as alocações atuais da pessoa. */

export function Kanban({
  company,
  initialClients,
  initialMilestones,
}: {
  company?: string;
  initialClients?: string[];
  /** `?marco=N` from the plan: the board opens showing only that milestone. */
  initialMilestones?: string[];
}) {
  const operation = useTaskOperations();
  const scoped = useScopedClientExecution();
  const { statusMap, extraTasks, taskPatches, patchTask, removeTask } = useDeliveryState();
  const { journeyOf } = useCatalog();
  const { products, cycles } = useServices();
  const { clients: companies, clientBySlug } = useClientsState();
  const companyRec = company ? clientBySlug(company) : undefined;
  const msOptions = companyRec ? journeyOf(companyRec).milestones : [];
  const companyJourneyId = companyRec ? journeyOf(companyRec).id : undefined;
  /** Global and per-client boards read the same per-client projection, plan reference tasks included. */
  const items = useMemo(() => (
    company && scoped?.company === company
      ? scoped.tasks
      : company
      ? deliveriesFor(
          company,
          statusMap,
          extraTasks,
          taskPatches,
          companyJourneyId,
        )
      : companies.flatMap((c) =>
          deliveriesFor(
            c.slug,
            statusMap,
            extraTasks,
            taskPatches,
            journeyOf(c).id,
          ),
        )
  ), [company, companyJourneyId, companies, statusMap, extraTasks, taskPatches, journeyOf, scoped]);
  return <KanbanSurface company={company} initialClients={initialClients}
    initialMilestones={initialMilestones} items={items} cycles={cycles} products={products}
    msOptions={msOptions} operation={operation} patchTask={patchTask} onRemoved={removeTask}
    renderList={(tasks, onOpen, ownerName) => <TaskList tasks={tasks} company={company}
      onOpen={onOpen} ownerName={ownerName} />}
    renderCreate={(onClose, onCreated) => <NewDeliveryForm company={company}
      onClose={onClose} onCreated={onCreated} />}
    renderDrawer={(task, onClose, onChange) => <TaskDrawer task={task}
      onClose={onClose} onChange={onChange} />} />;
}

export type KanbanOperation = {
  error: string; busy: boolean; retry: () => Promise<unknown>;
  /** A write whose outcome is unknown; without it, any error blocks the next gesture. */
  blocking?: boolean;
  /** Non-blocking status line, e.g. a failed background read. */
  notice?: string;
  run: (command: 'tasks.update' | 'tasks.remove', input: unknown, local: () => void, confirmed?: () => void) => Promise<boolean>;
};
type BoardCycle = { company: string; name: string; status: string;
  taskIds: readonly string[]; acceptance: readonly { done: boolean; approvedBy?: string }[] };

/** The filters and cards are shared by local and client-scoped remote adapters. */
export function KanbanSurface({ company, initialClients, initialMilestones, items, cycles,
  products, msOptions, operation, patchTask, onRemoved, renderList, renderCreate, renderDrawer }: {
  company?: string;
  initialClients?: string[];
  initialMilestones?: string[];
  items: Delivery[];
  cycles: readonly BoardCycle[];
  products: readonly { id: string; name: string }[];
  msOptions: readonly { n: number; name: string }[];
  operation: KanbanOperation;
  patchTask: (id: string, patch: Partial<Delivery>) => void;
  onRemoved?: (id: string) => void;
  renderList: (tasks: Delivery[], onOpen: (task: Delivery) => void,
    ownerName: (id: string) => string) => ReactNode;
  renderCreate: (onClose: () => void, onCreated: (task: Delivery) => void) => ReactNode;
  renderDrawer: (task: Delivery | null, onClose: () => void,
    onChange: (id: string, patch: Partial<Delivery>) => void) => ReactNode;
}) {
  const removal = useTaskRemovalConfirmation(operation, onRemoved);
  const { members, resolve, me } = useTeam();
  const { can, isAllocated } = usePermissions();
  const { clients: companies, clientBySlug } = useClientsState();
  const companyName = (slug: string) => clientBySlug(slug)?.name ?? slug;
  const cycleOf = (id: string) => cycles.find((c) => c.taskIds.includes(id));
  const evaluate = useEvidenceEvaluatorForCycles(cycles);
  const { view, setView, density, setDensity } = useCollectionDisplay(
    `tasks.${company ?? "all"}`,
    "board",
  );
  const ownerName = (id: string) => resolve(id).name;
  const [scope, setScope] = useState<TaskScope>("project");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [open, setOpen] = useState<Delivery | null>(null);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const [clients, setClients] = useState<string[]>(initialClients ?? []);
  const [owners, setOwners] = useState<string[]>([]);
  const [milestones, setMilestones] = useState<string[]>(
    initialMilestones ?? [],
  );
  const [kinds, setKinds] = useState<string[]>([]);
  const [period, setPeriod] = useState<"all" | "overdue" | "today" | "next7" | "custom">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dueOrder, setDueOrder] = useState<"default" | "soonest">("soonest");
  const [over, setOver] = useState<BoardLane | null>(null);
  /**
   * Tarefa sem prazo solta numa coluna que exige data: o cartão abre o seletor
   * de data e o movimento só segue depois da escolha. Fechar sem data não muda nada.
   */
  const [duePrompt, setDuePrompt] = useState<{ id: string; status: DeliveryStatus } | null>(null);
  const duePromptRef = useRef(duePrompt);
  /**
   * O que cada coluna já expandiu, preso ao recorte que estava à vista quando a
   * pessoa pediu mais. Guardar a chave do filtro junto evita um efeito de
   * reposição, que renderizaria o quadro de novo a cada tecla digitada.
   */
  const [expanded, setExpanded] = useState<{
    key: string;
    shown: Partial<Record<BoardLane, number>>;
  }>({ key: "", shown: {} });
  /**
   * A tarefa que acabou de mudar de coluna fica à vista mesmo que caia além do
   * corte da coluna de destino: mover um card e não achá-lo mais seria pior do
   * que uma coluna comprida.
   */
  const [moved, setMoved] = useState<string[]>(EMPTY_PINNED);
  const dragging = useRef<string | null>(null);
  const suppressClick = useRef(false);
  /** `wire` é o que vai ao servidor quando difere do provisório local (null limpa o início). */
  const queuedMoves = useRef<{ id: string; title: string; company: string; patch: Partial<Delivery>; wire?: Record<string, unknown> }[]>([]);
  const processingMoves = useRef(false);
  const operationRef = useRef(operation);
  const patchTaskRef = useRef(patchTask);
  useEffect(() => {
    operationRef.current = operation;
    patchTaskRef.current = patchTask;
  }, [operation, patchTask]);
  /** Estáveis de propósito: são elas que deixam o cartão memoizado parado. */
  const openByClick = useCallback((task: Delivery) => {
    if (suppressClick.current) return;
    setOpen(task);
  }, [setOpen]);
  const openByKey = useCallback((task: Delivery) => setOpen(task), [setOpen]);
  const startDrag = useCallback((task: Delivery, event: DragEvent) => {
    dragging.current = task.id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
  }, []);
  const endDrag = useCallback(() => {
    dragging.current = null;
    setOver(null);
  }, [setOver]);
  const today = NOW.slice(0, 10);
  // Chave estável dos clientes alocados, só calculada quando "Meus clientes" está ativo.
  const mineKey = clients.includes(MY_CLIENTS)
    ? companies.filter((c) => isAllocated(c.slug)).map((c) => c.slug).join("\u0000") : "";
  const filtered = useMemo(() => filterBoardTasks(items,
    { scope, statuses, q, clients, owners, milestones, kinds, period, dateFrom, dateTo, dueOrder },
    { today, mine: new Set(mineKey ? mineKey.split("\u0000") : []), companyName, ownerName,
      inCycle: (id) => Boolean(cycleOf(id)) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  [items, q, clients, mineKey, owners, milestones, kinds, statuses, cycles, scope, period, dateFrom, dateTo, dueOrder, today]);
  const filterKey = JSON.stringify([q.trim(), scope, statuses, clients, owners, milestones, kinds, period, dateFrom, dateTo, dueOrder]);
  const shown = expanded.key === filterKey ? expanded.shown : EMPTY_SHOWN;
  const pinned = moved;
  const columns = useMemo(
    () => boardColumns(filtered, boardOrder, shown, pinned),
    [filtered, shown, pinned],
  );

  const current = open
    ? (filtered.find((d) => d.id === open.id) ??
      items.find((d) => d.id === open.id) ??
      open)
    : null;
  const clearFilters = () => {
    setQ("");
    setClients([]);
    setStatuses([]);
    setOwners([]);
    setMilestones([]);
    setKinds([]);
    setPeriod("all");
    setDateFrom("");
    setDateTo("");
  };
  const activeFilters =
    statuses.length +
    clients.length +
    owners.length +
    milestones.length +
    kinds.length +
    (period !== "all" ? 1 : 0) +
    (q.trim() ? 1 : 0);

  const processMoves = useCallback(async () => {
    if (processingMoves.current) return;
    processingMoves.current = true;
    try {
      while (queuedMoves.current.length) {
        const move = queuedMoves.current.shift()!;
        setMoved([move.id]);
        if (move.patch.status === "entregue") {
          requestCompletion(move, move.patch);
          continue;
        }
        const confirmed = await operationRef.current.run("tasks.update", { taskId: move.id, patch: move.wire ?? move.patch },
          () => patchTaskRef.current(move.id, move.patch));
        if (!confirmed) {
          if (queuedMoves.current.length) notify(droppedMovesMessage(queuedMoves.current));
          queuedMoves.current = [];
          break;
        }
      }
    } finally {
      processingMoves.current = false;
    }
  }, []);

  function dropOn(lane: BoardLane) {
    const id = dragging.current;
    dragging.current = null;
    setOver(null);
    if (!id) return;
    const task = items.find((item) => item.id === id);
    if (!task) return;
    if (boardLane(task) === lane) return;
    if (operation.blocking ?? Boolean(operation.error)) {
      notify(blockedMoveMessage(task.title, operation.error));
      return;
    }
    const status = laneStatus(lane);
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 80);
    if (!task.dueAt && lane !== "backlog") {
      // Sem prazo a tarefa só fica no Backlog: pede a data antes de mover.
      const prompt = { id, status };
      duePromptRef.current = prompt;
      setDuePrompt(prompt);
      setMoved([id]);
      return;
    }
    const patch: Partial<Delivery> = lane === "backlog"
      ? { status, dueAt: "", deadline: { mode: "fixed" }, startsAt: undefined }
      : { status };
    const wire = lane === "backlog" ? { status, dueAt: "", deadline: { mode: "fixed" }, ...(task.startsAt ? { startsAt: null } : {}) } : undefined;
    queuedMoves.current.push({ id, title: task.title, company: task.company, patch, wire });
    void processMoves();
  }

  const closeDuePrompt = useCallback(() => {
    duePromptRef.current = null;
    setDuePrompt(null);
  }, []);

  const saveDue = useCallback((task: Delivery, dueAt: string) => {
    const prompt = duePromptRef.current?.id === task.id ? duePromptRef.current : null;
    duePromptRef.current = null;
    setDuePrompt(null);
    if (dueAt === task.dueAt && !prompt) return;
    const blocked = operationRef.current.blocking ?? Boolean(operationRef.current.error);
    if (blocked) {
      notify(`«${task.title}» não teve o prazo alterado: resolva antes a falha pendente. ${operationRef.current.error}`.trim());
      return;
    }
    if (processingMoves.current) notify("Alteração de prazo na fila.");
    const patch = { ...directDueDatePatch(task, dueAt), ...(prompt && prompt.status !== task.status ? { status: prompt.status } : {}) };
    queuedMoves.current.push({ id: task.id, title: task.title, company: task.company, patch });
    void processMoves();
  }, [processMoves]);

  /**
   * Concluir uma tarefa com prazo e deixar o cliente sem nada em "A fazer" pede
   * a próxima: um aviso leve, que não bloqueia nada. Compara só tarefas que já
   * estavam no quadro, para uma leitura nova não disparar o aviso.
   */
  const previousItems = useRef<Map<string, Delivery> | null>(null);
  useEffect(() => {
    const before = previousItems.current;
    previousItems.current = new Map(items.map((task) => [task.id, task]));
    if (!before) return;
    const finished = new Set(items.filter((task) => {
      const old = before.get(task.id);
      return task.status === "entregue" && old && old.status !== "entregue" && old.dueAt;
    }).map((task) => task.company));
    for (const slug of finished) {
      if (items.some((task) => task.company === slug && task.status === "fila" && task.dueAt)) continue;
      notify(company ? "Defina a próxima tarefa com prazo." : `Defina a próxima tarefa com prazo para ${clientBySlug(slug)?.name ?? slug}.`);
    }
  }, [items, company, clientBySlug]);

  const currentView = { scope, statuses, q, clients, owners, milestones, kinds, period, dateFrom, dateTo, dueOrder, view, density };
  const applyView = (saved: typeof currentView) => {
    setScope(["project", "requests", "all"].includes(saved.scope) ? saved.scope : "project");
    setStatuses(Array.isArray(saved.statuses) ? saved.statuses : []);
    setQ(typeof saved.q === "string" ? saved.q : "");
    setClients(company ? [] : Array.isArray(saved.clients) ? saved.clients : []);
    setOwners(Array.isArray(saved.owners) ? saved.owners : []);
    setMilestones(Array.isArray(saved.milestones) ? saved.milestones : []);
    setKinds(Array.isArray(saved.kinds) ? saved.kinds : []);
    setPeriod(["all", "overdue", "today", "next7", "custom"].includes(saved.period) ? saved.period : "all");
    setDateFrom(typeof saved.dateFrom === "string" ? saved.dateFrom : "");
    setDateTo(typeof saved.dateTo === "string" ? saved.dateTo : "");
    setDueOrder(saved.dueOrder === "default" ? "default" : "soonest");
    setView(saved.view === "list" ? "list" : "board");
    setDensity(saved.density === "compact" ? "compact" : "comfortable");
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-density={density}>
      {removal.dialog}
      {operation.error ? <div role="alert" className="mb-3 flex items-center gap-3 text-[13px] text-rose">{operation.error}<Button size="sm" disabled={operation.busy} onClick={() => void operation.retry()}>Tentar novamente</Button></div>
        : operation.notice ? <p role="status" className="mb-3 text-[13px] text-muted">{operation.notice}</p> : null}
      <div className="mb-3 flex w-full min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <SavedViews scope={`tasks.${company ?? "all"}`} localOwner={me.id} current={currentView} onApply={applyView}
            initialOverride={Boolean(initialClients?.length || initialMilestones?.length)} />
          <DisplayControls
            board
            view={view}
            onView={setView}
            density={density}
            onDensity={setDensity}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            Nova tarefa
          </Button>
        </div>
      </div>
      <KanbanFilters
        filters={{ scope, setScope, q, setQ, clients, setClients, owners, setOwners, milestones, setMilestones, kinds, setKinds,
          statuses, setStatuses, period, setPeriod, dateFrom, setDateFrom, dateTo, setDateTo, dueOrder, setDueOrder }}
        company={company}
        companies={companies}
        members={members}
        milestoneOptions={msOptions}
        shown={filtered.length}
        total={items.length}
        onClear={() => {
          clearFilters();
          setScope("project");
        }}
      />

      {filtered.length === 0 && activeFilters > 0 ? (
        <Empty
          title="Nenhuma tarefa com esses filtros"
          hint="Tente outro termo ou remova os filtros para ver as tarefas da operação."
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
            >
              Limpar filtros
            </Button>
          }
        />
      ) : view === "list" ? (
        renderList(filtered, setOpen, ownerName)
      ) : (
        <div className="flex min-h-0 flex-1 snap-x snap-proximity gap-3 overflow-x-auto pb-3">
          {columns.map(({ status: col, total, visible, hidden }) => {
            const StatusIcon = {
              backlog: Inbox,
              fila: CircleDashed,
              "em-curso": Circle,
              revisao: CirclePause,
              entregue: CircleCheck,
              bloqueado: CircleAlert,
            }[col];
            const statusTone =
              col === "entregue"
                ? "text-blue"
                : col === "bloqueado"
                  ? "text-rose"
                  : col === "em-curso"
                    ? "text-amber"
                    : "text-muted";
            return (
              <section
                key={col}
                className={cn(
                  "flex h-full min-h-0 shrink-0 snap-start flex-col rounded-xl border border-line bg-soft/50 p-2 transition-colors sm:max-w-[420px]",
                  // Backlog vazio não empurra "A fazer" para fora da tela: fica estreito, mas segue como alvo.
                  col === "backlog" && total === 0
                    ? "w-44 grow-0 basis-44"
                    : "w-[min(268px,calc(100vw-56px))] grow basis-[min(268px,calc(100vw-56px))]",
                  over === col && "bg-soft ring-1 ring-line-strong",
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(col);
                }}
                onDragLeave={() => setOver((v) => (v === col ? null : v))}
                onDrop={(e) => {
                  e.preventDefault();
                  dropOn(col);
                }}
              >
                <header className="mb-3 flex shrink-0 items-center justify-between px-2 pt-1.5 pb-1">
                  <h3 className="flex items-center gap-2 text-[13px] font-medium">
                    <StatusIcon className={cn("h-3.5 w-3.5", statusTone)} />
                    {boardLaneLabel[col]}
                  </h3>
                  <span className="text-[12.5px] tabular-nums text-muted">
                    {total}
                  </span>
                </header>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-0.5 pb-2">
                  {total === 0 && (
                    <div className="rounded-lg border border-dashed border-line px-3 py-8 text-center">
                      <StatusIcon
                        className={cn("mx-auto mb-2 h-5 w-5", statusTone)}
                      />
                      <p className="text-[12px] font-medium text-ink-soft">
                        {col === "bloqueado"
                          ? "Caminho livre"
                          : col === "entregue"
                            ? "As próximas conquistas ficam aqui"
                            : col === "backlog"
                              ? "Nada sem prazo"
                              : col === "fila"
                                ? "Defina a próxima tarefa com prazo"
                                : "Nenhuma tarefa nesta etapa"}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted">
                        {col === "bloqueado"
                          ? "Nenhuma tarefa bloqueada."
                          : col === "backlog"
                            ? "Tarefas ainda sem data esperam aqui."
                            : col === "fila"
                              ? "Arraste uma tarefa do Backlog e escolha a data."
                              : "Mova uma tarefa pelo card ou pelo menu de status."}
                      </p>
                    </div>
                  )}
                  {visible.map((d) => {
                    const owner = resolve(d.ownerId);
                    const linkedCycle = cycleOf(d.id);
                    const due = dueMeta(d.dueAt);
                    return (
                      <KanbanCard
                        key={d.id}
                        task={d}
                        companyLabel={company ? undefined : companyName(d.company)}
                        subtitle={
                          linkedCycle?.name ??
                          (d.productId
                            ? products.find((p) => p.id === d.productId)?.name
                            : undefined)
                        }
                        ownerInitials={owner.initials}
                        ownerFirstName={owner.name.split(" ")[0]}
                        milestoneLabel={
                          !linkedCycle && d.milestone > 0
                            ? padMilestone(d.milestone)
                            : undefined
                        }
                        dueLabel={d.status === "entregue" ? "Concluída" : due.label}
                        dueTitle={d.dueAt ? formatDate(d.dueAt) : "Sem prazo"}
                        dueOverdue={due.tone === "bad" && d.status !== "entregue"}
                        canEditDue={can("entregas.editar", d.company) && d.status !== "entregue" && linkedCycle?.status !== "concluido" && (!d.deadline || d.deadline.mode === "fixed")}
                        onRequestRemove={can("entregas.remover", d.company) ? removal.requestRemoval : undefined}
                        evaluation={evaluate(d)}
                        onOpenByClick={openByClick}
                        onOpenByKey={openByKey}
                        onDragStart={startDrag}
                        onDragEnd={endDrag}
                        onSaveDue={saveDue}
                        duePrompt={duePrompt?.id === d.id ? `Defina o prazo para mover para ${boardLaneLabel[duePrompt.status]}` : undefined}
                        onDuePromptClose={closeDuePrompt}
                      />
                    );
                  })}
                  {hidden > 0 && (
                    <button
                      type="button"
                      data-more=""
                      onClick={() =>
                        setExpanded((state) => ({
                          key: filterKey,
                          shown: expandColumn(
                            state.key === filterKey ? state.shown : EMPTY_SHOWN,
                            col,
                          ),
                        }))
                      }
                      className="w-full rounded-lg border border-dashed border-line px-3 py-2 text-[12px] text-muted hover:bg-soft hover:text-ink"
                    >
                      Mostrar mais {hidden === 1 ? "1 tarefa" : `${hidden} tarefas`}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <div className="shrink-0 pt-2 text-[12.5px] text-muted">
        {filtered.length} de {items.length} tarefa
        {items.length === 1 ? "" : "s"} ·{" "}
        {view === "list"
          ? "abra uma tarefa para atualizar os detalhes"
          : "arraste o card para mudar o status"}
      </div>

      {creating && renderCreate(() => setCreating(false), (task) => setOpen(task))}
      {renderDrawer(current, () => setOpen(null), patchTask)}
    </div>
  );
}
