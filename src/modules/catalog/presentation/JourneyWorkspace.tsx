"use client";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { clientProgress, milestoneDeliveries } from "@/modules/delivery/application/progress";
import { useTaskOperations } from "@/modules/delivery/presentation/useTaskOperations";
import { requestCompletion } from "@/modules/delivery/infrastructure/completion-request";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import {
  isBlocked,
  milestoneSummaries,
  milestoneAdvance,
  milestoneProgress,
} from "@/modules/catalog/domain/journey-progress";
import type { JourneyTemplate } from "@/modules/catalog/domain/models";
import { JOURNEY_TASK_STATUSES as STATUS } from "@/modules/catalog/presentation/JourneyTasks";
import type { Company } from "@/modules/clients/domain/models";
import type { Delivery, DeliveryStatus } from "@/modules/delivery/domain/models";
import type { ServiceCycle } from "@/modules/delivery/domain/services";
import { NewDeliveryForm } from "@/modules/delivery/presentation/NewDeliveryForm";
import { TaskDrawer } from "@/modules/delivery/presentation/TaskDrawer";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { cn } from "@/shared/lib/cn";
import { NOW, padMilestone } from "@/shared/lib/format";
import { StickyHeader } from "@/shared/ui/StickyHeader";
import { Button, Empty } from "@/shared/ui/primitives";

import { OUTCOMES, type Filter } from "./journey-workspace/shared";
import { useJourneyState } from "./journey-workspace/useJourneyState";
import { useMilestoneAdvance } from "./journey-workspace/useMilestoneAdvance";
import { MilestoneRail } from "./journey-workspace/MilestoneRail";
import { MilestoneOverview } from "./journey-workspace/MilestoneOverview";
import { MilestoneTasksHeader } from "./journey-workspace/MilestoneTasksHeader";
import { MilestoneTasksTable } from "./journey-workspace/MilestoneTasksTable";
import { UnplannedMilestone } from "./journey-workspace/UnplannedMilestone";
import { MilestoneAside } from "./journey-workspace/MilestoneAside";
import { AdvanceDrawer } from "./journey-workspace/AdvanceDrawer";

/**
 * The client's plan: a horizontal roadmap of milestones and, for the selected
 * milestone, the cycles that execute it and the deliveries they contain.
 * The layout mirrors the cycle page: heading, main column, summary aside.
 */
