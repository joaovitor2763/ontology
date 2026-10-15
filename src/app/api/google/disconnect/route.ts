import { json } from "@/server/context";
import { googleGuard, googleProblem } from "@/server/google-route";
import { revokeConnection } from "@/server/google";

export async function POST(request: Request) {
  const ctx = await googleGuard(request);
  if ("error" in ctx) return ctx.error;
  try {
    await revokeConnection(ctx.env, ctx.db, ctx.workspace, ctx.user.email);
    return json({ ok: true });
  } catch (error) {
    return googleProblem(error);
  }
}
