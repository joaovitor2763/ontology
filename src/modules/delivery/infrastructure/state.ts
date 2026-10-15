import { removeDeliveryTask } from "../application/task-removal";
import { provisionMissingProduct, provisionMissingPlan } from "../application/provision-missing";
import { removeUntouchedEnrollmentExecution } from "../application/enrollment-lifecycle";
import type { ProductEnrollment } from "@/modules/clients/domain/product-enrollments";
import { mergeTaskOverride } from "../domain/task-overrides";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { changePlanSchedule } from "../application/plan-schedule";
import { projectDelivery } from "./snapshot";
import { scheduledDeliverySnapshot } from "./scheduled-state";
import {
  previewProduct,
  type ProductRolloutOptions,
  applyProductImpact,
  rolloutFingerprint,
} from "../application/product-rollout";
import type { Product } from "@/modules/catalog/domain/products";
import type { ProductVersion } from "@/modules/catalog/domain/product-versions";
import {
  applyProduct,
  type ProductExecution,
} from "../application/product-execution";
import type { Company } from "../../clients/domain/models";
import type { JourneyTemplate } from "../../catalog/domain/models";
import {
  provisionPlan,
  type DateChange,
} from "../application/plan-execution";
import { saveCycleAggregate, removeCycleAggregate } from "@/modules/delivery/application/cycles";
import { blockerPatch, recordHistory } from "@/modules/delivery/domain/history";
import type {
  Delivery,
  DeliveryBlocker,
  DeliveryStatus,
} from "@/modules/delivery/domain/models";
import {
  applyStatusChange,
  type ServiceCycle,
} from "@/modules/delivery/domain/services";
import { documentsFor } from "@/modules/documents/infrastructure/queries";
import { useDocumentsState } from "@/modules/documents/infrastructure/state";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import {
  migrateLegacy,
} from "@/shared/infrastructure/migration";
import { useLocalStorageState } from "@/shared/infrastructure/useLocalStorageState";
import { useScopedClientExecution } from './ClientExecutionProvider';
import { notify } from "@/shared/ui/Feedback";
import { useCallback, useMemo, type SetStateAction } from "react";
import { requestCompletion } from "./completion-request";
import {
  deliveryPatchError,
  requiresCompletionReview,
} from "../domain/delivery-policy";
import { resolveCycles } from "./cycles";
import { deliveriesFor } from "./queries";
import { deliveries } from "./seed";
import { serviceCycles } from "./services";
import { DELIVERY_INITIAL as INITIAL, normalizeDeliverySnapshot, type DeliverySnapshot as StoredState } from "./snapshot";
export type { DeliverySnapshot as StoredState } from "./snapshot";
const migrate = () =>
  migrateLegacy(INITIAL, ["ontology.praxis.v1", "ontology.services.v1"]);
const stamp = () => new Date().toISOString();
const withCompletionLifecycle = (current: Delivery | undefined, patch: Partial<Delivery>): Partial<Delivery> =>
  current?.status === "entregue" && patch.status !== undefined && patch.status !== "entregue"
    ? { ...patch, completedAt: undefined }
    : patch;
