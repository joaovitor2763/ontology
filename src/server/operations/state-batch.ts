import { authenticate, googleSessionApproved, identifyUser, resolveAuthMode } from "../auth.ts";
import { json, problem, workspaceOf, type ServerEnv } from "../context.ts";
import { resolveMember } from "../authz.ts";
import { touchUserThrottled } from "../db.ts";
import { googleStatus, type GoogleStatusBody } from "../google-status.ts";
import { loadChangedDocuments } from "./request-context.ts";
import { supportedStateKey } from "./legacy-state.ts";
import { authorizeStateRead } from "../../modules/workspace/domain/permissions.ts";
import { instrumentQueries, withQueryTiming } from "../timing.ts";
import { countAlerts, countAlertsIfReady } from "./alerts-count.ts";
import { resolveOperationPrincipal } from "./principal.ts";

/** Uma chave por documento; o limite acompanha o conjunto sincronizado da aplicação. */
const MAX_KEYS = 20;

/** Blocos extras que a carga de uma página pede junto com os documentos. */
const EXTRAS = ["session", "google", "alerts"] as const;
type Extra = (typeof EXTRAS)[number];

export type SessionBlock = {
  mode: "local" | "remote";
  user: { email: string; name: string; approved?: boolean } | null;
  authMode: string;
};

/**
 * Leitura em lote dos documentos do workspace.
 *
 * `GET /api/state?keys=a,b&versions=a:3,b:7` autentica uma vez, resolve o
 * roster uma vez e lê todas as chaves em um `db.batch`. A decisão de leitura
 * continua sendo por chave: o que a pessoa não pode ler volta em `denied`, com
 * o mesmo motivo da rota por chave, que segue existindo para compatibilidade.
 * Chaves cuja versão informada ainda é a atual voltam só em `unchanged`, sem
 * corpo — é a mesma economia do ETag, para o conjunto inteiro.
 *
 * `&with=session,google,alerts` é o bootstrap da página: a mesma resposta traz
 * o que `/api/health`, `/api/google/status` e `/api/v1/alerts/count` devolvem,
 * para a carga de uma tela ser **uma** chamada e não quatro em cadeia. Com
 * `session` a resposta é 200 mesmo sem identidade (o bloco diz `user: null`,
 * como `/api/health`), e `keys` pode ficar vazio; as três rotas continuam
 * existindo para quem as chama fora da carga.
 */
