import { getServerEnv, type ServerEnv } from "./context.ts";
import { instrumentQueries, withQueryTiming } from "./timing.ts";

/**
 * Entrada de toda rota de API que toca o banco fora do adaptador `/api/v1`.
 *
 * Dá à requisição o mesmo contexto que `apiResponse` dá ao REST: a memória de
 * leitura por requisição (cada documento lido uma vez), o cache do roster do
 * isolate e o `Server-Timing` quando a medição está ligada. Uma rota que
 * chamasse `getServerEnv()` direto ficava fora disso — e `/api/insights`
 * resolvia o mesmo roster cinco vezes. `tests/architecture.test.mjs` exige o
 * invólucro em toda rota que autentica.
 */
export async function apiRoute(
  request: Request,
  run: (env: ServerEnv) => Promise<Response>,
): Promise<Response> {
  const startedAt = Date.now();
  const { env, meter } = instrumentQueries(await getServerEnv(), request);
  return withQueryTiming(await run(env), meter, startedAt);
}
