import { attachDocument } from "@/modules/documents/application/attachments";
import type { ClientDocument } from "@/modules/documents/domain/models";
import { attachmentRepository } from "@/modules/documents/infrastructure/attachments";
import type { ThreadFile } from "@/modules/engagement/domain/models";

/**
 * Stores each file as a document of the client (content first, then the
 * record) and returns what the note should point to. Failures are reported,
 * not thrown, so the note can still be saved with the files that worked.
 */
export async function storeNoteFiles(input: {
  files: File[];
  company: string;
  threadId: string;
  note: string;
  uploadedBy: string;
  addDoc: (doc: ClientDocument) => void;
  onEach?: () => void;
}): Promise<{ stored: ThreadFile[]; error: string }> {
  const stored: ThreadFile[] = [];
  let error = "";
  for (const file of input.files) {
    const record: ClientDocument = {
      id: "up-" + crypto.randomUUID(),
      company: input.company,
      name: file.name,
      kind: "comunicacao",
      mime: file.type || "application/octet-stream",
      size: file.size,
      uploadedAt: new Date().toISOString(),
      uploadedBy: input.uploadedBy,
      relatedThreadId: input.threadId,
      note: input.note || undefined,
      visibility: "interna",
    };
    try {
      await attachDocument(attachmentRepository, record, file, (next) => {
        input.addDoc(next);
        stored.push({ id: next.id, name: next.name, mime: next.mime });
      });
    } catch {
      error = `Não foi possível guardar ${file.name}. Verifique o espaço disponível e tente novamente.`;
    } finally {
      input.onEach?.();
    }
  }
  return { stored, error };
}
