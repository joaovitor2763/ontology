"use client";
import type { ClientDocument } from "@/modules/documents/domain/models";
import {
  DOCUMENT_ACCEPT,
  StageDocumentModal,
  stageFiles,
  type Staged,
} from "@/modules/documents/presentation/StageDocumentModal";
import { Button } from "@/shared/ui/primitives";
import { Paperclip } from "lucide-react";
import { useRef, useState } from "react";

/**
 * Opens the document upload flow from anywhere with the links prefilled,
 * e.g. from a delivery that needs evidence.
 */
export function UploadDocumentButton({
  company,
  taskId,
  deliverableTemplateId,
  label = "Anexar documento",
  size = "sm",
  variant = "ghost",
  onSaved,
}: {
  company: string;
  taskId?: string;
  deliverableTemplateId?: string;
  label?: string;
  size?: "sm" | "md";
  variant?: "ghost" | "primary";
  onSaved?: (records: ClientDocument[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [error, setError] = useState("");
  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        onClick={() => input.current?.click()}
      >
        <Paperclip className="h-3.5 w-3.5" />
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        accept={DOCUMENT_ACCEPT}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length)
            setStaged(stageFiles(files, { taskId, deliverableTemplateId }));
          e.target.value = "";
        }}
      />
      {error && (
        <p role="alert" className="mt-2 text-[12.5px] text-rose">
          {error}
        </p>
      )}
      <StageDocumentModal
        company={company}
        staged={staged}
        onChange={setStaged}
        onClose={() => setStaged(null)}
        onError={setError}
        onSaved={onSaved}
      />
    </>
  );
}
