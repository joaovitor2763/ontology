"use client";
import Link from "next/link";
import { useState } from "react";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useCatalog } from "@/modules/catalog/presentation/catalog";
import { useStakeholders } from "@/modules/clients/infrastructure/stakeholders-state";
import type { Delivery } from "@/modules/delivery/domain/models";
import {
  acceptanceWaitingDays,
  cycleProgress,
  debriefError,
  type AcceptanceCriterion,
  type ServiceCycle,
} from "@/modules/delivery/domain/services";
import { useServices } from "@/modules/delivery/presentation/state";
import { useDocumentsState } from "@/modules/documents/infrastructure/state";
import { documentsFor } from "@/modules/documents/infrastructure/queries";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { NOW, formatDate } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { Modal } from "@/shared/ui/Dialog";
import { ActionMenu } from "@/shared/ui/Menu";
import { PageHeading } from "@/shared/ui/PageHeading";
import { Avatar, Badge, Button } from "@/shared/ui/primitives";

import { useCycleWriter } from "./cycle-detail/useCycleWriter";
import { ErrorBox } from "./cycle-detail/ErrorBox";
import { CycleStepper } from "./cycle-detail/CycleStepper";
import { MilestoneChip } from "./cycle-detail/MilestoneChip";
import { AcceptanceSection } from "./cycle-detail/AcceptanceSection";
import { CycleTasks } from "./cycle-detail/CycleTasks";
import {
  CycleDocs,
  CycleHistory,
  CycleMeetings,
} from "./cycle-detail/CycleSideSections";
import { DebriefSection } from "./cycle-detail/DebriefSection";
import {
  ApprovalModal,
  useAcceptanceForm,
} from "./cycle-detail/ApprovalModal";
import { DebriefModal, useDebriefForm } from "./cycle-detail/DebriefModal";

/** Badge shown wherever a cycle waits for the client. */
export function AcceptanceWait({ cycle }: { cycle: ServiceCycle }) {
  const days = acceptanceWaitingDays(cycle, NOW);
  if (days == null) return null;
  return (
    <Badge tone={days >= 5 ? "bad" : "warn"}>
      Aguardando cliente há {days} {days === 1 ? "dia" : "dias"}
    </Badge>
  );
}

/**
 * Everything about one cycle: status trail, acceptance with approvals,
 * deliveries, history, meetings and documents. Used inside the drawer today and
 * reusable as a page body.
 */
