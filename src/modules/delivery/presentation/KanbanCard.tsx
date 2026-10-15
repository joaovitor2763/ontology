"use client";
import { memo, useState } from "react";
import type { DragEvent } from "react";
import type { Delivery } from "@/modules/delivery/domain/models";
import { CriticalTaskBadge } from "./CriticalTaskBadge";
import { EvidenceTag } from "./EvidenceBadge";
import type { EvidenceEvaluation } from "./useEvidence";
import { cn } from "@/shared/lib/cn";
import { workspaceDate } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { ActionMenu, actionMenuTriggerClass, type MenuAction } from "@/shared/ui/Menu";
import { CalendarDays, MoreHorizontal, Trash2 } from "lucide-react";
import { Avatar } from "@/shared/ui/primitives";
import { DatePicker } from "@/shared/ui/DatePicker";

export type KanbanCardProps = {
  task: Delivery;
  /** Nome do cliente; ausente no quadro de um cliente só. */
  companyLabel?: string;
  /** Ciclo ou produto ao qual a tarefa pertence. */
  subtitle?: string;
  ownerInitials: string;
  ownerFirstName: string;
  /** Marco já formatado; ausente quando a tarefa está em um ciclo. */
  milestoneLabel?: string;
  dueLabel: string;
  dueTitle: string;
  dueOverdue: boolean;
  canEditDue: boolean;
  evaluation: EvidenceEvaluation;
  onOpenByClick: (task: Delivery) => void;
  onOpenByKey: (task: Delivery) => void;
  onDragStart: (task: Delivery, event: DragEvent) => void;
  onDragEnd: () => void;
  onSaveDue: (task: Delivery, dueAt: string) => void;
  /** Rótulo do seletor aberto pelo quadro: a tarefa sem prazo precisa de data para mudar de coluna. */
  duePrompt?: string;
  onDuePromptClose?: () => void;
  onRequestRemove?: (task: Delivery) => void;
};

/**
 * O menu de ações do cartão, montado só quando alguém o usa.
 *
 * `ActionMenu` traz gatilho, portal, posicionador e popup inteiros; num quadro
 * de trezentas tarefas isso é trezentos menus montados para que, no máximo, um
 * abra. Fechado, aqui só existe o botão — mesmo rótulo, mesmas classes, mesmo
 * lugar na ordem de tabulação. O primeiro clique ou Enter troca pelo menu de
 * verdade já aberto, então o gesto continua sendo um só.
 */
function CardActions({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [live, setLive] = useState(false);
  if (live)
    return <ActionMenu label={label} className="h-6 w-6" actions={actions} defaultOpen />;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-haspopup="menu"
      aria-expanded={false}
      onClick={() => setLive(true)}
      className={cn(actionMenuTriggerClass(), "h-6 w-6")}
    >
      <MoreHorizontal className="h-4 w-4" aria-hidden />
    </button>
  );
}

/**
 * Um cartão do quadro. Mover uma tarefa reconstrói a projeção inteira, então
 * todo cartão chega com um objeto novo a cada gesto; sem memoização o quadro
 * renderiza as ~130 tarefas para mudar uma. A comparação abaixo olha o que o
 * cartão mostra, não a identidade do objeto, e deixa passar só as tarefas cuja
 * aparência mudou.
 *
 * A tarefa inteira continua sendo entregue a `onOpen*` porque o quadro
 * reencontra o registro atual pelo identificador antes de abrir a gaveta.
 */
