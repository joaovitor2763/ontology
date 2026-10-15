import { authenticate } from "@/server/auth";
import { json, problem, workspaceOf } from "@/server/context";
import { readPreferences, writePreference } from "@/server/member-preferences";
import { apiRoute } from "@/server/route";

const headers = { "cache-control": "private, no-store", vary: "Cookie" };

export function GET(request: Request) {
  return apiRoute(request, async (env) => {
    if (!env.DB) return problem(503, "Banco de dados não configurado.");
    const user = await authenticate(request, env);
    if (!user) return problem(401, "Faça login para continuar.");
    return json({ preferences: await readPreferences(env.DB, workspaceOf(env), user.email) }, { headers });
  });
}

/** Só a própria sessão, pela mesma origem: preferência não aceita Bearer de integração. */
export function PUT(request: Request) {
  return apiRoute(request, async (env) => {
    if (!env.DB) return problem(503, "Banco de dados não configurado.");
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return problem(403, "Origem da requisição não permitida.");
    const user = await authenticate(request, env);
    if (!user) return problem(401, "Faça login para continuar.");
    let body: { key?: unknown; value?: unknown };
    try { body = await request.json() as typeof body; } catch { return problem(400, "Corpo inválido."); }
    const result = await writePreference(env.DB, workspaceOf(env), user.email, body);
    return result.ok ? json({ updatedAt: result.updatedAt }, { headers }) : problem(result.status, result.message);
  });
}
