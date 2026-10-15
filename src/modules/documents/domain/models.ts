export type DocKind =
  "contrato" | "entregavel" | "evidencia" | "ata" | "comunicacao" | "outro";

/** Who may see the document once a client portal exists. */
export type DocVisibility = "interna" | "cliente";

export const docVisibilityLabel: Record<DocVisibility, string> = {
  interna: "Equipe interna",
  cliente: "Compartilhado com o cliente",
};

/** Review of a deliverable by an administrator. Absent means not reviewed. */
export type DocReviewStatus = "pendente" | "aprovado" | "ajustes";

export const docReviewLabel: Record<DocReviewStatus, string> = {
  pendente: "Aguardando revisão",
  aprovado: "Aprovado",
  ajustes: "Ajustes solicitados",
};

export type DocReviewEntry = {
  status: DocReviewStatus;
  notes?: string;
  by: string;
  at: string;
};

export type ClientDocument = {
  id: string;
  company: string;
  name: string;
  kind: DocKind;
  mime: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
  relatedTaskId?: string;
  relatedMeetingId?: string;
  /** Conversation or notes space the file was attached from. */
  relatedThreadId?: string;
  note?: string;
  /** Sequential version inside a chain; absent means the first version. */
  version?: number;
  /** Document replaced by this one. */
  supersedesId?: string;
  visibility?: DocVisibility;
  /** Deliverable template the document follows, when any. */
  deliverableTemplateId?: string;
  reviewStatus?: DocReviewStatus;
  reviewNotes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewHistory?: DocReviewEntry[];
  createdAt?: string;
  updatedAt?: string;
};

/** Fields written by a review; requesting changes requires a note. */
export function reviewPatch(
  doc: Pick<ClientDocument, "reviewHistory">,
  status: DocReviewStatus,
  notes: string,
  by: string,
  at: string,
): { error: string } | Partial<ClientDocument> {
  const text = notes.trim();
  if (status === "ajustes" && !text)
    return { error: "Descreva os ajustes necessários para quem vai revisar." };
  return {
    reviewStatus: status,
    reviewNotes: text || undefined,
    reviewedBy: by,
    reviewedAt: at,
    reviewHistory: [
      ...(doc.reviewHistory ?? []),
      { status, notes: text || undefined, by, at },
    ],
  };
}

export function documentVersion(doc: Pick<ClientDocument, "version">) {
  return doc.version ?? 1;
}

/** Documents that no newer version replaces. */
export function currentDocuments<T extends Pick<ClientDocument, "id" | "supersedesId">>(
  docs: T[],
): T[] {
  const replaced = new Set(docs.map((d) => d.supersedesId).filter(Boolean));
  return docs.filter((d) => !replaced.has(d.id));
}

/** Every version of the chain a document belongs to, newest first. */
export function versionChain<T extends Pick<ClientDocument, "id" | "supersedesId" | "version">>(
  docs: T[],
  doc: T,
): T[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const chain: T[] = [];
  let current: T | undefined = doc;
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = current.supersedesId ? byId.get(current.supersedesId) : undefined;
  }
  let head: T | undefined = doc;
  while (head) {
    const next = docs.find((d) => d.supersedesId === head!.id);
    if (!next || chain.includes(next)) break;
    chain.unshift(next);
    head = next;
  }
  return chain;
}

export function isPreviewable(mime: string) {
  return mime.startsWith("image/") || mime === "application/pdf";
}
