import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { ServerEnv } from "./context";
import { touchUser, touchUserThrottled } from "./db.ts";
import { requestScratch } from "./operations/request-context.ts";
import { PRIMARY_COOKIE } from "./d1-replicas.ts";

const SESSION = "__Host-g4_session";
const FLOW = "__Host-g4_login";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const FLOW_SECONDS = 10 * 60;
const validState = (state: string) => /^login\.[a-f0-9]{64}$/.test(state);
// Each attempt has its own binding: tabs/retries cannot overwrite or clear one another.
const flowName = (state: string) => `${FLOW}_${state.slice(6)}`;
function flowCookieName(request: Request, state: string) {
  if (!validState(state)) return null;
  const name = flowName(state);
  // Finish pre-deployment flows for at most their existing ten-minute lifetime.
  return loginCookie(request, name) ? name : loginCookie(request, FLOW) ? FLOW : name;
}
const keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const now = () => Math.floor(Date.now() / 1000);
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
const workspace = (env: ServerEnv) => env.WORKSPACE_ID || "default";

export async function tokenHash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function loginCookie(request: Request, name: string) {
  const value = request.headers.get("cookie")?.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${name}=`));
  return value?.slice(name.length + 1) || null;
}

function cookie(name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}

export function loginConfigured(env: ServerEnv) {
  return Boolean(env.AUTH_MODE === "google" && env.DB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.AUTH_ORIGIN?.startsWith("https://") && env.AUTH_GOOGLE_DOMAIN);
}

function validOrigin(request: Request, env: ServerEnv) {
  return new URL(request.url).origin === env.AUTH_ORIGIN;
}

function redirect(env: ServerEnv, path: string, cookies: string[] = []) {
  const headers = new Headers({ location: `${env.AUTH_ORIGIN}${path}`, "cache-control": "no-store", "referrer-policy": "no-referrer" });
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(null, { status: 302, headers });
}

/** Login requests only identity scopes; connecting Calendar is a separate action. */
export async function startGoogleLogin(request: Request, env: ServerEnv) {
  if (!loginConfigured(env) || !validOrigin(request, env))
    return new Response("Login indisponível neste endereço.", { status: 503 });
  const state = `login.${random()}`;
  const browser = random();
  const verifier = random();
  const nonce = random();
  await env.DB!.batch([
    env.DB!.prepare("DELETE FROM login_states WHERE expires_at <= ?").bind(now()),
    env.DB!.prepare("DELETE FROM login_sessions WHERE expires_at <= ?").bind(now()),
    env.DB!.prepare("INSERT INTO login_states (state_hash, browser_hash, workspace_id, verifier, nonce, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(await tokenHash(state), await tokenHash(browser), workspace(env), verifier, nonce, now() + FLOW_SECONDS),
  ]);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: `${env.AUTH_ORIGIN}/api/google/callback`,
    response_type: "code", scope: "openid email profile", state, nonce,
    code_challenge: await tokenHash(verifier), code_challenge_method: "S256",
    hd: env.AUTH_GOOGLE_DOMAIN!, prompt: "select_account",
  }).toString();
  return new Response(null, { status: 302, headers: { location: url.toString(), "set-cookie": cookie(flowName(state), browser, FLOW_SECONDS), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

export function identityFromGoogle(payload: JWTPayload, domain: string, nonce: string) {
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!payload.sub || payload.email_verified !== true || payload.hd !== domain ||
      email.split("@").length !== 2 || email.split("@")[1] !== domain || payload.nonce !== nonce)
    throw new Error("Conta Google não autorizada.");
  return { email, name: typeof payload.name === "string" && payload.name ? payload.name : email.split("@")[0] };
}

export async function verifyGoogleIdentity(token: string, env: ServerEnv, nonce: string, jwks = keys) {
  const { payload } = await jwtVerify(token, jwks, {
    algorithms: ["RS256"], issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: env.GOOGLE_CLIENT_ID, requiredClaims: ["exp", "iat", "sub", "nonce"],
  });
  if (payload.azp && payload.azp !== env.GOOGLE_CLIENT_ID) throw new Error("Cliente Google inválido.");
  return identityFromGoogle(payload, env.AUTH_GOOGLE_DOMAIN!, nonce);
}

type LoginState = { verifier: string; nonce: string };

/** Atomically consumes a flow, bound to this browser and workspace, before exchanging its code. */
export async function consumeLoginState(request: Request, env: ServerEnv, state: string) {
  const name = flowCookieName(request, state);
  const browser = name && loginCookie(request, name);
  if (!browser || !/^[a-f0-9]{64}$/.test(browser) || !validState(state)) return null;
  return env.DB!.prepare("DELETE FROM login_states WHERE state_hash = ? AND browser_hash = ? AND workspace_id = ? AND expires_at > ? RETURNING verifier, nonce")
    .bind(await tokenHash(state), await tokenHash(browser), workspace(env), now()).first<LoginState>();
}

export async function finishGoogleLogin(request: Request, env: ServerEnv) {
  if (!loginConfigured(env) || !validOrigin(request, env)) return new Response("Login indisponível.", { status: 503 });
  const url = new URL(request.url);
  const rawState = url.searchParams.get("state") || "";
  const name = flowCookieName(request, rawState);
  const clearFlow = name && name !== FLOW ? [cookie(name, "", 0)] : [];
  let stage = "state";
  const failed = (reason: "expirado" | "cancelado" | "temporario" | "validacao") => {
    // Static categories only: never log URLs, codes, cookies, tokens, emails or provider bodies.
    console.warn({event: "google_login_failed", stage, reason});
    return redirect(env, `/entrar?erro=login&motivo=${reason}`, clearFlow);
  };
  try {
    const state = await consumeLoginState(request, env, rawState);
    if (!state) return failed("expirado");
    // A legacy binding belongs to this callback only after the atomic hash match succeeds.
    if (name === FLOW) clearFlow.push(cookie(FLOW, "", 0));
    if (url.searchParams.has("error")) return failed("cancelado");
    const code = url.searchParams.get("code");
    if (!code) return failed("validacao");
    stage = "google-token";
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${env.AUTH_ORIGIN}/api/google/callback`, grant_type: "authorization_code", code_verifier: state.verifier }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Falha no Google.");
    const body = await response.json() as { id_token?: string };
    if (!body.id_token) throw new Error("Resposta Google inválida.");
    stage = "google-identity";
    const user = await verifyGoogleIdentity(body.id_token, env, state.nonce);
    stage = "session";
    const token = random();
    // Rotate any existing session on sign-in. Tokens are only stored as hashes.
    const previous = loginCookie(request, SESSION);
    await env.DB!.batch([
      env.DB!.prepare("DELETE FROM login_sessions WHERE token_hash = ? AND workspace_id = ?").bind(await tokenHash(previous || ""), workspace(env)),
      env.DB!.prepare("INSERT INTO login_sessions (token_hash, workspace_id, email, name, expires_at) VALUES (?, ?, ?, ?, ?)")
        .bind(await tokenHash(token), workspace(env), user.email, user.name, now() + SESSION_SECONDS),
    ]);
    // Presença ("entrou") é registrada aqui, no login, e não em toda leitura.
    try {
      await touchUser(env.DB!, workspace(env), user);
    } catch {
      // Migrations ainda não aplicadas: o login não depende do registro.
    }
    const oauthPending = loginCookie(request, "g4_oauth_pending");
    const destination = oauthPending && /^[a-f0-9-]{36}$/.test(oauthPending) ? "/oauth/resume" : "/";
    // Réplicas do D1 (flag): a sessão acabou de ser gravada no primário; as leituras
    // dos próximos 30 s vão a ele para a pessoa não parecer deslogada (sem a flag, ignorado).
    return redirect(env, destination, [...clearFlow, cookie(SESSION, token, SESSION_SECONDS),
      `${PRIMARY_COOKIE}=1; Path=/; Secure; SameSite=Lax; Max-Age=30`]);
  } catch {
    // Provider error bodies, codes and tokens must never reach URLs, logs or the UI.
    return failed(stage === "google-identity" ? "validacao" : "temporario");
  }
}

