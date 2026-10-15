import { resolveMember } from "./authz";
import { getDoc } from "./db";
import { projectMeetings } from "../modules/engagement/infrastructure/snapshot";
import { authenticate } from "@/server/auth";
import { instrumentQueries } from "./timing";
import { getServerEnv, problem, workspaceOf } from "@/server/context";
import { googleEnabled, GoogleError } from "@/server/google";

/** Common guard of the Google routes: integration on, database attached, signed in. */
export async function googleGuard(request: Request) {
  const { env } = instrumentQueries(await getServerEnv(), request);
  if (!googleEnabled(env))
    return { error: problem(503, "Integração com o Google não configurada.") };
  if (!env.DB) return { error: problem(503, "Banco de dados não configurado.") };
  const user = await authenticate(request, env);
  if (!user) return { error: problem(401, "Faça login para continuar.") };
  const workspace = workspaceOf(env);
  const { member } = await resolveMember(env.DB, workspace, user.email);
  if (!member?.active) return { error: problem(403, "Seu acesso não está ativo.") };
  return { env, db: env.DB, user, workspace };
}

/** Calendar identifiers are accepted only for a meeting owned by this organizer. */
export async function googleMeetingGuard(ctx: { db: D1Database; workspace: string; user: { email: string } }, filter: { eventId?: string; calendarId?: string; meetLink?: string; startsAt?: string }) {
  const doc = await getDoc(ctx.db, ctx.workspace, "ontology.engagement.v2");
  const meeting = projectMeetings((doc?.value ?? {}) as object).find(m =>
    filter.eventId ? m.google?.eventId === filter.eventId && (m.google.calendarId || "primary") === (filter.calendarId || "primary")
      : (m.google?.meetLink === filter.meetLink || m.place === filter.meetLink) && Date.parse(m.startsAt) === Date.parse(filter.startsAt || ""));
  if (!meeting) return problem(404, "Reunião não encontrada na plataforma.");
  if ((meeting.organizerEmail ?? meeting.google?.organizer)?.toLowerCase() !== ctx.user.email.toLowerCase())
    return problem(403, "Use a conexão do organizador para consultar o evento e seus materiais.");
  return null;
}

export function googleProblem(error: unknown) {
  if (error instanceof GoogleError) return problem(error.status, error.message);
  return problem(502, error instanceof Error ? error.message : "Falha ao falar com o Google.");
}
