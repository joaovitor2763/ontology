"use client";
import { Suspense } from "react";
import { enrollmentMilestone } from "@/modules/catalog/domain/journey-progress";
import { hasLegacyExecutionForClient, selectedExecutionId, selectedLegacyProduct, selectPlanScheduleExecution } from "@/modules/delivery/application/plan-schedule";
import { clientProgress } from "@/modules/delivery/application/progress";
import { useServices } from "@/modules/delivery/presentation/state";
import { PlanScheduleEditor } from "@/modules/delivery/presentation/PlanScheduleEditor";
import {
  journeyDate,
  milestoneSummaries,
} from "@/modules/catalog/domain/journey-progress";
import { useCatalog } from "@/modules/catalog/presentation/catalog";
import { JourneyWorkspace } from "@/modules/catalog/presentation/JourneyWorkspace";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { useScopedClientExecution } from "@/modules/delivery/infrastructure/ClientExecutionProvider";
import { milestoneDeliveries } from "@/modules/delivery/application/progress";
import { CyclesWorkspace } from "@/modules/delivery/presentation/CyclesWorkspace";
import { NOW } from "@/shared/lib/format";
import { paths, planViewLabel, type PlanView } from "@/shared/lib/routes";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { CalendarDays, Flag, Repeat2 } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { enrollmentIsCurrent } from "@/modules/clients/domain/product-enrollments";
import { EnrollmentTeam } from "@/modules/clients/presentation/EnrollmentTeam";
import { useDocumentHydrated, useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";

const views: PlanView[] = ["plano", "ciclos", "cronograma"];
const icons = {
  plano: <Flag className="h-3.5 w-3.5" />,
  ciclos: <Repeat2 className="h-3.5 w-3.5" />,
  cronograma: <CalendarDays className="h-3.5 w-3.5" />,
};

/**
 * O plano é o roteiro macro do contrato; os ciclos executam cada marco.
 * Três visões da mesma seção: o plano por marco, a lista de ciclos e o cronograma.
 */
function ClientPlanoScreenContent() {
  const { slug } = useParams<{ slug: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const requested = params.get("visao") as PlanView | null;
  const view = requested && views.includes(requested) ? requested : "plano";
  const marco = Number(params.get("marco") ?? "");
  const { clientBySlug, enrollments } = useClientsState();
  const { statusMap, extraTasks, taskPatches } = useDeliveryState();
  const scoped = useScopedClientExecution();
  const deliveryHydrated = useDocumentHydrated("ontology.delivery.v2") || Boolean(scoped);
  const sync = useSyncStatus();
  const { journeyOf, milestoneOf, headOf } = useCatalog();
  const { cycles, companyJourney } = useServices();
  const client = clientBySlug(slug);
  if (!client) return null;
  const followed = journeyOf(client);
  const allPurchases = enrollments.filter(e => e.company === slug);
  const purchases = allPurchases.filter(enrollmentIsCurrent);
  const projectedTasks = deliveriesFor(slug, statusMap, extraTasks, taskPatches);
  const hasLegacyExecution = hasLegacyExecutionForClient(
    { cycles, tasks: projectedTasks },
    slug,
    [companyJourney[slug], client.journeyId],
    allPurchases.map((enrollment) => enrollment.planId),
  );
  const fallbackId = purchases.find(e => e.planId === followed.id)?.id ?? purchases[0]?.id ?? (hasLegacyExecution ? "__legacy__" : "__none__");
  const requestedId = selectedExecutionId(params.get("contratacao"), allPurchases.map(e => e.id), fallbackId, hasLegacyExecution);
  const selectedId = requestedId.startsWith("legacy:") ? "__legacy__" : requestedId;
  const enrollment = allPurchases.find(e => e.id === selectedId);
  const missingExecution = !enrollment && (selectedId !== "__legacy__" || !hasLegacyExecution);
  if (missingExecution) return <section className="rounded-xl border border-line bg-surface p-6"><h2 className="text-base font-semibold">Nenhuma execução atual</h2><p className="mt-2 text-sm text-muted">Contrate um produto ou selecione uma contratação histórica para consultar seu plano, ciclos e tarefas.</p></section>;
  const enrollmentHead = enrollment?.planId ? headOf(enrollment.planId) : undefined;
  if (enrollment?.planId && !enrollmentHead) return (
    <section className="rounded-xl border border-line bg-surface p-6" role={deliveryHydrated || sync.error ? "alert" : "status"}>
      <h2 className="text-base font-semibold">
        {deliveryHydrated || sync.error ? "Execução contratada indisponível" : "Carregando execução contratada…"}
      </h2>
      <p className="mt-2 text-sm text-muted">
        {deliveryHydrated || sync.error
          ? "A contratação está registrada, mas o plano correspondente não pôde ser carregado. Recarregue a página; se o problema continuar, revise a contratação."
          : "Estamos buscando o plano, os ciclos e as tarefas desta contratação."}
      </p>
    </section>
  );
  const journey = enrollment
    ? (enrollment.planId === followed.id ? followed : (enrollmentHead ?? followed))
    : followed;
  const all = { tasks: projectedTasks, cycles: cycles.filter(c => c.company === slug) };
  const legacy = selectPlanScheduleExecution(all, journey.id, followed.id);
  const execution = selectPlanScheduleExecution(all, journey.id, followed.id, enrollment?.id);
  const legacyProduct = !enrollment ? selectedLegacyProduct(requestedId, params.get("produto")) : null;
  if(legacyProduct) {
    execution.tasks=execution.tasks.filter(t=>t.productId===legacyProduct);
    execution.cycles=execution.cycles.filter(c=>c.productId===legacyProduct);
  }
  const tasks = execution.tasks.filter(t => t.kind !== "request");
  const inherited = purchases.filter(e => e.planId === journey.id).length === 1 && !legacy.tasks.length && !legacy.cycles.length && journey.id === followed.id ? milestoneOf(client).n : undefined;
  const n = enrollment ? enrollmentMilestone(enrollment, journey, inherited) : milestoneOf(client).n;
  const progress = clientProgress(tasks, execution.cycles, NOW.slice(0,10));
  const planPath = (next: PlanView) => paths.clientPlan(slug, next) + (next === "plano" ? "?" : "&") + new URLSearchParams({contratacao: enrollment?.id ?? "__legacy__", ...(legacyProduct ? {produto:legacyProduct} : {})});
  const completed = milestoneSummaries(
    journey,
    tasks,
    NOW.slice(0, 10),
    n,
    (milestone) => milestoneDeliveries(progress, milestone).items,
  ).filter((item) => item.closed).length;
  /** Same node in every view, so nothing moves when the visão changes. */
  const planTitle = [
    journey.name,
    journey.version
      ? `v${journey.version}${journey.publishedAt ? ` · publicada em ${journeyDate(journey.publishedAt)}` : ""}`
      : null,
    `${completed}/${journey.milestones.length} marcos concluídos`,
  ]
    .filter(Boolean)
    .join(" · ");
  const heading = (
    <div className="flex flex-wrap items-center gap-3">
      {(!enrollment || enrollment.planId) && <PlanScheduleEditor key={enrollment?.id ?? "__legacy__"} company={client} plan={journey} tasks={execution.tasks} enrollmentId={enrollment?.id ?? null} />}
      <SegmentedControl
        label="Visão do plano"
        value={view}
        onChange={(next) => router.replace(planPath(next))}
        options={views.map((v) => ({
          value: v,
          label: planViewLabel[v],
          icon: icons[v],
        }))}
      />
      <span
        className="hidden truncate text-[12px] text-muted md:inline"
        title={planTitle}
      >
        {journey.name}
        <span className="tabular-nums">
          {" "}
          · {completed}/{journey.milestones.length} marcos
        </span>
      </span>
    </div>
  );
  if (view === "plano")
    return (
      <div>
        {enrollment ? <EnrollmentTeam company={client} enrollmentId={enrollment.id} /> : null}
        <JourneyWorkspace
          key={`${slug}-${journey.id}-${enrollment?.id ?? "legacy"}`}
          company={client}
          tasks={tasks}
          enrollmentId={enrollment?.id ?? null}
          advanceEnabled={!enrollment || Boolean(enrollment.planId)}
          cycles={execution.cycles}
          journey={journey}
          currentMilestone={n}
          initialMilestone={
            Number.isFinite(marco) && marco > 0 ? marco : undefined
          }
          heading={heading}
        />
      </div>
    );
  return (
    <div>
    {enrollment ? <EnrollmentTeam company={client} enrollmentId={enrollment.id} /> : null}
    <CyclesWorkspace
      company={slug}
      cycleIds={execution.cycles.map(c => c.id)}
      embedded
      schedule={view === "cronograma"}
      heading={heading}
    />
    </div>
  );
}

/** Suspense dentro do módulo cliente, não em `page.tsx`: ver `docs/navegacao-e-visualizacoes.md`. */
export default function ClientPlanoScreen() {
  return (
    <Suspense>
      <ClientPlanoScreenContent />
    </Suspense>
  );
}
