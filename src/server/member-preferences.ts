/**
 * Preferências pessoais de interface, guardadas por pessoa no D1. Não são
 * dados do cliente nem passam pela matriz de permissões: cada pessoa lê e
 * grava só as próprias, identificada pela sessão.
 */
export const PREFERENCE_KEY = /^[a-z][a-z0-9-]{0,39}(?:\.[a-z0-9-]{1,40}){0,2}$/;
export const PREFERENCE_MAX_BYTES = 16 * 1024;
const MAX_KEYS = 200;

export type PreferenceEntry = { value: unknown; updatedAt: string };

export async function readPreferences(db: D1Database, workspace: string, email: string) {
  const { results } = await db
    .prepare("SELECT key, value, updated_at FROM member_preferences WHERE workspace_id = ? AND email = ? ORDER BY key LIMIT ?")
    .bind(workspace, email.toLowerCase(), MAX_KEYS)
    .all<{ key: string; value: string; updated_at: string }>();
  const preferences: Record<string, PreferenceEntry> = {};
  for (const row of results ?? []) {
    try { preferences[row.key] = { value: JSON.parse(row.value), updatedAt: row.updated_at }; } catch { /* linha corrompida é ignorada */ }
  }
  return preferences;
}

export type PreferenceWrite =
  | { ok: true; updatedAt: string }
  | { ok: false; status: number; message: string };

/**
 * Grava a preferência com o relógio do servidor: vence a última gravação que
 * chega, sem depender do relógio de cada aparelho. Devolve o carimbo salvo.
 */
export async function writePreference(
  db: D1Database,
  workspace: string,
  email: string,
  input: { key?: unknown; value?: unknown },
): Promise<PreferenceWrite> {
  if (typeof input.key !== "string" || !PREFERENCE_KEY.test(input.key))
    return { ok: false, status: 400, message: "Chave de preferência inválida." };
  if (input.value === undefined) return { ok: false, status: 400, message: "Informe value." };
  const raw = JSON.stringify(input.value);
  if (new TextEncoder().encode(raw).byteLength > PREFERENCE_MAX_BYTES)
    return { ok: false, status: 413, message: "Preferência maior que 16 KB." };
  const stamp = new Date().toISOString();
  const owner = email.toLowerCase();
  const count = await db
    .prepare("SELECT count(*) AS n, sum(key = ?) AS present FROM member_preferences WHERE workspace_id = ? AND email = ?")
    .bind(input.key, workspace, owner)
    .first<{ n: number; present: number | null }>();
  if (count && count.n >= MAX_KEYS && !count.present)
    return { ok: false, status: 409, message: "Limite de preferências atingido." };
  await db
    .prepare(
      `INSERT INTO member_preferences (workspace_id, email, key, value, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, email, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(workspace, owner, input.key, raw, stamp)
    .run();
  return { ok: true, updatedAt: stamp };
}
