import { createRemoteJWKSet, jwtVerify } from "jose";
import { hasGoogleSessionCookie, readGoogleSession } from "./google-login.ts";
import { prefetchWorkspaceDocument } from "./operations/request-context.ts";
import { resolveMember } from "./authz.ts";
import { markAuthenticated } from "./timing.ts";
import type { ServerEnv } from "./context";

export type AuthUser = { email: string; name: string };

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(teamDomain: string) {
  const url = `${teamDomain.replace(/\/$/, "")}/cdn-cgi/access/certs`;
  let set = jwksCache.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url));
    jwksCache.set(url, set);
  }
  return set;
}

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  try { return match ? decodeURIComponent(match.slice(name.length + 1)) : null; } catch { return null; }
}

/**
 * Identifies the person behind a request.
 *
 * `google`: Google identity with a server-side session and approved membership.
 * `access`: the app sits behind Cloudflare Access (Google as identity provider).
 * Access already blocked anonymous traffic at the edge; here the signed JWT is
 * verified again so the API never trusts a forged header.
 * `dev`: local development without Access; identity comes from `.dev.vars`.
 */
export type AuthMode = "google" | "access" | "dev" | "none";

/** Explicit Google/Access/dev mode; unconfigured published environments refuse access. */
export function resolveAuthMode(request: Request, env: ServerEnv): AuthMode {
  const configured = Boolean(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD);
  const host = new URL(request.url).host;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const wanted = env.AUTH_MODE as AuthMode | undefined;
  if (wanted === "google" || wanted === "access" || wanted === "dev" || wanted === "none") return wanted;
  return configured ? "access" : local ? "dev" : "none";
}

/**
 * Identidade da requisição. Reconhecer a pessoa também libera a medição de
 * `Server-Timing` desta requisição (ver `timing.ts`); nenhum dado da pessoa
 * entra no cabeçalho, só contagens.
 */
export async function authenticate(
  request: Request,
  env: ServerEnv,
): Promise<AuthUser | null> {
  const user = await identify(request, env, false);
  if (user) markAuthenticated(env.DB);
  return user;
}

/**
 * Quem a requisição diz ser, **antes** da aprovação no roster: é o que
 * `/api/health` e o bloco `session` do bootstrap (`GET /api/state?with=session`)
 * mostram a uma pessoa que entrou pelo Google e ainda espera aprovação. Não
 * libera nenhum dado do workspace; para isso continua valendo `authenticate`.
 */
export function identifyUser(request: Request, env: ServerEnv): Promise<AuthUser | null> {
  return identify(request, env, true);
}

async function identify(
  request: Request,
  env: ServerEnv,
  pendingAllowed: boolean,
): Promise<AuthUser | null> {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const audience = env.CF_ACCESS_AUD;
  const mode = resolveAuthMode(request, env);
  if (mode === "google") {
    const path = new URL(request.url).pathname;
    // Pending people can read their own identity; workspace data and all other
    // APIs require an active membership or the designated first admin.
    const identityOnly = pendingAllowed || path === "/api/health" || path === "/api/me";
    // A aprovação lê o roster; com um cookie de sessão bem formado ele sai junto
    // com a leitura da sessão (duas idas em paralelo, não em série). A decisão
    // continua a mesma e só acontece depois de a sessão ser reconhecida.
    if (!identityOnly && env.DB && hasGoogleSessionCookie(request))
      prefetchWorkspaceDocument(env.DB, env.WORKSPACE_ID || "default");
    const user = await readGoogleSession(request, env);
    if (!user) return null;
    if (identityOnly) return user;
    return await googleSessionApproved(env, user.email) ? user : null;
  }
  if (mode === "dev") {
    // Local development: the /entrar screen picks who you are (cookie); .dev.vars is the default.
    const chosen = readCookie(request, "ontology_dev_user");
    if (chosen) {
      try {
        const parsed = JSON.parse(chosen) as { email?: string; name?: string };
        if (parsed.email)
          return { email: parsed.email, name: parsed.name || parsed.email.split("@")[0] };
      } catch {
        /* ignore a malformed cookie */
      }
    }
    const email = env.DEV_USER_EMAIL || "dev@local";
    return { email, name: env.DEV_USER_NAME || "Pessoa de desenvolvimento" };
  }
  // Published without Cloudflare Access configured: refuse rather than trust anyone.
  if (mode !== "access" || !teamDomain || !audience) return null;
  const token =
    request.headers.get("cf-access-jwt-assertion") ??
    readCookie(request, "CF_Authorization");
  if (!token) return null;
  try {
    const user = await verifyAccessIdentity(token, env);
    const path = new URL(request.url).pathname;
    if (pendingAllowed || path === "/api/health" || path === "/api/me") return user;
    return await googleSessionApproved(env, user.email) ? user : null;
  } catch {
    return null;
  }
}

/** Access authenticates identity; the app still requires approved membership or its designated first admin. */
export async function verifyAccessIdentity(
  token: string,
  env: ServerEnv,
  keys?: ReturnType<typeof createRemoteJWKSet>,
): Promise<AuthUser> {
  const issuer = env.CF_ACCESS_TEAM_DOMAIN?.replace(/\/$/, "");
  if (!issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(issuer) || !env.CF_ACCESS_AUD)
    throw new Error("Cloudflare Access não configurado.");
  const { payload } = await jwtVerify(token, keys ?? jwksFor(issuer), {
    issuer,
    audience: env.CF_ACCESS_AUD,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub", "email"],
  });
  if (typeof payload.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email))
    throw new Error("Identidade Access sem e-mail válido.");
  const email = payload.email.toLowerCase();
  return { email, name: typeof payload.name === "string" && payload.name ? payload.name : email.split("@")[0] };
}

export async function googleSessionApproved(env: ServerEnv, email: string) {
  if (!env.DB) return false;
  const { member, bootstrap } = await resolveMember(env.DB, env.WORKSPACE_ID || "default", email);
  return member?.active === true || (bootstrap && email === env.AUTH_BOOTSTRAP_EMAIL?.toLowerCase());
}
