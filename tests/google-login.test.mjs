import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { startGoogleLogin, consumeLoginState, identityFromGoogle, verifyGoogleIdentity, finishGoogleLogin, readGoogleSession, logoutGoogle, tokenHash, renewGoogleSession } from "../src/server/google-login.ts";
import { authenticate, resolveAuthMode } from "../src/server/auth.ts";

function environment() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  sql.exec(readFileSync(new URL("../migrations/0004_google_login.sql", import.meta.url), "utf8"));
  const db = {
    prepare(query) {
      let args = [];
      return { bind(...values) { args = values; return this; },
        async first() { return sql.prepare(query).get(...args) ?? null; },
        async run() { return { meta: sql.prepare(query).run(...args) }; } };
    },
    async batch(statements) { return Promise.all(statements.map((s) => s.run())); },
  };
  return { sql, env: { DB: db, AUTH_MODE: "google", AUTH_ORIGIN: "https://delivery.test", AUTH_GOOGLE_DOMAIN: "example.com", AUTH_BOOTSTRAP_EMAIL: "joao@example.com", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "placeholder", WORKSPACE_ID: "test" } };
}
const request = (path, cookie = "", init = {}) => new Request(`https://delivery.test${path}`, { ...init, headers: { cookie, ...init.headers } });
const pair = await generateKeyPair("RS256");
const jwk = { ...await exportJWK(pair.publicKey), kid: "login-test", alg: "RS256" };
const jwks = createLocalJWKSet({ keys: [jwk] });
const claims = { email: "joao@example.com", email_verified: true, hd: "example.com", nonce: "nonce", name: "João", sub: "google-user" };
const sign = (payload = claims, audience = "test-client", expiration = "5m") => new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: "login-test" }).setIssuer("https://accounts.google.com").setAudience(audience).setIssuedAt().setExpirationTime(expiration).sign(pair.privateKey);

test("Google identity requires verified email, exact Workspace domain and nonce", () => {
  assert.equal(identityFromGoogle(claims, "example.com", "nonce").email, claims.email);
  for (const invalid of [{ email_verified: false }, { email: "joao@example.com.attacker.test" }, { hd: "other.test" }, { hd: undefined }, { nonce: "replayed" }, { sub: undefined }])
    assert.throws(() => identityFromGoogle({ ...claims, ...invalid }, "example.com", "nonce"));
});

test("ID tokens require Google's issuer, correct audience, valid signature and expiry", async () => {
  const { env } = environment();
  assert.equal((await verifyGoogleIdentity(await sign(), env, "nonce", jwks)).email, claims.email);
  await assert.rejects(verifyGoogleIdentity(await sign(claims, "other-client"), env, "nonce", jwks));
  await assert.rejects(verifyGoogleIdentity(await sign(claims, "test-client", "-1s"), env, "nonce", jwks));
  await assert.rejects(verifyGoogleIdentity(await sign({ ...claims, azp: "other-client" }), env, "nonce", jwks));
  const foreign = await generateKeyPair("RS256");
  const forged = await new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "login-test" }).setIssuer("https://accounts.google.com").setAudience("test-client").setIssuedAt().setExpirationTime("5m").sign(foreign.privateKey);
  await assert.rejects(verifyGoogleIdentity(forged, env, "nonce", jwks));
});

test("login flow uses PKCE and a browser-bound, expiring, single-use state", async () => {
  const { env, sql } = environment();
  const response = await startGoogleLogin(request("/api/auth/google"), env);
  const url = new URL(response.headers.get("location"));
  assert.equal(url.hostname, "accounts.google.com");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.match(response.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);
  const state = url.searchParams.get("state");
  assert.equal(await consumeLoginState(request("/", "__Host-g4_login=" + "a".repeat(64)), env, state), null);
  assert.equal(await consumeLoginState(request("/", cookie), { ...env, WORKSPACE_ID: "other" }, state), null);
  const consumed = await consumeLoginState(request("/", cookie), env, state);
  assert.equal(await tokenHash(consumed.verifier), url.searchParams.get("code_challenge"));
  assert.equal(await consumeLoginState(request("/", cookie), env, state), null);
  const expired = await startGoogleLogin(request("/api/auth/google"), env);
  sql.exec("UPDATE login_states SET expires_at = 0");
  assert.equal(await consumeLoginState(request("/", expired.headers.get("set-cookie").split(";")[0]), env, new URL(expired.headers.get("location")).searchParams.get("state")), null);
  assert.equal((await startGoogleLogin(new Request("https://other.test/api/auth/google"), env)).status, 503);
});

