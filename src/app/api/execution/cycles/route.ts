import { OperationError } from '@/server/operations/errors';
import { readExecutionCycles } from '@/server/operations/execution-cycles';
import { resolveOperationPrincipal } from '@/server/operations/principal';
import { apiRoute } from '@/server/route';

export async function GET(request: Request) {
  return apiRoute(request, async env => {
    const headers = (etag?: string | null) => ({
      'cache-control': 'private, no-store', vary: 'Cookie',
      'x-content-type-options': 'nosniff', ...(etag ? { etag } : {}),
    });
    try {
      const principal = await resolveOperationPrincipal(request, env);
      const result = await readExecutionCycles(env, principal,
        request.headers.get('if-none-match'));
      if ('notModified' in result && result.notModified)
        return new Response(null, { status: 304, headers: headers(result.etag) });
      return Response.json(result, { headers: headers(result.etag) });
    } catch (error) {
      if (error instanceof OperationError)
        return Response.json({ error: error.code, message: error.message },
          { status: error.status, headers: headers() });
      console.error('Execution cycles read failed', error instanceof Error ? error.name : typeof error);
      return Response.json({ error: 'internal_error', message: 'Não foi possível carregar os ciclos.' },
        { status: 500, headers: headers() });
    }
  });
}