export function CycleDetail({
  cycle,
  tasks,
  onEdit,
  onOpenTask,
  onAddDelivery,
  onDeleted,
  onDuplicated,
  layout = "drawer",
}: {
  cycle: ServiceCycle;
  tasks: Delivery[];
  onEdit: (cycle: ServiceCycle) => void;
  onOpenTask: (task: Delivery) => void;
  onAddDelivery: (cycle: ServiceCycle) => void;
  onDeleted?: () => void;
  onDuplicated?: (id: string) => void;
  /** `page` spreads the sections in two columns; `drawer` stacks them. */
  layout?: "drawer" | "page";
}) {
  const { products } = useServices();
  const { clientBySlug } = useClientsState();
  const { journeyOf } = useCatalog();
  const { forCompany } = useStakeholders();
  const { resolve, active, me } = useTeam();
  const { extraDocs, removedDocs } = useDocumentsState();
  const { allMeetings } = useEngagementState();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const client = clientBySlug(cycle.company);
  const milestone =
    cycle.milestone && client
      ? journeyOf(client).milestones.find((m) => m.n === cycle.milestone)
      : undefined;
  const progress = cycleProgress(cycle, tasks);
  const stakeholders = forCompany(cycle.company).filter((s) => s.active);
  const acceptanceForm = useAcceptanceForm(stakeholders);
  const debriefForm = useDebriefForm();

  const writer = useCycleWriter({
    cycle,
    tasks,
    cycleTasks: progress.tasks,
    onUpdateConfirmed: (next) => {
      acceptanceForm.setApproving(null);
      debriefForm.setOpen(false);
      if (next.status === "concluido" && !next.debrief) openDebrief();
    },
    onDuplicated: (id) => onDuplicated?.(id),
    onRemoved: () => {
      setConfirmDelete(false);
      onDeleted?.();
    },
  });
  const { busy, busyRef, update } = writer;

  const personName = (id: string) =>
    stakeholders.find((s) => s.id === id)?.name ?? resolve(id).name;
  const approverOptions = [
    ...stakeholders.map((s) => ({
      value: s.id,
      label: s.name,
      description: `${s.role} · cliente`,
    })),
    ...active.map((p) => ({
      value: p.id,
      label: p.name,
      description: `${p.role} · equipe`,
    })),
  ];
  const docs = documentsFor(cycle.company, extraDocs, removedDocs).filter(
    (d) =>
      cycle.taskIds.includes(d.relatedTaskId ?? "") ||
      (d.uploadedAt.slice(0, 10) >= cycle.startsAt &&
        d.uploadedAt.slice(0, 10) <= cycle.endsAt),
  );
  const meetings = allMeetings.filter(
    (m) =>
      m.company === cycle.company &&
      m.startsAt.slice(0, 10) >= cycle.startsAt &&
      m.startsAt.slice(0, 10) <= cycle.endsAt,
  );
  const transitions = [...(cycle.transitions ?? [])].sort((a, b) =>
    a.at.localeCompare(b.at),
  );
  const templateName =
    cycle.templateName ??
    products
      .find((p) => p.id === cycle.productId)
      ?.cycles.find((t) => t.id === cycle.templateId)?.name ??
    "Personalizado";
  const productName =
    products.find((p) => p.id === cycle.productId)?.name ??
    "Produto não definido";

  function openApproval(criterion: AcceptanceCriterion) {
    if (busyRef.current) return;
    writer.captureFormBaseline();
    writer.setError("");
    acceptanceForm.start(criterion);
  }

  async function registerApproval() {
    const approving = acceptanceForm.approving;
    if (!approving || !acceptanceForm.approvedBy) return;
    const ok = await update(
      {
        ...cycle,
        acceptance: cycle.acceptance.map((v) =>
          v.id === approving.id
            ? {
                ...v,
                done: true,
                approvedBy: acceptanceForm.approvedBy,
                approvedAt: acceptanceForm.approvedAt,
                channel: acceptanceForm.channel,
                note: acceptanceForm.note.trim() || undefined,
              }
            : v,
        ),
      },
      writer.formBaselineValue(),
    );
    if (ok) acceptanceForm.setApproving(null);
  }

  function clearApproval(criterion: AcceptanceCriterion) {
    update({
      ...cycle,
      acceptance: cycle.acceptance.map((v) =>
        v.id === criterion.id
          ? {
              ...v,
              done: false,
              approvedBy: undefined,
              approvedAt: undefined,
              channel: undefined,
              note: undefined,
            }
          : v,
      ),
    });
  }

  const advance = async () => {
    const next: ServiceCycle["status"] =
      cycle.status === "planejado"
        ? "em-curso"
        : cycle.status === "em-curso"
          ? "em-aceite"
          : "concluido";
    const ok = await update({ ...cycle, status: next });
    if (ok && next === "concluido" && !cycle.debrief) openDebrief();
  };

  function openDebrief() {
    if (busyRef.current) return;
    writer.renewFormBaseline();
    writer.setError("");
    debriefForm.start(cycle);
  }

  async function saveDebrief() {
    const debrief = {
      at: cycle.debrief?.at ?? NOW,
      by: me.id,
      score: Number(debriefForm.score),
      comment: debriefForm.comment.trim(),
      wouldRehire: debriefForm.rehire === "sim",
    };
    const issue = debriefError(debrief);
    if (issue) {
      debriefForm.setIssue(issue);
      return;
    }
    if (await update({ ...cycle, debrief }, writer.formBaselineValue()))
      debriefForm.setOpen(false);
  }

  const advanceLabel =
    cycle.status === "planejado"
      ? "Iniciar ciclo"
      : cycle.status === "em-curso"
        ? "Enviar para aceite"
        : "Concluir ciclo";

  const stepper = <CycleStepper status={cycle.status} />;
  const milestoneChip = (
    <MilestoneChip
      cycle={cycle}
      milestone={milestone}
      planMilestones={client ? journeyOf(client).milestones : []}
      onLink={(n) => update({ ...cycle, milestone: n })}
    />
  );
  const errorBox = (
    <ErrorBox
      error={writer.error}
      canVerify={writer.canVerify}
      busy={busy}
      onVerify={writer.verifyPending}
    />
  );
  /** One-line facts of the cycle, shown under the page title. */
  const meta = (
    <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px]">
      <div className="flex items-center gap-1.5">
        <dt className="text-muted">Marco</dt>
        <dd>{milestoneChip}</dd>
      </div>
      <div className="flex items-center gap-1.5">
        <dt className="text-muted">Período</dt>
        <dd className="tabular-nums">
          {formatDate(cycle.startsAt)} — {formatDate(cycle.endsAt)}
        </dd>
      </div>
      <div className="flex items-center gap-1.5">
        <dt className="text-muted">Produto</dt>
        <dd>
          {productName}
          <span className="text-muted"> · {templateName}</span>
        </dd>
      </div>
      <div className="flex items-center gap-1.5">
        <dt className="text-muted">Responsável</dt>
        <dd className="inline-flex items-center gap-1.5">
          <Avatar
            initials={resolve(cycle.ownerId).initials}
            size="sm"
          />
          {resolve(cycle.ownerId).name}
        </dd>
      </div>
    </dl>
  );
  const header = (
    <>
      {stepper}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-muted">
          {formatDate(cycle.startsAt)} — {formatDate(cycle.endsAt)}
        </span>
        {milestoneChip}
        <AcceptanceWait cycle={cycle} />
      </div>
      <p className="text-[12px] text-muted">
        {productName} · Modelo: {templateName} ·{" "}
        {cycle.productVersion
          ? `Versão ${cycle.productVersion}`
          : "Origem anterior ao versionamento"}
      </p>
      <p className="text-[14px] leading-relaxed">{cycle.goal}</p>
      <p className="text-[12px] text-muted">
        Responsável · {resolve(cycle.ownerId).name}
      </p>
      {errorBox}
    </>
  );
  const acceptance = (
    <AcceptanceSection
      cycle={cycle}
      busy={busy}
      personName={personName}
      onApprove={openApproval}
      onClear={clearApproval}
    />
  );
  const deliveries = (
    <CycleTasks
      cycle={cycle}
      rows={progress.tasks}
      done={progress.done}
      total={progress.total}
      busy={busy}
      layout={layout}
      resolve={resolve}
      onOpenTask={onOpenTask}
      onAddDelivery={onAddDelivery}
    />
  );
  const debriefSection = (
    <DebriefSection cycle={cycle} resolve={resolve} onOpen={openDebrief} />
  );
  const history = <CycleHistory transitions={transitions} resolve={resolve} />;
  const meetingsSection = (
    <CycleMeetings company={cycle.company} meetings={meetings} />
  );
  const docsSection = <CycleDocs company={cycle.company} docs={docs} />;
  const primaryAction =
    cycle.status === "concluido" ? (
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => update({ ...cycle, status: "em-curso" })}
      >
        Reabrir ciclo
      </Button>
    ) : (
      <Button size="sm" disabled={busy} onClick={advance}>
        {busy ? "Salvando…" : advanceLabel}
      </Button>
    );
  const backLink = (
    <Link
      href={paths.clientPlan(cycle.company, "ciclos")}
      className="text-[12px] text-muted hover:text-ink"
    >
      Todos os ciclos
    </Link>
  );
  const toolbar = (
    <div className="flex items-center gap-2">
      <ActionMenu
        label="Ações do ciclo"
        actions={[
          {
            disabled: busy,
            label: "Editar ciclo",
            icon: <Pencil />,
            onSelect: () => onEdit(cycle),
          },
          {
            disabled: busy,
            label: "Duplicar",
            icon: <Copy />,
            onSelect: writer.duplicate,
          },
          {
            disabled: busy,
            label: "Excluir",
            icon: <Trash2 />,
            tone: "danger",
            separator: true,
            onSelect: () => setConfirmDelete(true),
          },
        ]}
      />
      {primaryAction}
    </div>
  );
  const actions = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => onEdit(cycle)}
        >
          Editar ciclo
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={writer.duplicate}
        >
          <Copy className="h-3.5 w-3.5" />
          Duplicar
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={busy}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Excluir
        </Button>
      </div>
      {primaryAction}
    </div>
  );

  return (
    <div className={layout === "page" ? "space-y-6" : "space-y-5"}>
      {layout === "page" ? (
        <>
          <PageHeading
            compact
            title={cycle.name}
            description={cycle.goal}
            actions={toolbar}
          />
          <div className="max-w-[1240px] space-y-3">
            {meta}
            <div className="flex flex-wrap items-center justify-between gap-3 border-y border-line py-2">
              {stepper}
              <div className="flex items-center gap-3">
                <AcceptanceWait cycle={cycle} />
                {backLink}
              </div>
            </div>
          </div>
          <div className="grid max-w-[1240px] items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0 space-y-7">
              {errorBox}
              {acceptance}
              {deliveries}
            </div>
            <aside className="space-y-7 lg:border-l lg:border-line lg:pl-6">
              {debriefSection}
              {history}
              {meetingsSection}
              {docsSection}
            </aside>
          </div>
        </>
      ) : (
        <>
          {header}
          {acceptance}
          {deliveries}
          {debriefSection}
          {history}
          {meetingsSection}
          {docsSection}
          {actions}
        </>
      )}
      <Modal
        open={confirmDelete}
        onClose={() => {
          if (!busyRef.current) setConfirmDelete(false);
        }}
        title="Excluir este ciclo?"
        description="As tarefas continuam no cliente. O ciclo deixa de aparecer nas listas."
        footer={
          <>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              Cancelar
            </Button>
            <Button variant="danger" disabled={busy} onClick={writer.remove}>
              {busy ? "Excluindo…" : "Excluir ciclo"}
            </Button>
          </>
        }
      >
        {errorBox}
      </Modal>
      <DebriefModal
        cycle={cycle}
        form={debriefForm}
        busy={busy}
        busyRef={busyRef}
        errorBox={errorBox}
        onSubmit={saveDebrief}
      />
      <ApprovalModal
        cycle={cycle}
        form={acceptanceForm}
        busy={busy}
        busyRef={busyRef}
        meName={me.name}
        approverOptions={approverOptions}
        errorBox={errorBox}
        onSubmit={registerApproval}
      />
    </div>
  );
}