export function JourneyWorkspace({
  company,
  tasks,
  cycles,
  enrollmentId,
  advanceEnabled = true,
  journey,
  currentMilestone,
  heading,
  initialMilestone,
}: {
  company: Company;
  tasks: Delivery[];
  cycles: ServiceCycle[];
  enrollmentId: string | null;
  advanceEnabled?: boolean;
  journey: JourneyTemplate;
  currentMilestone: number;
  /** Switcher and plan line owned by the client plan screen, identical in every view. */
  heading?: React.ReactNode;
  /** Milestone requested by the URL (`?marco=`). */
  initialMilestone?: number;
}) {
  const app_delivery = useDeliveryState();
  const taskOperation = useTaskOperations();
  const { can } = usePermissions();
  const canEditTasks = can("entregas.editar", company.slug);
  const { resolve } = useTeam();
  const {
    open,
    m,
    navigate,
    editing,
    setEditing,
    creating,
    setCreating,
    review,
    setReview,
    filter,
    setFilter,
    query,
    setQuery,
    showLoose,
    setShowLoose,
    notice,
    setNotice,
    peek,
    setPeek,
    justification,
    setJustification,
    contentRef,
    stepperRef,
    railWidth,
  } = useJourneyState({ journey, currentMilestone, initialMilestone });

  const today = NOW.slice(0, 10);
  const clientState = clientProgress(tasks, cycles, today);
  const linkedItems = (n: number) => milestoneDeliveries(clientState, n).items;
  const cyclesOf = (n: number) =>
    cycles
      .filter(
        (cycle) =>
          cycle.company === company.slug &&
          (cycle.milestone === n ||
            tasks.some(
              (t) => cycle.taskIds.includes(t.id) && t.milestone === n,
            )),
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const allClientCycles = cycles.filter((c) => c.company === company.slug);
  const milestoneCycles = cyclesOf(open);
  const progress = milestoneProgress(tasks, open, today, linkedItems(open));
  const advance = milestoneAdvance(journey, tasks, open, currentMilestone);
  const currentIndex = journey.milestones.findIndex(
    (item) => item.n === currentMilestone,
  );
  const finished =
    currentIndex === journey.milestones.length - 1 &&
    milestoneAdvance(journey, tasks, currentMilestone, currentMilestone).ready;
  const summaries = milestoneSummaries(
    journey,
    tasks,
    today,
    currentMilestone,
    linkedItems,
  ).map((item) => ({ ...item, cycles: cyclesOf(item.n).length }));
  const stages = [...new Set(journey.milestones.map((item) => item.stage))];
  const index = journey.milestones.findIndex((item) => item.n === open);
  const current = open === currentMilestone;
  const past = index < currentIndex;
  const matchesFilter = (task: Delivery, value: Filter) =>
    value === "all" ||
    (value === "pending" && task.status !== "entregue") ||
    (value === "blocked" && isBlocked(task)) ||
    (value === "done" && task.status === "entregue");
  const visibleTasks = progress.ordered.filter(
    (task) =>
      matchesFilter(task, filter) &&
      `${task.title} ${task.description} ${task.blockers ?? ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(query.toLocaleLowerCase("pt-BR")),
  );
  const cycleOfTask = (task: Delivery) =>
    allClientCycles.find((cycle) => cycle.taskIds.includes(task.id));
  const nextTask = progress.nextTask;
  const overdueIds = new Set(progress.overdue.map((task) => task.id));
  const outcome =
    m.goal ??
    (journey.id === "founding-companies" ? OUTCOMES[open] : undefined);
  const openCyclesHere = milestoneCycles.filter((c) => c.status !== "concluido");
  const unplanned = progress.items.length === 0 && milestoneCycles.length === 0;
  const milestoneState = progress.complete
    ? past || finished
      ? { label: "Concluído", tone: "bg-ink text-on-ink" }
      : current
        ? { label: "Pronto para revisão", tone: "bg-ok-soft text-ok" }
        : { label: "Tarefas concluídas", tone: "bg-soft text-muted" }
    : unplanned
      ? past
        ? { label: "Sem registro", tone: "bg-soft text-muted" }
        : current
          ? { label: "Não planejado", tone: "bg-amber-soft text-amber" }
          : { label: "Não planejado", tone: "bg-soft text-muted" }
      : current
        ? { label: "Em curso", tone: "bg-amber-soft text-amber" }
        : past
          ? { label: "Com pendências", tone: "bg-rose-soft text-rose" }
          : { label: "Planejado", tone: "bg-soft text-muted" };
  const nextLabel = nextTask
    ? isBlocked(nextTask)
      ? "Bloqueio a resolver"
      : overdueIds.has(nextTask.id)
        ? "Tarefa atrasada"
        : nextTask.status === "revisao"
          ? "Aguardando revisão"
          : "Próxima ação"
    : "Próxima ação";

  const advanceOperation = useMilestoneAdvance({
    company,
    journey,
    enrollmentId,
    currentMilestone,
    advanceEnabled,
    advance,
    onAdvanced: (next) => {
      setReview(false);
      setJustification("");
      navigate(next);
      setNotice(`Avanço confirmado. Você está em ${padMilestone(next)}.`);
    },
  });

  function changeStatus(task: Delivery, status: DeliveryStatus) {
    if (!canEditTasks || taskOperation.busy) return;
    const confirmed = () =>
      setNotice(
        `${task.title}: ${STATUS.find((item) => item.id === status)?.label}.`,
      );
    if (status === "entregue") {
      requestCompletion(task, { status }, confirmed);
      return;
    }
    void taskOperation.run(
      "tasks.update",
      { taskId: task.id, patch: { status } },
      () => app_delivery.setStatus(task.id, status),
      confirmed,
    );
  }

  /** Deliveries grouped by the cycle that executes them; loose deliveries come last. */
  const groupedRows = [
    ...milestoneCycles.map((cycle) => ({
      key: cycle.id,
      cycle,
      tasks: visibleTasks.filter((task) => cycleOfTask(task)?.id === cycle.id),
    })),
    {
      key: "loose",
      cycle: null as ServiceCycle | null,
      tasks: visibleTasks.filter((task) => {
        const c = cycleOfTask(task);
        return !c || !milestoneCycles.some((x) => x.id === c.id);
      }),
    },
  ].filter((group) => group.cycle || group.tasks.length);

  const deliveriesSection = (
    <section aria-label="Tarefas do marco">
      {visibleTasks.length > 0 || milestoneCycles.length > 0 ? (
        <MilestoneTasksTable
          companySlug={company.slug}
          groups={groupedRows}
          allTasks={clientState.all}
          today={today}
          milestoneCyclesCount={milestoneCycles.length}
          showLoose={showLoose}
          setShowLoose={setShowLoose}
          totalItems={progress.items.length}
          visibleCount={visibleTasks.length}
          overdueIds={overdueIds}
          canEditTasks={canEditTasks}
          busy={taskOperation.busy}
          resolve={resolve}
          onEdit={setEditing}
          onChangeStatus={changeStatus}
          onCreate={() => setCreating(true)}
        />
      ) : (
        <Empty
          title={
            progress.items.length
              ? "Nenhuma tarefa neste filtro"
              : "Nenhuma tarefa neste marco"
          }
          hint={
            progress.items.length
              ? "Ajuste os filtros para ver as outras tarefas."
              : "Os ciclos deste marco ainda não têm tarefas. Adicione a primeira."
          }
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                progress.items.length
                  ? (setFilter("all"), setQuery(""))
                  : setCreating(true)
              }
            >
              {progress.items.length
                ? "Limpar filtros"
                : "Criar primeira tarefa"}
            </Button>
          }
        />
      )}
    </section>
  );

  return (
    <div data-journey-workspace>
      <div ref={contentRef} className="min-w-0" data-journey-content>
        <StickyHeader className="plan-header">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {heading}
            <div className="flex flex-wrap items-center gap-2">
              {!current && (
                <button
                  type="button"
                  onClick={() => navigate(currentMilestone)}
                  className="text-[12px] text-blue hover:underline"
                >
                  Ir para o marco atual
                </button>
              )}
              <button
                type="button"
                aria-label="Marco anterior"
                disabled={index === 0}
                onClick={() => navigate(journey.milestones[index - 1].n)}
                className="map-control disabled:opacity-30"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Próximo marco"
                disabled={!journey.milestones[index + 1]}
                onClick={() => navigate(journey.milestones[index + 1].n)}
                className="map-control disabled:opacity-30"
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="plan-rail-wrap mt-2">
            <MilestoneRail
              journey={journey}
              summaries={summaries}
              stages={stages}
              open={open}
              currentMilestone={currentMilestone}
              peek={peek}
              setPeek={setPeek}
              navigate={navigate}
              stepperRef={stepperRef}
              railWidth={railWidth}
            />
          </div>
        </StickyHeader>

        <MilestoneOverview
          company={company}
          journey={journey}
          enrollmentId={enrollmentId}
          milestone={m}
          open={open}
          state={milestoneState}
          outcome={outcome}
          progress={progress}
          advance={advance}
          unplanned={unplanned}
          current={current}
          resolve={resolve}
          onReview={() => setReview(true)}
          onCreate={() => setCreating(true)}
        />

        {!unplanned && (
          <div className="mt-5">
            <MilestoneTasksHeader
              companySlug={company.slug}
              open={open}
              cyclesCount={milestoneCycles.length}
              itemsCount={progress.items.length}
              countOf={(value) =>
                progress.items.filter((task) => matchesFilter(task, value))
                  .length
              }
              filter={filter}
              setFilter={setFilter}
              query={query}
              setQuery={setQuery}
            />
          </div>
        )}
        <div
          className={cn(
            "grid items-start gap-6 pb-6 lg:grid-cols-[minmax(0,1fr)_300px]",
            unplanned && "mt-5",
          )}
        >
          <div className="min-w-0 space-y-6">
            {unplanned ? (
              <UnplannedMilestone
                companySlug={company.slug}
                enrollmentId={enrollmentId}
                open={open}
                past={past}
                milestone={m}
                onCreate={() => setCreating(true)}
              />
            ) : (
              deliveriesSection
            )}
          </div>
          <MilestoneAside
            journey={journey}
            milestone={m}
            currentMilestone={currentMilestone}
            current={current}
            past={past}
            progress={progress}
            advance={advance}
            nextTask={nextTask}
            nextLabel={nextLabel}
            resolve={resolve}
            onReview={() => setReview(true)}
            onEditNext={setEditing}
            navigate={navigate}
          />
        </div>
      </div>
      {taskOperation.error && (
        <div
          role="alert"
          className="my-3 rounded-xl border border-line bg-surface p-3 text-sm"
        >
          <p>{taskOperation.error}</p>
          <Button
            size="sm"
            disabled={taskOperation.busy}
            onClick={() => void taskOperation.retry()}
          >
            Tentar novamente
          </Button>
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-30 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-xl border border-line bg-surface px-4 py-3 text-[12px] shadow-lg"
        >
          {notice}
        </div>
      )}
      {creating && (
        <NewDeliveryForm
          company={company.slug}
          cycle={openCyclesHere.length === 1 ? openCyclesHere[0] : undefined}
          milestone={open}
          journeyId={journey.id}
          enrollmentId={enrollmentId}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setFilter("all");
            setQuery("");
            setNotice("Tarefa criada neste marco.");
          }}
        />
      )}
      <TaskDrawer
        task={
          editing
            ? (tasks.find((task) => task.id === editing!.id) ??
              editing)
            : null
        }
        onClose={() => setEditing(null)}
        onChange={app_delivery.patchTask}
      />
      <AdvanceDrawer
        open={review}
        onClose={() => setReview(false)}
        milestoneName={m.name}
        milestoneN={open}
        advance={advance}
        advanceEnabled={advanceEnabled}
        canEditPlan={can("plano.editar", company.slug)}
        operation={advanceOperation}
        justification={justification}
        setJustification={setJustification}
        current={current}
        doneCount={progress.done}
        itemsCount={progress.items.length}
        resolve={resolve}
        onCreate={() => {
          setReview(false);
          setCreating(true);
        }}
        onEditTask={(task) => {
          setReview(false);
          setEditing(task);
        }}
      />
    </div>
  );
}
