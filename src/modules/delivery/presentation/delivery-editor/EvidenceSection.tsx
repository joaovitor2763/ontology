"use client";
import Link from "next/link";
import { Paperclip } from "lucide-react";
import { deliverableTemplateById } from "@/modules/documents/infrastructure/deliverable-templates";
import { UploadDocumentButton } from "@/modules/documents/presentation/UploadDocumentButton";
import { EvidenceBadge } from "@/modules/delivery/presentation/EvidenceBadge";
import { paths } from "@/shared/lib/routes";
import { areaClass } from "@/shared/ui/Drawer";
import type { DeliveryDraft } from "./useDeliveryDraft";

export function EvidenceSection({ editor }: { editor: DeliveryDraft }) {
  const { draft, live, files, evidence } = editor;
  return (
    <section aria-label="Evidência" className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-[13px] font-medium">
          <Paperclip className="h-3.5 w-3.5 text-muted" />
          Evidência
          {live.requiresEvidence && (
            <span className="text-[11px] text-muted">obrigatória</span>
          )}
        </h3>
        <EvidenceBadge task={live} />
      </div>
      <p className="mt-1 text-[12px] text-muted">
        {evidence.result.reason} {evidence.result.recommendedAction}
      </p>
      {deliverableTemplateById(live.deliverableTemplateId) && (
        <p className="mt-1.5 text-[12px] text-muted">
          Modelo esperado ·{" "}
          <span className="text-ink">
            {deliverableTemplateById(live.deliverableTemplateId)!.name}
          </span>
        </p>
      )}
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-2 text-[13px]"
            >
              <Link
                href={paths.clientDocuments(draft.company)}
                className="min-w-0 truncate hover:underline"
              >
                {f.name}
              </Link>
              {f.reviewStatus && (
                <span className="shrink-0 text-[11px] text-muted">
                  {f.reviewStatus === "aprovado"
                    ? "aprovado"
                    : f.reviewStatus === "ajustes"
                      ? "ajustes solicitados"
                      : "aguardando revisão"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <textarea
        aria-label="Evidência em texto"
        className={`${areaClass} mt-2`}
        rows={2}
        value={editor.evidenceDraft}
        onChange={(e) => editor.setEvidenceDraft(e.target.value)}
        onBlur={editor.saveEvidenceText}
        placeholder="Descreva ou linke o que comprova a tarefa"
      />
      <div className="mt-2">
        <UploadDocumentButton
          company={draft.company}
          taskId={draft.id}
          deliverableTemplateId={live.deliverableTemplateId}
        />
      </div>
    </section>
  );
}