export const KanbanCard = memo(function KanbanCard({
  task,
  companyLabel,
  subtitle,
  ownerInitials,
  ownerFirstName,
  milestoneLabel,
  dueLabel,
  dueTitle,
  dueOverdue,
  canEditDue,
  evaluation,
  onOpenByClick,
  onOpenByKey,
  onDragStart,
  onDragEnd,
  onSaveDue,
  duePrompt,
  onDuePromptClose,
  onRequestRemove,
}: KanbanCardProps) {
  const [editingDue, setEditingDue] = useState(false);
  const dueChip = task.dueAt
    ? <><CalendarDays className="size-3" aria-hidden />{task.dueAt.slice(8, 10)}/{task.dueAt.slice(5, 7)}{task.dueAt.slice(0, 4) !== workspaceDate().slice(0, 4) && `/${task.dueAt.slice(2, 4)}`}</>
    : <><CalendarDays className="size-3" aria-hidden />Sem prazo</>;
  const dueAction = task.dueAt ? "Alterar prazo" : "Definir prazo";
  const dueChipClass = cn(
    "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-accent",
    dueOverdue ? "border-rose/25 bg-rose-soft/60 text-rose hover:bg-rose-soft" : "border-line bg-soft/60 text-ink-soft hover:bg-soft",
  );
  return (
    <article
      draggable
      role="button"
      tabIndex={0}
      aria-label={`Abrir tarefa: ${task.title}`}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenByKey(task);
        }
      }}
      onDragStart={(event) => onDragStart(task, event)}
      onDragEnd={onDragEnd}
      onClick={() => onOpenByClick(task)}
      className={cn(
        "kanban-task surface-card surface-interactive w-full cursor-grab rounded-tile border border-line bg-surface p-3 text-left hover:border-line-strong active:cursor-grabbing",
        task.status === "bloqueado" && "border-rose/30",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 font-medium leading-snug text-[13.5px]">
          {task.title}
          <CriticalTaskBadge priority={task.priority} />
        </div>
        <span
          className="-mr-1.5 -mt-1 shrink-0"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          draggable={false}
        >
          <CardActions
            label={`Ações de ${task.title}`}
            actions={[
              {
                label: "Abrir página",
                href: paths.clientDelivery(task.company, task.id),
              },
              { label: "Abrir cliente", href: paths.client(task.company) },
              ...(onRequestRemove ? [{ label: "Excluir tarefa", icon: <Trash2 />, tone: "danger" as const, onSelect: () => onRequestRemove(task) }] : []),
            ]}
          />
        </span>
      </div>
      {task.kind === "request" && (
        <p className="mt-1 text-[11px] text-muted">Ticket / Solicitação</p>
      )}
      {companyLabel && (
        <div className="mt-1 text-[12px] text-muted">{companyLabel}</div>
      )}
      {subtitle && (
        <p className="mt-1 truncate text-[11px] text-muted">{subtitle}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5">
          <Avatar initials={ownerInitials} size="sm" />
          <span className="text-[12px] text-muted">{ownerFirstName}</span>
          {milestoneLabel && (
            <span className="rounded bg-soft px-1.5 py-0.5 text-[10px] text-muted">
              {milestoneLabel}
            </span>
          )}
        </span>
        {canEditDue || duePrompt ? (
          <span onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}
            onDragStart={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} draggable={false}>
            {editingDue || duePrompt ? <DatePicker
              label={duePrompt ? `${duePrompt} · ${task.title}` : `${dueAction} de ${task.title} · ${dueTitle} (${dueLabel})`}
              value={task.dueAt}
              required={Boolean(duePrompt) || task.status !== "fila"}
              defaultOpen
              onOpenChange={(next) => { if (!next) { setEditingDue(false); onDuePromptClose?.(); } }}
              onValueChange={(next) => onSaveDue(task, next)}
              triggerContent={dueChip}
              className={dueChipClass}
            />
              : <button type="button" title={`${dueAction} · ${dueTitle} (${dueLabel})`} aria-label={`${dueAction} de ${task.title}`}
                className={dueChipClass}
                onClick={() => setEditingDue(true)}>{dueChip}</button>}
          </span>
        ) : (
          <span title={task.deadline && task.deadline.mode !== "fixed" ? `Prazo calculado · ${dueTitle}` : dueTitle}
            className={cn("text-[11px]", dueOverdue ? "text-rose" : "text-muted")}>{dueLabel}</span>
        )}
      </div>
      {(evaluation.awaitingApproval ||
        evaluation.result.status === "evidencia_disponivel" ||
        evaluation.result.status === "revisao_necessaria") && (
        <div className="mt-2">
          <EvidenceTag evaluation={evaluation} compact />
        </div>
      )}
    </article>
  );
}, sameCard);

/** O que o cartão mostra da tarefa; o resto já chega pronto em outra prop. */
function sameTask(a: Delivery, b: Delivery) {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.status === b.status &&
    a.dueAt === b.dueAt &&
    a.company === b.company &&
    a.kind === b.kind &&
    a.priority === b.priority
  );
}

/** O que o selo de evidência lê da avaliação. */
function sameEvaluation(a: EvidenceEvaluation, b: EvidenceEvaluation) {
  return (
    a.awaitingApproval === b.awaitingApproval &&
    a.result.status === b.result.status &&
    a.result.reason === b.result.reason &&
    a.result.recommendedAction === b.result.recommendedAction
  );
}

function sameCard(a: KanbanCardProps, b: KanbanCardProps) {
  return (
    sameTask(a.task, b.task) &&
    sameEvaluation(a.evaluation, b.evaluation) &&
    a.companyLabel === b.companyLabel &&
    a.subtitle === b.subtitle &&
    a.ownerInitials === b.ownerInitials &&
    a.ownerFirstName === b.ownerFirstName &&
    a.milestoneLabel === b.milestoneLabel &&
    a.dueLabel === b.dueLabel &&
    a.dueTitle === b.dueTitle &&
    a.dueOverdue === b.dueOverdue &&
    a.canEditDue === b.canEditDue &&
    a.onOpenByClick === b.onOpenByClick &&
    a.onOpenByKey === b.onOpenByKey &&
    a.onDragStart === b.onDragStart &&
    a.onDragEnd === b.onDragEnd &&
    a.onSaveDue === b.onSaveDue &&
    a.duePrompt === b.duePrompt &&
    a.onDuePromptClose === b.onDuePromptClose &&
    a.onRequestRemove === b.onRequestRemove
  );
}
