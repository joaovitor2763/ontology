"use client";
import { useState } from "react";
import Link from "next/link";
import type { Insight } from "../domain/insights";
import { paths } from "@/shared/lib/routes";
import { Button } from "@/shared/ui/primitives";

type Source = { label: string; text: string | null; notice: string; meetingId?: string; documentId?: string };

/** Sources are fetched only when opened; they never trigger an AI call. */
export function InsightSource({ item }: { item: Insight }) {
  const [source, setSource] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    if (source || busy) return;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({ company: item.company, source: item.id });
      const response = await fetch(`/api/insights?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível abrir a referência.");
      setSource(await response.json() as Source);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível abrir a referência.");
    } finally { setBusy(false); }
  }
  const refs = JSON.parse(item.evidence) as string[];
  const label = item.source_kind === "whatsapp" ? `Ver ${refs.length} mensagens de origem` : refs.some((id) => id.startsWith("up-")) ? "Ver transcrição de origem" : "Ver notas de origem";
  return (
    <details className="mt-3 rounded-lg border border-line p-3 text-[12px]" onToggle={(e) => { if (e.currentTarget.open) void load(); }}>
      <summary className="cursor-pointer font-medium text-ink">{label}</summary>
      {busy && <p role="status" className="mt-2 text-muted">Carregando referência…</p>}
      {error && <div role="alert" className="mt-2 text-rose">{error} <Button size="sm" variant="ghost" onClick={() => void load()}>Tentar novamente</Button></div>}
      {source && <div className="mt-3 space-y-2">
        <p className="text-muted">{source.notice}</p>
        <div className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-soft p-3 leading-relaxed">{source.text || "O conteúdo desta referência não está mais disponível."}</div>
        <div className="flex flex-wrap gap-4">
          {source.documentId && <a className="underline underline-offset-4" href={`/api/files/${encodeURIComponent(source.documentId)}`}>Baixar transcrição original</a>}
          {source.meetingId && <Link className="underline underline-offset-4" href={paths.meeting(source.meetingId)}>Abrir reunião</Link>}
          {item.source_kind === "whatsapp" && <Link className="underline underline-offset-4" href={paths.clientConversations(item.company)}>Abrir conversas do cliente</Link>}
        </div>
      </div>}
    </details>
  );
}
