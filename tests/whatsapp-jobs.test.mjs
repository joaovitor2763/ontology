import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { enqueueSync, processWhatsApp } from "../src/server/whatsapp-jobs.ts";
function setup() {
  const sql = new DatabaseSync(":memory:");
  for (const name of ["0001_init", "0002_ai_runs", "0005_insights", "0008_whatsapp_incremental", "0010_insight_sources"])
    sql.exec(
      readFileSync(
        new URL(`../migrations/${name}.sql`, import.meta.url),
        "utf8",
      ),
    );
  sql.exec("INSERT INTO workspaces(id,name) VALUES ('w','test')");
  const value = {
    configs: { client: { whatsapp: { groupName: "A, B & C" } } },
  };
  sql
    .prepare(
      "INSERT INTO state_documents(workspace_id,key,version,body) VALUES ('w','ontology.clients.v3',1,?)",
    )
    .run(JSON.stringify(value));
  const db = {
    prepare(query) {
      let args = [];
      return {
        bind(...v) {
          args = v;
          return this;
        },
        async first() {
          return sql.prepare(query).get(...args) ?? null;
        },
        async all() {
          return { results: sql.prepare(query).all(...args) };
        },
        async run() {
          return { meta: sql.prepare(query).run(...args) };
        },
      };
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sql.exec("COMMIT");
        return results;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return {
    sql,
    env: {
      DB: db,
      WORKSPACE_ID: "w",
      WHATSAPP_ENABLED: "true",
      SUPABASE_URL: "https://source.test",
      SUPABASE_SERVICE_KEY: "placeholder",
      WHATSAPP_GROUP_NAME_COLUMN: "fonte",
      WHATSAPP_FROM_COLUMN: "sender",
      WHATSAPP_TEXT_COLUMN: "text",
      AI_ENABLED: "true",
      AI_GATEWAY_ACCOUNT_ID: "account",
      AI_GATEWAY_ID: "gateway",
      AI_GATEWAY_TOKEN: "placeholder",
    },
  };
}
test("import resumes across pages, keeps source precision, and creates only pending daily insights", async () => {
  const { sql, env } = setup(),
    original = fetch;
  let page = 0,
    analyses = 0;
  const at = new Date(Date.now() - 86400000).toISOString();
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("source.test")) {
      const u = new URL(url);
      assert.equal(u.searchParams.get("fonte"), "eq.A, B & C");
      page++;
      return Response.json(
        page === 1
          ? Array.from({ length: 100 }, (_, i) => ({
              id: i + 1,
              created_at: at,
              sender: "Someone",
              text: "Example",
            }))
          : page === 2
            ? [{ id: 101, created_at: at, sender: "Someone", text: "Example" }]
            : [],
      );
    }
    analyses++;
    assert.equal(JSON.parse(init.body).store, false);
    return Response.json({
      status: "completed",
      model: "gpt-5.6-luna",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                summary: "Daily facts",
                decisions: [],
                actions: [],
                risks: [],
                questions: [],
              }),
            },
          ],
        },
      ],
    });
  };
  try {
    const first = await enqueueSync(env, "client", 30, "tester");
    assert.equal(await enqueueSync(env, "client", 30, "tester"), first);
    for (let n = 0; n < 4; n++) await processWhatsApp(env);
    assert.equal(
      sql.prepare("SELECT count(*) AS n FROM whatsapp_messages").get().n,
      101,
    );
    assert.equal(
      sql.prepare("SELECT status FROM whatsapp_jobs").get().status,
      "complete",
    );
    assert.equal(analyses, 2);
    assert.deepEqual(
      sql
        .prepare("SELECT DISTINCT status FROM ai_suggestions")
        .all()
        .map((x) => x.status),
      ["pending"],
    );
    assert.equal(
      sql.prepare("SELECT count(*) AS n FROM ai_generation_locks").get().n,
      0,
    );
  } finally {
    globalThis.fetch = original;
    sql.close();
  }
});
test("a group changed after enqueue is cancelled before any external read", async () => {
  const { sql, env } = setup();
  await enqueueSync(env, "client", 30, "tester");
  sql.prepare("UPDATE state_documents SET body=?").run(
    JSON.stringify({
      configs: { client: { whatsapp: { groupName: "other" } } },
    }),
  );
  await processWhatsApp(env);
  assert.equal(
    sql.prepare("SELECT status FROM whatsapp_jobs").get().status,
    "cancelled",
  );
  sql.close();
});

test("new group replaces an old queued import immediately", async () => {
  const { sql, env } = setup();
  const previous = await enqueueSync(env, "client", 30, "tester");
  sql.prepare("UPDATE state_documents SET body=?").run(
    JSON.stringify({
      configs: { client: { whatsapp: { groupName: "New group" } } },
    }),
  );
  const next = await enqueueSync(env, "client", 30, "tester");
  assert.notEqual(next, previous);
  assert.equal(
    sql.prepare("SELECT status FROM whatsapp_jobs WHERE id=?").get(previous)
      .status,
    "cancelled",
  );
  assert.equal(
    sql.prepare("SELECT group_key FROM whatsapp_jobs WHERE id=?").get(next)
      .group_key,
    "name:New group",
  );
  sql.close();
});

