import type { AttachmentRepository } from "../application/attachments";

/** File contents in the workspace bucket (R2), addressed by the document id. */
export const remoteAttachmentRepository: AttachmentRepository = {
  async put(id, content, context) {
    const file = content as Blob & { name?: string };
    const response = await fetch(`/api/files/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        "content-type": content.type || "application/octet-stream",
        ...(context ? { "x-client-company": context.company } : {}),
        "x-file-name": encodeURIComponent(file.name ?? id),
      },
      body: content,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error ?? "Não foi possível enviar o arquivo.");
    }
  },
  async get(id) {
    const response = await fetch(`/api/files/${encodeURIComponent(id)}`);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error("Não foi possível baixar o arquivo.");
    return response.blob();
  },
  async remove(id) {
    const response = await fetch(`/api/files/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error ?? "Não foi possível excluir o arquivo.");
    }
  },
};
