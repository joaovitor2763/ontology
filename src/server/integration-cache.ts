type CacheRow = { body: string | null; fetched_at: number; expires_at: number };
export type CachedResult<T> = { value: T; fetchedAt: number; stale: boolean };
/** Workspace-scoped source cache. A D1 lease coalesces requests across Worker instances. */
export async function cachedIntegration<T>(
  db: D1Database,
  workspace: string,
  key: string,
  load: () => Promise<T>,
  options: {
    ttl: number;
    staleFor?: number;
    background?: (work: Promise<unknown>) => void;
    force?: boolean;
  },
): Promise<CachedResult<T>> {
  const now = Date.now();
  const row = await db
    .prepare(
      "SELECT body,fetched_at,expires_at FROM integration_cache WHERE workspace_id=? AND key=?",
    )
    .bind(workspace, key)
    .first<CacheRow>();
  const old =
    row?.body && now - row.expires_at <= (options.staleFor ?? 0)
      ? {
          value: JSON.parse(row.body) as T,
          fetchedAt: row.fetched_at,
          stale: now >= row.expires_at,
        }
      : null;
  if (old && !options.force && row!.expires_at > now) return old;
  const owner = crypto.randomUUID();
  const claim = await db
    .prepare(
      `INSERT INTO integration_cache(workspace_id,key,lease_owner,lease_until) VALUES(?,?,?,?)
    ON CONFLICT(workspace_id,key) DO UPDATE SET lease_owner=excluded.lease_owner,lease_until=excluded.lease_until
    WHERE integration_cache.lease_until<=? RETURNING key`,
    )
    .bind(workspace, key, owner, now + 60000, now)
    .first();
  if (!claim) {
    if (old) return { ...old, stale: true };
    throw new Error(
      "Atualização em andamento. Aguarde alguns segundos e tente novamente.",
    );
  }
  async function refresh(): Promise<CachedResult<T>> {
    try {
      const value = await load(),
        at = Date.now(),
        body = JSON.stringify(value);
      // Keep large message payloads out of D1's row-size limit.
      if (new TextEncoder().encode(body).length < 500000)
        await db
          .prepare(
            "UPDATE integration_cache SET body=?,fetched_at=?,expires_at=?,lease_until=0 WHERE workspace_id=? AND key=? AND lease_owner=?",
          )
          .bind(body, at, at + options.ttl, workspace, key, owner)
          .run();
      else
        await db
          .prepare(
            "DELETE FROM integration_cache WHERE workspace_id=? AND key=? AND lease_owner=?",
          )
          .bind(workspace, key, owner)
          .run();
      return { value, fetchedAt: at, stale: false };
    } catch (error) {
      // Brief failure cooldown prevents a provider outage becoming a request storm.
      await db
        .prepare(
          "UPDATE integration_cache SET lease_until=? WHERE workspace_id=? AND key=? AND lease_owner=?",
        )
        .bind(Date.now() + 30000, workspace, key, owner)
        .run();
      if (old) return { ...old, stale: true };
      throw error;
    }
  }
  if (old && options.background && !options.force) {
    options.background(refresh().catch(() => {}));
    return { ...old, stale: true };
  }
  return refresh();
}
export async function invalidateIntegration(
  db: D1Database,
  workspace: string,
  key: string,
) {
  await db
    .prepare("DELETE FROM integration_cache WHERE workspace_id=? AND key=?")
    .bind(workspace, key)
    .run();
}
