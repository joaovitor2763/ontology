import { OperationError } from '@/server/operations/errors';
import { readExecutionBoardJson } from '@/server/operations/execution-board';
import { resolveOperationPrincipal } from '@/server/operations/principal';
import { apiRoute } from '@/server/route';

export async function GET(request: Request) {
  return apiRoute(request, async env => {
    const reply = (body: unknown, status = 200, etag?: string | null) => Response.json(body, { status, headers: {
      'cache-control': 'private, no-store', vary: 'Cookie',
      'x-content-type-options': 'nosniff',
      ...(etag ? { etag } : {}),
    } });
    try {
      const principal = await resolveOperationPrincipal(request, env);
      const wire = new URL(request.url).searchParams.get('formato') === 'tabela' ? 'table' : 'objects';
      const result = await readExecutionBoardJson(env, principal,
        request.headers.get('if-none-match'), wire);
      if ('notModified' in result)
        return new Response(null, { status: 304, headers: {
          'cache-control': 'private, no-store', vary: 'Cookie', etag: result.etag,
        } });
      // O corpo já vem serializado (e guardado no isolate junto com o quadro).
      return new Response(result.body, { status: 200, headers: {
        'content-type': 'application/json', 'cache-control': 'private, no-store', vary: 'Cookie',
        'x-content-type-options': 'nosniff', ...(result.etag ? { etag: result.etag } : {}),
      } });
    } catch (error) {
      if (error instanceof OperationError)
        return reply({ error: error.code, message: error.message }, error.status);
      console.error('Execution board read failed', error instanceof Error ? error.name : typeof error);
      return reply({ error: 'internal_error', message: 'Não foi possível carregar a execução.' }, 500);
    }
  });
}
