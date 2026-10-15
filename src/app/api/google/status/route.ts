import { authenticate } from "@/server/auth";
import { json } from "@/server/context";
import { apiRoute } from "@/server/route";
import { googleEnabled } from "@/server/google";
import { googleStatus } from "@/server/google-status";

/** Whether the Google integration is on and whether the signed-in member is connected. Never returns secrets. */
export function GET(request: Request) {
  return apiRoute(request, async (env) => {
    const user = env.DB && googleEnabled(env) ? await authenticate(request, env) : null;
    return json(await googleStatus(env, user));
  });
}
