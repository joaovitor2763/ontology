export type TaskTitleResult = { values: Record<string, string>; version: string };

class ChangedDuringRead extends Error {}

/** Publish one complete version, even when the document list has over 1,000 task links. */
export async function loadDocumentTaskTitles(ids: string[], options: {
  fetcher?: typeof fetch; signal?: AbortSignal; previous?: TaskTitleResult;
} = {}): Promise<TaskTitleResult> {
  const fetcher = options.fetcher ?? fetch;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const chunks: string[][] = [];
      for (let index = 0; index < ids.length; index += 1000)
        chunks.push(ids.slice(index, index + 1000));
      if (!chunks.length) return { values: {}, version: '' };
      let version = '';
      const values: Record<string, string> = {};
      for (const [index, chunk] of chunks.entries()) {
        const response = await fetcher('/api/documents/task-titles', {
          method: 'POST', cache: 'no-store', signal: options.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: chunk,
            ...(index === 0 && options.previous ? { ifVersion: options.previous.version } : {}),
            ...(index > 0 ? { requireVersion: version } : {}) }),
        });
        const body = await response.json() as {
          titles?: Record<string, string>; unchanged?: boolean;
          snapshotVersion?: string; message?: string;
        };
        if (response.status === 409) throw new ChangedDuringRead();
        if (!response.ok) throw new Error(body.message ?? 'Não foi possível carregar os vínculos.');
        if (index === 0 && body.unchanged && options.previous) return options.previous;
        if (!body.titles || typeof body.snapshotVersion !== 'string')
          throw new Error('A resposta dos vínculos está incompleta.');
        if (version && version !== body.snapshotVersion) throw new ChangedDuringRead();
        version = body.snapshotVersion;
        Object.assign(values, body.titles);
      }
      return { values, version };
    } catch (error) {
      if (error instanceof ChangedDuringRead && attempt < 2) continue;
      throw error;
    }
  }
  throw new ChangedDuringRead('Os vínculos mudaram durante a leitura. Tente novamente.');
}