test("OAuth callback establishes a hashed session, consumes state and revokes on logout", async () => {
  const { env, sql } = environment();
  const started = await startGoogleLogin(request("/api/auth/google"), env);
  const auth = new URL(started.headers.get("location"));
  const cookie = started.headers.get("set-cookie").split(";")[0];
  const token = await sign({ ...claims, nonce: auth.searchParams.get("nonce") });
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] });
    assert.equal(url, "https://oauth2.googleapis.com/token");
    assert.equal(init.body.get("redirect_uri"), "https://delivery.test/api/google/callback");
    assert.equal(await tokenHash(init.body.get("code_verifier")), auth.searchParams.get("code_challenge"));
    return Response.json({ id_token: token });
  };
  try {
    const callback = request(`/api/google/callback?code=test-code&state=${auth.searchParams.get("state")}`, cookie);
    const response = await finishGoogleLogin(callback, env);
    assert.equal(response.headers.get("location"), "https://delivery.test/");
    assert.match(response.headers.getSetCookie().find(v => v.startsWith("__Host-g4_session=")), /Max-Age=2592000/);
    const session = response.headers.getSetCookie().find((v) => v.startsWith("__Host-g4_session=")).split(";")[0];
    assert.equal((await readGoogleSession(request("/api/me", session), env)).email, claims.email);
    const row = sql.prepare("SELECT token_hash FROM login_sessions").get();
    assert.notEqual(row.token_hash, session.split("=")[1]);
    assert.equal((await finishGoogleLogin(callback, env)).headers.get("location"), "https://delivery.test/entrar?erro=login&motivo=expirado");
    assert.equal(await readGoogleSession(request("/api/me", session), { ...env, WORKSPACE_ID: "other" }), null);
    assert.equal(await readGoogleSession(request("/api/state/key", session, { method: "PUT", headers: { origin: "https://attacker.test" } }), env), null);
    assert.equal((await logoutGoogle(request("/api/auth/logout", session, { method: "POST", headers: { origin: env.AUTH_ORIGIN } }), env)).status, 204);
    assert.equal(await readGoogleSession(request("/api/me", session), env), null);
  } finally { globalThis.fetch = original; }
});

test("pending users cannot access data or bootstrap themselves; approved users and designated first admin can", async () => {
  const { env, sql } = environment();
  const token = "b".repeat(64), cookie = `__Host-g4_session=${token}`;
  const hash = await tokenHash(token);
  sql.prepare("INSERT INTO login_sessions VALUES (?, ?, ?, ?, ?)").run(hash, "test", "new@example.com", "New", Math.floor(Date.now() / 1000) + 100);
  assert.equal(resolveAuthMode(request("/"), env), "google");
  assert.ok(await authenticate(request("/api/health", cookie), env));
  assert.equal(await authenticate(request("/api/state/ontology.workspace.v3", cookie), env), null);
  assert.equal(await authenticate(request("/api/whatsapp", cookie), env), null);
  assert.equal(await authenticate(request("/api/state/ontology.workspace.v3", cookie, { method: "PUT", headers: { origin: env.AUTH_ORIGIN } }), env), null);
  sql.prepare("UPDATE login_sessions SET email = ?").run(env.AUTH_BOOTSTRAP_EMAIL);
  assert.ok(await authenticate(request("/api/whatsapp", cookie), env));
  sql.prepare("INSERT INTO workspaces (id, name) VALUES (?, ?)").run("test", "Test");
  const roster = { extraMembers: [{ id: "admin", email: env.AUTH_BOOTSTRAP_EMAIL, access: "admin" }], deactivatedIds: ["admin"] };
  sql.prepare("INSERT INTO state_documents (workspace_id, key, body, version) VALUES (?, ?, ?, ?)").run("test", "ontology.workspace.v3", JSON.stringify(roster), 1);
  assert.equal(await authenticate(request("/api/whatsapp", cookie), env), null);
  sql.exec("UPDATE login_sessions SET expires_at = 0");
  assert.equal(await readGoogleSession(request("/api/me", cookie), env), null);
});

test("parallel login attempts keep independent browser bindings", async () => {
  const {env}=environment();
  const first=await startGoogleLogin(request('/api/auth/google'),env);
  const firstCookie=first.headers.get('set-cookie').split(';')[0];
  const second=await startGoogleLogin(request('/api/auth/google',firstCookie),env);
  const secondCookie=second.headers.get('set-cookie').split(';')[0];
  // Browser replaces only cookies with the same name.
  const jar=new Map([firstCookie,secondCookie].map(c=>[c.split('=')[0],c]));
  const cookies=[...jar.values()].join('; ');
  const state=r=>new URL(r.headers.get('location')).searchParams.get('state');
  assert.ok(await consumeLoginState(request('/',cookies),env,state(first)));
  assert.ok(await consumeLoginState(request('/',cookies),env,state(second)));
});


test("stale callback clears only its own cookie and leaves a newer attempt usable", async () => {
  const {env}=environment();
  const a=await startGoogleLogin(request('/api/auth/google'),env);
  const b=await startGoogleLogin(request('/api/auth/google'),env);
  const pair=r=>r.headers.get('set-cookie').split(';')[0];
  const state=r=>new URL(r.headers.get('location')).searchParams.get('state');
  const jar=[pair(a),pair(b)].join('; ');
  await consumeLoginState(request('/',jar),env,state(a));
  const failed=await finishGoogleLogin(request(`/api/google/callback?state=${state(a)}&code=stale`,jar),env);
  const cleared=failed.headers.getSetCookie();
  assert.equal(cleared.length,1);
  assert.ok(cleared[0].startsWith(pair(a).split('=')[0]+'='));
  assert.ok(!cleared[0].startsWith(pair(b).split('=')[0]+'='));
  assert.ok(await consumeLoginState(request('/',pair(b)),env,state(b)));
  assert.equal((await finishGoogleLogin(request('/api/google/callback?state=invalid',jar),env)).headers.getSetCookie().length,0);
});

