"use client";
import { documentOperationBaseline, executeOperation, operationAttempt, usesRemoteOperations } from "@/shared/infrastructure/operations";
import {
  docVisibilityLabel,
  documentVersion,
  type ClientDocument,
  type DocKind,
  type DocVisibility,
} from "@/modules/documents/domain/models";
import { attachmentRepository } from "@/modules/documents/infrastructure/attachments";
import {
  deliverableTemplateById,
  deliverableTemplates,
  renderDeliverableTemplate,
} from "@/modules/documents/infrastructure/deliverable-templates";
import { useDocumentsState } from "@/modules/documents/infrastructure/state";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useClientProgress } from "@/modules/delivery/presentation/useClientProgress";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { docKindLabel, formatBytes, formatDate } from "@/shared/lib/format";
import { Combobox } from "@/shared/ui/Combobox";
import { Modal } from "@/shared/ui/Dialog";
import { areaClass, FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { Select } from "@/shared/ui/Select";
import { Download } from "lucide-react";
import { useRef, useState } from "react";

export const DOCUMENT_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.txt,.md,.csv,.zip";

export const kindOptions = (Object.keys(docKindLabel) as DocKind[]).map(
  (id) => ({ value: id, label: docKindLabel[id] }),
);
export const visibilityOptions = (
  Object.keys(docVisibilityLabel) as DocVisibility[]
).map((id) => ({ value: id, label: docVisibilityLabel[id] }));

export function guessKind(name: string): DocKind {
  const n = name.toLowerCase();
  if (/dpa|contrato|termo|nda|proposta/.test(n)) return "contrato";
  if (/ata/.test(n)) return "ata";
  if (/canvas|roadmap|charter|mapa|política|politica|plano|relat/.test(n))
    return "entregavel";
  if (/caso|evid|deck|print|screenshot|foto/.test(n)) return "evidencia";
  if (/whats|email|msg|mensagem/.test(n)) return "comunicacao";
  return "outro";
}

export type Staged = {
  files: File[];
  kind: DocKind;
  taskId: string;
  meetingId: string;
  visibility: DocVisibility;
  note: string;
  deliverableTemplateId: string;
  /** When set, the upload registers a new version of this document. */
  versionOf?: ClientDocument;
};

/** Builds the staging state for a set of files, inheriting from a previous version or a delivery. */
export function stageFiles(
  files: File[],
  options: {
    versionOf?: ClientDocument;
    taskId?: string;
    deliverableTemplateId?: string;
  } = {},
): Staged {
  const { versionOf } = options;
  const template = options.deliverableTemplateId ?? versionOf?.deliverableTemplateId ?? "";
  return {
    files,
    kind: versionOf?.kind ?? (template ? "entregavel" : guessKind(files[0]?.name ?? "")),
    taskId: options.taskId ?? versionOf?.relatedTaskId ?? "",
    meetingId: versionOf?.relatedMeetingId ?? "",
    visibility: versionOf?.visibility ?? "interna",
    note: "",
    deliverableTemplateId: template,
    versionOf,
  };
}

/** Downloads the Markdown skeleton of a template with the client's name filled in. */
export function downloadTemplate(id: string, empresa?: string) {
  const rendered = renderDeliverableTemplate(id, { empresa });
  if (!rendered) return;
  const blob = new Blob([rendered.body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = rendered.fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The step between choosing files and saving them: type, links, visibility,
 * template and note. Shared by the documents panel and the delivery editor.
 */
export function StageDocumentModal({
  company,
  staged,
  onChange,
  onClose,
  onSaved,
  onError,
  onPending,
}: {
  company: string;
  staged: Staged | null;
  onChange: (next: Staged) => void;
  onClose: () => void;
  onSaved?: (records: ClientDocument[]) => void;
  onError?: (message: string) => void;
  onPending?: (delta: number) => void;
}) {
  const { addDoc, addVersion } = useDocumentsState();
  const { clientBySlug } = useClientsState();
  const { allMeetings } = useEngagementState();
  const progress = useClientProgress(company);
  const { me } = useTeam();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [batchPending, setBatchPending] = useState(false);
  const lock = useRef(false);
  const pendingBatch = useRef<null | { batch: Staged; index: number; run?: () => Promise<ClientDocument> }>(null);
  function close() {
    if (lock.current || pendingBatch.current) return;
    onClose();
  }

  const deliveries = progress.all.map((d) => ({
    value: d.id,
    label: d.title,
    description: d.kind === "request" ? "Solicitação" : "Tarefa",
  }));
  const meetings = allMeetings
    .filter((m) => m.company === company)
    .map((m) => ({
      value: m.id,
      label: m.title,
      description: formatDate(m.startsAt),
    }));
  const template = deliverableTemplateById(staged?.deliverableTemplateId);
  const mimeWarning =
    staged && template
      ? staged.files.filter(
          (f) => f.type && !template.acceptedMimeTypes.includes(f.type),
        )
      : [];

  async function commit(batch: Staged) {
    if (lock.current) return;
    lock.current = true;
    setSaving(true); setError("");
    const pending: NonNullable<typeof pendingBatch.current> = pendingBatch.current ?? { batch: { ...batch, files: [...batch.files] }, index: 0 };
    pendingBatch.current = pending; setBatchPending(true);
    try {
      const remote = await usesRemoteOperations();
      while (pending.index < pending.batch.files.length) {
        const file = pending.batch.files[pending.index];
        if (!pending.run) {
          const draft = pending.batch;
          const id = "up-" + crypto.randomUUID();
          const record: ClientDocument = {
            id, company, name: file.name, kind: draft.kind,
            mime: file.type || "application/octet-stream", size: file.size,
            uploadedAt: new Date().toISOString(), uploadedBy: me.id,
            relatedTaskId: draft.taskId || undefined, relatedMeetingId: draft.meetingId || undefined,
            relatedThreadId: draft.versionOf?.relatedThreadId,
            visibility: draft.visibility, note: draft.note.trim() || undefined,
            deliverableTemplateId: draft.deliverableTemplateId || undefined,
            reviewStatus: draft.kind === "entregavel" || draft.deliverableTemplateId ? "pendente" : undefined,
          };
          const command = draft.versionOf ? "documents.version" : "documents.register";
          const body = {
            ...(draft.versionOf ? { previousId: draft.versionOf.id } : { company }),
            fileId: id, kind: record.kind, visibility: record.visibility,
            ...(record.note ? { note: record.note } : {}),
            ...(record.relatedTaskId ? { relatedTaskId: record.relatedTaskId } : {}),
            ...(record.relatedMeetingId ? { relatedMeetingId: record.relatedMeetingId } : {}),
            ...(record.relatedThreadId ? { relatedThreadId: record.relatedThreadId } : {}),
            ...(record.deliverableTemplateId ? { deliverableTemplateId: record.deliverableTemplateId } : {}),
          };
          const attempt = operationAttempt(command, body), baseline = documentOperationBaseline();
          let uploaded = false;
          pending.run = async () => {
            if (!uploaded) { await attachmentRepository.put(id, file, { company }); uploaded = true; }
            if (remote) {
              const result = await executeOperation(command, body, attempt, baseline);
              return (result.data as { document: ClientDocument }).document;
            }
            if (draft.versionOf) addVersion(draft.versionOf, record); else addDoc(record);
            return record;
          };
        }
        onPending?.(1);
        try {
          const saved = await pending.run();
          pending.index++; pending.run = undefined;
          onSaved?.([saved]);
        } finally { onPending?.(-1); }
      }
      pendingBatch.current = null; setBatchPending(false);
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível confirmar o documento.";
      setError(message); onError?.(message);
    } finally { lock.current = false; setSaving(false); }
  }

  return (
    <Modal
      open={!!staged}
      onClose={close}
      size={template ? "lg" : "md"}
      kicker={
        staged?.versionOf
          ? `Nova versão de ${staged.versionOf.name}`
          : "Antes de salvar"
      }
      title={
        staged
          ? staged.files.length === 1
            ? staged.files[0].name
            : `${staged.files.length} documentos`
          : ""
      }
      description="Tipo, vínculo e visibilidade valem para todos os arquivos deste envio."
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={saving || batchPending} onClick={close}>
            Cancelar
          </Button>
          <Button
            size="sm"
            type="submit"
            form="document-stage-form"
            disabled={saving}
          >
            {staged?.versionOf
              ? `Salvar como v${documentVersion(staged.versionOf) + 1}`
              : "Salvar documento"}
          </Button>
        </>
      }
    >
      {error && <div className="mb-4 text-sm" role="alert"><p className="text-rose">{error}</p><p className="mt-2">Os documentos confirmados já foram salvos. Tente novamente para confirmar os arquivos restantes.</p>{!saving && <Button size="sm" variant="ghost" onClick={() => { pendingBatch.current = null; setBatchPending(false); setError(""); onClose(); }}>Encerrar envio restante</Button>}</div>}
      {staged && (
        <form
          id="document-stage-form"
          onSubmit={(e) => {
            e.preventDefault();
            void commit(staged);
          }}
          className={template ? "grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]" : ""}
        >
          <fieldset disabled={saving || batchPending}>
            {staged.files.length > 1 && (
              <ul className="mb-5 space-y-1 text-[13px] text-muted">
                {staged.files.map((f) => (
                  <li key={f.name} className="flex justify-between gap-3">
                    <span className="truncate">{f.name}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatBytes(f.size)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-x-4 sm:grid-cols-2">
              <FieldBlock label="Tipo">
                <Select
                  label="Tipo"
                  value={staged.kind}
                  onValueChange={(value) =>
                    onChange({ ...staged, kind: value as DocKind })
                  }
                  options={kindOptions}
                />
              </FieldBlock>
              <FieldBlock label="Visibilidade">
                <Select
                  label="Visibilidade"
                  value={staged.visibility}
                  onValueChange={(value) =>
                    onChange({ ...staged, visibility: value as DocVisibility })
                  }
                  options={visibilityOptions}
                />
              </FieldBlock>
            </div>
            <FieldBlock label="Modelo de entregável (opcional)">
              <Select
                label="Modelo de entregável"
                value={staged.deliverableTemplateId}
                placeholder="Sem modelo"
                onValueChange={(value) =>
                  onChange({
                    ...staged,
                    deliverableTemplateId: value,
                    kind: value ? "entregavel" : staged.kind,
                  })
                }
                options={[
                  { value: "", label: "Sem modelo" },
                  ...deliverableTemplates.map((t) => ({
                    value: t.id,
                    label: t.name,
                    description: t.description,
                  })),
                ]}
              />
            </FieldBlock>
            <FieldBlock label="Tarefa relacionada">
              <Combobox
                label="Tarefa relacionada"
                className={fieldClass}
                value={staged.taskId}
                onValueChange={(value) => onChange({ ...staged, taskId: value })}
                placeholder="Nenhuma"
                options={[{ value: "", label: "Nenhuma" }, ...deliveries]}
              />
            </FieldBlock>
            <FieldBlock label="Reunião relacionada">
              <Combobox
                label="Reunião relacionada"
                className={fieldClass}
                value={staged.meetingId}
                onValueChange={(value) =>
                  onChange({ ...staged, meetingId: value })
                }
                placeholder="Nenhuma"
                options={[{ value: "", label: "Nenhuma" }, ...meetings]}
              />
            </FieldBlock>
            <FieldBlock label="Nota">
              <textarea
                rows={2}
                className={areaClass}
                value={staged.note}
                onChange={(e) => onChange({ ...staged, note: e.target.value })}
                placeholder="Contexto, pendências ou o que mudou nesta versão"
              />
            </FieldBlock>
            <p className="-mt-2 text-[12px] text-muted">
              A visibilidade prepara o compartilhamento com o cliente. Hoje
              nada é enviado para fora do workspace.
            </p>
          </fieldset>
          {template && (
            <aside className="rounded-xl border border-line bg-soft/40 p-4 text-[12.5px]">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                Checklist de validação
              </p>
              <p className="mt-1 text-[13px] font-medium">{template.name}</p>
              <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-ink-soft">
                {template.reviewChecklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
              {mimeWarning.length > 0 && (
                <p className="mt-3 text-rose">
                  {mimeWarning.length === 1
                    ? "O arquivo não está entre os formatos esperados para este modelo."
                    : `${mimeWarning.length} arquivos não estão entre os formatos esperados para este modelo.`}
                </p>
              )}
              <button
                type="button"
                onClick={() =>
                  downloadTemplate(template.id, clientBySlug(company)?.name)
                }
                className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-medium hover:underline"
              >
                <Download className="h-3.5 w-3.5" />
                Baixar modelo (.md)
              </button>
            </aside>
          )}
        </form>
      )}
    </Modal>
  );
}
