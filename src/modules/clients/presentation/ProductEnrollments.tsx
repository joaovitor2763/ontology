"use client";
import { DatePicker } from "@/shared/ui/DatePicker";

import { useRef, useState } from "react";
import { Archive, Eye, History, RefreshCw, RotateCcw, Trash2, XCircle } from "lucide-react";
import type { Company } from "../domain/models";
import { enrollmentCanReceiveWork, enrollmentError, enrollmentRemovalError, enrollmentStatusLabel, type EnrollmentLifecycleEntry, type ProductEnrollment } from "../domain/product-enrollments";
import { participantsFor, type ProductStakeholderParticipation } from "../domain/product-stakeholders";
import { stakeholderRoles } from "../domain/stakeholders";
import { useClientsState } from "../infrastructure/state";
import { useStakeholders } from "../infrastructure/stakeholders-state";
import { useCatalogState } from "../../catalog/infrastructure/state";
import { useDeliveryState } from "../../delivery/infrastructure/state";
import { prepareProduct } from "../../delivery/application/product-execution";
import { usePermissions } from "../../workspace/presentation/usePermissions";
import { Combobox } from "@/shared/ui/Combobox";
import { Button } from "@/shared/ui/primitives";
import { Checkbox } from "@g4ai/ds";
import { fieldClass } from "@/shared/ui/Drawer";
import { Modal } from "@/shared/ui/Dialog";
import { ActionMenu } from "@/shared/ui/Menu";
import { OperationButton } from "@/shared/ui/OperationFeedback";
import { formatDateTime } from "@/shared/lib/format";
import { operationAttempt, executeClientOperation, usesRemoteOperations, type OperationAttempt } from "@/shared/infrastructure/operations";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { EnrollmentLifecycleFeedback, type EnrollmentLifecycleAction, useEnrollmentLifecycle } from "./useEnrollmentLifecycle";

