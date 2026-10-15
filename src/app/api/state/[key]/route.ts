import { authenticate } from "@/server/auth";
import { canReadState } from "@/server/authz";
import { getServerEnv, json, problem, workspaceOf } from "@/server/context";
import { getDoc } from "@/server/db";

import { supportedStateKey } from "@/server/operations/legacy-state";
import { saveLegacyState } from "@/server/operations/legacy-authorization";
import { OperationError } from "@/server/operations/errors";
import { instrumentQueries, withQueryTiming, type QueryMeter } from "@/server/timing";

type Guard =
  | { error: Response; meter: QueryMeter | null }
  | { error?: undefined; db: D1Database; user: { email: string }; workspace: string; meter: QueryMeter | null };

async function guard(request: Request): Promise<Guard> {
  const { env, meter } = instrumentQueries(await getServerEnv(), request);
  if (!env.DB)
    return { error: problem(503, "Banco de dados não configurado."), meter };
  const user = await authenticate(request, env);
  if (!user) return { error: problem(401, "Faça login para continuar."), meter };
  return { db: env.DB, user, workspace: workspaceOf(env), meter };
}

function timed(response: Response, meter: QueryMeter | null, startedAt: number) {
  return withQueryTiming(response, meter, startedAt);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const startedAt = Date.now();
  const { key } = await params;
  if (!supportedStateKey(key)) return problem(400, "Chave inválida.");
  const ctx = await guard(request);
  if (ctx.error) return timed(ctx.error, ctx.meter, startedAt);
  const allowed = await canReadState(
    ctx.db,
    ctx.workspace,
    ctx.user.email,
    key,
  );
  if (!allowed.ok) return timed(problem(allowed.status, allowed.reason), ctx.meter, startedAt);
  const tag = (version: number) =>
    `"${encodeURIComponent(ctx.workspace + ":" + key)}-${version}"`;
  // Uma leitura serve a versão e o corpo: 304 e 200 custam a mesma ida.
  const doc = await getDoc(ctx.db, ctx.workspace, key);
  if (request.headers.get("if-none-match") === tag(doc?.version ?? 0))
    return timed(new Response(null, {
      status: 304,
      headers: { "cache-control": "private, no-cache", vary: "Cookie" },
    }), ctx.meter, startedAt);
  // A missing document is a normal state on first use, not an error.
  return timed(json(doc ?? { value: null, version: 0, updatedAt: null }, {
    headers: {
      etag: tag(doc?.version ?? 0),
      "cache-control": "private, no-cache",
      vary: "Cookie",
    },
  }), ctx.meter, startedAt);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const startedAt = Date.now();
  const { key } = await params;
  if (!supportedStateKey(key, true)) return problem(400, "Chave inválida.");
  const ctx = await guard(request);
  if (ctx.error) return timed(ctx.error, ctx.meter, startedAt);
  let body: { value?: unknown; baseVersion?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return timed(problem(400, "Corpo inválido."), ctx.meter, startedAt);
  }
  if (body.value === undefined || typeof body.baseVersion !== "number" || !Number.isSafeInteger(body.baseVersion) || body.baseVersion < 0)
    return timed(problem(400, "Informe value e baseVersion."), ctx.meter, startedAt);
  try {
    const result = await saveLegacyState(ctx.db, ctx.workspace, ctx.user.email, key, body.value, body.baseVersion);
    return timed(json(result), ctx.meter, startedAt);
  } catch (error) {
    if (error instanceof OperationError) {
      if (error.code === "version_conflict") {
        const current = await getDoc(ctx.db, ctx.workspace, key);
        return timed(json(current ?? { value: null, version: 0, updatedAt: null }, { status: 409 }), ctx.meter, startedAt);
      }
      return timed(problem(error.status, error.message), ctx.meter, startedAt);
    }
    throw error;
  }
}