test("waiting for AI does not prevent a later import", async () => {
  const { sql, env } = setup(),
    original = fetch;
  env.AI_ENABLED = "false";
  globalThis.fetch = async () => Response.json([]);
  try {
    const first = await enqueueSync(env, "client", 30, "tester");
    await processWhatsApp(env);
    assert.equal(
      sql.prepare("SELECT phase FROM whatsapp_jobs WHERE id=?").get(first)
        .phase,
      "summary",
    );
    const next = await enqueueSync(env, "client", 2, "tester");
    assert.notEqual(next, first);
    await processWhatsApp(env);
    assert.equal(
      sql.prepare("SELECT phase FROM whatsapp_jobs WHERE id=?").get(next).phase,
      "summary",
    );
  } finally {
    globalThis.fetch = original;
    sql.close();
  }
});

test("cancelled job cannot persist an analysis returned by an in-flight provider", async () => {
  const { sql, env } = setup(),
    original = fetch;
  const at = new Date(Date.now() - 86400000).toISOString();
  globalThis.fetch = async (url) => {
    if (String(url).includes("source.test"))
      return Response.json([
        { id: 1, created_at: at, sender: "Someone", text: "Example" },
      ]);
    sql.prepare("UPDATE state_documents SET body=?").run(
      JSON.stringify({
        configs: { client: { whatsapp: { groupName: "New group" } } },
      }),
    );
    await enqueueSync(env, "client", 30, "tester");
    return Response.json({
      status: "completed",
      model: "gpt-5.6-luna",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                summary: "Old group",
                decisions: [],
                actions: [],
                risks: [],
                questions: [],
              }),
            },
          ],
        },
      ],
    });
  };
  try {
    await enqueueSync(env, "client", 30, "tester");
    await processWhatsApp(env);
    assert.equal(
      sql.prepare("SELECT count(*) AS n FROM ai_suggestions").get().n,
      0,
    );
  } finally {
    globalThis.fetch = original;
    sql.close();
  }
});

test("a longer history request replaces a shorter active window", async () => {
  const { sql, env } = setup();
  const short = await enqueueSync(env, "client", 2, "tester");
  const long = await enqueueSync(env, "client", 365, "tester");
  assert.notEqual(short, long);
  assert.equal(
    sql.prepare("SELECT status FROM whatsapp_jobs WHERE id=?").get(short)
      .status,
    "cancelled",
  );
  assert.ok(
    Date.parse(
      sql.prepare("SELECT since FROM whatsapp_jobs WHERE id=?").get(long).since,
    ) <=
      Date.now() - 365 * 86400000,
  );
  sql.close();
});

test("cancelled fetch does not write old group messages", async () => {
  const { sql, env } = setup(),
    original = fetch;
  globalThis.fetch = async () => {
    sql
      .prepare("UPDATE state_documents SET body=?")
      .run(
        JSON.stringify({
          configs: { client: { whatsapp: { groupName: "Replacement" } } },
        }),
      );
    await enqueueSync(env, "client", 30, "tester");
    return Response.json([
      {
        id: 1,
        created_at: new Date().toISOString(),
        sender: "Someone",
        text: "Old group",
      },
    ]);
  };
  try {
    await enqueueSync(env, "client", 30, "tester");
    await processWhatsApp(env);
    assert.equal(
      sql.prepare("SELECT count(*) AS n FROM whatsapp_messages").get().n,
      0,
    );
  } finally {
    globalThis.fetch = original;
    sql.close();
  }
});

test("manual sync reuses imported windows and expands history with bounded requests", async () => {
  const { sql, env } = setup(), original = fetch;
  env.AI_ENABLED = "false";
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(new URL(url)); return Response.json([]); };
  try {
    const first = await enqueueSync(env, "client", 30, "tester");
    await processWhatsApp(env);
    const old = sql.prepare("SELECT * FROM whatsapp_jobs WHERE id=?").get(first);
    assert.equal(old.phase, "summary");
    urls.length = 0;
    const next = await enqueueSync(env, "client", 30, "tester");
    let job = sql.prepare("SELECT * FROM whatsapp_jobs WHERE id=?").get(next);
    const ranges = JSON.parse(job.import_ranges);
    assert.equal(ranges.length, 1);
    assert.equal(Date.parse(job.until_at)-Date.parse(ranges[0].since), 5*60000);
    await processWhatsApp(env);
    assert.equal(urls.length, 1);
    assert.ok(urls[0].searchParams.get("and").includes(ranges[0].since));
    urls.length = 0;
    const longer = await enqueueSync(env, "client", 90, "tester");
    job = sql.prepare("SELECT * FROM whatsapp_jobs WHERE id=?").get(longer);
    const gaps = JSON.parse(job.import_ranges);
    assert.equal(gaps.length, 2);
    assert.equal(gaps[0].until, old.since);
    await processWhatsApp(env);
    assert.equal(urls.length, 2);
    assert.ok(urls[0].searchParams.get("and").includes(old.since));
    assert.ok(urls[1].searchParams.get("and").includes(gaps[1].since));
  } finally { globalThis.fetch = original; sql.close(); }
});

test("failed partial imports do not count as complete coverage", async () => {
  const { sql, env } = setup();
  try {
    const first = await enqueueSync(env, "client", 30, "tester");
    sql.prepare("UPDATE whatsapp_jobs SET status='failed' WHERE id=?").run(first);
    const next = await enqueueSync(env, "client", 30, "tester");
    const job = sql.prepare("SELECT * FROM whatsapp_jobs WHERE id=?").get(next);
    assert.deepEqual(JSON.parse(job.import_ranges), [{since:job.since,until:job.until_at}]);
  } finally { sql.close(); }
});
