"use client";
import { useEffect, useState } from "react";
import type { ClientDocument } from "../domain/models";
import { documentPreviewKind, previewLimit, PREVIEW_TEXT_CHARS } from "../domain/preview";
import { loadDocumentPreview } from "../infrastructure/preview";
import { Button } from "@/shared/ui/primitives";

export function DocumentPreview({ document: doc }: { document: ClientDocument }) {
  const kind = documentPreviewKind(doc.name, doc.mime);
  const limit = kind ? previewLimit(kind) : 0;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ text?: string; url?: string; truncated?: boolean; error?: string } | null>(null);
  const allowed = doc.id.startsWith("up-") && kind && doc.size <= limit;
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    let url: string | undefined;
    void loadDocumentPreview(doc.id, limit, controller.signal).then(async (blob) => {
      if (controller.signal.aborted) return;
      if (kind === "text") {
        const text = await blob.text();
        if (!controller.signal.aborted) setResult({ text: text.slice(0, PREVIEW_TEXT_CHARS), truncated: text.length > PREVIEW_TEXT_CHARS });
      } else {
        url = URL.createObjectURL(kind === "pdf" ? blob.slice(0, blob.size, "application/pdf") : blob);
        setResult({ url });
      }
    }).catch((e) => { if (!controller.signal.aborted) setResult({ error: e instanceof Error ? e.message : "Não foi possível carregar a prévia." }); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [allowed, doc.id, kind, limit, attempt]);
  if (!doc.id.startsWith("up-")) return null;
  return <section aria-label="Prévia do documento" className="overflow-hidden rounded-xl border border-line">
    <h3 className="border-b border-line bg-soft/40 px-3 py-2 text-[13px] font-medium">Prévia</h3>
    {!allowed ? <p className="p-3 text-[13px] text-muted">{!kind ? "Prévia indisponível para este formato. Use Baixar para abrir no aplicativo correspondente." : `Arquivo grande para prévia automática (limite de ${kind === "text" ? "1" : "5"} MB). Use Baixar para abrir o conteúdo completo.`}</p>
      : !result ? <p role="status" className="p-3 text-[13px] text-muted">Carregando prévia…</p>
      : result.error ? <div role="alert" className="p-3 text-[13px] text-muted">{result.error}<Button size="sm" variant="ghost" onClick={() => { setResult(null); setAttempt((n) => n + 1); }}>Tentar novamente</Button></div>
      : kind === "text" ? <>
        <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words p-3 font-sans text-[13px] leading-relaxed">{result.text || "Arquivo vazio."}</pre>
        {result.truncated && <p className="border-t border-line px-3 py-2 text-[12px] text-muted">Exibindo os primeiros 40 mil caracteres. Baixe para ler tudo.</p>}
      </> : kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={result.url} alt={`Prévia de ${doc.name}`} className="max-h-[360px] w-full object-contain" />
      ) : <iframe src={result.url} title={`Prévia de ${doc.name}`} className="h-[360px] w-full" />}
  </section>;
}
