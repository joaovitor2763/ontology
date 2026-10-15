import {generateMeetingInsight} from './operations/meeting-insight';
import {requestWhatsAppSync} from './operations/whatsapp-sync';
import {reviewInsight} from './operations/insight-review';
import {readInsights, readInsightSource} from './operations/insights';
import {resolveOperationPrincipal} from './operations/principal';
import {OperationError} from './operations/errors';
import { canReadState } from "./authz";
import { authenticate } from "./auth";
import { json, problem, workspaceOf, type ServerEnv } from "./context";
import { apiRoute } from "./route";
import {
  insightPermission,
} from "./insight-context";
import { processWhatsApp } from "./whatsapp-jobs";
import { getCloudflareContext } from "@opennextjs/cloudflare";
export function insightsGet(request: Request) {
  return apiRoute(request, (env) => insightsGetIn(request, env));
}
async function insightsGetIn(request: Request, env: ServerEnv) {
  const user = await authenticate(request, env);
  if (!user) return problem(401, "Faça login para continuar.");
  if (!env.DB)
    return problem(503, "Conecte o banco para usar análises persistentes.");
  const p = new URL(request.url).searchParams,
    company = p.get("company"),
    meeting = p.get("meeting");
  if (!company) return problem(400, "Informe o cliente.");
  const workspace = workspaceOf(env);
  const access = await canReadState(
    env.DB,
    workspace,
    user.email,
    "ontology.engagement.v2",
  );
  if (!access.ok) return problem(403, access.reason);
  const sourceId = p.get("source");
  try {
    const principal = await resolveOperationPrincipal(request, env);
    if(sourceId)return json((await readInsightSource(env,principal,{company,insight:sourceId})).data);
    const result = await readInsights(env, principal, {
      company,
      meeting: meeting ?? undefined,
      status: p.get("status") ?? undefined,
      cursor: p.get("cursor") ?? undefined,
    }, {bookmark: request.headers.get("x-d1-bookmark") ?? undefined});
    return json({
      ...result.data,
      canReview: await insightPermission(env.DB, workspace, user.email, company, "ia.revisar"),
      canSync: await insightPermission(env.DB, workspace, user.email, company, "whatsapp.sincronizar"),
    });
  } catch (error) {
    return problem(error instanceof OperationError ? error.status : 500,
      error instanceof OperationError ? error.message : "Não foi possível consultar as análises.");
  }
}
export function insightsPost(request: Request) {
  return apiRoute(request, (env) => insightsPostIn(request, env));
}
async function insightsPostIn(request: Request, env: ServerEnv) {
  const user = await authenticate(request, env);
  if (!user) return problem(401, "Faça login para continuar.");
  if (!env.DB) return problem(503, "Banco não configurado.");
  const db = env.DB,
    workspace = workspaceOf(env);
  const b = (await request.json().catch(() => null)) as {
    company?: string;
    action?: string;
    id?: string;
    days?: number;
    meeting?: string;
    confirmedHash?: string;
  } | null;
  if (!b || typeof b.company !== "string" || b.company.length > 160)
    return problem(400, "Cliente inválido.");
  const action =
    b.action === "sync"
      ? "whatsapp.sincronizar"
      : b.action === "meeting"
        ? "ia.analisar"
        : "ia.revisar";
  if (!(await insightPermission(db, workspace, user.email, b.company, action)))
    return problem(
      403,
      "Seu nível de acesso não permite esta ação neste cliente.",
    );
  try {
    if (b.action === "sync") {
      if (![2, 30, 90, 365].includes(b.days ?? 30))
        return problem(400, "Escolha um período válido.");
      const principal=await resolveOperationPrincipal(request,env);
      const result=await requestWhatsAppSync(env,principal,{company:b.company,days:b.days??30},request.headers.get('idempotency-key')||crypto.randomUUID()) as {data:{id:string}};
      const id=result.data.id;
      // The cron continues if this request's background execution is interrupted.
      const { ctx } = await getCloudflareContext({ async: true });
      ctx.waitUntil(processWhatsApp(env));
      return json({ id }, { status: 202 });
    }
    if (b.action === "meeting") {
      const principal=await resolveOperationPrincipal(request,env);
      const result=await generateMeetingInsight(env,principal,{company:b.company,meeting:b.meeting,confirmedHash:b.confirmedHash},request.headers.get('idempotency-key')||crypto.randomUUID()) as {data:unknown};
      return json(result.data);
    }
    if (!b.id || !["accept", "dismiss"].includes(b.action ?? ""))
      return problem(400, "Ação inválida.");
    const principal=await resolveOperationPrincipal(request,env);
    await reviewInsight(env,principal,{company:b.company,insight:b.id,decision:b.action},request.headers.get('idempotency-key')||crypto.randomUUID());
    return json({ ok: true });
  } catch (error) {
    if(error instanceof OperationError)return json({error:error.message,...(error.code==='source_changed'?error.details as object:{})},{status:error.status});
    return problem(
      502,
      error instanceof Error
        ? error.message
        : "Não foi possível concluir a análise.",
    );
  }
}
