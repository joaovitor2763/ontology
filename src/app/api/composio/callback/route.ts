import { authenticate } from "@/server/auth";
import { resolveMember } from "@/server/authz";
import { workspaceOf } from "@/server/context";
import { apiRoute } from "@/server/route";
import { completeAuth, toolkit } from "@/server/composio";
import { composioUserId } from "@/server/composio-route";

/** Composio's configured verifier redirects with only session_uri; ownership is resolved from the signed-in active member. */
export async function GET(request: Request) {
  return apiRoute(request, async (env) => {
    const user = await authenticate(request, env);
    if (!user || !env.DB) return Response.json({ error: "Sessão inválida." }, { status: 401 });
    const workspace = workspaceOf(env);
    const { member } = await resolveMember(env.DB, workspace, user.email);
    if (!member?.active) return Response.json({ error: "Acesso inativo." }, { status: 403 });
    const sessionUri = new URL(request.url).searchParams.get("session_uri");
    if (!sessionUri) return Response.json({ error: "Sessão de verificação ausente." }, { status: 400 });
    try {
      const result = await completeAuth(env, workspace, sessionUri, composioUserId(workspace, member.id));
      if (!toolkit(result.toolkit_slug)) throw new Error("Toolkit retornado não suportado.");
      const now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO composio_connections(workspace_id,member_id,toolkit_slug,connected_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,member_id,toolkit_slug) DO UPDATE SET connected_account_id=excluded.connected_account_id,status=excluded.status,updated_at=excluded.updated_at")
        .bind(workspace, member.id, result.toolkit_slug, result.connected_account_id, "ACTIVE", now, now).run();
      return Response.redirect(new URL("/configuracoes#apps", request.url), 303);
    } catch {
      return Response.json({ error: "Não foi possível verificar a identidade/ativar a conexão. Tente novamente." }, { status: 502 });
    }
  });
}