export function ProductEnrollments({ company, compact = false, onView }: { company: Company; compact?: boolean; onView?: (enrollmentId: string) => void }) {
  const clients = useClientsState();
  const { products } = useCatalogState();
  const { initializeProduct } = useDeliveryState();
  const { contacts } = useStakeholders();
  const { can, me } = usePermissions();
  const sync = useSyncStatus();
  const [productId, setProductId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [previousEnrollmentId, setPrevious] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<{ action: EnrollmentLifecycleAction; enrollment: ProductEnrollment } | null>(null);
  const [reason, setReason] = useState("");
  const attempt = useRef<OperationAttempt | null>(null);
  const lifecycle = useEnrollmentLifecycle(company);
  const enrollments = clients.enrollments.filter(e => e.company === company.slug);
  const legacy = (clients.configFor(company.slug).productIds ?? []).filter(id => !enrollments.some(e => e.productId === id));

  async function create(event: React.FormEvent) {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    try {
      const input = { company: company.slug, productId, startsAt, ...(previousEnrollmentId ? { previousEnrollmentId } : {}) };
      attempt.current = operationAttempt("enrollments.create", input, attempt.current);
      if (await usesRemoteOperations()) {
        await executeClientOperation("enrollments.create", input, attempt.current);
      } else {
        const product = products.find(p => p.id === productId);
        if (!product) throw new Error("Selecione um produto.");
        const createdAt = new Date().toISOString();
        const config = clients.configFor(company.slug);
        const enrollment: ProductEnrollment = { id: attempt.current.key, company: company.slug, productId, productVersion: product.version ?? 1, startsAt, status: "ativa", previousEnrollmentId: previousEnrollmentId || undefined, createdAt, createdBy: me.id, createdProductLink: !(config.productIds ?? []).includes(productId), lifecycleHistory: [{ type: "created", at: createdAt, by: me.id }] };
        const issue = enrollmentError(enrollment, clients.enrollments);
        if (issue) throw new Error(issue);
        const options = { id: enrollment.id, startsAt };
        const assigned = { ...company, ...clients.assigned(company) };
        const draft = prepareProduct(product, assigned, enrollment.createdAt!, options);
        initializeProduct(draft);
        enrollment.planId = draft.plan.id;
        clients.saveEnrollment(enrollment);
        clients.saveConfig(company.slug, { ...config, productIds: [...new Set([...(config.productIds ?? []), productId])] });
      }
      attempt.current = null; setProductId(""); setStartsAt(""); setPrevious(""); setMessage("Contratação criada com ciclos e tarefas.");
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível criar a contratação."); }
    finally { setBusy(false); }
  }

  const lifecycleCopy = pending ? lifecycleDialogCopy(pending.action, pending.enrollment) : null;
  const canManage = can("cliente.configurar", company.slug) && can("plano.editar", company.slug);
  const canReplaceExecution = sync.resolved && sync.mode === "remote";
  function openLifecycle(action: EnrollmentLifecycleAction, enrollment: ProductEnrollment) {
    lifecycle.reset();
    setReason("");
    setPending({ action, enrollment });
  }
  function confirmLifecycle() {
    if (!pending) return;
    void lifecycle.run(pending.action, pending.enrollment, reason, () => {
      setPending(null);
      setReason("");
    });
  }

  return <section className={compact ? "" : "mb-6 rounded-xl border border-line bg-surface p-4"} aria-label="Produtos contratados">
    {!compact && <h2 className="text-sm font-semibold">Produtos contratados</h2>}
    <p className="mt-1 text-xs text-muted">Cada contratação tem início, execução e stakeholders próprios.</p>
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    {legacy.map(id => <p key={id} className="mt-3 text-sm text-muted">{products.find(p => p.id === id)?.name ?? id} · vínculo legado, sem contratação registrada</p>)}
    {!legacy.length && !enrollments.length && <p className="mt-3 text-sm text-muted">Nenhum produto contratado.</p>}
    <div className="mt-3 space-y-3">{enrollments.map(enrollment => <div key={enrollment.id} className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <details className="min-w-0 flex-1">
          <summary className="cursor-pointer text-sm font-medium">{products.find(p => p.id === enrollment.productId)?.name ?? enrollment.productId} · {enrollment.startsAt ?? "Início não registrado"} · {enrollmentStatusLabel[enrollment.status]}{enrollment.archivedAt ? " · Arquivada" : ""}</summary>
          <p className="mt-2 text-xs text-muted">{enrollment.productVersion ? `Versão ${enrollment.productVersion}` : "Versão histórica não registrada"}{enrollment.previousEnrollmentId ? " · Renovação" : ""}</p>
          <EnrollmentHistory enrollment={enrollment} />
          <EnrollmentPeople enrollment={enrollment} contacts={contacts} canEdit={can("stakeholders.editar", company.slug) && enrollmentCanReceiveWork(enrollment)} />
        </details>
        {(onView || canManage) && <ActionMenu label="Ações da contratação" actions={[
          ...(onView ? [{ label: "Ver execução", icon: <Eye />, onSelect: () => onView(enrollment.id) }] : []),
          ...(canManage ? (enrollment.archivedAt
            ? [{ label: "Restaurar contratação", icon: <RotateCcw />, separator: Boolean(onView), onSelect: () => openLifecycle("restore", enrollment) }]
            : [
                ...(enrollment.status !== "cancelada" && enrollment.status !== "concluida" ? [{ label: "Registrar cancelamento", icon: <XCircle />, separator: Boolean(onView), onSelect: () => openLifecycle("cancel", enrollment) }] : []),
                ...(["concluida", "cancelada"].includes(enrollment.status) ? [{ label: "Arquivar contratação", icon: <Archive />, separator: Boolean(onView), onSelect: () => openLifecycle("archive", enrollment) }] : []),
                ...(canReplaceExecution && enrollmentCanReceiveWork(enrollment) && enrollment.planId ? [{ label: "Recriar pela versão contratada", icon: <RefreshCw />, onSelect: () => openLifecycle("rebuild", enrollment) }] : []),
                ...(canReplaceExecution && !enrollmentRemovalError(enrollment) ? [{ label: "Excluir contratação incorreta", icon: <Trash2 />, tone: "danger" as const, separator: true, onSelect: () => openLifecycle("remove", enrollment) }] : []),
              ]) : []),
        ]} />}
      </div>
    </div>)}</div>
    {canManage && <details className="mt-4 border-t border-line pt-3">
      <summary className="cursor-pointer text-sm font-medium">Nova contratação</summary>
      <form onSubmit={create} className="mt-3 grid gap-3 sm:grid-cols-2">
        <Combobox placeholder="Selecione o produto" label="Produto" value={productId} disabled={busy} onValueChange={id => { setProductId(id); setPrevious(""); }} options={products.map(p => ({ value: p.id, label: p.name }))} />
        <label className="text-xs text-muted">Início da contratação<DatePicker label="Início da contratação" required
              className={fieldClass}
              value={startsAt}
              disabled={busy}
              onValueChange={next => setStartsAt(next)} /></label>
        <Combobox label="Contratação anterior (opcional)" value={previousEnrollmentId} disabled={busy} onValueChange={setPrevious} options={[{ value: "", label: "Nova compra" }, ...enrollments.filter(e => e.productId === productId).map(e => ({ value: e.id, label: `${e.startsAt ?? "Legado"} · ${enrollmentStatusLabel[e.status]}` }))]} />
        <div className="flex items-end"><Button type="submit" disabled={busy || !productId || !startsAt}>{busy ? "Salvando…" : "Contratar produto"}</Button></div>
        {error && <p role="alert" className="text-sm text-rose sm:col-span-2">{error}</p>}
      </form>
    </details>}
    <Modal
      open={Boolean(pending)}
      onClose={() => { if (!lifecycle.busy) { setPending(null); lifecycle.reset(); } }}
      title={lifecycleCopy?.title ?? "Alterar contratação"}
      description={lifecycleCopy?.description}
      footer={<OperationButton operation={lifecycle} busyLabel={lifecycleCopy?.busyLabel} variant={pending?.action === "remove" ? "danger" : "primary"} disabled={pending?.action === "cancel" && !reason.trim()} onClick={confirmLifecycle}>{lifecycleCopy?.confirmLabel ?? "Confirmar"}</OperationButton>}
    >
      {pending?.action === "cancel" && <label className="text-xs text-muted">Motivo do cancelamento<textarea required rows={4} maxLength={600} className={fieldClass} value={reason} disabled={lifecycle.busy} onChange={event => setReason(event.target.value)} placeholder="Registre o contexto para preservar o histórico da relação." /></label>}
      <EnrollmentLifecycleFeedback operation={lifecycle} />
    </Modal>
  </section>;
}

const lifecycleLabels: Record<EnrollmentLifecycleEntry["type"], string> = {
  created: "Contratação criada",
  status: "Situação alterada",
  archived: "Contratação arquivada",
  restored: "Contratação restaurada",
  execution_rebuilt: "Execução recriada pela versão contratada",
};

function EnrollmentHistory({ enrollment }: { enrollment: ProductEnrollment }) {
  const entries = enrollment.lifecycleHistory ?? [];
  if (!entries.length) return null;
  return <details className="mt-3 rounded-lg bg-soft/55 px-3 py-2">
    <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium"><History className="h-3.5 w-3.5" />Histórico da contratação · {entries.length}</summary>
    <ol className="mt-2 space-y-2 border-l border-line pl-3 text-xs text-muted">
      {[...entries].reverse().map((entry, index) => <li key={`${entry.at}-${entry.type}-${index}`}>
        <span className="font-medium text-ink-soft">{lifecycleLabels[entry.type]}</span>
        {entry.from && entry.to ? ` · ${enrollmentStatusLabel[entry.from]} → ${enrollmentStatusLabel[entry.to]}` : ""}
        <span className="block">{formatDateTime(entry.at)}{entry.reason ? ` · ${entry.reason}` : ""}</span>
      </li>)}
    </ol>
  </details>;
}

function lifecycleDialogCopy(action: EnrollmentLifecycleAction, enrollment: ProductEnrollment) {
  const copy = {
    cancel: { title: "Cancelar este produto?", description: "O trabalho deixa de receber novas tarefas, mas ciclos, tarefas e o motivo ficam preservados no histórico do cliente.", confirmLabel: "Registrar cancelamento", busyLabel: "Cancelando…" },
    archive: { title: "Arquivar esta contratação?", description: "Ela sai das seleções de trabalho atual, mas todo o histórico continua disponível no cliente.", confirmLabel: "Arquivar", busyLabel: "Arquivando…" },
    restore: { title: "Restaurar esta contratação?", description: `A contratação volta a aparecer no histórico visível do cliente com situação ${enrollmentStatusLabel[enrollment.status].toLowerCase()}.`, confirmLabel: "Restaurar", busyLabel: "Restaurando…" },
    remove: { title: "Excluir contratação incorreta?", description: "Use apenas para um cadastro feito por engano. A exclusão só será aceita se a execução estiver intacta e sem reuniões ou referências; casos reais devem ser cancelados para preservar o histórico.", confirmLabel: "Excluir definitivamente", busyLabel: "Excluindo…" },
    rebuild: { title: "Recriar a execução correta?", description: `Os ciclos e tarefas intactos serão substituídos pela estrutura exata da versão ${enrollment.productVersion ?? "contratada"} do produto. Se já houver trabalho ou personalizações, nada será alterado.`, confirmLabel: "Recriar execução", busyLabel: "Recriando…" },
  } satisfies Record<EnrollmentLifecycleAction, { title: string; description: string; confirmLabel: string; busyLabel: string }>;
  return copy[action];
}

function EnrollmentPeople({ enrollment, contacts, canEdit }: { enrollment: ProductEnrollment; contacts: ReturnType<typeof useStakeholders>["contacts"]; canEdit: boolean }) {
  const clients = useClientsState();
  const [stakeholderId, setStakeholder] = useState("");
  const [role, setRole] = useState<ProductStakeholderParticipation["accountRole"]>("ponto-focal");
  const [primary, setPrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<OperationAttempt | null>(null);
  const rows = participantsFor(enrollment.id, clients.participations, contacts);

  async function save(stakeholderId: string, accountRole: ProductStakeholderParticipation["accountRole"], primary: boolean, active: boolean) {
    setBusy(true); setError("");
    try {
      const current = clients.participations.find(p => p.enrollmentId === enrollment.id && p.stakeholderId === stakeholderId);
      const input = { company: enrollment.company, enrollmentId: enrollment.id, stakeholderId, accountRole, primary, active,
        ...(current?.stance ? { stance: current.stance } : {}), ...(current?.influence ? { influence: current.influence } : {}) };
      attempt.current = operationAttempt("participants.save", input, attempt.current);
      if (await usesRemoteOperations()) await executeClientOperation("participants.save", input, attempt.current);
      else clients.saveParticipation({ ...current, ...input, id: current?.id ?? attempt.current.key }, contacts);
      attempt.current = null; setStakeholder(""); setPrimary(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar a participação."); }
    finally { setBusy(false); }
  }

  return <div className="mt-3 space-y-3">
    <h3 className="text-xs font-semibold">Stakeholders desta contratação</h3>
    {!rows.length && <p className="text-xs text-muted">Nenhum stakeholder vinculado.</p>}
    {rows.map(({ participation: p, stakeholder, active }) => <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
      <span>{stakeholder.name} · {stakeholderRoles[p.accountRole]}{active && p.primary ? " · Principal" : ""}{!active ? " · Inativo" : ""}</span>
      {canEdit && active && <><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setStakeholder(p.stakeholderId); setRole(p.accountRole); setPrimary(p.primary); }}>Editar papel</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => save(p.stakeholderId, p.accountRole, false, false)}>Desvincular</Button></>}
    </div>)}
    {canEdit && <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); void save(stakeholderId, role, primary, true); }}>
      <Combobox placeholder="Selecione o stakeholder" label="Stakeholder do cliente" value={stakeholderId} disabled={busy} onValueChange={id => { setStakeholder(id); const p = rows.find(r => r.participation.stakeholderId === id)?.participation; setRole(p?.accountRole ?? "ponto-focal"); setPrimary(p?.primary ?? false); }} options={contacts.filter(c => c.company === enrollment.company && c.active).map(c => ({ value: c.id, label: c.name }))} />
      <Combobox label="Papel neste produto" value={role} disabled={busy} onValueChange={value => setRole(value as typeof role)} options={Object.entries(stakeholderRoles).map(([value, label]) => ({ value, label }))} />
      <Checkbox className="self-center" label="Contato principal deste produto" checked={primary} disabled={busy} onCheckedChange={setPrimary} />
      <div><Button type="submit" size="sm" disabled={busy || !stakeholderId}>{busy ? "Salvando…" : "Salvar participação"}</Button></div>
    </form>}
    {error && <p role="alert" className="text-sm text-rose">{error}</p>}
  </div>;
}
