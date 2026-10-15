export interface AttachmentRepository {
  put(id: string, content: Blob, context?: { company: string }): Promise<void>;
  get(id: string): Promise<Blob | undefined>;
  remove(id: string): Promise<void>;
}
/** Metadata is registered only after the original content has been persisted. */
export async function attachDocument<T extends { id: string; company?: string }>(
  repository: AttachmentRepository,
  record: T,
  content: Blob,
  register: (record: T) => void,
): Promise<void> {
  await repository.put(record.id, content, record.company ? { company: record.company } : undefined);
  register(record);
}
