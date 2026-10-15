"use client";
import { useState } from "react";
import {
  evidenceKindLabel,
  evidenceSourceLabel,
  hypothesisError,
  hypothesisStatusLabel,
} from "@/modules/engagement/domain/hypotheses";
import type {
  Hypothesis,
  HypothesisEvidence,
  HypothesisEvidenceKind,
  HypothesisStatus,
  Pain,
} from "@/modules/engagement/domain/models";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { Combobox } from "@/shared/ui/Combobox";
import { Modal } from "@/shared/ui/Dialog";
import { Drawer, FieldBlock, areaClass, fieldClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import { Button } from "@/shared/ui/primitives";
import { OperationButton } from "@/shared/ui/OperationFeedback";
import {
  DiagnosisOperationFeedback,
  type DiagnosisOperation,
} from "../useDiagnosisOperation";
import { EVIDENCE_KINDS, HYPOTHESIS_STATUS } from "./shared";

export function HypothesisForm({
  operation,
  hypothesis,
  isNew,
  pains,
  onClose,
  onSave,
}: {
  operation:DiagnosisOperation;
  hypothesis: Hypothesis;
  isNew: boolean;
  pains: Pain[];
  onClose: () => void;
  onSave: (next: Hypothesis) => void;
}) {
  const { active } = useTeam();
  const [draft, setDraft] = useState<Hypothesis>(hypothesis);
  const [error, setError] = useState("");
  function submit() {
    if(operation.busy||operation.pending)return;
    const problem = hypothesisError(draft);
    if (problem) {
      setError(problem);
      return;
    }
    onSave({ ...draft, statement: draft.statement.trim(), rootCause: draft.rootCause?.trim() || undefined });
  }
  return (
    <Drawer
      open
      onClose={()=>{if(!operation.busy)onClose();}}
      title={isNew ? "Nova hipótese" : "Editar hipótese"}
      kicker="Diagnóstico"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button type="button" variant="ghost" disabled={operation.busy} onClick={onClose}>
            Cancelar
          </Button>
          <OperationButton operation={operation} busyLabel={isNew ? "Registrando…" : "Salvando…"} type="button" onClick={submit}>
            {isNew ? "Registrar hipótese" : "Salvar"}
          </OperationButton>
        </div>
      }
    >
      <DiagnosisOperationFeedback operation={operation}/><fieldset disabled={operation.busy||operation.pending} className="min-w-0">
      <FieldBlock label="Hipótese">
        <textarea
          value={draft.statement}
          onChange={(e) => setDraft({ ...draft, statement: e.target.value })}
          rows={2}
          className={areaClass}
          placeholder="A alta atrasa porque a prescrição chega à farmácia sem revisão."
          autoFocus
        />
      </FieldBlock>
      <FieldBlock label="Causa raiz presumida">
        <input
          value={draft.rootCause ?? ""}
          onChange={(e) => setDraft({ ...draft, rootCause: e.target.value })}
          className={fieldClass}
          placeholder="Ausência de conciliação antes da assinatura"
        />
      </FieldBlock>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldBlock label="Situação">
          <Select
            label="Situação da hipótese"
            value={draft.status}
            onValueChange={(value) => setDraft({ ...draft, status: value as HypothesisStatus })}
            options={HYPOTHESIS_STATUS.map((st) => ({ value: st, label: hypothesisStatusLabel[st] }))}
          />
        </FieldBlock>
        <FieldBlock label="Dono">
          <Select
            label="Dono da hipótese"
            value={draft.ownerId ?? ""}
            placeholder="Escolher"
            onValueChange={(value) => setDraft({ ...draft, ownerId: value || undefined })}
            options={active.map((p) => ({ value: p.id, label: p.name, description: p.role }))}
          />
        </FieldBlock>
      </div>
      <FieldBlock label="Dores relacionadas">
        <Combobox
          multiple
          label="Dores relacionadas"
          placeholder="Buscar dor…"
          value={draft.painIds}
          onValueChange={(painIds) => setDraft({ ...draft, painIds })}
          options={pains.map((p) => ({ value: p.id, label: p.title, description: p.area }))}
        />
      </FieldBlock>
      <p className="text-[12px] leading-relaxed text-muted">
        Uma boa hipótese é específica, testável e fala de causa raiz, não de
        sintoma. Ser refutada não é falha: é o caminho para a causa certa.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-rose">
          {error}
        </p>
      )}
      </fieldset>
    </Drawer>
  );
}

