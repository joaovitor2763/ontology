"use client";
import { DatePicker } from "@/shared/ui/DatePicker";

import { useEffect, useRef, useState } from "react";
import { deliveryOperationBaseline, deliveryOperationPatch, executeOperation, operationAttempt, usesRemoteOperations, type OperationAttempt } from "@/shared/infrastructure/operations";
import { isUncertainFailure } from "@/shared/infrastructure/operation-error";
import { editorClearableTaskFields } from "../domain/task-overrides";
import type { Delivery } from "../domain/models";
import {
  completionEvent,
  type CompletionRequest,
} from "../infrastructure/completion-request";
import { useDeliveryState } from "../infrastructure/state";
import { ClientExecutionProvider, useScopedClientExecution } from '../infrastructure/ClientExecutionProvider';
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { executeScopedClientCommand, ScopedCommandError } from '../infrastructure/client-operations';
import { deliveriesFor } from "../infrastructure/queries";
import { useDocumentsState } from "@/modules/documents/infrastructure/state";
import { documentsFor } from "@/modules/documents/infrastructure/queries";
import { UploadDocumentButton } from "@/modules/documents/presentation/UploadDocumentButton";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { Modal } from "@/shared/ui/Dialog";
import { areaClass, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { Checkbox } from "@g4ai/ds";
import { refreshNow } from "@/shared/lib/format";
import { validDate } from "../application/plan-execution";

/**
 * O modal mora no shell e fica em silêncio até alguém pedir para concluir uma
 * tarefa. Quem espera é só o ouvinte do evento: os documentos de execução e de
 * documentos entram quando há um pedido na fila, não em toda página.
 */
export function DeliveryCompletionHost() {
  const { mode } = useSyncStatus();
  const scoped = useScopedClientExecution();
  const [queue, setQueue] = useState<CompletionRequest[]>([]);
  useEffect(() => {
    const receive = (event: Event) => {
      const request = (event as CustomEvent<CompletionRequest>).detail;
      setQueue((items) =>
        items.some((item) => item.id === request.id)
          ? items
          : [...items, request],
      );
    };
    window.addEventListener(completionEvent, receive);
    return () => window.removeEventListener(completionEvent, receive);
  }, []);
  const request = queue[0];
  if (!request) return null;
  const content = (
    <CompletionRequestHost
      key={request.key}
      request={request}
      onClose={() => setQueue((items) => items.slice(1))}
    />
  );
  return mode === "remote" && scoped?.company !== request.company
    ? <ClientExecutionProvider key={request.key} company={request.company}>{content}</ClientExecutionProvider>
    : content;
}

function CompletionRequestHost({
  request,
  onClose,
}: {
  request: CompletionRequest;
  onClose: () => void;
}) {
  const scoped = useScopedClientExecution();
  const state = useDeliveryState();
  const task = scoped
    ? scoped.tasks.find((item) => item.id === request.id && item.company === request.company)
    : deliveriesFor(
      request.company,
      state.statusMap,
      state.extraTasks,
      state.taskPatches,
    ).find((item) => item.id === request.id);
  const close = onClose;
  if (!task)
    return (
      <Modal
        open
        title="Tarefa indisponível"
        onClose={close}
        description="A tarefa foi removida. Feche esta janela para continuar."
      />
    );
  return (
    <CompletionForm
      key={request.key}
      task={task}
      request={request}
      onClose={close}
      complete={state.completeTask}
      scoped={scoped}
    />
  );
}

function CompletionForm({
  task,
  request,
  onClose,
  complete,
  scoped,
}: {
  task: Delivery;
  request: CompletionRequest;
  onClose: () => void;
  complete: (id: string, patch: Partial<Delivery>) => string | null;
  scoped: ReturnType<typeof useScopedClientExecution>;
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [evidence, setEvidence] = useState(
    (Object.hasOwn(request.patch, "evidence")
      ? request.patch.evidence
      : task.evidence) ?? "",
  );
  const [effort, setEffort] = useState(
    String(
      (Object.hasOwn(request.patch, "effortActual")
        ? request.patch.effortActual
        : task.effortActual) ?? "",
    ),
  );
  const [today, setToday] = useState(() => refreshNow().slice(0, 10));
  const [completedAt, setCompletedAt] = useState(task.completedAt ?? today);
  const completionDateTouched = useRef(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const attempt = useRef<OperationAttempt | null>(null);
  const [baseline] = useState(() => {
    if (scoped) return {};
    const value = deliveryOperationBaseline();
    // Uploading evidence is an intentional edit while this modal is open.
    // The command still flushes and guards the current document revision.
    delete value["ontology.documents.v3"];
    return value;
  });
  const { currentUserId } = useWorkspaceState();
  const { extraDocs, removedDocs, docEdits } = useDocumentsState();
  const files = documentsFor(
    task.company,
    extraDocs,
    removedDocs,
    docEdits,
  ).filter((doc) => doc.relatedTaskId === task.id);
  const checklist = task.checklist ?? [];
  const done = (item: NonNullable<Delivery["checklist"]>[number]) =>
    checks[item.id] ?? item.done;
  const pending = checklist.filter((item) => !done(item)).length;
  const requiresEvidence =
    request.patch.requiresEvidence ?? task.requiresEvidence;
  const missingEvidence = requiresEvidence && !evidence.trim() && !files.length;
  const invalidEffort =
    effort !== "" && (!Number.isFinite(Number(effort)) || Number(effort) < 0);
  const invalidCompletionDate = !validDate(completedAt) || completedAt > today;
  useEffect(() => {
    const refreshDate = () => {
      const next = refreshNow().slice(0, 10);
      setToday(next);
      if (!task.completedAt && !completionDateTouched.current) setCompletedAt(next);
    };
    const timer = window.setInterval(refreshDate, 60_000);
    window.addEventListener("focus", refreshDate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshDate);
    };
  }, [task.completedAt]);
  async function confirm() {
    const currentDate = refreshNow().slice(0, 10);
    if (currentDate !== today) setToday(currentDate);
    if (savingRef.current || pending || missingEvidence || invalidEffort || !validDate(completedAt) || completedAt > currentDate) return;
    const at = new Date().toISOString();
    // These fields belong to the live record, never an editor's earlier snapshot.
    const { comments: _c, history: _h, blocker: _b, ...patch } = request.patch;
    void _c;
    void _h;
    void _b;
    const completed: Partial<Delivery> = {
      ...patch,
      checklist: checklist.map((item) =>
        done(item)
          ? item.done
            ? item
            : { ...item, done: true, doneAt: at, doneBy: currentUserId }
          : { ...item, done: false, doneAt: undefined, doneBy: undefined },
      ),
      evidence: evidence.trim() || undefined,
      effortActual: effort === "" ? undefined : Number(effort),
      completedAt,
    };
    // Keep an own undefined property so local patches record the same explicit clear.
    for (const field of editorClearableTaskFields) if (field !== "effortActual" && patch[field] === null) Object.assign(completed, { [field]: undefined });
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      let confirmed = completed;
      if (await usesRemoteOperations()) {
        const input = { taskId: task.id, patch: deliveryOperationPatch({ ...patch }),
          checklist: checklist.map(item => ({ id: item.id, done: done(item) })),
          evidence: evidence.trim(), effortActual: effort === "" ? null : Number(effort), completedAt };
        attempt.current = operationAttempt("tasks.complete", input, attempt.current);
        const result = scoped
          ? await executeScopedClientCommand<{ task: Delivery }>('tasks.complete', input,
            attempt.current.key, scoped.clientSnapshot)
          : await executeOperation<{ task: Delivery }>("tasks.complete", input, attempt.current, baseline);
        confirmed = { ...result.data.task, ...Object.fromEntries(editorClearableTaskFields.map(field => [field, result.data.task[field]])) };
        if (scoped) void scoped.refresh().catch(() => { /* the provider revalidates on focus */ });
      } else {
        const issue = complete(task.id, completed);
        if (issue) throw new Error(issue);
      }
      request.onComplete?.(confirmed);
      onClose();
    } catch (issue) {
      if (scoped && issue instanceof ScopedCommandError && issue.code === 'snapshot_changed')
        try { await scoped.refresh(); } catch { /* keep the form draft available */ }
      setUncertain(issue instanceof ScopedCommandError && (issue.status ?? 500) < 500
        ? false : isUncertainFailure(issue));
      setError(issue instanceof Error ? issue.message : "Não foi possível confirmar a conclusão.");
    }
    finally { savingRef.current = false; setSaving(false); }
  }
  return (
    <Modal
      open
      onClose={() => { if (!savingRef.current) onClose(); }}
      title="Concluir tarefa"
      kicker={task.title}
      description="Confira o que foi feito e registre as informações da conclusão."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={confirm}
            disabled={saving || !!(pending || missingEvidence || invalidEffort || invalidCompletionDate)}
          >
            {saving ? "Concluindo…" : uncertain ? "Verificar conclusão" : completedAt !== today ? "Confirmar data e concluir" : "Confirmar conclusão"}
          </Button>
        </>
      }
    >
      <fieldset disabled={saving || uncertain} className="space-y-5 disabled:opacity-60">
        <div className="space-y-2">
          <label htmlFor="completion-date" className="block text-sm font-medium">
            Data efetiva da conclusão
          </label>
          <DatePicker
            label="Data efetiva da conclusão"
            id="completion-date"
            required
            max={today}
            className={fieldClass}
            value={completedAt}
            onValueChange={(next) => {
              completionDateTouched.current = true;
              setCompletedAt(next);
            }}
          />
          <p className="text-xs text-muted">
            Pode ser uma data passada. O histórico também registra quando esta informação entrou na plataforma.
          </p>
          {completedAt && completedAt !== today && !invalidCompletionDate && (
            <p role="status" className="rounded-lg border border-amber/30 bg-amber-soft/40 px-3 py-2 text-xs text-amber">
              Atenção: a data de conclusão escolhida é diferente de hoje. Confira antes de confirmar para manter o tempo de execução correto.
            </p>
          )}
          {invalidCompletionDate && (
            <p role="alert" className="text-xs text-rose">
              Informe uma data válida que não esteja no futuro.
            </p>
          )}
        </div>
        {checklist.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="mb-3 text-sm font-medium">
              Checklist · {checklist.length - pending}/{checklist.length}
            </legend>
            {checklist.map((item) => (
              <Checkbox
                key={item.id}
                className="w-full break-words rounded-lg border border-line px-3 py-3"
                label={item.title}
                checked={done(item)}
                onCheckedChange={(checked) =>
                  setChecks((values) => ({
                    ...values,
                    [item.id]: checked,
                  }))
                }
              />
            ))}
            {pending > 0 && (
              <p className="text-xs text-muted" role="status">
                Marque{" "}
                {pending === 1
                  ? "o item pendente"
                  : `os ${pending} itens pendentes`}{" "}
                para concluir.
              </p>
            )}
          </fieldset>
        )}
        <div className="space-y-2">
          <label
            htmlFor="completion-evidence"
            className="block text-sm font-medium"
          >
            Evidência {requiresEvidence ? "· obrigatória" : "· opcional"}
          </label>
          <textarea
            id="completion-evidence"
            className={areaClass}
            rows={3}
            placeholder="Descreva ou cole o link do que comprova a tarefa"
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
          />
          {files.length > 0 && (
            <p className="text-xs text-muted">
              {files.length}{" "}
              {files.length === 1
                ? "documento vinculado"
                : "documentos vinculados"}{" "}
              à tarefa.
            </p>
          )}
          <UploadDocumentButton
            company={task.company}
            taskId={task.id}
            deliverableTemplateId={task.deliverableTemplateId}
          />
          {missingEvidence && (
            <p className="text-xs text-muted">
              Descreva a evidência ou anexe um documento.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <label
            htmlFor="completion-effort"
            className="block text-sm font-medium"
          >
            Esforço realizado (h) · opcional
          </label>
          <input
            id="completion-effort"
            type="number"
            min="0"
            step="any"
            className={fieldClass}
            value={effort}
            onChange={(event) => setEffort(event.target.value)}
            placeholder="Ex.: 2"
          />
          {invalidEffort && (
            <p role="alert" className="text-xs text-rose">
              Informe um número maior ou igual a zero.
            </p>
          )}
        </div>
      </fieldset>
        {error && (
          <p role="alert" className="text-sm text-rose">
            {error}
          </p>
        )}
    </Modal>
  );
}
