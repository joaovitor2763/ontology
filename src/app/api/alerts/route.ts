import { OperationError } from '@/server/operations/errors';
import { resolveOperationPrincipal } from '@/server/operations/principal';
import { readAlertQueue } from '@/server/operations/alert-queue';
import { apiRoute } from '@/server/route';

export async function GET(request: Request) {
  return apiRoute(request, async env => {
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: {
      'cache-control': 'private, no-store', vary: 'Cookie',
      'x-content-type-options': 'nosniff',
    } });
    try {
      const principal = await resolveOperationPrincipal(request, env);
      const company = new URL(request.url).searchParams.get('company') || undefined;
      return reply(await readAlertQueue(env, principal, company));
    } catch (error) {
      if (error instanceof OperationError)
        return reply({ error: error.code, message: error.message }, error.status);
      console.error('Alert queue failed', error instanceof Error ? error.name : typeof error);
      return reply({ error: 'internal_error', message: 'Não foi possível carregar os alertas.' }, 500);
    }
  });
}