/** A requisição traz um cookie de sessão bem formado (sem consultar o banco). */
export function hasGoogleSessionCookie(request: Request) {
  return /^[a-f0-9]{64}$/.test(loginCookie(request, SESSION) ?? "");
}

export async function readGoogleSession(request: Request, env: ServerEnv) {
  if (!loginConfigured(env) || !validOrigin(request, env)) return null;
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.get("origin") !== env.AUTH_ORIGIN) return null;
  const token = loginCookie(request, SESSION);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  // A mesma requisição autentica mais de uma vez (identidade, principal das
  // operações); a sessão é lida do banco uma vez só.
  const scratch = requestScratch(env.DB!), key = `google-session ${token}`;
  const cached = scratch?.get(key) as Promise<{ email: string; name: string } | null> | undefined;
  if (cached) return cached;
  const work = (async () => {
    const user = await env.DB!.prepare("SELECT email, name FROM login_sessions WHERE token_hash = ? AND workspace_id = ? AND expires_at > ?")
      .bind(await tokenHash(token), workspace(env), now()).first<{ email: string; name: string }>();
    return user?.email.split("@")[1] === env.AUTH_GOOGLE_DOMAIN ? user : null;
  })();
  scratch?.set(key, work);
  return work;
}

export async function logoutGoogle(request: Request, env: ServerEnv) {
  if (!loginConfigured(env) || !validOrigin(request, env) || request.headers.get("origin") !== env.AUTH_ORIGIN)
    return new Response("Origem inválida.", { status: 403 });
  const token = loginCookie(request, SESSION);
  if (token) await env.DB!.prepare("DELETE FROM login_sessions WHERE token_hash = ? AND workspace_id = ?")
    .bind(await tokenHash(token), workspace(env)).run();
  return new Response(null, { status: 204, headers: { "set-cookie": cookie(SESSION, "", 0), "cache-control": "no-store" } });
}

/** Called only after membership approval; renews both D1 and the browser cookie. */
export async function renewGoogleSession(request: Request, env: ServerEnv) {
  if (request.method !== "POST" || request.headers.get("origin") !== env.AUTH_ORIGIN ||
      !await readGoogleSession(request, env)) return null;
  const token = loginCookie(request, SESSION)!;
  const timestamp = now();
  // Conditional update cannot resurrect a session revoked/expired after authentication.
  // Reuse a recent expiry so parallel checks agree on the browser deadline.
  const session = await env.DB!.prepare(`UPDATE login_sessions
    SET expires_at = CASE WHEN expires_at < ? THEN ? ELSE expires_at END
    WHERE token_hash = ? AND workspace_id = ? AND expires_at > ?
    RETURNING expires_at`)
    .bind(timestamp + SESSION_SECONDS - 24 * 60 * 60, timestamp + SESSION_SECONDS,
      await tokenHash(token), workspace(env), timestamp).first<{ expires_at: number }>();
  if (!session) return null;
  const renewed = await readGoogleSession(request, env);
  if (renewed) {
    try {
      await touchUserThrottled(env.DB!, workspace(env), renewed);
    } catch {
      // A renovação não depende do registro de presença.
    }
  }
  return new Response(null, { status: 204, headers: {
    "set-cookie": cookie(SESSION, token, session.expires_at - timestamp),
    "cache-control": "no-store",
  } });
}
