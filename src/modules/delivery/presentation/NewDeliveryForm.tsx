"use client";
import { DatePicker } from "@/shared/ui/DatePicker";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import type { Delivery } from "@/modules/delivery/domain/models";
import type { ServiceCycle } from "@/modules/delivery/domain/services";
import type { ActiveExecutionBoard } from '../infrastructure/execution-board-collection';
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { useScopedClientExecution } from '@/modules/delivery/infrastructure/ClientExecutionProvider';
import { executeScopedClientCommand, ScopedCommandError } from '../infrastructure/client-operations';
import { isUncertainFailure, OperationRefused } from '@/shared/infrastructure/operation-error';
import { useServices } from "@/modules/delivery/presentation/state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { NOW, priorityLabel } from "@/shared/lib/format";
import { deliverableTemplates } from "@/modules/documents/infrastructure/deliverable-templates";
import { Combobox } from "@/shared/ui/Combobox";
import { Select } from "@/shared/ui/Select";
import { Drawer, FieldBlock, areaClass, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { Checkbox } from "@g4ai/ds";
import { TaskDeadlineFields } from "@/modules/catalog/presentation/TaskDeadlineFields";
import { resolveTaskDeadlines, type TaskDeadline } from "@/modules/catalog/domain/task-deadlines";
import { deliveriesFor } from "../infrastructure/queries";
import { useRef, useState } from "react";
import { deliveryOperationBaseline, deliveryOperationPatch, executeOperation, operationAttempt, usesRemoteOperations, type OperationAttempt } from "@/shared/infrastructure/operations";

/**
 * Creates one delivery from anywhere: the execution board, a client's board or
 * the detail of a cycle. Linking to a cycle also appends it to the cycle.
 */
export function NewDeliveryForm({
  company,
  cycle,
  milestone,
  journeyId,
  enrollmentId,
  onClose,
  onCreated,
}: {
  company?: string;
  cycle?: ServiceCycle;
  /** Milestone of the client's plan the delivery belongs to when no cycle is linked. */
  milestone?: number;
  journeyId?: string;
  enrollmentId?: string | null;
  onClose: () => void;
  onCreated?: (task: Delivery) => void;
}) {
  const { addTask, statusMap, extraTasks, taskPatches } = useDeliveryState();
  const { saveCycle, cycles } = useServices();
  return <NewDeliveryFormContent company={company} cycle={cycle} milestone={milestone}
    journeyId={journeyId} enrollmentId={enrollmentId} onClose={onClose}
    onCreated={onCreated} local={{ addTask, saveCycle, cycles,
      referencesFor: (slug: string) => deliveriesFor(slug, statusMap, extraTasks, taskPatches),
    }} />;
}

/** Global creation reads lightweight references from the board and writes one client slice. */
export function RemoteNewDeliveryForm({ board, refresh, onClose, onCreated }: {
  board: ActiveExecutionBoard;
  refresh: () => Promise<unknown>;
  onClose: () => void;
  onCreated?: (task: Delivery) => void;
}) {
  return <NewDeliveryFormContent onClose={onClose} onCreated={onCreated}
    remote={{ board, refresh }} />;
}

function NewDeliveryFormContent({ company, cycle, milestone, journeyId, enrollmentId,
  onClose, onCreated, local, remote }: {
  company?: string;
  cycle?: ServiceCycle;
  milestone?: number;
  journeyId?: string;
  enrollmentId?: string | null;
  onClose: () => void;
  onCreated?: (task: Delivery) => void;
  local?: {
    addTask: (task: Delivery) => void;
    saveCycle: (cycle: ServiceCycle, tasks: Delivery[]) => void;
    cycles: ServiceCycle[];
    referencesFor: (slug: string) => { id: string; company: string; title: string; dueAt: string }[];
  };
  remote?: { board: ActiveExecutionBoard; refresh: () => Promise<unknown> };
}) {
  const scoped = useScopedClientExecution();
  const [deadline, setDeadline] = useState<TaskDeadline>({mode:"fixed"});
  const cycles = remote?.board.cycles ?? local?.cycles ?? [];
  const { clients, assigned, enrollments } = useClientsState();
  const { active } = useTeam();
  const initialSlug = cycle?.company ?? company ?? clients[0]?.slug ?? "";
  const ownerFor = (slug: string) => {
    const client = clients.find((c) => c.slug === slug);
    const leadId = client ? assigned(client).leadId : undefined;
    return (
      active.find((p) => p.id === leadId)?.id ?? active[0]?.id ?? ""
    );
  };
  const [slug, setSlug] = useState(initialSlug);
  const [cycleId, setCycleId] = useState(cycle?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState(
    cycle?.ownerId ?? ownerFor(initialSlug),
  );
  const [dueAt, setDueAt] = useState(
    new Date(new Date(NOW).getTime() + 7 * 86400000).toISOString().slice(0, 10),
  );
  const [hours, setHours] = useState(4);
  const [priority, setPriority] = useState<NonNullable<Delivery["priority"]>>("media");
  const [completion, setCompletion] = useState<"checklist" | "deliverable">(
    "checklist",
  );
  const [templateId, setTemplateId] = useState("");
  const [requiresEvidence, setRequiresEvidence] = useState(true);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [checklistText, setChecklistText] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const attempt = useRef<OperationAttempt | null>(null);
  const taskId = useRef(`d-${crypto.randomUUID()}`);
  const frozenInput = useRef<unknown>(null);
  const [uncertain, setUncertain] = useState(false);
  const [baseline] = useState(() => scoped || remote ? {} : deliveryOperationBaseline());
  const openCycles = cycles.filter(
    (c) => c.company === slug && c.status !== "concluido" && (enrollmentId === undefined || (c.enrollmentId ?? null) === enrollmentId),
  );
  const linked = cycles.find((c) => c.id === cycleId);
  const references = remote
    ? remote.board.referenceTasks.filter(task => task.company === slug)
    : local?.referencesFor(slug) ?? [];
  let effectiveDue = dueAt, deadlineError = "";
  try {
    effectiveDue = resolveTaskDeadlines([...references.map(t => ({...t, deadline: undefined})), {id:"new-task", company:slug, title, dueAt, deadline}], {"new-task":{cycleStart:linked?.startsAt,clientStart:clients.find(c=>c.slug===slug)?.startedAt}})["new-task"];
  } catch (e) { deadlineError = (e as Error).message; }


  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    if (deadlineError) { setError(deadlineError); return; }
    if (!title.trim()) {
      setError("Dê um título à tarefa.");
      return;
    }
    if (!slug) {
      setError("Escolha o cliente.");
      return;
    }
    if (!ownerId) {
      setError("Escolha um responsável ativo.");
      return;
    }
    // Sem prazo (Data fixa vazia) a tarefa nasce no Backlog.
    const backlog = deadline.mode === "fixed" && !effectiveDue;
    if (!backlog && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDue)) {
      setError("Informe um prazo válido.");
      return;
    }
    if (!backlog && linked && (effectiveDue < linked.startsAt || effectiveDue > linked.endsAt)) {
      setError("O prazo precisa ficar dentro do período do ciclo.");
      return;
    }
    const task: Delivery = {
      id: taskId.current,
      company: slug,
      productId: linked?.productId ?? enrollments.find(e => e.id === enrollmentId && e.company === slug)?.productId,
      enrollmentId: linked?.enrollmentId ?? enrollmentId ?? undefined,
      cycleTemplateId: linked?.templateId,
      title: title.trim(),
      priority,
      description: description.trim(),
      status: "fila",
      ownerId,
      dueAt: effectiveDue,
      deadline,
      startsAt: backlog ? undefined : linked?.startsAt,
      hours: Number.isFinite(hours) && hours >= 0 ? hours : 0,
      workstream: "Tarefa",
      milestone: linked?.milestone ?? milestone ?? 0,
      journeyId,
      completion,
      kind: "journey",
      deliverableTemplateId:
        completion === "deliverable" && templateId ? templateId : undefined,
      requiresEvidence: completion === "deliverable" ? requiresEvidence : false,
      approvalRequired: completion === "deliverable" ? approvalRequired : false,
      checklist:
        completion === "checklist"
          ? checklistText
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .map((title, i) => ({ id: `ck-${i + 1}-${taskId.current.slice(2, 10)}`, title, done: false }))
          : undefined,
    };
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      let created = task;
      if (await usesRemoteOperations()) {
        const input = uncertain && frozenInput.current
          ? frozenInput.current
          : { company: slug, cycleId: linked?.id, task: { ...deliveryOperationPatch({ ...task }), checklist: task.checklist?.map(item => ({ title: item.title })) } };
        attempt.current = operationAttempt("tasks.create", input, attempt.current);
        frozenInput.current = input;
        if (scoped && slug !== scoped.company) throw new OperationRefused('Escolha o cliente desta página.');
        const remoteMarker = remote?.board.clientSnapshots[slug];
        if (remote && !remoteMarker) throw new OperationRefused('Carregue novamente as tarefas deste cliente.');
        const result = remoteMarker
          ? await executeScopedClientCommand<{ task: Delivery }>('tasks.create', input,
            attempt.current.key, remoteMarker)
          : scoped
            ? await executeScopedClientCommand<{ task: Delivery }>('tasks.create', input,
              attempt.current.key, scoped.clientSnapshot)
            : await executeOperation<{ task: Delivery }>("tasks.create", input, attempt.current, baseline);
        created = result.data.task;
        frozenInput.current = null;
        setUncertain(false);
        if (scoped) void scoped.refresh().catch(() => { /* the provider revalidates on focus */ });
      } else if (linked && local) local.saveCycle({ ...linked, taskIds: [...linked.taskIds, task.id] } as ServiceCycle, [task]);
      else local?.addTask(task);
      onCreated?.(created);
      onClose();
    } catch (issue) {
      if (scoped && issue instanceof ScopedCommandError && issue.code === 'snapshot_changed')
        try { await scoped.refresh(); } catch { /* preserve the draft for retry */ }
      if (remote && issue instanceof ScopedCommandError && issue.code === 'snapshot_changed')
        try { await remote.refresh(); } catch { /* preserve the draft for retry */ }
      const mayHaveWritten = issue instanceof ScopedCommandError
        ? (issue.status ?? 500) >= 500 : isUncertainFailure(issue);
      setUncertain(mayHaveWritten);
      if (!mayHaveWritten) frozenInput.current = null;
      setError(issue instanceof Error ? issue.message : "Não foi possível criar a tarefa.");
    }
    finally { savingRef.current = false; setSaving(false); }
  }

  return (
    <Drawer
      open
      onClose={() => { if (!savingRef.current) onClose(); }}
      title="Nova tarefa"
      kicker={
        linked
          ? `${clients.find((c) => c.slug === slug)?.name ?? ""} · ${linked.name}`
          : (clients.find((c) => c.slug === slug)?.name ?? "Tarefa")
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="new-delivery-form" disabled={saving}>
            {saving ? "Criando…" : uncertain ? "Verificar criação" : "Criar tarefa"}
          </Button>
        </div>
      }
    >
      <form id="new-delivery-form" className="space-y-1" onSubmit={submit}>
        <fieldset disabled={saving || uncertain} className="space-y-1 disabled:opacity-60">
        <FieldBlock label="Título">
          <input
            autoFocus
            required
            className={fieldClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex.: Mapa do processo de despacho"
            maxLength={240}
          />
        </FieldBlock>
        {!company && !cycle && (
          <FieldBlock label="Cliente">
            <Combobox
              label="Cliente"
              className={fieldClass}
              value={slug}
              onValueChange={(value) => {
                setSlug(value);
                setCycleId("");
                setOwnerId(ownerFor(value));
              }}
              options={clients.map((c) => ({ value: c.slug, label: c.name }))}
            />
          </FieldBlock>
        )}
        {!cycle && (
          <FieldBlock label="Ciclo (opcional)">
            <Combobox
              label="Ciclo"
              className={fieldClass}
              value={cycleId}
              placeholder="Sem ciclo"
              onValueChange={(value) => setCycleId(value)}
              options={[
                { value: "", label: "Sem ciclo" },
                ...openCycles.map((c) => ({
                  value: c.id,
                  label: c.name,
                  description: `${c.startsAt} — ${c.endsAt}`,
                })),
              ]}
            />
          </FieldBlock>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldBlock label="Responsável">
            <Combobox
              label="Responsável"
              className={fieldClass}
              value={ownerId}
              onValueChange={(value) => setOwnerId(value)}
              options={active.map((p) => ({ value: p.id, label: p.name }))}
            />
          </FieldBlock>
          <FieldBlock label="Prazo">
            <DatePicker
              label="Prazo"
              aria-describedby="new-task-due-hint"
              className={fieldClass}
              value={effectiveDue}
              readOnly={deadline.mode !== "fixed"}
              min={linked?.startsAt}
              max={linked?.endsAt}
              onValueChange={(next) => setDueAt(next)}
            />
            {deadline.mode === "fixed" && (
              <p id="new-task-due-hint" className="mt-1 text-xs text-muted">
                {effectiveDue ? (
                  <button type="button" className="underline-offset-2 hover:underline" onClick={() => setDueAt("")}>
                    Criar sem prazo (Backlog)
                  </button>
                ) : "Sem prazo, a tarefa entra no Backlog."}
              </p>
            )}
          </FieldBlock>
          <FieldBlock label="Esforço previsto (h)">
            <input
              type="number"
              min={0}
              step={0.5}
              className={fieldClass}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </FieldBlock>
        </div>
        <TaskDeadlineFields value={deadline} onChange={setDeadline} tasks={references} cycleAvailable={!!linked} />
        {deadlineError && <p role="status" className="text-sm text-rose">{deadlineError}</p>}
        <FieldBlock label="Prioridade">
          <Select label="Prioridade" value={priority} onValueChange={v => setPriority(v as NonNullable<Delivery["priority"]>)} tone={priority === "critica" ? "bad" : "neutral"} options={Object.entries(priorityLabel).map(([value,label])=>({value,label}))} />
          <p className="mt-1 text-xs text-muted">Escolha Crítica para destacar uma tarefa muito importante dentro do ciclo.</p>
        </FieldBlock>
        <FieldBlock label="Descrição">
          <textarea
            className={areaClass}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Resultado esperado e como será validado."
            maxLength={4000}
          />
        </FieldBlock>
        <fieldset className="mb-4 rounded-xl border border-line p-4">
          <legend className="px-1 text-[12.5px] text-muted">
            Como a tarefa é concluída
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldBlock label="Tipo">
              <Select
                label="Tipo de conclusão"
                value={completion}
                onValueChange={(v) => setCompletion(v as "checklist" | "deliverable")}
                options={[
                  {
                    value: "deliverable",
                    label: "Entregável",
                    description: "Exige um artefato como evidência",
                  },
                  {
                    value: "checklist",
                    label: "Checklist",
                    description: "Concluída quando todos os itens estiverem marcados",
                  },
                ]}
              />
            </FieldBlock>
            {completion === "deliverable" && (
              <FieldBlock label="Modelo de entregável">
                <Select
                  label="Modelo de entregável"
                  value={templateId}
                  placeholder="Sem modelo"
                  onValueChange={setTemplateId}
                  options={[
                    { value: "", label: "Sem modelo" },
                    ...deliverableTemplates.map((t) => ({
                      value: t.id,
                      label: t.name,
                    })),
                  ]}
                />
              </FieldBlock>
            )}
          </div>
          {completion === "deliverable" ? (
            <div className="flex flex-wrap gap-4">
              <Checkbox
                label="Exige evidência para concluir"
                checked={requiresEvidence}
                onCheckedChange={setRequiresEvidence}
              />
              <Checkbox
                label="Exige aprovação do documento"
                checked={approvalRequired}
                onCheckedChange={setApprovalRequired}
              />
            </div>
          ) : (
            <FieldBlock label="Itens do checklist (um por linha)">
              <textarea
                className={areaClass}
                rows={4}
                value={checklistText}
                onChange={(e) => setChecklistText(e.target.value)}
                placeholder={"Entrevistas agendadas\nMapa validado com o dono do processo"}
              />
            </FieldBlock>
          )}
        </fieldset>
        </fieldset>
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-rose-soft px-3 py-2 text-[13px] text-rose"
          >
            {error}
          </p>
        )}
      </form>
    </Drawer>
  );
}
