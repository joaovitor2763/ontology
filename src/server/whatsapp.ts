import { zApiEnabled, zApiHistory, zApiMessagePage } from "./z-api.ts";
import {
  defaultWhatsAppColumns,
  mapWhatsAppRow,
  sortWhatsAppMessages,
  type WhatsAppColumns,
  type WhatsAppMessage,
} from "../modules/engagement/application/whatsapp.ts";

/**
 * The client's WhatsApp groups live in a Supabase base filled by the WhatsApp
 * integration. The Worker reads it with the service key (never exposed to the
 * browser) through PostgREST, filtered by the group of the client.
 */
export type WhatsAppEnv = {
  DB?: D1Database;
  WORKSPACE_ID?: string;
  INTEGRATION_SECRET_KEY?: string;
  WHATSAPP_ENABLED?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
  WHATSAPP_TABLE?: string;
  WHATSAPP_GROUP_COLUMN?: string;
  /** Column with the group name as it appears in WhatsApp; the client is configured by name. */
  WHATSAPP_GROUP_NAME_COLUMN?: string;
  WHATSAPP_ID_COLUMN?: string;
  WHATSAPP_AT_COLUMN?: string;
  WHATSAPP_FROM_COLUMN?: string;
  WHATSAPP_TEXT_COLUMN?: string;
  WHATSAPP_FROM_ME_COLUMN?: string;
};

export function whatsappColumns(env: WhatsAppEnv): WhatsAppColumns {
  return {
    group: env.WHATSAPP_GROUP_COLUMN || defaultWhatsAppColumns.group,
    groupName:
      env.WHATSAPP_GROUP_NAME_COLUMN || defaultWhatsAppColumns.groupName,
    id: env.WHATSAPP_ID_COLUMN || defaultWhatsAppColumns.id,
    at: env.WHATSAPP_AT_COLUMN || defaultWhatsAppColumns.at,
    from: env.WHATSAPP_FROM_COLUMN || defaultWhatsAppColumns.from,
    text: env.WHATSAPP_TEXT_COLUMN || defaultWhatsAppColumns.text,
    fromMe: env.WHATSAPP_FROM_ME_COLUMN ?? defaultWhatsAppColumns.fromMe,
  };
}

export function whatsappConfigured(env: WhatsAppEnv) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

export function whatsappEnabled(env: WhatsAppEnv) {
  return env.WHATSAPP_ENABLED === "true" && whatsappConfigured(env);
}

export async function whatsappSourceAvailable(env: WhatsAppEnv) { return whatsappEnabled(env) || await zApiEnabled(env); }

/** Never returns secrets. */
export function whatsappStatus(env: WhatsAppEnv) {
  return {
    enabled: whatsappEnabled(env),
    configured: whatsappConfigured(env),
    source: "supabase" as const,
    table: env.WHATSAPP_TABLE || "messages",
    groupColumn: whatsappColumns(env).group,
    groupNameColumn: whatsappColumns(env).groupName,
  };
}

export async function fetchGroupMessages(
  env: WhatsAppEnv,
  group: { id?: string; name?: string },
  limit = 300,
): Promise<WhatsAppMessage[]> {
  if (group.id?.startsWith("z-api:")) return (await zApiHistory(env, group.id.slice(6))).messages.slice(-limit);
  const columns = whatsappColumns(env);
  const table = env.WHATSAPP_TABLE || "messages";
  const base = env.SUPABASE_URL!.replace(/\/+$/, "");
  const url = new URL(`${base}/rest/v1/${encodeURIComponent(table)}`);
  // URLSearchParams encodes the literal value; quotes here become part of the filter.
  if (group.id) url.searchParams.set(columns.group, `eq.${group.id}`);
  else
    url.searchParams.set(
      columns.groupName ?? "group_name",
      `eq.${group.name ?? ""}`,
    );
  url.searchParams.set("order", `${columns.at}.desc`);
  url.searchParams.set("limit", String(limit));
  const key = env.SUPABASE_SERVICE_KEY!;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: "application/json",
    },
  });
  if (!response.ok)
    throw new Error(`A base de conversas respondeu ${response.status}.`);
  const rows = (await response.json()) as unknown;
  if (!Array.isArray(rows))
    throw new Error("A base de conversas devolveu um formato inesperado.");
  return sortWhatsAppMessages(
    rows
      .map((row) => mapWhatsAppRow(row as Record<string, unknown>, columns))
      .filter((m): m is WhatsAppMessage => m !== null),
  );
}

