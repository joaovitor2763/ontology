import type { AiEnv } from "./ai/gateway";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Bindings and variables of the running Worker. In `next dev` they come from
 * the local wrangler emulation started by `initOpenNextCloudflareForDev`.
 * When no database is attached the app keeps working in browser-only mode.
 */
export type ServerEnv = AiEnv & {
  DB?: D1Database;
  FILES?: R2Bucket;
  AUTH_MODE?: string;
  AUTH_ORIGIN?: string;
  AUTH_GOOGLE_DOMAIN?: string;
  AUTH_BOOTSTRAP_EMAIL?: string;
  WORKSPACE_ID?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  DEV_USER_EMAIL?: string;
  DEV_USER_NAME?: string;
  /** WhatsApp conversations base (Supabase), read-only. See src/server/whatsapp.ts. */
  WHATSAPP_ENABLED?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
  WHATSAPP_TABLE?: string;
  WHATSAPP_GROUP_COLUMN?: string;
  WHATSAPP_GROUP_NAME_COLUMN?: string;
  WHATSAPP_ID_COLUMN?: string;
  WHATSAPP_AT_COLUMN?: string;
  WHATSAPP_FROM_COLUMN?: string;
  WHATSAPP_TEXT_COLUMN?: string;
  WHATSAPP_FROM_ME_COLUMN?: string;
  /** Google Agenda and Meet, per member. See src/server/google.ts. */
  GOOGLE_ENABLED?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_TOKEN_KEY?: string;
  INTEGRATION_SECRET_KEY?: string;
  /** `1` liga as réplicas de leitura do D1 (Sessions API) nas leituras de `d1-replicas.ts`. Desligado por padrão. */
  D1_READ_REPLICAS?: string;
};

export async function getServerEnv(): Promise<ServerEnv> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return env as unknown as ServerEnv;
  } catch {
    return {
      AI_ENABLED: process.env.AI_ENABLED,
      AI_GATEWAY_ACCOUNT_ID: process.env.AI_GATEWAY_ACCOUNT_ID,
      AI_GATEWAY_ID: process.env.AI_GATEWAY_ID,
      AI_GATEWAY_KEY_ALIAS: process.env.AI_GATEWAY_KEY_ALIAS,
      AI_GATEWAY_TOKEN: process.env.AI_GATEWAY_TOKEN,
      AI_MODEL: process.env.AI_MODEL,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      AUTH_MODE: process.env.AUTH_MODE,
      AUTH_ORIGIN: process.env.AUTH_ORIGIN,
      AUTH_GOOGLE_DOMAIN: process.env.AUTH_GOOGLE_DOMAIN,
      AUTH_BOOTSTRAP_EMAIL: process.env.AUTH_BOOTSTRAP_EMAIL,
      WORKSPACE_ID: process.env.WORKSPACE_ID,
      DEV_USER_EMAIL: process.env.DEV_USER_EMAIL,
      DEV_USER_NAME: process.env.DEV_USER_NAME,
      WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
      WHATSAPP_TABLE: process.env.WHATSAPP_TABLE,
      WHATSAPP_GROUP_COLUMN: process.env.WHATSAPP_GROUP_COLUMN,
      WHATSAPP_GROUP_NAME_COLUMN: process.env.WHATSAPP_GROUP_NAME_COLUMN,
      WHATSAPP_ID_COLUMN: process.env.WHATSAPP_ID_COLUMN,
      WHATSAPP_AT_COLUMN: process.env.WHATSAPP_AT_COLUMN,
      WHATSAPP_FROM_COLUMN: process.env.WHATSAPP_FROM_COLUMN,
      WHATSAPP_TEXT_COLUMN: process.env.WHATSAPP_TEXT_COLUMN,
      WHATSAPP_FROM_ME_COLUMN: process.env.WHATSAPP_FROM_ME_COLUMN,
      GOOGLE_ENABLED: process.env.GOOGLE_ENABLED,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_TOKEN_KEY: process.env.GOOGLE_TOKEN_KEY,
      INTEGRATION_SECRET_KEY: process.env.INTEGRATION_SECRET_KEY,
      D1_READ_REPLICAS: process.env.D1_READ_REPLICAS,
    };
  }
}

export function workspaceOf(env: ServerEnv) {
  return env.WORKSPACE_ID || "default";
}

export function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function problem(status: number, message: string) {
  return json({ error: message }, { status });
}

/**
 * `waitUntil` do Worker, para trabalho que pode terminar depois da resposta
 * (o contador de alertas do bootstrap, por exemplo). Fora do Worker não há
 * contexto e quem chama segue esperando, como antes.
 */
export async function getWaitUntil(): Promise<((work: Promise<unknown>) => void) | undefined> {
  try {
    const { ctx } = await getCloudflareContext({ async: true });
    return typeof ctx?.waitUntil === "function" ? (work) => ctx.waitUntil(work) : undefined;
  } catch {
    return undefined;
  }
}