test("pre-deployment browser-bound login flows remain consumable", async () => {
  const {env}=environment();
  const started=await startGoogleLogin(request('/api/auth/google'),env);
  const browser=started.headers.get('set-cookie').split(';')[0].split('=')[1];
  const state=new URL(started.headers.get('location')).searchParams.get('state');
  assert.ok(await consumeLoginState(request('/',`__Host-g4_login=${browser}`),env,state));
});


test("provider failures emit only safe stage categories and never provider content", async () => {
  const {env}=environment();
  const started=await startGoogleLogin(request('/api/auth/google'),env);
  const state=new URL(started.headers.get('location')).searchParams.get('state');
  const cookie=started.headers.get('set-cookie').split(';')[0];
  const originalFetch=globalThis.fetch, originalWarn=console.warn;
  const logs=[];
  globalThis.fetch=async()=>new Response('sensitive-provider-body',{status:503});
  console.warn=(value)=>logs.push(value);
  try {
    const result=await finishGoogleLogin(request(`/api/google/callback?state=${state}&code=sensitive-code`,cookie),env);
    assert.equal(result.headers.get('location'),'https://delivery.test/entrar?erro=login&motivo=temporario');
    assert.deepEqual(logs,[{event:'google_login_failed',stage:'google-token',reason:'temporario'}]);
    assert.ok(!JSON.stringify(logs).includes('sensitive'));
  } finally {globalThis.fetch=originalFetch;console.warn=originalWarn;}
});


test("stale modern callback cannot clear an unrelated in-flight legacy cookie", async () => {
  const {env}=environment();
  const old=await startGoogleLogin(request('/api/auth/google'),env);
  const modern=await startGoogleLogin(request('/api/auth/google'),env);
  const state=r=>new URL(r.headers.get('location')).searchParams.get('state');
  const pair=r=>r.headers.get('set-cookie').split(';')[0];
  const legacyCookie='__Host-g4_login='+pair(old).split('=')[1];
  await consumeLoginState(request('/',pair(modern)),env,state(modern));
  const response=await finishGoogleLogin(request(`/api/google/callback?state=${state(modern)}&code=stale`,legacyCookie),env);
  assert.equal(response.headers.getSetCookie().length,0);
  const cancel=await finishGoogleLogin(request(`/api/google/callback?state=${state(old)}&error=access_denied`,legacyCookie),env);
  assert.equal(cancel.headers.get('location'),'https://delivery.test/entrar?erro=login&motivo=cancelado');
  assert.ok(cancel.headers.getSetCookie()[0].startsWith('__Host-g4_login=;'));
});

test("session renewal upgrades a valid old session and renews the secure browser deadline", async () => {
  const { env, sql } = environment();
  const token = "c".repeat(64), cookie = `__Host-g4_session=${token}`;
  const timestamp = Math.floor(Date.now() / 1000);
  sql.prepare("INSERT INTO login_sessions VALUES (?, ?, ?, ?, ?)").run(await tokenHash(token), "test", claims.email, "João", timestamp + 3600);
  const req = request("/api/me", cookie, { method: "POST", headers: { origin: env.AUTH_ORIGIN } });
  const result = await renewGoogleSession(req, env);
  assert.equal(result.status, 204);
  assert.match(result.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax; Max-Age=2592000/);
  assert.equal(result.headers.get("cache-control"), "no-store");
  const expires = sql.prepare("SELECT expires_at FROM login_sessions").get().expires_at;
  assert.ok(expires >= timestamp + 2592000);
  await renewGoogleSession(req, env);
  assert.equal(sql.prepare("SELECT expires_at FROM login_sessions").get().expires_at, expires);
  // Older active sessions slide forward on subsequent days, too.
  sql.prepare("UPDATE login_sessions SET expires_at = ?").run(timestamp + 27 * 86400);
  await renewGoogleSession(req, env);
  assert.ok(sql.prepare("SELECT expires_at FROM login_sessions").get().expires_at >= timestamp + 2592000);
  assert.equal(await renewGoogleSession(request("/api/me", cookie), env), null);
  assert.equal(await renewGoogleSession(request("/api/me", cookie, {method:"POST",headers:{origin:"https://other.test"}}), env), null);
  assert.equal(await renewGoogleSession(req, {...env, WORKSPACE_ID:"other"}), null);
  sql.exec("UPDATE login_sessions SET expires_at = 0");
  assert.equal(await renewGoogleSession(req, env), null);
  sql.exec("DELETE FROM login_sessions");
  assert.equal(await renewGoogleSession(req, env), null);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM login_sessions").get().n, 0);
});
