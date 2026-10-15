"use client";
import { ArrowRight, Check } from "lucide-react";
import { TextareaField } from "@g4ai/ds";
import type { milestoneAdvance } from "@/modules/catalog/domain/journey-progress";
import type { Delivery } from "@/modules/delivery/domain/models";
import { padMilestone } from "@/shared/lib/format";
import { Drawer } from "@/shared/ui/Drawer";
import { Button, StatusBadge } from "@/shared/ui/primitives";
import type { useMilestoneAdvance } from "./useMilestoneAdvance";

export function AdvanceDrawer({
  open,
  onClose,
  milestoneName,
  milestoneN,
  advance,
  advanceEnabled,
  canEditPlan,
  operation,
  justification,
  setJustification,
  current,
  doneCount,
  itemsCount,
  resolve,
  onCreate,
  onEditTask,
}: {
  open: boolean;
  onClose: () => void;
  milestoneName: string;
  milestoneN: number;
  advance: ReturnType<typeof milestoneAdvance>;
  advanceEnabled: boolean;
  canEditPlan: boolean;
  operation: ReturnType<typeof useMilestoneAdvance>;
  justification: string;
  setJustification: (value: string) => void;
  current: boolean;
  doneCount: number;
  itemsCount: number;
  resolve: (id: string) => { name: string };
  onCreate: () => void;
  onEditTask: (task: Delivery) => void;
}) {
  const { advancing, advanceUncertain, advanceError } = operation;
  const canForce =
    current &&
    !advance.ready &&
    !advance.empty &&
    justification.trim().length >= 10;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        advance.ready
          ? "Marco pronto para conclusão"
          : "O que falta para avançar"
      }
      kicker={`${padMilestone(milestoneN)} · ${milestoneName}`}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Voltar ao marco
          </Button>
          {advance.next ? (
            <Button
              disabled={
                !advanceEnabled ||
                advancing ||
                !canEditPlan ||
                (!advanceUncertain && !advance.ready && !canForce)
              }
              variant={advance.ready ? "primary" : "ghost"}
              onClick={() =>
                void operation.advanceMilestone(!advance.ready, justification)
              }
            >
              {advancing
                ? "Avançando…"
                : advanceUncertain
                  ? "Verificar avanço"
                  : advance.ready
                    ? `Avançar para ${padMilestone(advance.next.n)}`
                    : `Avançar com pendências`}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : advance.ready ? (
            <Button onClick={onClose}>
              <Check className="h-3.5 w-3.5" />
              Plano concluído
            </Button>
          ) : null}
        </div>
      }
    >
      {!advanceEnabled && (
        <p className="mb-4 text-sm text-muted">
          Prepare o plano deste produto antes de avançar os marcos.
        </p>
      )}
      {advanceError && (
        <div role="alert" className="mb-4 text-sm text-rose">
          {advanceError}
          <Button
            variant="ghost"
            size="sm"
            disabled={advancing}
            onClick={operation.reviewAdvance}
          >
            Revisar avanço
          </Button>
        </div>
      )}
      <div className="mb-6 rounded-xl border border-line p-4">
        <p className="text-[14px] font-medium">
          {doneCount} de {itemsCount} tarefas concluídas
        </p>
        <p className="mt-2 text-[12px] leading-6 text-muted">
          {advance.ready
            ? "As tarefas deste marco e dos marcos anteriores estão concluídas. Elas permanecem disponíveis para consulta."
            : "Conclua cada tarefa e revise os bloqueios. O avanço preserva o status de todas as tarefas."}
        </p>
      </div>
      {current && !advance.ready && !advance.empty && advance.next && (
        <TextareaField
          label="Avançar mesmo com pendências? Registre a justificativa."
          className="mb-5"
          minRows={3}
          placeholder="Ex.: tarefas restantes seguem no próximo marco por decisão do patrocinador."
          disabled={advancing || advanceUncertain}
          value={justification}
          onChange={setJustification}
          hint="Mínimo de 10 caracteres. As pendências continuam abertas no marco atual."
        />
      )}
      {advance.empty && (
        <Button variant="ghost" onClick={onCreate}>
          Adicionar primeira tarefa
        </Button>
      )}
      <ul className="divide-y divide-line">
        {advance.pending.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => onEditTask(task)}
              className="w-full py-4 text-left"
            >
              <span className="block text-[10px] text-muted">
                {padMilestone(task.milestone)} · {resolve(task.ownerId).name}
              </span>
              <span className="mt-1 block text-[13px] font-medium leading-5">
                {task.title}
              </span>
              <span className="mt-2 block">
                <StatusBadge status={task.status} />
              </span>
              {task.blockers && (
                <span className="mt-2 block text-[12px] leading-5 text-rose">
                  {task.blockers}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {advance.ready && advance.next && (
        <div>
          <p className="text-[11px] text-muted">VOCÊ VAI INICIAR</p>
          <h3 className="mt-2 text-[18px] font-medium">{advance.next.name}</h3>
          <p className="mt-2 text-[12px] text-muted">
            {advance.next.stage} · {advance.next.owner}
          </p>
        </div>
      )}
    </Drawer>
  );
}
