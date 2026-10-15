import { json, problem } from "@/server/context";
import { googleGuard, googleProblem, googleMeetingGuard } from "@/server/google-route";
import { eventResponses } from "@/server/google";

const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Who accepted, declined or has not answered the invitation of a meeting. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!ID.test(id)) return problem(400, "Identificador de evento inválido.");
  const ctx = await googleGuard(request);
  if ("error" in ctx) return ctx.error;
  const calendar = new URL(request.url).searchParams.get("calendar") || "primary";
  const denied = await googleMeetingGuard(ctx, { eventId: id, calendarId: calendar });
  if (denied) return denied;
  try {
    return json(await eventResponses(ctx.env, ctx.db, ctx.workspace, ctx.user.email, { calendarId: calendar, eventId: id }));
  } catch (error) {
    return googleProblem(error);
  }
}
