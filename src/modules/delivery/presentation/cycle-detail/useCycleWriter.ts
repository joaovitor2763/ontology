"use client";
import { useMemo, useRef, useState } from "react";
import type { Delivery } from "@/modules/delivery/domain/models";
import { cycleError, type ServiceCycle } from "@/modules/delivery/domain/services";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { useScopedClientExecution } from "@/modules/delivery/infrastructure/ClientExecutionProvider";
import { executeScopedClientCommand } from "@/modules/delivery/infrastructure/client-operations";
import { useServices } from "@/modules/delivery/presentation/state";
import {
  deliveryOperationBaseline,
  executeOperation,
  operationAttempt,
  usesRemoteOperations,
  type OperationAttempt,
} from "@/shared/infrastructure/operations";
import {
  cycleChanges,
  cycleCopyInput,
} from "../../application/cycle-command-input";

/** Every write of one cycle — save, duplicate and remove — with its pending confirmation. */
export function useCycleWriter({
  cycle,
  tasks,
  cycleTasks,
  onUpdateConfirmed,
  onDuplicated,
  onRemoved,
}: {
  cycle: ServiceCycle;
  tasks: Delivery[];
  cycleTasks: Delivery[];
  onUpdateConfirmed: (next: ServiceCycle) => void;
  onDuplicated: (id: string) => void;
  onRemoved: () => void;
}) {
  const { saveCycle } = useServices();
  const { removeCycle } = useDeliveryState();
  const scoped = useScopedClientExecution();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [canVerify, setCanVerify] = useState(false);
  const busyRef = useRef(false);
  const attempt = useRef<OperationAttempt | null>(null);
  const pending = useRef<{
    kind: "update" | "duplicate" | "remove";
    send: () => Promise<void>;
    confirmed: () => void;
  } | null>(null);
  const baseline = useMemo(() => {
    void cycle;
    return deliveryOperationBaseline();
  }, [cycle]);
  const formBaseline = useRef(baseline);
  const clientMarker = useRef(scoped?.clientSnapshot);
  const formClientMarker = useRef(scoped?.clientSnapshot);
  const duplicateId = useRef(`cycle-${crypto.randomUUID()}`);

  function scopedSend<T>(command: "cycles.save" | "cycles.remove", input: unknown,
    sentAttempt: OperationAttempt, openedMarker: string | undefined,
    onResult?: (data: T) => void) {
    if (!scoped || !openedMarker || scoped.company !== cycle.company)
      throw new Error("A execução do cliente mudou. Reabra o ciclo antes de salvar.");
    let written = false;
    return async () => {
      if (!written) {
        const result = await executeScopedClientCommand<T>(command, input,
          sentAttempt.key, openedMarker);
        written = true;
        if (result.clientSnapshot) clientMarker.current = result.clientSnapshot;
        onResult?.(result.data);
      }
      const fresh = await scoped.refresh();
      if (fresh.mode !== "active")
        throw new Error("Não foi possível confirmar a revisão do cliente. Tente novamente.");
      clientMarker.current = fresh.clientSnapshot;
    };
  }

  async function verifyPending() {
    const request = pending.current;
    if (!request || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await request.send();
      pending.current = null;
      setCanVerify(false);
      attempt.current = null;
      setError("");
      busyRef.current = false;
      request.confirmed();
    } catch (problem) {
      setCanVerify(Boolean(pending.current));
      setError(
        problem instanceof Error
          ? problem.message
          : "Não foi possível verificar a gravação.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function update(next: ServiceCycle, capturedBaseline: Record<string, string> | string = scoped
    ? clientMarker.current ?? "" : baseline) {
    if (busyRef.current) return false;
    const issue = cycleError(next, tasks);
    if (issue) {
      setError(issue);
      return false;
    }
    setError("");
    busyRef.current = true;
    setBusy(true);
    try {
      if (await usesRemoteOperations()) {
        const input = { cycleId: cycle.id, cycle: cycleChanges(cycle, next) };
        attempt.current = operationAttempt("cycles.save", input, attempt.current);
        const sentAttempt = attempt.current;
        pending.current = {
          kind: "update",
          send: scoped ? scopedSend("cycles.save", input, sentAttempt,
            typeof capturedBaseline === "string" ? capturedBaseline : clientMarker.current)
            : async () => {
            await executeOperation(
              "cycles.save",
              input,
              sentAttempt,
              typeof capturedBaseline === "string" ? baseline : capturedBaseline,
            );
          },
          confirmed: () => onUpdateConfirmed(next),
        };
        await pending.current.send();
      } else saveCycle(next);
      pending.current = null;
      setCanVerify(false);
      attempt.current = null;
      return true;
    } catch (problem) {
      setCanVerify(Boolean(pending.current));
      setError(
        problem instanceof Error
          ? problem.message
          : "Não foi possível salvar o ciclo.",
      );
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function duplicate() {
    if (busyRef.current) return;
    if (pending.current?.kind === "duplicate") {
      await verifyPending();
      return;
    }
    const length =
      Math.round(
        (new Date(`${cycle.endsAt}T12:00:00`).getTime() -
          new Date(`${cycle.startsAt}T12:00:00`).getTime()) /
          86_400_000,
      ) + 1;
    const shift = (value: string, days: number) => {
      const date = new Date(`${value.slice(0, 10)}T12:00:00`);
      date.setDate(date.getDate() + days);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    };
    const id = duplicateId.current;
    const generated: Delivery[] = cycleTasks
      .filter((t) => t.kind !== "request")
      .map((t, index) => ({
        ...t,
        id: `${id}-d${index + 1}`,
        status: "fila",
        dueAt: t.dueAt ? shift(t.dueAt, length) : "",
        startsAt: t.startsAt ? shift(t.startsAt, length) : undefined,
        checklist: t.checklist?.map((item) => ({
          id: `${id}-${item.id}`,
          title: item.title,
          done: false,
        })),
        evidence: undefined,
        blockers: "",
        blocker: undefined,
        comments: [],
        history: [],
        effortActual: undefined,
      }));
    const sourceTasks = cycleTasks.filter((t) => t.kind !== "request");
    const copiedIds = new Map(
      sourceTasks.map((task, index) => [task.id, generated[index].id]),
    );
    for (const task of generated)
      if (task.deadline?.mode === "task" && copiedIds.has(task.deadline.taskId))
        task.deadline = {
          ...task.deadline,
          taskId: copiedIds.get(task.deadline.taskId)!,
        };
    const next: ServiceCycle = {
      ...cycle,
      id,
      name: `${cycle.name} (cópia)`,
      startsAt: shift(cycle.startsAt, length),
      endsAt: shift(cycle.endsAt, length),
      status: "planejado",
      taskIds: generated.map((t) => t.id),
      acceptance: cycle.acceptance.map((a) => ({
        id: `${id}-${a.id}`,
        text: a.text,
        done: false,
      })),
      transitions: [],
      debrief: undefined,
      acceptanceRequestedAt: undefined,
      createdAt: undefined,
      removed: undefined,
    };
    const issue = cycleError(next, [...tasks, ...generated]);
    if (issue) {
      setError(issue);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      let savedId = id;
      if (await usesRemoteOperations()) {
        const input = cycleCopyInput(next, generated, sourceTasks);
        attempt.current = operationAttempt("cycles.save", input, attempt.current);
        const sentAttempt = attempt.current;
        const send = scoped ? scopedSend<{ cycle: ServiceCycle }>("cycles.save",
          input, sentAttempt, clientMarker.current, result => { savedId = result.cycle.id; })
          : async () => {
          const result = await executeOperation<{ cycle: ServiceCycle }>(
            "cycles.save",
            input,
            sentAttempt,
            baseline,
          );
          savedId = result.data.cycle.id;
        };
        pending.current = {
          kind: "duplicate",
          send,
          confirmed: () => {
            duplicateId.current = `cycle-${crypto.randomUUID()}`;
            onDuplicated(savedId);
          },
        };
        await send();
      } else saveCycle(next, generated);
      pending.current = null;
      setCanVerify(false);
      attempt.current = null;
      duplicateId.current = `cycle-${crypto.randomUUID()}`;
      onDuplicated(savedId);
    } catch (problem) {
      setCanVerify(Boolean(pending.current));
      setError(
        problem instanceof Error
          ? problem.message
          : "Não foi possível duplicar o ciclo.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function remove() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (await usesRemoteOperations()) {
        const input = { cycleId: cycle.id };
        attempt.current = operationAttempt(
          "cycles.remove",
          input,
          attempt.current,
        );
        const sentAttempt = attempt.current;
        pending.current = {
          kind: "remove",
          send: scoped ? scopedSend("cycles.remove", input, sentAttempt,
            clientMarker.current) : async () => {
            await executeOperation("cycles.remove", input, sentAttempt, baseline);
          },
          confirmed: onRemoved,
        };
        await pending.current.send();
      } else removeCycle(cycle.id);
      pending.current = null;
      setCanVerify(false);
      attempt.current = null;
      onRemoved();
    } catch (problem) {
      setCanVerify(Boolean(pending.current));
      setError(
        problem instanceof Error
          ? problem.message
          : "Não foi possível excluir o ciclo.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return {
    error,
    setError,
    busy,
    busyRef,
    canVerify,
    baseline,
    /** The acceptance form keeps the baseline of the moment it opened. */
    captureFormBaseline: () => {
      formBaseline.current = baseline;
      formClientMarker.current = clientMarker.current;
    },
    /** The debrief form takes a fresh baseline, because it opens after a save. */
    renewFormBaseline: () => {
      formBaseline.current = deliveryOperationBaseline();
      formClientMarker.current = clientMarker.current;
    },
    formBaselineValue: () => scoped ? formClientMarker.current ?? "" : formBaseline.current,
    verifyPending,
    update,
    duplicate,
    remove,
  };
}

export type CycleWriter = ReturnType<typeof useCycleWriter>;
