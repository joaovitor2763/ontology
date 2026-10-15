import type { AuthUser } from "./auth.ts";
import { workspaceOf, type ServerEnv } from "./context.ts";
import { getConnection, googleConfigured, googleEnabled, MEET_SETTINGS_SCOPE } from "./google.ts";

export type GoogleStatusBody = {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  canConfigureMeet?: boolean;
  accountEmail: string | null;
  status: string | null;
  error?: string | null;
};

/**
 * Se a integração Google está ligada e se a pessoa está conectada. É o corpo de
 * `GET /api/google/status` e do bloco `google` do bootstrap da página
 * (`GET /api/state?with=google`), que evita uma chamada por carga. Nunca
 * devolve segredo.
 */
export async function googleStatus(env: ServerEnv, user: AuthUser | null): Promise<GoogleStatusBody> {
  const base = { enabled: googleEnabled(env), configured: googleConfigured(env) };
  if (!base.enabled || !env.DB || !user)
    return { ...base, connected: false, accountEmail: null, status: null };
  const connection = await getConnection(env.DB, workspaceOf(env), user.email);
  return {
    ...base,
    connected: connection?.status === "connected",
    canConfigureMeet: connection?.scopes.split(" ").includes(MEET_SETTINGS_SCOPE) ?? false,
    accountEmail: connection?.account_email ?? null,
    status: connection?.status ?? null,
    error: connection?.last_error ?? null,
  };
}
