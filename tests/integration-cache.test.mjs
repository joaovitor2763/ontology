import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  cachedIntegration,
  invalidateIntegration,
} from "../src/server/integration-cache.ts";
function setup() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    readFileSync(
      new URL("../migrations/0007_integration_cache.sql", import.meta.url),
      "utf8",
    ),
  );
  const db = {
    prepare(q) {
      let a = [];
      return {
        bind(...v) {
          a = v;
          return this;
        },
        async first() {
          return sql.prepare(q).get(...a) ?? null;
        },
        async run() {
          return { meta: sql.prepare(q).run(...a) };
        },
      };
    },
  };
  return { db, sql };
}
test("integration cache reuses fresh reads and isolates workspaces", async () => {
  const { db } = setup();
  let calls = 0;
  const load = async () => ({ count: ++calls });
  assert.equal(
    (await cachedIntegration(db, "a", "key", load, { ttl: 60000 })).value.count,
    1,
  );
  assert.equal(
    (await cachedIntegration(db, "a", "key", load, { ttl: 60000 })).value.count,
    1,
  );
  assert.equal(
    (await cachedIntegration(db, "b", "key", load, { ttl: 60000 })).value.count,
    2,
  );
  await invalidateIntegration(db, "a", "key");
  assert.equal(
    (await cachedIntegration(db, "a", "key", load, { ttl: 60000 })).value.count,
    3,
  );
});
test("only one refresh runs across callers; invalidation cannot be resurrected", async () => {
  const { db, sql } = setup();
  let release, started;
  const ready = new Promise((r) => {
    started = r;
  });
  const pending = cachedIntegration(
    db,
    "a",
    "key",
    async () => {
      started();
      return new Promise((r) => {
        release = r;
      });
    },
    { ttl: 60000 },
  );
  await ready;
  await assert.rejects(
    cachedIntegration(
      db,
      "a",
      "key",
      async () => {
        throw Error("duplicate");
      },
      { ttl: 60000 },
    ),
    /Atualização em andamento/,
  );
  await invalidateIntegration(db, "a", "key");
  release({ value: 1 });
  await pending;
  assert.equal(
    sql.prepare("SELECT COUNT(*) n FROM integration_cache").get().n,
    0,
  );
});
test("stale pages return immediately and refresh in background; failures retain the last read", async () => {
  const { db, sql } = setup();
  let work;
  await cachedIntegration(db, "a", "page", async () => ({ value: 1 }), {
    ttl: 60000,
  });
  sql.exec("UPDATE integration_cache SET expires_at=0");
  // Freshness window is relative to expiry, and explicitly bounded.
  const options = {
    ttl: 60000,
    staleFor: Date.now() + 1000,
    background: (p) => {
      work = p;
    },
  };
  const old = await cachedIntegration(
    db,
    "a",
    "page",
    async () => ({ value: 2 }),
    options,
  );
  assert.equal(old.value.value, 1);
  assert.equal(old.stale, true);
  await work;
  assert.equal(
    (
      await cachedIntegration(
        db,
        "a",
        "page",
        async () => {
          throw Error("should not fetch");
        },
        options,
      )
    ).value.value,
    2,
  );
  sql.exec("UPDATE integration_cache SET expires_at=0");
  const stale = await cachedIntegration(
    db,
    "a",
    "page",
    async () => {
      throw Error("provider down");
    },
    { ...options, background: undefined, force: true },
  );
  assert.equal(stale.value.value, 2);
  assert.equal(stale.stale, true);
});

test("expired cached pages are not served beyond the permitted stale window", async () => {
  const { db, sql } = setup();
  await cachedIntegration(db, "a", "page", async () => ({ value: 1 }), {
    ttl: 60000,
  });
  sql.exec("UPDATE integration_cache SET expires_at=0");
  await assert.rejects(
    cachedIntegration(
      db,
      "a",
      "page",
      async () => {
        throw Error("offline");
      },
      { ttl: 60000, staleFor: 60000 },
    ),
    /offline/,
  );
});