export function EvidenceModal({
  operation,
  hypothesis,
  onClose,
  onSave,
}: {
  operation:DiagnosisOperation;
  hypothesis: Hypothesis | null;
  onClose: () => void;
  onSave: (evidence: Omit<HypothesisEvidence, "id" | "at" | "by">) => void;
}) {
  const [kind, setKind] = useState<HypothesisEvidenceKind>("confirma");
  const [source, setSource] = useState<NonNullable<HypothesisEvidence["source"]>>("entrevista");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  function submit() {
    if(operation.busy||operation.pending)return;
    if (!note.trim()) {
      setError("Descreva o que a evidência mostrou.");
      return;
    }
    onSave({ kind, source, note: note.trim() });

  }
  return (
    <Modal
      open={!!hypothesis}
      onClose={()=>{if(!operation.busy)onClose();}}
      size="sm"
      title="Registrar evidência"
      description={hypothesis?.statement}
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={operation.busy} onClick={onClose}>
            Cancelar
          </Button>
          <OperationButton operation={operation} busyLabel="Registrando…" size="sm" onClick={submit}>
            Registrar
          </OperationButton>
        </>
      }
    >
      <DiagnosisOperationFeedback operation={operation}/><fieldset disabled={operation.busy||operation.pending} className="min-w-0">
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldBlock label="O que mostrou">
          <Select
            label="Tipo de evidência"
            value={kind}
            onValueChange={(value) => setKind(value as HypothesisEvidenceKind)}
            options={EVIDENCE_KINDS.map((k) => ({ value: k, label: evidenceKindLabel[k] }))}
          />
        </FieldBlock>
        <FieldBlock label="Fonte">
          <Select
            label="Fonte da evidência"
            value={source}
            onValueChange={(value) => setSource(value as NonNullable<HypothesisEvidence["source"]>)}
            options={(Object.keys(evidenceSourceLabel) as (keyof typeof evidenceSourceLabel)[]).map(
              (k) => ({ value: k, label: evidenceSourceLabel[k] }),
            )}
          />
        </FieldBlock>
      </div>
      <FieldBlock label="Evidência">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className={areaClass}
          placeholder="Amostra de 12 altas: 9 devolvidas pela farmácia antes da liberação."
          autoFocus
        />
      </FieldBlock>
      {error && (
        <p role="alert" className="text-[13px] text-rose">
          {error}
        </p>
      )}
      </fieldset>
    </Modal>
  );
}

export function RefineModal({
  operation,
  hypothesis,
  onClose,
  onSave,
}: {
  operation:DiagnosisOperation;
  hypothesis: Hypothesis | null;
  onClose: () => void;
  onSave: (statement: string) => void;
}) {
  const [statement, setStatement] = useState("");
  const [error, setError] = useState("");
  function submit() {
    if(operation.busy||operation.pending)return;
    const problem = hypothesisError({ statement });
    if (problem) {
      setError(problem);
      return;
    }
    onSave(statement.trim());

  }
  return (
    <Modal
      open={!!hypothesis}
      onClose={()=>{if(!operation.busy)onClose();}}
      size="sm"
      title="Refinar hipótese"
      description="A hipótese atual passa a “refinada” e a nova nasce aberta, ligada a ela, com as mesmas dores."
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={operation.busy} onClick={onClose}>
            Cancelar
          </Button>
          <OperationButton operation={operation} busyLabel="Criando…" size="sm" onClick={submit}>
            Criar hipótese refinada
          </OperationButton>
        </>
      }
    >
      <DiagnosisOperationFeedback operation={operation}/><fieldset disabled={operation.busy||operation.pending} className="min-w-0">
      <p className="mb-4 rounded-lg bg-soft px-3 py-2 text-[12.5px] text-ink-soft">
        {hypothesis?.statement}
      </p>
      <FieldBlock label="Nova hipótese">
        <textarea
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          rows={3}
          className={areaClass}
          placeholder="O leito fica ocupado porque a assinatura espera o médico voltar à enfermaria."
          autoFocus
        />
      </FieldBlock>
      {error && (
        <p role="alert" className="text-[13px] text-rose">
          {error}
        </p>
      )}
      </fieldset>
    </Modal>
  );
}