export async function readStateBatch(request: Request, source: ServerEnv,
  options: { waitUntil?: (work: Promise<unknown>) => void } = {}) {
  const startedAt = Date.now();
  const { env, meter } = instrumentQueries(source, request);
  const timed = (response: Response) => withQueryTiming(response, meter, startedAt);
  const url = new URL(request.url);
  const extras = new Set<Extra>();
  for (const name of (url.searchParams.get("with") ?? "").split(",").filter(Boolean)) {
    if (!(EXTRAS as readonly string[]).includes(name)) return timed(problem(400, "Bloco extra inválido."));
    extras.add(name as Extra);
  }
  const wantsSession = extras.has("session");
  const authMode = resolveAuthMode(request, env);
  const empty = { documents: [], unchanged: [], denied: [] };
  const reply = (body: Record<string, unknown>) =>
    timed(json(body, { headers: { "cache-control": "private, no-store", vary: "Cookie" } }));
  if (!env.DB) {
    if (wantsSession)
      return reply({ ...empty, session: { mode: env.AUTH_MODE === "google" ? "remote" : "local", user: null, authMode } });
    return timed(problem(503, "Banco de dados não configurado."));
  }
  const keys = [...new Set((url.searchParams.get("keys") ?? "").split(",").filter(Boolean))];
  if ((!keys.length && !wantsSession) || keys.length > MAX_KEYS) return timed(problem(400, "Informe de 1 a 20 chaves."));
  if (keys.some((key) => !supportedStateKey(key))) return timed(problem(400, "Chave inválida."));
  const known = new Map<string, number>();
  for (const pair of (url.searchParams.get("versions") ?? "").split(",").filter(Boolean)) {
    const at = pair.lastIndexOf(":");
    const version = Number(pair.slice(at + 1));
    if (at <= 0 || !Number.isSafeInteger(version) || version < 0)
      return timed(problem(400, "Versão informada é inválida."));
    known.set(pair.slice(0, at), version);
  }
  const user = await authenticate(request, env);
  if (!user) {
    if (!wantsSession) return timed(problem(401, "Faça login para continuar."));
    // Pessoa que entrou pelo Google e ainda espera aprovação: identidade sem dados.
    const pending = await identifyUser(request, env);
    const session: SessionBlock = {
      mode: "remote",
      user: pending ? { email: pending.email, name: pending.name, approved: false } : null,
      authMode,
    };
    return reply({ ...empty, session });
  }
  const workspace = workspaceOf(env);
  const { member, bootstrap } = await resolveMember(env.DB, workspace, user.email);
  const denied: { key: string; status: number; reason: string }[] = [];
  const allowed: string[] = [];
  for (const key of keys) {
    const decision = authorizeStateRead({ member, bootstrap, key });
    if (decision.ok) allowed.push(key);
    else denied.push({ key, status: decision.status, reason: decision.reason });
  }
  // Versões conhecidas e corpos do que mudou numa ida só; chave inalterada não
  // traz corpo. Só as chaves autorizadas são lidas: uma execução ativa
  // inalterada não reconstrói as fatias a cada revalidação.
  const [{ unchanged, documents: changed }, session, google, alerts] = await Promise.all([
    loadChangedDocuments(env.DB, workspace, allowed, known),
    wantsSession ? sessionBlock(request, env, user, authMode) : undefined,
    extras.has("google") ? googleStatus(env, user) : undefined,
    extras.has("alerts") ? alertCount(request, env, options.waitUntil) : undefined,
  ]);
  const pending = allowed.filter(key => !unchanged.includes(key));
  const docs = pending.map(key => changed.get(key) ?? null);
  const documents: { key: string; value: unknown; version: number; updatedAt: string | null }[] = [];
  pending.forEach((key, index) => {
    const doc = docs[index];
    const version = doc?.version ?? 0;
    documents.push({ key, value: doc?.value ?? null, version, updatedAt: doc?.updatedAt ?? null });
  });
  return reply({
    documents,
    unchanged,
    denied,
    ...(session ? { session } : {}),
    ...(google ? { google } : {}),
    ...(alerts !== undefined ? { alerts } : {}),
  });
}

async function sessionBlock(
  request: Request,
  env: ServerEnv,
  user: { email: string; name: string },
  authMode: string,
): Promise<SessionBlock> {
  // Em modo google a presença é registrada no login e na renovação; nos demais
  // modos (Access, dev) não há callback, e a leitura registra uma vez por hora.
  if (env.DB && authMode !== "google") {
    try {
      await touchUserThrottled(env.DB, workspaceOf(env), user);
    } catch {
      // Migrations may not have run yet; the client still learns the mode.
    }
  }
  return {
    mode: "remote",
    user: {
      email: user.email,
      name: user.name,
      approved: authMode === "google" || authMode === "access" ? await googleSessionApproved(env, user.email) : undefined,
    },
    authMode,
  };
}

/**
 * O contador do menu; quem não pode ver clientes recebe `null`, como a rota
 * própria recusaria. Com `waitUntil` (o Worker), a fila ativa que ainda não está
 * pronta não segura a resposta: o bloco sai ausente (`undefined`), o navegador
 * mantém o número que tinha (na carga, pede `GET /api/v1/alerts/count`) e o
 * cálculo segue depois da resposta, pronto para a próxima revalidação.
 */
async function alertCount(request: Request, env: ServerEnv,
  waitUntil?: (work: Promise<unknown>) => void): Promise<{ count: number } | null | undefined> {
  try {
    const principal = await resolveOperationPrincipal(request, env);
    if (!waitUntil) return (await countAlerts(env, principal)).data;
    return (await countAlertsIfReady(env, principal, waitUntil))?.data;
  } catch {
    return null;
  }
}

export type { GoogleStatusBody };
