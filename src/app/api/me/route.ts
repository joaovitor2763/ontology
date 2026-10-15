import { renewGoogleSession } from "@/server/google-login";
import { authenticate, resolveAuthMode, googleSessionApproved } from "@/server/auth";
import { json, problem, workspaceOf } from "@/server/context";
import { apiRoute } from "@/server/route";

export function GET(request: Request) {
  return apiRoute(request, async (env) => {
    const user = await authenticate(request, env);
    if (!user) return problem(401, "Faça login para continuar.");
    return json({
      email: user.email,
      name: user.name,
      workspaceId: workspaceOf(env),
      authMode: resolveAuthMode(request, env),
    });
  });
}

/** The visible app requests renewal during user activity, never in a background timer. */
export function POST(request: Request) {
  return apiRoute(request, async (env) => {
    const user = await authenticate(request, env);
    if (!user || !await googleSessionApproved(env, user.email))
      return problem(401, "Faça login para continuar.");
    return await renewGoogleSession(request, env) ?? problem(401, "Faça login para continuar.");
  });
}
