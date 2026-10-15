/**
 * D1 access for the state documents, users, memberships and file metadata.
 * All statements are prepared; version checks make concurrent saves safe.
 */
import { forgetDocuments, loadDocuments, rememberDocument } from "./operations/request-context.ts";
import { encodeStateBody } from "./state-body.ts";

export type StoredDoc = { value: unknown; version: number; updatedAt: string };

/** Uma leitura por chave e por requisição: ver `operations/request-context.ts`. */
export async function getDoc(
  db: D1Database,
  workspace: string,
  key: string,
): Promise<StoredDoc | null> {
  return (await loadDocuments(db, workspace, [key]))[0];
}

export type PutResult =
  | { ok: true; version: number }
  | { ok: false; conflict: StoredDoc };

/**
 * Writes a document only when the caller saw the current version.
 * `baseVersion` 0 creates the document; any mismatch returns the live copy.
 */
export async function putDoc(
  db: D1Database,
  workspace: string,
  key: string,
  value: unknown,
  baseVersion: number,
  by: string | null,
): Promise<PutResult> {
  const body = await encodeStateBody(value);
  const now = new Date().toISOString();
  const current = await getDoc(db, workspace, key);
  const saved = (version: number) => {
    forgetDocuments(db);
    rememberDocument(db, workspace, key, { value, version, updatedAt: now });
    return { ok: true as const, version };
  };
  if (!current) {
    if (baseVersion !== 0) return { ok: false, conflict: { value: null, version: 0, updatedAt: now } };
    try {
      await db.batch([
        db
          .prepare(
            "INSERT INTO state_documents (workspace_id, key, version, body, updated_at, updated_by) VALUES (?, ?, 1, ?, ?, ?)",
          )
          .bind(workspace, key, body, now, by),
        db
          .prepare(
            "INSERT INTO state_history (workspace_id, key, version, updated_at, updated_by, body) VALUES (?, ?, 1, ?, ?, ?)",
          )
          .bind(workspace, key, now, by, body),
      ]);
      return saved(1);
    } catch {
      forgetDocuments(db);
      const live = await getDoc(db, workspace, key);
      return { ok: false, conflict: live ?? { value: null, version: 0, updatedAt: now } };
    }
  }
  if (current.version !== baseVersion) return { ok: false, conflict: current };
  const next = current.version + 1;
  const result = await db
    .prepare(
      "UPDATE state_documents SET version = ?, body = ?, updated_at = ?, updated_by = ? WHERE workspace_id = ? AND key = ? AND version = ?",
    )
    .bind(next, body, now, by, workspace, key, baseVersion)
    .run();
  if (!result.meta.changes) {
    forgetDocuments(db);
    const live = await getDoc(db, workspace, key);
    return { ok: false, conflict: live ?? current };
  }
  await db
    .prepare(
      "INSERT INTO state_history (workspace_id, key, version, updated_at, updated_by, body) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(workspace, key, next, now, by, body)
    .run();
  // Keep the last 50 versions per key.
  await db
    .prepare(
      "DELETE FROM state_history WHERE workspace_id = ? AND key = ? AND version <= ?",
    )
    .bind(workspace, key, next - 50)
    .run();
  return saved(next);
}

/**
 * `touchUser` grava três comandos; chamado em toda carga de página ele era a
 * única escrita do caminho de leitura. O registro de "entrou" só precisa ser
 * verdadeiro uma vez por hora por pessoa: a primeira requisição de cada
 * isolate grava, as seguintes só releem.
 */
const touched = new Map<string, number>();
const TOUCH_EVERY = 60 * 60 * 1000;
export async function touchUserThrottled(
  db: D1Database,
  workspace: string,
  user: { email: string; name: string },
) {
  const id = `${workspace} ${user.email.toLowerCase()}`;
  const last = touched.get(id) ?? 0;
  if (Date.now() - last < TOUCH_EVERY) return `user-${user.email.toLowerCase()}`;
  touched.set(id, Date.now());
  try {
    return await touchUser(db, workspace, user);
  } catch (error) {
    touched.delete(id);
    throw error;
  }
}

export async function touchUser(
  db: D1Database,
  workspace: string,
  user: { email: string; name: string },
) {
  const id = `user-${user.email.toLowerCase()}`;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO workspaces (id, name) VALUES (?, ?)").bind(
      workspace,
      "Meu workspace",
    ),
    db
      .prepare(
        "INSERT INTO users (id, email, name, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name, last_seen_at = excluded.last_seen_at",
      )
      .bind(id, user.email.toLowerCase(), user.name, now),
    db
      .prepare(
        "INSERT OR IGNORE INTO memberships (workspace_id, user_id, member_id, access) VALUES (?, ?, ?, ?)",
      )
      .bind(workspace, id, id, "membro"),
  ]);
  return id;
}

export type FileRow = {
  id: string;
  r2_key: string;
  name: string;
  mime: string | null;
  size: number;
};

export async function getFileRow(db: D1Database, workspace: string, id: string) {
  return db
    .prepare(
      "SELECT id, r2_key, name, mime, size FROM files WHERE workspace_id = ? AND id = ?",
    )
    .bind(workspace, id)
    .first<FileRow>();
}

export async function insertFileRow(
  db: D1Database,
  workspace: string,
  row: FileRow & { createdBy: string | null },
) {
  await db
    .prepare(
      "INSERT INTO files (id, workspace_id, r2_key, name, mime, size, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET r2_key = excluded.r2_key, name = excluded.name, mime = excluded.mime, size = excluded.size",
    )
    .bind(row.id, workspace, row.r2_key, row.name, row.mime, row.size, row.createdBy)
    .run();
}

export async function deleteFileRow(db: D1Database, workspace: string, id: string) {
  await db
    .prepare("DELETE FROM files WHERE workspace_id = ? AND id = ?")
    .bind(workspace, id)
    .run();
}
