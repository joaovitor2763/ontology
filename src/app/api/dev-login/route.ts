import { resolveAuthMode } from "@/server/auth";
import { getServerEnv, json, problem } from "@/server/context";

const COOKIE = "ontology_dev_user";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const devMode = (env: Awaited<ReturnType<typeof getServerEnv>>, request: Request) =>
  resolveAuthMode(request, env) === "dev";

/** Local development only: choose which e-mail the session belongs to. */
export async function POST(request: Request) {
  const env = await getServerEnv();
  if (!devMode(env, request)) return problem(404, "Disponível só em desenvolvimento.");
  const body = (await request.json().catch(() => null)) as { email?: string; name?: string } | null;
  const email = (body?.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return problem(400, "Informe um e-mail válido.");
  const name = (body?.name ?? "").trim().slice(0, 80);
  const value = encodeURIComponent(JSON.stringify({ email, name }));
  return json(
    { ok: true, email },
    { headers: { "set-cookie": `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` } },
  );
}

export async function DELETE(request: Request) {
  const env = await getServerEnv();
  if (!devMode(env, request)) return problem(404, "Disponível só em desenvolvimento.");
  return json(
    { ok: true },
    { headers: { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } },
  );
}
