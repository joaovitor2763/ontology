import { authenticate } from "@/server/auth";
import { resolveMember } from "@/server/authz";
import { json, problem, workspaceOf } from "@/server/context";
import { apiRoute } from "@/server/route";

/** People who signed in to this workspace. Admins use it to approve newcomers. */
export function GET(request: Request) {
  return apiRoute(request, async (env) => {
  if (!env.DB) return problem(503, "Banco de dados não configurado.");
  const user = await authenticate(request, env);
  if (!user) return problem(401, "Faça login para continuar.");
  const workspace = workspaceOf(env);
  const { member, bootstrap } = await resolveMember(env.DB, workspace, user.email);
  const admin = bootstrap || (member?.active && member.access === "admin");
  if (!admin) return problem(403, "Só admins veem quem entrou.");
  const rows = await env.DB.prepare(
    "SELECT u.email, u.name, u.last_seen_at FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.workspace_id = ? ORDER BY u.last_seen_at DESC LIMIT 200",
  )
    .bind(workspace)
    .all<{ email: string; name: string | null; last_seen_at: string | null }>();
  return json({
    users: (rows.results ?? []).map((r) => ({
      email: r.email,
      name: r.name ?? "",
      lastSeenAt: r.last_seen_at,
    })),
  });
  });
}
