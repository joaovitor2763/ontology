import { invalidateOperationDocument } from '@/shared/infrastructure/useLocalStorageState';

type ScopedResult<T> = { data: T; documents: unknown[]; clientSnapshot?: string };

export class ScopedCommandError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) {
    super(message);
  }
}

/** A supplied client revision remains fenced on every attempt. Mixed-client
 * batches deliberately omit it and use the server's atomic bridge. */
export async function executeScopedClientCommand<T>(
  command: string, input: unknown, key: string, clientSnapshot?: string,
): Promise<ScopedResult<T>> {
    const headers: Record<string, string> = {
      'content-type': 'application/json', 'Idempotency-Key': key,
    };
    if (clientSnapshot) headers['x-client-snapshot'] = clientSnapshot;
    const response = await fetch('/api/v1/commands', { method: 'POST', headers,
      body: JSON.stringify({ command, input }) });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = body && typeof body === 'object' && 'error' in body ? body.error : null;
      const error = detail && typeof detail === 'object'
        ? detail as { code?: string; message?: string } : {};
      throw new ScopedCommandError(error.message ?? 'Não foi possível salvar. Tente novamente.',
        error.code, response.status);
    }
    if (!body || typeof body !== 'object' || !('documents' in body) ||
        !Array.isArray(body.documents) || !('data' in body))
      throw new Error('Não foi possível confirmar a gravação. Tente novamente.');
    invalidateOperationDocument('ontology.delivery.v2');
    return body as ScopedResult<T>;
}
