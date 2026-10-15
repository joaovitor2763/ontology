import { persistenceMode } from "@/shared/infrastructure/persistence";
import { attachmentRepository } from "./attachments";

const cache = new Map<string, { blob: Blob; at: number }>();
/** Short-lived cache of at most two small files; no preloading of document lists. */
export async function loadDocumentPreview(id: string, limit: number, signal: AbortSignal) {
  const cached = cache.get(id);
  if (cached && Date.now() - cached.at < 60_000 && cached.blob.size <= limit) return cached.blob;
  let blob: Blob | undefined;
  if (persistenceMode() === "remote") {
    const response = await fetch(`/api/files/${encodeURIComponent(id)}`, { signal });
    if (!response.ok) throw new Error("Não foi possível carregar a prévia. Você pode tentar novamente ou baixar o arquivo.");
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body?.cancel();
      throw new Error("Este arquivo excede o limite da prévia. Baixe para ver o conteúdo completo.");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Conteúdo indisponível.");
    const parts: ArrayBuffer[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error("Este arquivo excede o limite da prévia. Baixe para ver o conteúdo completo.");
        parts.push(new Uint8Array(value).buffer);
      }
    } finally { await reader.cancel().catch(() => {}); }
    blob = new Blob(parts, { type: response.headers.get("content-type") || "application/octet-stream" });
  } else {
    blob = await attachmentRepository.get(id);
  }
  if (!blob) throw new Error("O conteúdo deste documento não está disponível.");
  if (blob.size > limit) throw new Error("Este arquivo excede o limite da prévia. Baixe para ver o conteúdo completo.");
  signal.throwIfAborted();
  if (cache.size >= 2) cache.delete(cache.keys().next().value!);
  cache.set(id, { blob, at: Date.now() });
  return blob;
}
