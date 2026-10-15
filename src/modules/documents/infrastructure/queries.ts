import type { ClientDocument } from "@/modules/documents/domain/models";
import { documents } from "@/modules/documents/infrastructure/seed";
export function documentsFor(
  slug?: string,
  extras?: ClientDocument[],
  removed?: Set<string>,
  edits?: Record<string, Partial<ClientDocument>>,
) {
  return [...documents, ...(extras ?? [])]
    .filter((d) => !slug || d.company === slug)
    .filter((d) => !removed?.has(d.id))
    .map((d) => (edits?.[d.id] ? { ...d, ...edits[d.id] } : d))
    .slice()
    .sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt));
}
