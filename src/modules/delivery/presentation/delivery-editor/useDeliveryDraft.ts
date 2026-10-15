"use client";
import { useRef, useState } from "react";
import { applyTaskOverride } from "../../domain/task-overrides";
import { useTaskOperations } from "../useTaskOperations";
import { deliveryOperationPatch } from "@/shared/infrastructure/operations";
import { resolveExecutionDeadlines } from "../../application/task-deadlines";
import { deliveriesFor } from "../../infrastructure/queries";
import { useDocumentsState } from "@/modules/documents/infrastructure/state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { requestCompletion } from "../../infrastructure/completion-request";
import { deliveryPatchError } from "../../domain/delivery-policy";
import { useServices } from "@/modules/delivery/presentation/state";
import type {
  Delivery,
  DeliveryStatus,
} from "@/modules/delivery/domain/models";
import { useEvidence } from "@/modules/delivery/presentation/useEvidence";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { documentsFor } from "@/modules/documents/infrastructure/queries";
import { useLiveOntology } from "@/modules/knowledge/infrastructure/state";
import {
  NOW,
  deliveryLabel,
  formatDate,
  priorityLabel,
} from "@/shared/lib/format";

export function editedFields(
  previous: Delivery,
  next: Delivery,
): Record<string, unknown> {
  const editable = deliveryOperationPatch(next, previous);
  const before = deliveryOperationPatch(previous);
  const changed = Object.fromEntries(
    Object.entries(editable).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key]),
    ),
  );
  return changed;
}

export const statuses: { id: DeliveryStatus; label: string }[] = [
  { id: "fila", label: "A fazer" },
  { id: "em-curso", label: "Em curso" },
  { id: "revisao", label: "Revisão" },
  { id: "bloqueado", label: "Bloqueada" },
  { id: "entregue", label: "Concluída" },
];