/** Stable keyset pagination: equal timestamps are disambiguated by the source id. */
export async function fetchMessagePage(
  env: WhatsAppEnv,
  group: { id?: string; name?: string },
  range: {
    since: string;
    until: string;
    at?: string | null;
    id?: string | null;
  },
) {
  if (group.id?.startsWith("z-api:")) return zApiMessagePage(env, group.id.slice(6), range);
  const c = whatsappColumns(env);
  const url = new URL(
    `${env.SUPABASE_URL!.replace(/\/+$/, "")}/rest/v1/${encodeURIComponent(env.WHATSAPP_TABLE || "messages")}`,
  );
  const quote = (v: string) =>
    `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  url.searchParams.set(
    group.id ? c.group : (c.groupName ?? "group_name"),
    `eq.${group.id || group.name || ""}`,
  );
  url.searchParams.set("select", [c.id, c.at, c.from, c.text].join(","));
  url.searchParams.set(
    "and",
    `(${c.at}.gte.${quote(range.since)},${c.at}.lte.${quote(range.until)})`,
  );
  if (range.at && range.id)
    url.searchParams.set(
      "or",
      `(${c.at}.gt.${quote(range.at)},and(${c.at}.eq.${quote(range.at)},${c.id}.gt.${quote(range.id)}))`,
    );
  url.searchParams.set("order", `${c.at}.asc,${c.id}.asc`);
  url.searchParams.set("limit", "100");
  const response = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY!,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY!}`,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`A base de conversas respondeu ${response.status}.`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows))
    throw new Error("Formato inesperado da base de conversas.");
  return rows.map((row: Record<string, unknown>) => {
    const id = String(row[c.id] ?? ""),
      at = String(row[c.at] ?? "");
    if (!id || !Number.isFinite(Date.parse(at)))
      throw new Error("Mensagem sem identificador ou data válida.");
    return {
      id,
      at,
      text: String(row[c.text] ?? ""),
      from: String(row[c.from] ?? "Participante"),
    };
  });
}

export type MessageCursor = { at: string; id: string };
export function parseMessageCursor(value: unknown): MessageCursor | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 1000)
    throw new Error("Página inválida.");
  const cursor = JSON.parse(value) as MessageCursor;
  if (
    !cursor ||
    typeof cursor.at !== "string" ||
    cursor.at.length > 50 ||
    !Number.isFinite(Date.parse(cursor.at)) ||
    typeof cursor.id !== "string" ||
    !cursor.id ||
    cursor.id.length > 300
  )
    throw new Error("Página inválida.");
  return { at: cursor.at, id: cursor.id };
}

/** Bounded history window. Cursor uses the raw timestamp, preserving microseconds. */
export async function fetchHistoryPage(
  env: WhatsAppEnv,
  group: { id?: string; name?: string },
  before: MessageCursor | null = null,
) {
  if (group.id?.startsWith("z-api:")) return zApiHistory(env, group.id.slice(6), before);
  const c = whatsappColumns(env);
  const url = new URL(
    `${env.SUPABASE_URL!.replace(/\/+$/, "")}/rest/v1/${encodeURIComponent(env.WHATSAPP_TABLE || "messages")}`,
  );
  const quote = (v: string) =>
    `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  url.searchParams.set(
    group.id ? c.group : (c.groupName ?? "group_name"),
    `eq.${group.id || group.name || ""}`,
  );
  url.searchParams.set(
    "select",
    [
      ...new Set([
        c.id,
        c.at,
        c.from,
        c.text,
        c.group,
        ...(c.fromMe ? [c.fromMe] : []),
      ]),
    ].join(","),
  );
  url.searchParams.set("order", `${c.at}.desc,${c.id}.desc`);
  url.searchParams.set("limit", "51");
  if (before)
    url.searchParams.set(
      "or",
      `(${c.at}.lt.${quote(before.at)},and(${c.at}.eq.${quote(before.at)},${c.id}.lt.${quote(before.id)}))`,
    );
  const response = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY!,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY!}`,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`A base de conversas respondeu ${response.status}.`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows))
    throw new Error("Formato inesperado da base de conversas.");
  const page = rows.slice(0, 50) as Record<string, unknown>[];
  const messages = page
    .map((row) => {
      const message = mapWhatsAppRow(row, c);
      if (!message)
        throw new Error("Mensagem sem identificador ou data válida.");
      return message;
    })
    .reverse();
  const last = page.at(-1);
  return {
    messages,
    nextCursor:
      rows.length > 50 && last
        ? JSON.stringify({ at: String(last[c.at]), id: String(last[c.id]) })
        : null,
  };
}
