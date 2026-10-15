import { persistenceMode } from "@/shared/infrastructure/persistence";
import type { AttachmentRepository } from "../application/attachments";
import { remoteAttachmentRepository } from "./remote-attachments";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ontology.documents", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("attachments");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Feche outras abas do aplicativo e tente novamente."));
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("attachments", mode);
    const request = operation(tx.objectStore("attachments"));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("Não foi possível salvar o arquivo."));
    };
  });
}

/** Browser-only storage used in the demo and as a fallback. */
export const localAttachmentRepository: AttachmentRepository = {
  async put(id, content) {
    await transaction("readwrite", (store) => store.put(content, id));
  },
  get(id) {
    return transaction<Blob | undefined>("readonly", (store) => store.get(id));
  },
  async remove(id) {
    await transaction("readwrite", (store) => store.delete(id));
  },
};

/** Files go to the workspace bucket when the app runs behind the API; otherwise to IndexedDB. */
export const attachmentRepository: AttachmentRepository = {
  put: (id, content, context) =>
    (persistenceMode() === "remote"
      ? remoteAttachmentRepository
      : localAttachmentRepository
    ).put(id, content, context),
  async get(id) {
    if (persistenceMode() === "remote") {
      const remote = await remoteAttachmentRepository.get(id);
      if (remote) return remote;
    }
    return localAttachmentRepository.get(id);
  },
  async remove(id) {
    await localAttachmentRepository.remove(id).catch(() => {});
    if (persistenceMode() === "remote") await remoteAttachmentRepository.remove(id);
  },
};

export async function downloadAttachment(id: string, filename: string) {
  const content = await attachmentRepository.get(id);
  if (!content)
    throw new Error(
      "O conteúdo deste arquivo antigo não está disponível. Anexe o original novamente.",
    );
  const url = URL.createObjectURL(content);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
