import { googleGuard, googleProblem } from "@/server/google-route";
import { startOAuth } from "@/server/google";

/** Sends the signed-in member to Google's consent screen. */
export async function GET(request: Request) {
  const ctx = await googleGuard(request);
  if ("error" in ctx) return ctx.error;
  const origin = new URL(request.url).origin;
  try {
    const url = await startOAuth(ctx.env, ctx.db, ctx.workspace, ctx.user.email, `${origin}/api/google/callback`);
    return Response.redirect(url, 302);
  } catch (error) {
    return googleProblem(error);
  }
}
