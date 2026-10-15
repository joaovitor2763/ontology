"use client";
import { useRef } from "react";
import { ArrowUp, ArrowUpRight, Paperclip } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { InboxOperationFeedback, type InboxOperation } from "../useInboxOperation";

export function Composer({
  hint,
  text,
  onText,
  onSend,
  onFile,
  uploading,
  attachError,
  operation,
  company,
  onTimeline,
}: {
  hint: string;
  text: string;
  onText: (value: string) => void;
  onSend: () => void;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploading: number;
  attachError: string;
  operation: InboxOperation;
  company?: string;
  onTimeline: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
      className="shrink-0 border-t border-line bg-surface px-5 py-4"
    >
      <p className="mb-2 flex items-center gap-2 text-[12px] text-muted">
        <span className="rounded-md bg-soft px-1.5 py-0.5 font-medium text-ink-soft">
          Nota interna
        </span>
        {hint}
      </p>
      <div className="focus-field flex items-end gap-2 rounded-2xl border border-line bg-soft/70 px-3 py-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={onFile}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading > 0 || operation.busy || operation.pending}
          className="mb-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink disabled:opacity-40"
          aria-label="Anexar imagem ou arquivo"
          title="Anexar imagem ou arquivo"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <textarea
          id="inbox-composer"
          value={text}
          disabled={operation.busy || operation.pending}
          onChange={(e) => {
            operation.begin();
            onText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          rows={2}
          placeholder="Escrever nota interna… (Enter salva, Shift+Enter quebra linha)"
          className="min-h-[44px] w-full resize-none bg-transparent py-1.5 text-[14px] outline-none placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={!text.trim() || operation.busy || operation.pending}
          className="mb-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-on-ink disabled:opacity-30"
          aria-label={operation.busy ? "Salvando nota…" : "Salvar nota"}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
      <InboxOperationFeedback operation={operation} />
      {(uploading > 0 || attachError) && (
        <p
          role={attachError ? "alert" : "status"}
          className={cn(
            "mt-2 text-[12px]",
            attachError ? "text-rose" : "text-muted",
          )}
        >
          {attachError ||
            `Guardando ${uploading} ${uploading === 1 ? "arquivo" : "arquivos"}…`}
        </p>
      )}
      {company && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onTimeline}
            className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"
          >
            Registrar na timeline de interações
            <ArrowUpRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </form>
  );
}