type API = {
  productPreview: (
    product: Product,
    versions: ProductVersion[],
    today: string,
    scope?: ProductRolloutOptions["scope"],
  ) => { impacts: ReturnType<typeof previewProduct>; fingerprint: string };
  applyProductVersion: (
    product: Product,
    versions: ProductVersion[],
    today: string,
    ids: string[],
    expected: string,
    scope?: ProductRolloutOptions["scope"],
  ) => void;
  initializeProduct: (draft: ProductExecution, options?: {preserveSelection?:boolean}) => void;
  removeEnrollmentExecution: (enrollment: ProductEnrollment, replacementPlanId?: string) => void;
  rebuildEnrollmentExecution: (enrollment: ProductEnrollment, draft: ProductExecution) => void;
  initializePlan: (plan: JourneyTemplate, company: Company, enrollment?: { id: string; startsAt: string }, options?: {preserveSelection?:boolean}) => void;
  savePlanDates: (
    company: string,
    cycles: DateChange[],
    tasks: DateChange[],
  ) => void;
  cycles: ServiceCycle[];
  saveCycle: (cycle: ServiceCycle, generated?: Delivery[]) => void;
  /** Removes the cycle; its deliveries stay in the client's list. */
  removeCycle: (id: string) => void;
  storageError: string | null;
  statusMap: Record<string, DeliveryStatus>;
  extraTasks: Delivery[];
  productPlans: Record<string, JourneyTemplate>;
  companyJourney: Record<string, string>;
  companyMilestone: Record<string, number>;
  companyJourneyVersion: Record<string, number>;
  taskPatches: Record<string, Partial<Delivery>>;
  setStatus: (id: string, status: DeliveryStatus) => void;
  addTask: (t: Delivery) => void;
  removeTask: (id: string) => void;
  addTasks: (tasks: Delivery[]) => void;
  completeTask: (id: string, patch: Partial<Delivery>) => string | null;
  patchTask: (id: string, patch: Partial<Delivery>) => void;
  /** Same patch on several deliveries, one write and one confirmation. */
  patchTasks: (ids: string[], patch: Partial<Delivery>) => void;
  addComment: (id: string, text: string) => void;
  toggleChecklistItem: (id: string, itemId: string) => void;
  addChecklistItem: (id: string, title: string) => void;
  removeChecklistItem: (id: string, itemId: string) => void;
  setEvidence: (id: string, text: string) => void;
  /** Sets a blocker, or resolves the current one when `blocker` is null. */
  setBlocker: (
    id: string,
    blocker: Omit<DeliveryBlocker, "resolvedAt"> | null,
  ) => void;
  assignCompanyJourney: (
    slug: string,
    journeyId: string,
    milestone: number,
  ) => void;
  /** Pins clients to a published plan version (null clears the pin). */
  pinCompanyJourneyVersion: (pins: Record<string, number | null>) => void;
};
export function useDeliveryState(): API {
  const scoped = useScopedClientExecution();
  const [localStored, setLocalStored, localError] = useLocalStorageState(
    "ontology.delivery.v2",
    INITIAL,
    migrate,
    { suspended: Boolean(scoped) },
  );
  const rawStored = scoped?.snapshot ?? localStored;
  const setRawStored = scoped?.setSnapshot ?? setLocalStored;
  const storageError = scoped ? null : localError;
  const { clients, enrollments } = useClientsState();
  const clientStarts = useMemo(() => Object.fromEntries(clients.map(c => [c.slug, c.startedAt])), [clients]);
  const enrollmentStarts = useMemo(() => Object.fromEntries(enrollments.map(e => [e.id, e.startsAt])), [enrollments]);
  const resolveScheduled = useCallback((s: StoredState) =>
    scheduledDeliverySnapshot(s, clientStarts, enrollmentStarts),
    [clientStarts, enrollmentStarts]);
  const migrated = useMemo(() => normalizeDeliverySnapshot(rawStored), [rawStored]);
  // Client and execution documents hydrate independently. Writes require valid references.
  // Uma projeção por documento: todo consumidor lê o mesmo objeto, sem recalcular.
  const stored = useMemo(() => {
    try { return resolveScheduled(migrated); } catch { return migrated; /* retain persisted dates until both contexts are available */ }
  }, [migrated, resolveScheduled]);
  const setStored = (action: SetStateAction<StoredState>) =>
    setRawStored((previous) => {
      const current = resolveScheduled(normalizeDeliverySnapshot(previous));
      const next = typeof action === "function" ? action(current) : action;
      return resolveScheduled(next);
    });
  const { currentUserId } = useWorkspaceState();
  const { extraDocs, removedDocs, docEdits } = useDocumentsState();
  const linkedDocuments = (id: string) =>
    documentsFor(undefined, extraDocs, removedDocs, docEdits).filter(
      (d) => d.relatedTaskId === id,
    ).length;
  const {
    statusMap,
    extraTasks,
    taskPatches,
    productPlans,
    companyJourney,
    companyMilestone,
    companyJourneyVersion,
  } = stored;
  function field<K extends keyof StoredState>(key: K) {
    return (action: SetStateAction<StoredState[K]>) =>
      setStored((previous) => ({
        ...previous,
        [key]:
          typeof action === "function"
            ? (action as (value: StoredState[K]) => StoredState[K])(
                previous[key],
              )
            : action,
      }));
  }
  const setExtraTasks = field("extraTasks");
  const cycles = useMemo(() => resolveCycles(stored), [stored]);
  const currentRecord = (state: StoredState, id: string) =>
    deliveriesFor(
      undefined,
      state.statusMap,
      state.extraTasks,
      state.taskPatches,
    ).find((d) => d.id === id);
  /** Applies one patch to one delivery inside a snapshot, recording history. */
  function applyPatch(
    state: StoredState,
    id: string,
    patch: Partial<Delivery>,
    at: string,
  ): StoredState {
    const previous: Partial<Delivery> = currentRecord(state, id) ?? {};
    const history = [
      ...(previous.history ?? []),
      ...recordHistory(previous, patch, currentUserId, at),
    ];
    const merged = { ...patch, history };
    return {
      ...state,
      statusMap: patch.status
        ? { ...state.statusMap, [id]: patch.status }
        : state.statusMap,
      extraTasks: state.extraTasks.map((t) =>
        t.id === id ? { ...t, ...merged } : t,
      ),
      taskPatches: {
        ...state.taskPatches,
        [id]: mergeTaskOverride(state.taskPatches[id] ?? {}, merged),
      },
    };
  }
  const value: API = {
    productPreview: (product, versions, today, scope) => {
      const tasks = deliveriesFor(
        undefined,
        stored.statusMap,
        stored.extraTasks,
        stored.taskPatches,
      );
      return {
        impacts: previewProduct(product, versions, cycles, tasks, today, clientStarts, {scope,enrollmentStarts}),
        fingerprint: rolloutFingerprint(cycles, tasks),
      };
    },
    applyProductVersion: (product, versions, today, ids, expected, scope) => {
      setStored((s) => {
        const currentCycles = resolveCycles(s);
        const tasks = deliveriesFor(
          undefined,
          s.statusMap,
          s.extraTasks,
          s.taskPatches,
        );
        const impacts = previewProduct(
          product,
          versions,
          currentCycles,
          tasks,
          today,
          clientStarts,
          {scope,enrollmentStarts},
        ).filter((i) => ids.includes(i.cycle.id));
        if (impacts.length !== ids.length)
          throw new Error("Os ciclos mudaram. Gere uma nova prévia.");
        return applyProductImpact(
          s,
          impacts,
          currentCycles,
          tasks,
          expected,
          currentUserId,
          stamp(),
        );
      });
      notify("Versão aplicada aos ciclos selecionados");
    },
    initializeProduct: (draft, options) => {
      setStored((s) => ({
        ...(options?.preserveSelection ? provisionMissingProduct(s, draft) : applyProduct(s, draft)),
        productPlans: {
          ...s.productPlans,
          [draft.plan.id]: s.productPlans[draft.plan.id] ?? draft.plan,
        },
      }));
      notify("Produto preparado com ciclos e tarefas");
    },
    removeEnrollmentExecution: (enrollment, replacementPlanId) => {
      setStored(s => removeUntouchedEnrollmentExecution(normalizeDeliverySnapshot(s), enrollment, replacementPlanId));
    },
    rebuildEnrollmentExecution: (enrollment, draft) => {
      setStored((s) => {
        const cleared = removeUntouchedEnrollmentExecution(
          normalizeDeliverySnapshot(s),
          enrollment,
          draft.plan.id,
        );
        const applied = applyProduct(cleared, draft);
        return {
          ...applied,
          productPlans: {
            ...applied.productPlans,
            [draft.plan.id]: draft.plan,
          },
        };
      });
    },
    initializePlan: (plan, company, enrollment, options) => {
      setStored((s) => options?.preserveSelection ? provisionMissingPlan(s, plan, company, stamp(), enrollment) : provisionPlan(s, plan, company, stamp(), enrollment));
      notify("Plano completo preparado; tarefas existentes preservadas");
    },
    savePlanDates: (company, cycles, tasks) => {
      setStored((s) => changePlanSchedule(s, projectDelivery(s, company), {cycles, tasks}, currentUserId, stamp()));
      notify("Datas do plano atualizadas");
    },
    cycles,
    saveCycle(cycle, generated = []) {
      const previous = cycles.find((c) => c.id === cycle.id);
      const next = applyStatusChange(
        previous,
        { ...cycle, updatedAt: stamp() },
        currentUserId,
        stamp(),
      );
      setStored((s) =>
        saveCycleAggregate(s, next, generated, {
          cycles: serviceCycles,
          deliveries,
        }),
      );
      notify(
        next.status === "em-aceite" && previous?.status !== "em-aceite"
          ? "Ciclo enviado para aceite do cliente"
          : "Ciclo salvo",
      );
    },
    removeCycle(id) {
      const previous = stored;
      setStored((s) => {
        const cycle=resolveCycles(s).find(c=>c.id===id);
        return cycle?removeCycleAggregate(s,cycle):s;
      });
      notify("Ciclo excluído", () => setStored(previous));
    },
    storageError,
    statusMap,
    extraTasks,
    productPlans,
    companyJourney,
    companyMilestone,
    companyJourneyVersion,
    taskPatches,
    setStatus: (id, status) => {
      const current = currentRecord(stored, id);
      if (current && requiresCompletionReview(current, { status })) {
        requestCompletion(current, { status });
        return;
      }
      const issue = deliveryPatchError(
        { status },
        cycles.find((c) => c.taskIds.includes(id)),
        {
          current: currentRecord(stored, id),
          linkedDocuments: linkedDocuments(id),
        },
      );
      if (issue) {
        notify(issue);
        return;
      }
      const at = stamp();
      setStored((s) => applyPatch(s, id, withCompletionLifecycle(currentRecord(s, id), { status }), at));
      notify("Status da tarefa atualizado");
    },
    addTasks: (tasks) => {
      setExtraTasks((xs) => [
        ...tasks.filter((t) => !xs.some((x) => x.id === t.id)),
        ...xs,
      ]);
    },
    addTask: (t) => {
      setExtraTasks((xs) => [t, ...xs]);
      notify(t.kind === "request" ? "Solicitação criada" : "Tarefa criada");
    },
    removeTask: (id) => {
      setStored((state) => {
        const projected = projectDelivery(state), task = projected.tasks.find(row => row.id === id);
        if (!task) return state;
        return removeDeliveryTask(state, task, projected.tasks, projected.cycles, currentUserId, stamp());
      });
    },
    completeTask: (id, patch) => {
      const current = currentRecord(stored, id);
      if (!current) return "Esta tarefa não está mais disponível.";
      const next = { ...patch, status: "entregue" as const };
      const issue = deliveryPatchError(
        next,
        cycles.find((c) => c.taskIds.includes(id)),
        {
          current,
          linkedDocuments: linkedDocuments(id),
        },
      );
      if (issue) return issue;
      const at = stamp();
      setStored((s) => applyPatch(s, id, next, at));
      notify("Tarefa concluída");
      return null;
    },
    patchTask: (id, patch) => {
      const current = currentRecord(stored, id);
      patch = withCompletionLifecycle(current, patch);
      if (current && requiresCompletionReview(current, patch)) {
        requestCompletion(current, patch);
        return;
      }
      const issue = deliveryPatchError(
        patch,
        cycles.find((c) => c.taskIds.includes(id)),
        {
          current: currentRecord(stored, id),
          linkedDocuments: linkedDocuments(id),
        },
      );
      if (issue) {
        notify(issue);
        return;
      }
      const at = stamp();
      setStored((s) => applyPatch(s, id, patch, at));
      notify("Tarefa atualizada");
    },
    patchTasks: (ids, patch) => {
      const review = ids.filter((id) =>
        requiresCompletionReview(currentRecord(stored, id), patch),
      );
      for (const id of review) {
        const current = currentRecord(stored, id);
        if (current) requestCompletion(current, patch);
      }
      ids = ids.filter((id) => !review.includes(id));
      if (!ids.length) return;
      const blocked = ids.filter((id) =>
        deliveryPatchError(
          patch,
          cycles.find((c) => c.taskIds.includes(id)),
          {
            current: currentRecord(stored, id),
            linkedDocuments: linkedDocuments(id),
          },
        ),
      );
      const allowed = ids.filter((id) => !blocked.includes(id));
      if (!allowed.length) {
        notify(
          "Nenhuma tarefa pôde ser alterada. Verifique ciclo concluído, checklist ou evidência.",
        );
        return;
      }
      const at = stamp();
      setStored((s) =>
        allowed.reduce((acc, id) => applyPatch(acc, id, withCompletionLifecycle(currentRecord(acc, id), patch), at), s),
      );
      notify(
        blocked.length
          ? `${allowed.length} tarefas atualizadas · ${blocked.length} bloqueada${blocked.length === 1 ? "" : "s"} pela política`
          : `${allowed.length} tarefa${allowed.length === 1 ? "" : "s"} atualizada${allowed.length === 1 ? "" : "s"}`,
      );
    },
    addComment: (id, text) => {
      const body = text.trim();
      if (!body) return;
      const at = stamp();
      setStored((s) => {
        const previous = currentRecord(s, id);
        const comments = [
          ...(previous?.comments ?? []),
          { id: `c-${crypto.randomUUID()}`, at, by: currentUserId, text: body },
        ];
        const history = [
          ...(previous?.history ?? []),
          { at, by: currentUserId, field: "comment" as const },
        ];
        return {
          ...s,
          extraTasks: s.extraTasks.map((t) =>
            t.id === id ? { ...t, comments, history } : t,
          ),
          taskPatches: {
            ...s.taskPatches,
            [id]: { ...s.taskPatches[id], comments, history },
          },
        };
      });
    },
    toggleChecklistItem: (id, itemId) => {
      const at = stamp();
      const current = currentRecord(stored, id);
      if (!current) return;
      const checklist = (current.checklist ?? []).map((item) =>
        item.id === itemId
          ? item.done
            ? { ...item, done: false, doneAt: undefined, doneBy: undefined }
            : { ...item, done: true, doneAt: at, doneBy: currentUserId }
          : item,
      );
      setStored((s) => applyPatch(s, id, { checklist }, at));
    },
    addChecklistItem: (id, title) => {
      const text = title.trim();
      if (!text) return;
      const at = stamp();
      const current = currentRecord(stored, id);
      if (!current) return;
      const checklist = [
        ...(current.checklist ?? []),
        { id: `ck-${crypto.randomUUID()}`, title: text, done: false },
      ];
      setStored((s) => applyPatch(s, id, { checklist }, at));
    },
    removeChecklistItem: (id, itemId) => {
      const at = stamp();
      const current = currentRecord(stored, id);
      if (!current) return;
      const checklist = (current.checklist ?? []).filter(
        (i) => i.id !== itemId,
      );
      setStored((s) => applyPatch(s, id, { checklist }, at));
    },
    setEvidence: (id, text) => {
      const at = stamp();
      setStored((s) =>
        applyPatch(s, id, { evidence: text.trim() || undefined }, at),
      );
      notify("Evidência registrada");
    },
    setBlocker: (id, blocker) => {
      const at = stamp();
      const current = currentRecord(stored, id);
      if (!current) return;
      const patch = blockerPatch(current, blocker, at);
      const issue = deliveryPatchError(
        patch,
        cycles.find((c) => c.taskIds.includes(id)),
      );
      if (issue) {
        notify(issue);
        return;
      }
      setStored((s) => {
        const next = applyPatch(s, id, patch, at);
        const record = next.taskPatches[id];
        const history = [
          ...(record.history ?? []),
          {
            at,
            by: currentUserId,
            field: "blocker" as const,
            from: blocker
              ? undefined
              : (current.blocker?.reason ?? current.blockers),
            to: blocker?.reason,
          },
        ];
        return {
          ...next,
          extraTasks: next.extraTasks.map((t) =>
            t.id === id ? { ...t, history } : t,
          ),
          taskPatches: { ...next.taskPatches, [id]: { ...record, history } },
        };
      });
      notify(blocker ? "Tarefa bloqueada" : "Bloqueio resolvido");
    },
    assignCompanyJourney: (slug, journeyId, milestone) => {
      setStored((s) => {
        const pins = { ...s.companyJourneyVersion };
        if (s.companyJourney[slug] !== journeyId) delete pins[slug];
        return {
          ...s,
          companyJourney: { ...s.companyJourney, [slug]: journeyId },
          companyMilestone: { ...s.companyMilestone, [slug]: milestone },
          companyJourneyVersion: pins,
        };
      });
    },
    pinCompanyJourneyVersion: (pins) => {
      setStored((s) => {
        const next = { ...s.companyJourneyVersion };
        for (const [slug, version] of Object.entries(pins)) {
          if (version == null) delete next[slug];
          else next[slug] = version;
        }
        return { ...s, companyJourneyVersion: next };
      });
    },
  };
  return value;
}
