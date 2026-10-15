"use client";
import type { JourneyTemplate } from "@/modules/catalog/domain/models";
import {
  publishScopeLabel,
  type JourneyDiff,
  type PublishScope,
} from "@/modules/catalog/domain/publication";
import type { Company } from "@/modules/clients/domain/models";
import { padMilestone } from "@/shared/lib/format";
import { Modal } from "@/shared/ui/Dialog";
import { Checkbox } from "@g4ai/ds";
import { FieldBlock } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import { Button } from "@/shared/ui/primitives";
import {
  CatalogOperationFeedback,
  type CatalogOperationUI,
} from "../../useCatalogOperations";

/** Prévia da publicação de um plano: o que muda e para quem passa a valer. */
export function PublishModal({
  open,
  onClose,
  journey,
  latest,
  diff,
  draftFingerprint,
  onThis,
  scope,
  setScope,
  impactConfirmed,
  setImpactConfirmed,
  operation,
  publish,
}: {
  open: boolean;
  onClose: () => void;
  journey: JourneyTemplate;
  latest?: { version: number } | null;
  diff: JourneyDiff;
  draftFingerprint: string;
  onThis: Company[];
  scope: PublishScope;
  setScope: (value: PublishScope) => void;
  impactConfirmed: boolean;
  setImpactConfirmed: (value: boolean) => void;
  operation: CatalogOperationUI;
  publish: () => void;
}) {
  return (
  <Modal
    open={open}
    onClose={onClose}
    kicker={journey.name}
    title={`Publicar v${(latest?.version ?? 0) + 1}`}
    description="A prévia mostra o que muda para quem executa o plano. Nada é enviado ao cliente."
    footer={
      <>
        <Button
          variant="ghost"
          size="sm"
          disabled={operation.busy}
          onClick={onClose}
        >
          Cancelar
        </Button>
        <Button
          size="sm"
          disabled={
            operation.busy ||
            (latest && diff.unchanged) ||
            (scope === "todos" && onThis.length > 0 && !impactConfirmed)
          }
          onClick={publish}
        >
          {operation.busy ? "Publicando…" : `Publicar v${(latest?.version ?? 0) + 1}`}
        </Button>
      </>
    }
  >
    <CatalogOperationFeedback operation={operation} />
    <fieldset disabled={operation.busy} className="space-y-4 text-[13px]">
      {latest && diff.unchanged ? (
        <p className="rounded-lg bg-soft px-3 py-2 text-muted">
          O rascunho é idêntico à v{latest.version}. Não há o que publicar.
        </p>
      ) : (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
          <dt className="text-muted">Marcos</dt>
          <dd>
            {journey.milestones.length}
            {diff.added.length
              ? ` · ${diff.added.length} novo${diff.added.length === 1 ? "" : "s"}`
              : ""}
            {diff.removed.length
              ? ` · ${diff.removed.length} removido${diff.removed.length === 1 ? "" : "s"}`
              : ""}
            {diff.renamed.length
              ? ` · ${diff.renamed.length} renomeado${diff.renamed.length === 1 ? "" : "s"}`
              : ""}
          </dd>
          <dt className="text-muted">Tarefas de referência</dt>
          <dd>
            {latest ? `${diff.tasksBefore} → ` : ""}
            {diff.tasksAfter}
          </dd>
          {diff.changed.length > 0 && (
            <>
              <dt className="text-muted">Marcos alterados</dt>
              <dd>
                {diff.changed
                  .map((x) => `${padMilestone(x.n)} ${x.name}`)
                  .join(", ")}
              </dd>
            </>
          )}
          <dt className="text-muted">Assinatura</dt>
          <dd className="font-mono text-[12px]">{draftFingerprint}</dd>
        </dl>
      )}
      <FieldBlock label="Quem passa a seguir esta versão">
        <Select
          label="Escopo da publicação"
          value={scope}
          onValueChange={(v) => {
            setScope(v as PublishScope);
            setImpactConfirmed(false);
          }}
          options={(Object.keys(publishScopeLabel) as PublishScope[]).map(
            (id) => ({ value: id, label: publishScopeLabel[id] }),
          )}
        />
      </FieldBlock>
      {scope === "todos" && onThis.length > 0 && (
        <Checkbox
          className="w-full rounded-lg border border-amber/30 bg-amber-soft/40 px-3 py-2 text-label text-amber"
          checked={impactConfirmed}
          onCheckedChange={setImpactConfirmed}
          label={`Entendo que ${onThis.length} cliente${onThis.length === 1 ? "" : "s"} deste plano passa${onThis.length === 1 ? "" : "m"} a seguir a v${(latest?.version ?? 0) + 1}. Tarefas já criadas não mudam.`}
        />
      )}
      {scope === "novos" && (
        <p className="text-[12.5px] text-muted">
          {latest
            ? `Os ${onThis.length} clientes atuais continuam na versão que já seguem.`
            : `Os ${onThis.length} clientes atuais ficam na v1 até que outra publicação os inclua.`}
        </p>
      )}
    </fieldset>
  </Modal>

  );
}