/** The editable draft of one delivery, the stored record under it, and every write. */
export function useDeliveryDraft({
  task,
  onChange,
  onPendingChange,
}: {
  task: Delivery;
  onChange: (id: string, patch: Partial<Delivery>) => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { clients, enrollments } = useClientsState();
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Delivery>(task);
  const savedDraft = useRef(task);
  const operation = useTaskOperations(onPendingChange);
  const [comment, setComment] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [blockOwner, setBlockOwner] = useState("");
  const [blocking, setBlocking] = useState(false);

  const { extraDocs, removedDocs } = useDocumentsState();
  const { members, deactivated, resolve } = useTeam();
  const {
    addComment,
    setBlocker,
    statusMap,
    extraTasks,
    taskPatches,
    toggleChecklistItem,
    addChecklistItem,
    removeChecklistItem,
    setEvidence,
  } = useDeliveryState();
  const [newItem, setNewItem] = useState("");
  const [evidenceDraft, setEvidenceDraft] = useState(task.evidence ?? "");
  const liveOnt = useLiveOntology(draft.company);
  const { configFor, cycles } = useServices();
  const ont = configFor(draft.company).modules.ontology ? liveOnt : undefined;
  /** Comments, history and blocker come from the stored record, which changes under the editor. */
  const live: Delivery = {
    ...applyTaskOverride(
      { ...task, ...(extraTasks.find((t) => t.id === task.id) ?? {}) },
      taskPatches[task.id],
    ),
    status: statusMap[task.id] ?? taskPatches[task.id]?.status ?? task.status,
  };
  const linkedCycle = cycles.find(
    (c) => c.company === draft.company && c.taskIds.includes(draft.id),
  );
  const related =
    ont?.nodes.filter((n) => draft.relatedNodeIds?.includes(n.id)) ?? [];
  const files = documentsFor(draft.company, extraDocs, removedDocs).filter(
    (d) => d.relatedTaskId === draft.id,
  );
  const evidence = useEvidence(live);
  const checklist = live.checklist ?? [];
  const activeBlocker =
    live.blocker && !live.blocker.resolvedAt
      ? live.blocker
      : live.blockers?.trim()
        ? { reason: live.blockers, since: "" }
        : null;
  const comments = [...(live.comments ?? [])].sort((a, b) =>
    a.at.localeCompare(b.at),
  );
  const history = [...(live.history ?? [])].sort((a, b) =>
    b.at.localeCompare(a.at),
  );
  const who = (id: string) => resolve(id).name;
  const valueLabel = (field: string, value?: string) => {
    if (!value) return "—";
    if (field === "status")
      return deliveryLabel[value as DeliveryStatus] ?? value;
    if (field === "ownerId") return who(value);
    if (field === "dueAt") return formatDate(value);
    if (field === "priority")
      return priorityLabel[value as keyof typeof priorityLabel] ?? value;
    return value;
  };

  function set<K extends keyof Delivery>(key: K, value: Delivery[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function save(extra?: Partial<Delivery>) {
    const next = {
      ...draft,
      dueAt:
        live.deadline && live.deadline.mode !== "fixed"
          ? live.dueAt
          : draft.dueAt,
      status: live.status,
      ...extra,
      checklist: live.checklist,
      evidence: live.evidence,
    };
    try {
      const references = deliveriesFor(
        draft.company,
        statusMap,
        extraTasks,
        taskPatches,
      ).filter((t) => t.id !== next.id);
      next.dueAt = resolveExecutionDeadlines(
        [...references, next],
        cycles,
        Object.fromEntries(
          clients.map((client) => [client.slug, client.startedAt]),
        ),
        Object.fromEntries(
          enrollments.map((enrollment) => [enrollment.id, enrollment.startsAt]),
        ),
      )[next.id];
      // A rule that lands before the planned start carries the start with it.
      if (next.startsAt && next.dueAt && next.dueAt < next.startsAt) next.startsAt = next.dueAt;
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (next.status === "entregue" && live.status !== "entregue") {
      const patch = editedFields(savedDraft.current, next);
      setError("");
      requestCompletion(
        task,
        { ...patch, evidence: evidenceDraft },
        (completed) => {
          savedDraft.current = {
            ...savedDraft.current,
            ...completed,
            status: "entregue",
          };
          setDraft((value) => ({ ...value, ...completed, status: "entregue" }));
          setEvidenceDraft(completed.evidence ?? "");
        },
      );
      return;
    }
    if (JSON.stringify(next) === JSON.stringify(task)) return;
    // Only what changed is validated: an old inconsistency never blocks editing another field.
    const touched = Object.fromEntries(
      Object.entries(next).filter(
        ([key, value]) =>
          JSON.stringify(value) !==
          JSON.stringify(savedDraft.current[key as keyof Delivery]),
      ),
    ) as Partial<Delivery>;
    const problem = deliveryPatchError(touched, linkedCycle, {
      current: live,
      linkedDocuments: files.length,
    });
    setError(problem ?? "");
    if (problem) return;
    // Comments, history and the blocker are owned by the store; never overwrite them from a stale draft.
    const { comments: _c, history: _h, blocker: _b, ...patch } = next;
    void _c;
    void _h;
    void _b;
    const changed = editedFields(savedDraft.current, next);
    // These live fields are managed by their own controls, never by a text blur.
    if (extra?.status === undefined) delete changed.status;
    delete changed.evidence;
    if (!Object.keys(changed).length) return;
    void operation.run(
      "tasks.update",
      { taskId: next.id, patch: changed },
      () => onChange(next.id, patch),
      () => {
        savedDraft.current = next;
        setDraft(next);
      },
    );
  }

  /** A transfer edits responsibility only; it never recalculates or resends legacy dates. */
  function transferOwner(ownerId: string) {
    if (!ownerId || ownerId === live.ownerId) return;
    setError("");
    const patch = { ownerId, assignmentSource: "manual" as const };
    void operation.run("tasks.update", { taskId: live.id, patch },
      () => onChange(live.id, patch), () => {
        savedDraft.current = { ...savedDraft.current, ...patch };
        setDraft(value => ({ ...value, ...patch }));
      });
  }

  function sendComment() {
    if (!comment.trim()) return;
    void operation.run(
      "tasks.comment",
      { taskId: draft.id, text: comment },
      () => addComment(draft.id, comment),
      () => setComment(""),
    );
  }

  function resolveBlocker() {
    void operation.run(
      "tasks.blocker",
      { taskId: draft.id, blocker: null },
      () => setBlocker(draft.id, null),
      () => setDraft((d) => ({ ...d, blockers: "", status: "em-curso" })),
    );
  }

  function saveBlocker() {
    const blocker = {
      reason: blockReason.trim(),
      ownerId: blockOwner || undefined,
    };
    void operation.run(
      "tasks.blocker",
      { taskId: draft.id, blocker },
      () => setBlocker(draft.id, { ...blocker, since: NOW.slice(0, 10) }),
      () => {
        setDraft((d) => ({
          ...d,
          blockers: blockReason.trim(),
          status: "bloqueado",
        }));
        setBlocking(false);
        setBlockReason("");
        setBlockOwner("");
      },
    );
  }

  function toggleItem(itemId: string, done: boolean) {
    void operation.run(
      "tasks.checklist",
      { taskId: draft.id, action: "set", itemId, done },
      () => toggleChecklistItem(draft.id, itemId),
    );
  }

  function removeItem(itemId: string) {
    void operation.run(
      "tasks.checklist",
      { taskId: draft.id, action: "remove", itemId },
      () => removeChecklistItem(draft.id, itemId),
    );
  }

  function addItem() {
    void operation.run(
      "tasks.checklist",
      { taskId: draft.id, action: "add", title: newItem },
      () => addChecklistItem(draft.id, newItem),
      () => setNewItem(""),
    );
  }

  function saveEvidenceText() {
    if ((evidenceDraft.trim() || "") !== (live.evidence ?? ""))
      void operation.run(
        "tasks.update",
        { taskId: draft.id, patch: { evidence: evidenceDraft.trim() } },
        () => setEvidence(draft.id, evidenceDraft),
      );
  }

  return {
    draft,
    setDraft,
    live,
    set,
    save,
    error,
    operation,
    members,
    deactivated,
    linkedCycle,
    related,
    files,
    evidence,
    checklist,
    activeBlocker,
    comments,
    history,
    who,
    valueLabel,
    comment,
    setComment,
    sendComment,
    transferOwner,
    blocking,
    setBlocking,
    blockReason,
    setBlockReason,
    blockOwner,
    setBlockOwner,
    resolveBlocker,
    saveBlocker,
    newItem,
    setNewItem,
    toggleItem,
    removeItem,
    addItem,
    evidenceDraft,
    setEvidenceDraft,
    saveEvidenceText,
    statusMap,
    extraTasks,
    taskPatches,
  };
}

export type DeliveryDraft = ReturnType<typeof useDeliveryDraft>;
