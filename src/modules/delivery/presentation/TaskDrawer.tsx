"use client";
import Link from "next/link";
import { useRef } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import { useServices } from "@/modules/delivery/presentation/state";
import type { Delivery } from "@/modules/delivery/domain/models";
import { EvidenceBadge } from "@/modules/delivery/presentation/EvidenceBadge";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { cn } from "@/shared/lib/cn";
import { originLabel, padMilestone } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { Drawer } from "@/shared/ui/Drawer";
import { Button, StatusBadge } from "@/shared/ui/primitives";

import { useDeliveryDraft } from "./delivery-editor/useDeliveryDraft";
import { BlockerSection } from "./delivery-editor/BlockerSection";
import { DeliveryFields } from "./delivery-editor/DeliveryFields";
import { TaskRemoval } from "./delivery-editor/TaskRemoval";
import { StatusPicker } from "./delivery-editor/StatusPicker";
import { ChecklistSection } from "./delivery-editor/ChecklistSection";
import { EvidenceSection } from "./delivery-editor/EvidenceSection";
import { CommentsSection } from "./delivery-editor/CommentsSection";
import { HistorySection } from "./delivery-editor/HistorySection";

type TaskDrawerProps = {
  task: Delivery | null;
  onClose: () => void;
  onChange: (id: string, patch: Partial<Delivery>) => void;
};

/** Quick edit in context; the delivery page shows the same editor with room for comments. */
export function TaskDrawer(props: TaskDrawerProps) {
  return props.task ? (
    <TaskDrawerContent key={props.task.id} {...props} />
  ) : null;
}

/** Kicker text shared by the drawer and the page header. */
export function useDeliveryContext(task: Delivery) {
  const { clientBySlug } = useClientsState();
  const { products, cycles } = useServices();
  const companyName = clientBySlug(task.company)?.name ?? task.company;
  const linkedCycle = cycles.find(
    (c) => c.company === task.company && c.taskIds.includes(task.id),
  );
  const origin =
    task.kind === "request"
      ? `Solicitação${task.origin ? ` · ${originLabel[task.origin]}` : ""}`
      : linkedCycle
        ? linkedCycle.name
        : task.productId
          ? (products.find((p) => p.id === task.productId)?.name ?? "Produto")
          : task.milestone
            ? padMilestone(task.milestone)
            : "Tarefa";
  return { companyName, linkedCycle, kicker: `${companyName} · ${origin}` };
}

function TaskDrawerContent({ task, onClose, onChange }: TaskDrawerProps) {
  const { kicker } = useDeliveryContext(task!);
  const pending = useRef(false);
  return (
    <Drawer
      open={!!task}
      onClose={() => {
        if (!pending.current) onClose();
      }}
      kicker={kicker}
      title={
        task!.title || (task!.kind === "request" ? "Solicitação" : "Tarefa")
      }
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <EvidenceBadge task={task!} />
        <Link
          href={paths.clientDelivery(task!.company, task!.id)}
          onClick={(event) => {
            if (pending.current) event.preventDefault();
            else onClose();
          }}
          className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink"
        >
          Abrir página
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <DeliveryEditor
        task={task!}
        onChange={onChange}
        layout="drawer"
        onRemoved={onClose}
        onPendingChange={(value) => {
          pending.current = value;
        }}
      />
    </Drawer>
  );
}

/**
 * Everything editable about one delivery: fields, blocker, comments and history.
 * `drawer` stacks the sections; `page` gives comments and history their own column.
 */
export function DeliveryEditor({
  task,
  onChange,
  layout = "drawer",
  onPendingChange,
  onRemoved,
}: {
  task: Delivery;
  onChange: (id: string, patch: Partial<Delivery>) => void;
  layout?: "drawer" | "page";
  onPendingChange?: (pending: boolean) => void;
  onRemoved?: () => void;
}) {
  const editor = useDeliveryDraft({ task, onChange, onPendingChange });
  const { draft, live, error, operation, linkedCycle } = editor;

  const blockerSection = <BlockerSection editor={editor} />;
  const fields = <DeliveryFields editor={editor} />;
  const statusPicker = <StatusPicker editor={editor} />;
  const checklistSection = <ChecklistSection editor={editor} />;
  const evidenceSection = <EvidenceSection editor={editor} />;
  const commentsSection = <CommentsSection editor={editor} layout={layout} />;
  const historySection = <HistorySection editor={editor} layout={layout} />;

  const links = (
    <>
      {editor.related.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-[12.5px] text-muted">Ontologia</div>
          <div className="flex flex-wrap gap-1.5">
            {editor.related.map((n) => (
              <Link
                key={n.id}
                href={paths.clientOntology(draft.company, n.id)}
                className="rounded-full bg-soft px-2.5 py-1 text-[12.5px] hover:bg-line"
              >
                {n.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );

  const actions = (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4",
        layout === "drawer"
          ? "mt-6 border-t border-line pt-4"
          : "rounded-xl border border-line bg-soft/35 px-4 py-3",
      )}
    >
      <StatusBadge status={live.status} />
      <div className="flex flex-wrap gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => editor.save({ status: "fila" })}
        >
          Voltar à fila
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => editor.save({ status: "entregue" })}
        >
          <Check className="h-3.5 w-3.5" />
          Concluir
        </Button>
      </div>
    </div>
  );

  const errorBox = (
    <>
      {(error || operation.error) && (
        <div
          role="alert"
          className="mb-4 rounded-lg bg-rose-soft p-3 text-[13px] text-rose"
        >
          {error || operation.error}
          {operation.error && (
            <Button
              size="sm"
              variant="ghost"
              disabled={operation.busy}
              onClick={() => void operation.retry()}
            >
              Tentar novamente
            </Button>
          )}
        </div>
      )}
    </>
  );

  const cycleLine = linkedCycle ? (
    <p className="mb-5 text-[13px] text-muted">
      Ciclo ·{" "}
      <Link
        className="text-ink hover:underline"
        href={paths.clientCycle(draft.company, linkedCycle.id)}
      >
        {linkedCycle.name}
      </Link>
    </p>
  ) : null;

  if (layout === "page")
    return (
      <>
        {errorBox}
        <TaskRemoval editor={editor} onRemoved={onRemoved} />
        <fieldset
          disabled={operation.busy}
          className="grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]"
        >
          <div className="min-w-0">
            {cycleLine}
            {blockerSection}
            {fields}
            {checklistSection}
            {evidenceSection}
            <div className="mt-8">{commentsSection}</div>
          </div>
          <aside className="space-y-6">
            <div className="rounded-xl border border-line p-4">
              {statusPicker}
            </div>
            <div className="rounded-xl border border-line p-4">
              {links}
              {historySection}
            </div>
          </aside>
        </fieldset>
      </>
    );

  return (
    <>
      {errorBox}
      <TaskRemoval editor={editor} onRemoved={onRemoved} />
      <fieldset disabled={operation.busy} className="contents">
        {cycleLine}
        {blockerSection}
        {fields}
        {checklistSection}
        {evidenceSection}
        {statusPicker}
        {links}
        {commentsSection}
        {historySection}
        {actions}
      </fieldset>
    </>
  );
}
