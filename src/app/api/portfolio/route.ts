import { OperationError } from '@/server/operations/errors';
import { resolveOperationPrincipal } from '@/server/operations/principal';
import { readPortfolioSummary, warmPortfolioRead } from '@/server/operations/portfolio';
import { apiRoute } from '@/server/route';
import { id } from '@/server/operations/input';

export async function GET(request: Request) {
  return apiRoute(request, async env => {
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: {
      'cache-control': 'private, no-store', vary: 'Cookie',
      'x-content-type-options': 'nosniff',
    } });
    try {
      warmPortfolioRead(request, env);
      const principal = await resolveOperationPrincipal(request, env);
      const rawMember = new URL(request.url).searchParams.get('member');
      const result = await readPortfolioSummary(env, principal,
        rawMember === null ? undefined : id(rawMember, 'membro'));
      return reply(rawMember === null ? result : { member: result.member });
    } catch (error) {
      if (error instanceof OperationError)
        return reply({ error: error.code, message: error.message }, error.status);
      console.error('Portfolio read failed', error instanceof Error ? error.name : typeof error);
      return reply({ error: 'internal_error', message: 'Não foi possível carregar a carteira.' }, 500);
    }
  });
}
