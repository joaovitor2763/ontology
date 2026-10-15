import { json, problem } from "@/server/context";
import { googleGuard, googleProblem, googleMeetingGuard } from "@/server/google-route";
import { meetArtifacts } from "@/server/google";

/** Recording and transcript of a past meeting, through the Meet REST API. */
export async function POST(request: Request) {
  const ctx = await googleGuard(request);
  if ("error" in ctx) return ctx.error;
  const body = (await request.json().catch(() => null)) as { meetLink?: string; startsAt?: string; includeEarlierSessions?: boolean } | null;
  if (!body?.meetLink || !body.startsAt || Number.isNaN(Date.parse(body.startsAt)))
    return problem(400, "Link do Meet e início da reunião são obrigatórios.");
  const denied = await googleMeetingGuard(ctx, { meetLink: body.meetLink, startsAt: body.startsAt });
  if (denied) return denied;
  try {
    return json(await meetArtifacts(ctx.env, ctx.db, ctx.workspace, ctx.user.email, {
      meetLink: body.meetLink,
      startsAt: body.startsAt,
      includeEarlierSessions: body.includeEarlierSessions === true,
    }));
  } catch (error) {
    return googleProblem(error);
  }
}
