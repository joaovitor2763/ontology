"use client";
import { DatePicker } from "@/shared/ui/DatePicker";
import { enrollmentCanReceiveWork, enrollmentStatusLabel } from "@/modules/clients/domain/product-enrollments";
import { Combobox } from "@/shared/ui/Combobox";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { useScopedClientExecution } from "@/modules/delivery/infrastructure/ClientExecutionProvider";
import { executeScopedClientCommand } from "@/modules/delivery/infrastructure/client-operations";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import {
  dateAfter,
  instantiateDeliveries,
  type BaseDelivery,
} from "@/modules/catalog/domain/products";
import { BaseDeliveriesEditor } from "@/modules/catalog/presentation/BaseDeliveriesEditor";
import { useCatalog } from "@/modules/catalog/presentation/catalog";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { deliveryOperationBaseline, executeOperation, operationAttempt, usesRemoteOperations, type OperationAttempt } from "@/shared/infrastructure/operations";
import type { JourneyMilestone } from "@/modules/catalog/domain/models";
import {
  cycleError,
  cycleStatusLabel,
  type ServiceCycle,
} from "@/modules/delivery/domain/services";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";
import { useServices } from "@/modules/delivery/presentation/state";
import { NOW, padMilestone } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { ConfirmDialog } from "@/shared/ui/Dialog";
import { areaClass, Drawer, FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { Checkbox } from "@g4ai/ds";
import { Select } from "@/shared/ui/Select";
import { resolveAllDueDates } from "@/modules/catalog/domain/schedule";
const endFromCadence = (start: string, weeks: number) =>
  dateAfter(start, weeks * 7 - 1);
/**
 * Reference deliveries of a milestone as editable copies. Declared schedules
 * set the day; the rest is spread evenly across the cycle.
 */
function referenceDrafts(
  milestone: JourneyMilestone,
  durationDays: number,
  startsAt: string,
): BaseDelivery[] {
  const tasks = milestone.tasks ?? [];
  const resolved = resolveAllDueDates(tasks, { startsAt });
  const clamp = (day: number) => Math.max(1, Math.min(durationDays, day));
  return tasks.map((task, index) => {
    const due = resolved[task.id];
    const day = due
      ? clamp(daysBetween(startsAt, due) + 1)
      : clamp(Math.ceil((durationDays * (index + 1)) / tasks.length));
    return {
      id: `m${milestone.n}-${task.id}`,
      title: task.title,
      description: task.description,
      day,
      hours: task.hours,
      completion: task.completion,
      checklistItems: task.checklistItems,
      requiresEvidence: task.requiresEvidence,
      approvalRequired: task.approvalRequired,
      deliverableTemplateId: task.deliverableTemplateId,
      responsibleRole: task.ownerRole,
      party: task.party,
    };
  });
}

function daysBetween(from: string, to: string) {
  return Math.round(
    (new Date(`${to.slice(0, 10)}T12:00:00`).getTime() -
      new Date(`${from.slice(0, 10)}T12:00:00`).getTime()) /
      86_400_000,
  );
}

export function CycleForm({
  cycle,
  company,
  onClose,
}: {
  cycle?: ServiceCycle;
  company?: string;
  onClose: () => void;
}) {
  const { extraTasks, taskPatches, statusMap } = useDeliveryState();
  const scoped = useScopedClientExecution();
  const { active, members: team } = useTeam();
  const { assigned, clients, clientBySlug, enrollments } = useClientsState();
  const { journeyOf, headOf } = useCatalog();
  const { saveCycle, configFor, products, cycles } = useServices();
  const params = useSearchParams();
  const requestedMilestone = params.get("marco");
  const members = team.filter(
    (p) => active.some((a) => a.id === p.id) || p.id === cycle?.ownerId,
  );
  const defaultOwner = (slug: string) => {
    const record = clientBySlug(slug);
    const assignedId = record ? assigned(record).leadId : undefined;
    return members.find((p) => p.id === assignedId)?.id ?? members[0]?.id ?? "";
  };
  const initialCompany = cycle?.company ?? company ?? clients[0]?.slug ?? "";
  /** `?marco=N` opens the form already filled from that milestone of the client's plan. */
  const initialClientRecord = clientBySlug(initialCompany);
  const requestedEnrollment = enrollments.find(e => e.id === params.get("contratacao") && e.company === initialCompany && enrollmentCanReceiveWork(e));
  const initialMilestoneN =
    !cycle && requestedMilestone && /^\d+$/.test(requestedMilestone)
      ? Number(requestedMilestone)
      : undefined;
  const initialMilestone: JourneyMilestone | undefined =
    initialMilestoneN != null && initialClientRecord
      ? (headOf(requestedEnrollment?.planId ?? "") ?? journeyOf(initialClientRecord)).milestones.find(
          (m) => m.n === initialMilestoneN,
        )
      : undefined;
  const defaultAcceptance = "Tarefas revisadas e aprovadas com o cliente";
  const [slug, setSlug] = useState(initialCompany);
  const [productId, setProductId] = useState(
    cycle?.productId ?? requestedEnrollment?.productId ?? configFor(initialCompany).productIds?.[0] ?? "",
  );
  const [enrollmentChoice, setEnrollmentChoice] = useState(cycle?.enrollmentId ?? requestedEnrollment?.id ?? "");
  const productEnrollments = enrollments.filter(e => e.company === slug && e.productId === productId && (enrollmentCanReceiveWork(e) || e.id === cycle?.enrollmentId));
  const enrollmentId = cycle ? cycle.enrollmentId : enrollmentChoice || (productEnrollments.length === 1 ? productEnrollments[0].id : undefined);
  const [templateId, setTemplateId] = useState(cycle?.templateId ?? "");
  const [milestone, setMilestone] = useState<string>(
    cycle?.milestone
      ? String(cycle.milestone)
      : initialMilestone
        ? String(initialMilestone.n)
        : "",
  );
  const [draftDeliveries, setDraftDeliveries] = useState<BaseDelivery[]>([]);
  const [name, setName] = useState(
    cycle?.name ??
      (initialMilestone
        ? `${padMilestone(initialMilestone.n)} · ${initialMilestone.name}`
        : ""),
  );
  const [goal, setGoal] = useState(cycle?.goal ?? initialMilestone?.goal ?? "");
  const [startsAt, setStart] = useState(cycle?.startsAt ?? NOW.slice(0, 10));
  const [endsAt, setEnd] = useState(
    cycle?.endsAt ??
      endFromCadence(
        NOW.slice(0, 10),
        initialMilestone?.durationWeeks ??
          configFor(initialCompany).cadenceWeeks,
      ),
  );
  const [ownerId, setOwner] = useState(
    cycle?.ownerId ?? defaultOwner(initialCompany),
  );
  const [status, setStatus] = useState<ServiceCycle["status"]>(
    cycle?.status ?? "planejado",
  );
  const [taskIds, setTasks] = useState(cycle?.taskIds ?? []);
  const [acceptance, setAcceptance] = useState(
    cycle?.acceptance.map((a) => a.text).join("\n") ??
      (initialMilestone?.exitCriteria?.length
        ? initialMilestone.exitCriteria.join("\n")
        : defaultAcceptance),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const attempt = useRef<OperationAttempt | null>(null);
  const [baseline] = useState(deliveryOperationBaseline);
  const openedSnapshot = useRef(scoped?.clientSnapshot);
  const confirmedWrite = useRef(false);
  const localCycleId = useRef(cycle?.id ?? `cycle-${crypto.randomUUID()}`);
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null);
  const client = clientBySlug(slug);
  const milestones = client ? journeyOf(client).milestones : [];
  const selectedMilestone = milestones.find((m) => String(m.n) === milestone);
  const tasks = deliveriesFor(slug, statusMap, extraTasks, taskPatches).filter(
    (t) =>
      !t.id.startsWith("pb-") &&
      (cycle?.taskIds.includes(t.id) ||
        ((t.productId ?? "") === productId &&
          (t.enrollmentId ?? "") === (enrollmentId ?? ""))) &&
      !cycles.some((c) => c.id !== cycle?.id && c.taskIds.includes(t.id)),
  );

  const product = products.find((p) => p.id === productId);
  const template = product?.cycles.find((t) => t.id === templateId);
  const availableProducts = products.filter(
    (p) =>
      configFor(slug).productIds?.includes(p.id) || p.id === cycle?.productId,
  );
  const durationDays =
    Math.round(
      (new Date(`${endsAt}T12:00:00`).getTime() -
        new Date(`${startsAt}T12:00:00`).getTime()) /
        86400000,
    ) + 1;
  function applyTemplate(id: string, confirmed = false) {
    const selected = product?.cycles.find((t) => t.id === id);
    const dirty =
      name.trim() !== "" || goal.trim() !== "" || draftDeliveries.length > 0;
    if (selected && dirty && !confirmed) {
      setPendingTemplate(id);
      return;
    }
    setTemplateId(id);
    setDraftDeliveries(selected ? structuredClone(selected.deliveries) : []);
    if (selected) {
      setName(selected.name);
      setGoal(selected.goal);
      setEnd(dateAfter(startsAt, selected.durationDays - 1));
      setAcceptance(selected.acceptance.join("\n"));
    }
  }
  function applyMilestone(value: string) {
    setMilestone(value);
    const m = milestones.find((x) => String(x.n) === value);
    if (!m || cycle) return;
    if (!name.trim()) setName(`${padMilestone(m.n)} · ${m.name}`);
    if (!goal.trim() && m.goal) setGoal(m.goal);
    if (
      m.exitCriteria?.length &&
      (!acceptance.trim() || acceptance === defaultAcceptance)
    )
      setAcceptance(m.exitCriteria.join("\n"));
    if (m.durationWeeks && !templateId)
      setEnd(endFromCadence(startsAt, m.durationWeeks));
  }
  const referenceCount = selectedMilestone?.tasks?.length ?? 0;
  const referenceAdded =
    referenceCount > 0 &&
    (selectedMilestone?.tasks ?? []).every((t) =>
      draftDeliveries.some((d) => d.id === `m${selectedMilestone!.n}-${t.id}`),
    );
  return (
    <Drawer
      open
      onClose={() => { if (!savingRef.current) onClose(); }}
      title={cycle ? "Editar ciclo" : "Novo ciclo"}
      kicker={configFor(slug).name}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="cycle-form" disabled={saving}>
            {saving ? "Salvando…" : "Salvar ciclo"}
          </Button>
        </div>
      }
    >
      <form
        id="cycle-form"
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (savingRef.current) return;
          if (!ownerId) {
            setError(
              "Cadastre um responsável ativo na equipe antes de criar o ciclo.",
            );
            return;
          }
          if (!cycle && productEnrollments.length > 1 && !enrollmentId) { setError("Escolha a contratação deste ciclo."); return; }
          const selectedEnrollment=enrollmentId?enrollments.find(e=>e.id===enrollmentId&&e.company===slug):undefined;
          if(selectedEnrollment&&!enrollmentCanReceiveWork(selectedEnrollment)){setError("A contratação está encerrada ou arquivada e não pode receber alterações.");return;}
          const cycleId = localCycleId.current;
          if (
            draftDeliveries.some(
              (d) =>
                !d.title.trim() ||
                ((!d.deadline || d.deadline.mode === "fixed") && (!Number.isInteger(d.day) || d.day < 1 || d.day > durationDays)) ||
                !Number.isFinite(d.hours) ||
                d.hours < 0,
            )
          ) {
            setError(
              "Revise os títulos, prazos e esforços das novas tarefas.",
            );
            return;
          }
          const generated = instantiateDeliveries(draftDeliveries, {
            cycleId,
            company: slug,
            productId,
            templateId,
            startsAt,
            clientStartsAt: productEnrollments.find(e => e.id === enrollmentId)?.startsAt ?? client?.startedAt,
            ownerId,
          }).map((t) => ({
            ...t,
            enrollmentId,
            milestone: selectedMilestone?.n ?? 0,
          }));
          const now = new Date().toISOString();
          const next: ServiceCycle = {
            ...cycle,
            enrollmentId,
            id: cycleId,
            productId: productId || undefined,
            templateId: templateId || undefined,
            productVersion: cycle
              ? cycle.productVersion
              : (product?.version ?? 1),
            productBaseline: cycle
              ? cycle.productBaseline
              : template
                ? structuredClone(template)
                : undefined,
            productUpdates: cycle?.productUpdates,
            templateName: cycle?.templateName ?? template?.name,
            milestone: selectedMilestone?.n,
            journeyVersion:
              cycle?.journeyVersion ??
              (client ? journeyOf(client).version : undefined),
            company: slug,
            name: name.trim(),
            goal: goal.trim(),
            startsAt,
            endsAt,
            ownerId,
            status,
            taskIds: [...taskIds, ...generated.map((t) => t.id)],
            acceptance: acceptance
              .split("\n")
              .map((t) => t.trim())
              .filter(Boolean)
              .map(
                (text) =>
                  cycle?.acceptance.find((a) => a.text === text) ?? {
                    id: crypto.randomUUID(),
                    text,
                    done: false,
                  },
              ),
            createdAt: cycle?.createdAt ?? now,
            updatedAt: now,
          };
          const problem = cycleError(next, [...tasks, ...generated]);
          if (problem) {
            setError(problem);
            return;
          }
          savingRef.current = true;
          setSaving(true);
          setError("");
          try {
            if (await usesRemoteOperations()) {
              // IDs and audit metadata belong to the server. draftRef only maps
              // dependencies between drafts in this single atomic command.
              const input = {
                company: slug, cycleId: cycle?.id,
                cycle: {
                  name: next.name, goal: next.goal, startsAt, endsAt, ownerId, status,
                  productId: productId || undefined, enrollmentId,
                  templateId: !cycle ? templateId || undefined : undefined,
                  milestone: selectedMilestone?.n ?? null, taskIds,
                  acceptance: next.acceptance.map(a => ({
                    id: cycle?.acceptance.some(prior => prior.id === a.id) ? a.id : undefined,
                    text: a.text, done: a.done, approvedBy: a.approvedBy, channel: a.channel, note: a.note,
                  })),
                },
                tasks: generated.map(t => ({
                  draftRef: t.id, title: t.title, description: t.description, ownerId: t.ownerId,
                  dueAt: t.dueAt, deadline: t.deadline, hours: t.hours, workstream: t.workstream,
                  milestone: selectedMilestone?.n, completion: t.completion, kind: t.kind,
                  responsibleRole: t.responsibleRole, party: t.party, assignmentSource: t.assignmentSource,
                  requiresEvidence: t.requiresEvidence, approvalRequired: t.approvalRequired,
                  deliverableTemplateId: t.deliverableTemplateId, deliverable: t.deliverable,
                  checklist: t.checklist?.map(item => ({ title: item.title })),
                })),
              };
              const prepared = operationAttempt("cycles.save", input, attempt.current);
              if (attempt.current?.key !== prepared.key) confirmedWrite.current = false;
              attempt.current = prepared;
              if (scoped) {
                if (scoped.company !== slug || !openedSnapshot.current)
                  throw new Error("A execução do cliente mudou. Reabra o ciclo antes de salvar.");
                if (!confirmedWrite.current) {
                  await executeScopedClientCommand("cycles.save", input, attempt.current.key, openedSnapshot.current);
                  confirmedWrite.current = true;
                }
                const fresh = await scoped.refresh();
                if (fresh.mode !== "active")
                  throw new Error("Não foi possível confirmar a revisão do cliente. Tente novamente.");
                openedSnapshot.current = fresh.clientSnapshot;
              } else await executeOperation("cycles.save", input, attempt.current, baseline);
            } else saveCycle(next, generated);
            onClose();
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Não foi possível salvar o ciclo.",
            );
          } finally {
            savingRef.current = false;
            setSaving(false);
          }
        }}
      >
        <fieldset disabled={saving} className="space-y-4">
        {!company && !cycle && (
          <FieldBlock label="Cliente">
            <Combobox
              label="Cliente"
              className={fieldClass}
              value={slug}
              onValueChange={(value) => {
                setSlug(value);
                setEnrollmentChoice("");
                setTasks([]);
                setDraftDeliveries([]);
                setTemplateId("");
                setMilestone("");
                setProductId(configFor(value).productIds?.[0] ?? "");
                setEnd(endFromCadence(startsAt, configFor(value).cadenceWeeks));
                setOwner(defaultOwner(value));
              }}
              options={clients.map((c) => ({ value: c.slug, label: c.name }))}
            />
          </FieldBlock>
        )}
        <FieldBlock label="Produto">
          <Combobox
            label="Produto"
            className={fieldClass}
            value={productId}
            disabled={!!cycle}
            required={!cycle}
            onValueChange={(value) => {
              setProductId(value);
              setEnrollmentChoice("");
              setTasks([]);
              setTemplateId("");
              setDraftDeliveries([]);
            }}
            placeholder="Selecione um produto"
            options={availableProducts.map((p) => ({
              value: p.id,
              label: p.name,
            }))}
          />
        </FieldBlock>
        {!cycle && productEnrollments.length > 0 && (
          <FieldBlock label="Contratação">
            <Combobox label="Contratação" className={fieldClass} required value={enrollmentId ?? ""}
              placeholder="Escolha a contratação"
              onValueChange={value => { setEnrollmentChoice(value); setTasks([]); }}
              options={productEnrollments.map(e => ({ value:e.id, label:`${e.startsAt ?? "Início não registrado"} · ${enrollmentStatusLabel[e.status]}` }))}
            />
          </FieldBlock>
        )}
        {cycle?.enrollmentId && <p className="text-[12px] text-muted">Contratação: {productEnrollments.find(e => e.id === cycle.enrollmentId)?.startsAt ?? "Início não registrado"}</p>}
        {!availableProducts.length && (
          <p className="text-[13px] text-muted">
            Vincule um produto em{" "}
            <Link
              className="underline"
              href={paths.client(slug)}
              onClick={onClose}
            >
              Configurar cliente
            </Link>{" "}
            para criar um ciclo.
          </p>
        )}
        {!cycle && (
          <FieldBlock label="Modelo de ciclo">
            <Combobox
              label="Modelo de ciclo"
              className={fieldClass}
              value={templateId}
              required
              onValueChange={(value) => applyTemplate(value)}
              placeholder="Selecione o padrão base"
              options={
                product?.cycles.map((t) => ({
                  value: t.id,
                  label: [t.name, " · ", t.durationDays, " dias"].join(""),
                })) ?? []
              }
            />
          </FieldBlock>
        )}
        {cycle && (
          <p className="text-[12px] text-muted">
            Modelo de origem:{" "}
            {cycle.templateName ?? template?.name ?? "Ciclo personalizado"}. As
            alterações ficam neste cliente.
          </p>
        )}
        {milestones.length > 0 && (
          <FieldBlock label="Marco do plano">
            <Combobox
              label="Marco do plano"
              className={fieldClass}
              value={milestone}
              placeholder="Sem marco"
              onValueChange={applyMilestone}
              options={[
                { value: "", label: "Sem marco" },
                ...milestones.map((m) => ({
                  value: String(m.n),
                  label: `${padMilestone(m.n)} · ${m.name}`,
                  description: m.stage,
                })),
              ]}
            />
          </FieldBlock>
        )}
        {selectedMilestone && (
          <div className="rounded-xl border border-line bg-soft/40 p-3 text-[12px] leading-5 text-muted">
            {selectedMilestone.goal && (
              <p className="text-ink-soft">{selectedMilestone.goal}</p>
            )}
            <p className="mt-1">
              O progresso deste marco passa a contar as tarefas deste ciclo.
              {selectedMilestone.durationWeeks
                ? ` Duração de referência: ${selectedMilestone.durationWeeks} semana${selectedMilestone.durationWeeks === 1 ? "" : "s"}.`
                : ""}
            </p>
            {!cycle && referenceCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2"
                disabled={referenceAdded}
                onClick={() =>
                  setDraftDeliveries((rows) => [
                    ...rows,
                    ...referenceDrafts(
                      selectedMilestone,
                      Math.max(1, durationDays || 1),
                      startsAt,
                    ).filter((r) => !rows.some((x) => x.id === r.id)),
                  ])
                }
              >
                {referenceAdded
                  ? "Tarefas de referência adicionadas"
                  : `Usar tarefas de referência do marco (${referenceCount})`}
              </Button>
            )}
          </div>
        )}
        <FieldBlock label="Nome do ciclo">
          <input
            required
            className={fieldClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Diagnóstico e plano de melhoria"
          />
        </FieldBlock>
        <FieldBlock label="Objetivo">
          <textarea
            required
            rows={3}
            className={areaClass}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Qual resultado vamos alcançar neste período?"
          />
        </FieldBlock>
        <div className="grid grid-cols-2 gap-3">
          <FieldBlock label="Início">
            <DatePicker label="Início" required className={fieldClass} value={startsAt} onValueChange={(next) => setStart(next)} />
          </FieldBlock>
          <FieldBlock label="Término">
            <DatePicker label="Término" required min={startsAt} className={fieldClass} value={endsAt} onValueChange={(next) => setEnd(next)} />
          </FieldBlock>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldBlock label="Responsável">
            <Combobox
              label="Responsável"
              className={fieldClass}
              value={ownerId}
              onValueChange={(value) => setOwner(value)}
              options={members.map((p) => ({ value: p.id, label: p.name }))}
            />
          </FieldBlock>
          <FieldBlock label="Situação">
            <Select
              label="Situação"
              value={status}
              onValueChange={(v) => setStatus(v as ServiceCycle["status"])}
              options={Object.entries(cycleStatusLabel).map(([id, label]) => ({
                value: id,
                label,
              }))}
            />
          </FieldBlock>
        </div>
        <FieldBlock label="Critérios de aceite">
          <textarea
            className={areaClass}
            rows={3}
            value={acceptance}
            onChange={(e) => setAcceptance(e.target.value)}
            placeholder="Um critério por linha"
          />
        </FieldBlock>
        <section className="space-y-3 border-t border-line pt-4">
          <h3 className="text-[14px] font-medium">
            {cycle
              ? "Adicionar tarefas ao ciclo"
              : "Tarefas para este cliente"}
          </h3>
          <p className="text-[12px] leading-5 text-muted">
            {cycle
              ? "As novas tarefas serão criadas ao salvar. Para editar uma tarefa existente, abra-a no detalhe do ciclo."
              : "Esta é uma cópia do padrão. Ajuste o escopo, remova o que não se aplica ou acrescente tarefas. O dia 1 corresponde ao início do ciclo."}
          </p>
          <BaseDeliveriesEditor
            rows={draftDeliveries}
            onChange={setDraftDeliveries}
            maxDay={Math.max(1, durationDays || 1)}
          />
        </section>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">
            Vincular tarefas existentes
          </legend>
          <p className="mb-3 text-[12px] text-muted">
            Selecione as tarefas e solicitações que compõem este resultado.
          </p>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
            {tasks.map((t) => (
              <Checkbox
                key={t.id}
                className="w-full rounded-lg p-2 hover:bg-soft"
                label={t.title}
                description={t.kind === "request" ? "Solicitação" : undefined}
                checked={taskIds.includes(t.id)}
                onCheckedChange={(checked) =>
                  setTasks((ids) =>
                    checked
                      ? [...ids, t.id]
                      : ids.filter((id) => id !== t.id),
                  )
                }
              />
            ))}
            {!tasks.length && (
              <p className="p-2 text-[12px] text-muted">
                Nenhuma tarefa disponível neste cliente.
              </p>
            )}
          </div>
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
      <ConfirmDialog
        open={pendingTemplate !== null}
        onClose={() => setPendingTemplate(null)}
        onConfirm={() => {
          if (pendingTemplate) applyTemplate(pendingTemplate, true);
        }}
        title="Aplicar este modelo?"
        description="Nome, objetivo, término, critérios de aceite e tarefas já preenchidos serão substituídos pelo padrão do modelo."
        confirmLabel="Aplicar modelo"
      />
    </Drawer>
  );
}
