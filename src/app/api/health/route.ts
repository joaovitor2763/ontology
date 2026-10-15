import { authenticate, resolveAuthMode, googleSessionApproved } from "@/server/auth";
import { json } from "@/server/context";
import { apiRoute } from "@/server/route";
import { touchUserThrottled } from "@/server/db";

/** Tells the client whether a database is attached and who is signed in. */
export function GET(request: Request) {
  return apiRoute(request, async (env) => {
  if (!env.DB) return json({ mode: env.AUTH_MODE === "google" ? "remote" : "local", user: null, authMode: resolveAuthMode(request, env) });
  const user = await authenticate(request, env);
  if (user && resolveAuthMode(request, env) !== "google") {
    try {
      await touchUserThrottled(env.DB, env.WORKSPACE_ID || "default", user);
    } catch {
      // Migrations may not have run yet; the client still learns the mode.
    }
  }
  return json({
    mode: "remote",
    user: user ? { email: user.email, name: user.name, approved: ["google", "access"].includes(resolveAuthMode(request, env)) ? await googleSessionApproved(env, user.email) : undefined } : null,
    authMode: resolveAuthMode(request, env),
  });
  });
}
