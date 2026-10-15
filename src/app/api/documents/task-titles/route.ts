import { OperationError } from '@/server/operations/errors';
import { documentTaskTitles } from '@/server/operations/document-task-titles';
import { resolveOperationPrincipal } from '@/server/operations/principal';
import { apiRoute } from '@/server/route';

export async function POST(request: Request) {
  return apiRoute(request, async env => {
    const reply = (body: unknown, status = 200) => Response.json(body, {
      status,
      headers: { 'cache-control': 'private, no-store', vary: 'Cookie',
        'x-content-type-options': 'nosniff' },
    });
    try {
      const principal = await resolveOperationPrincipal(request, env);
      const input: unknown = await request.json().catch(() => null);
      const ids = input && typeof input === 'object' && 'ids' in input ? input.ids : null;
      const ifVersion = input && typeof input === 'object' && 'ifVersion' in input
        ? input.ifVersion : undefined;
      const requireVersion = input && typeof input === 'object' && 'requireVersion' in input
        ? input.requireVersion : undefined;
      return reply(await documentTaskTitles(env, principal, ids, ifVersion, requireVersion));
    } catch (error) {
      if (error instanceof OperationError)
        return reply({ error: error.code, message: error.message }, error.status);
      console.error('Document task titles failed', error instanceof Error ? error.name : typeof error);
      return reply({ error: 'internal_error', message: 'Não foi possível carregar os vínculos.' }, 500);
    }
  });
}
