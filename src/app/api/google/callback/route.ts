import { finishGoogleLogin } from "@/server/google-login";
import { getServerEnv, workspaceOf } from "@/server/context";
import { finishOAuth, googleEnabled } from "@/server/google";

/** Google returns here; the member lands back on Configurações with the result. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (result: string, reason?: string) =>
    Response.redirect(
      `${url.origin}/configuracoes?google=${result}${reason ? `&motivo=${encodeURIComponent(reason)}` : ""}`,
      302,
    );
  const env = await getServerEnv();
  if (url.searchParams.get("state")?.startsWith("login.")) return finishGoogleLogin(request, env);
  if (!googleEnabled(env) || !env.DB) return back("erro", "desligado");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");
  if (denied) return back("erro", denied);
  if (!code || !state) return back("erro", "parametros");
  try {
    const result = await finishOAuth(env, env.DB, workspaceOf(env), { code, state }, `${url.origin}/api/google/callback`);
    return result.ok ? back("ok") : back("erro", result.reason);
  } catch (error) {
    return back("erro", error instanceof Error ? error.message : "falha");
  }
}
