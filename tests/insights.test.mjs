import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { parseInsight } from "../src/modules/engagement/domain/insights.ts";
import { aiGatewayProvider } from "../src/server/ai/gateway.ts";
import { can } from "../src/modules/workspace/domain/permissions.ts";
const result = {
  summary: "Resumo factual",
  decisions: [],
  actions: ["Conferir evidência"],
  risks: [],
  questions: [],
};
test("AI output has bounded, explicit arrays and cannot pass malformed structures", () => {
  assert.deepEqual(parseInsight(JSON.stringify(result)), result);
  for (const invalid of [
    { ...result, summary: "" },
    { ...result, actions: [{ tool: "execute" }] },
    { ...result, risks: Array(13).fill("x") },
  ])
    assert.throws(() => parseInsight(JSON.stringify(invalid)));
});
test("readers and unallocated masters cannot generate or review insights", () => {
  for (const action of ["ia.analisar", "ia.revisar", "whatsapp.sincronizar"]) {
    assert.equal(
      can({ access: "leitor", memberId: "m" }, action, {
        responsibleIds: ["m"],
      }),
      false,
    );
    assert.equal(can({ access: "ai_master", memberId: "m" }, action), false);
    assert.equal(
      can({ access: "ai_master", memberId: "m" }, action, {
        responsibleIds: ["m"],
      }),
      true,
    );
  }
});
test("Responses gateway selects BYOK alias, disables storage, and rejects incomplete output", async () => {
  const original = fetch;
  let payload, headers;
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(init.body);
    headers = init.headers;
    return Response.json({
      status: "completed",
      output: [
        { type: "message", content: [{ type: "output_text", text: "OK" }] },
      ],
    });
  };
  try {
    const p = aiGatewayProvider({
      AI_GATEWAY_TOKEN: "placeholder",
      AI_GATEWAY_KEY_ALIAS: "company-key",
    });
    assert.equal(
      (
        await p.complete({
          system: "s",
          messages: [{ role: "user", content: "u" }],
        })
      ).text,
      "OK",
    );
    assert.equal(payload.model, "gpt-5.6-luna");
    assert.equal(payload.store, false);
    assert.equal(headers["cf-aig-byok-alias"], "company-key");
    globalThis.fetch = async () =>
      Response.json({ status: "incomplete", output: [] });
    await assert.rejects(p.complete({ system: "s", messages: [] }));
  } finally {
    globalThis.fetch = original;
  }
});
test("D1 prevents parallel imports and duplicate insights, and review is single-use", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../migrations/0005_insights.sql", import.meta.url),
      "utf8",
    ),
  );
  const job = db.prepare(
    "INSERT INTO whatsapp_jobs(id,workspace_id,company,group_key,group_json,since,until_at,created_at,updated_at,requested_by) VALUES (?,'w','c','g','{}','s','u','a','a','x')",
  );
  job.run("1");
  assert.throws(() => job.run("2"));
  db.exec("UPDATE whatsapp_jobs SET status='complete'");
  job.run("2");
  const insert = db.prepare(
    "INSERT INTO ai_suggestions(id,workspace_id,company,source_kind,source_id,source_hash,title,body,evidence,model,created_at) VALUES (?,'w','c','whatsapp','s','hash','t','{}','[]','m','a')",
  );
  insert.run("a");
  assert.throws(() => insert.run("b"));
  const review = db.prepare(
    "UPDATE ai_suggestions SET status='accepted' WHERE id='a' AND status='pending'",
  );
  assert.equal(review.run().changes, 1);
  assert.equal(review.run().changes, 0);
  const plan = db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT id FROM whatsapp_messages WHERE workspace_id='w' AND company='c' AND group_key='g' AND at>'x' ORDER BY at,id LIMIT 100",
    )
    .all();
  assert.ok(plan.some((r) => r.detail.includes("whatsapp_messages_time")));
  db.close();
});

const aiEnv = { AI_ENABLED: 'true', AI_GATEWAY_ACCOUNT_ID: 'test', AI_GATEWAY_ID: 'test', AI_GATEWAY_TOKEN: 'test' };
function insightDb() {
  const sql = new DatabaseSync(':memory:');
  for (const file of ['0002_ai_runs.sql', '0005_insights.sql', '0010_insight_sources.sql'])
    sql.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const db = { prepare(query) { return { bind(...args) {
    return { async first() { return sql.prepare(query).get(...args) ?? null; }, async run() { return { meta: sql.prepare(query).run(...args) }; } };
  } }; } };
  db.batch=async statements=>{sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}};
  return { sql, db };
}
const input = { workspace: 'w', company: 'c', kind: 'meeting', sourceId: 'm', title: 'Reunião', text: 'Decisão registrada.', evidence: ['up-original'] };
const aiResponse = () => Response.json({ status: 'completed', model: 'test', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }], usage: {} });

test('identical content reuses reviewed analyses even when a new document version supplies it', async (t) => {
  const { generateInsight } = await import('../src/server/insights.ts');
  const { sql, db } = insightDb();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return aiResponse(); });
  const first = await generateInsight(db, aiEnv, input);
  sql.exec("UPDATE ai_suggestions SET status='accepted'");
  const second = await generateInsight(db, aiEnv, { ...input, text: '\r\nDecisão registrada.  \r\n', evidence: ['up-version2'] });
  assert.equal(second.id, first.id);
  assert.equal(second.reused, true);
  assert.equal(second.status, 'accepted');
  assert.equal(calls, 1);
  assert.equal(sql.prepare('SELECT status,source_text FROM ai_suggestions').get().status, 'accepted');
  assert.equal(sql.prepare('SELECT source_text FROM ai_suggestions').get().source_text, input.text);
  sql.close();
});

test('changed meeting content requires confirmation tied to the exact new source', async (t) => {
  const { generateInsight, digest, normalizedInsightText, InsightSourceChangedError } = await import('../src/server/insights.ts');
  const { sql, db } = insightDb();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return aiResponse(); });
  await generateInsight(db, aiEnv, input);
  const changed = { ...input, text: 'Uma nova decisão.' };
  await assert.rejects(generateInsight(db, aiEnv, changed), InsightSourceChangedError);
  await assert.rejects(generateInsight(db, aiEnv, { ...changed, confirmedHash: 'outdated' }), InsightSourceChangedError);
  assert.equal(calls, 1);
  await generateInsight(db, aiEnv, { ...changed, confirmedHash: await digest(normalizedInsightText(changed.text)) });
  assert.equal(calls, 2);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM ai_suggestions').get().n, 2);
  sql.close();
});

test('concurrent requests for the same input call the provider once', async (t) => {
  const { generateInsight } = await import('../src/server/insights.ts');
  const { sql, db } = insightDb();
  let release, started;
  const waiting = new Promise((resolve) => { started = resolve; });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; started(); await new Promise((resolve) => { release = resolve; }); return aiResponse(); });
  const first = generateInsight(db, aiEnv, input);
  await waiting;
  await assert.rejects(generateInsight(db, aiEnv, input), /andamento/);
  release();
  await first;
  assert.equal(calls, 1);
  sql.close();
});

test('source inspection returns the saved input and stays scoped to its workspace and client', async (t) => {
  const { generateInsight } = await import('../src/server/insights.ts');
  const { insightSource } = await import('../src/server/insight-source.ts');
  const { sql, db } = insightDb();
  t.mock.method(globalThis, 'fetch', async () => aiResponse());
  const { id } = await generateInsight(db, aiEnv, input);
  const source = await insightSource(db, undefined, 'w', 'c', id);
  assert.equal(source.text, input.text);
  assert.equal(source.documentId, 'up-original');
  assert.equal(source.meetingId, 'm');
  assert.equal(await insightSource(db, undefined, 'other', 'c', id), null);
  assert.equal(await insightSource(db, undefined, 'w', 'other', id), null);
  sql.close();
});


test('analysis and execution audit roll back together if audit persistence fails',async t=>{
 const {generateInsight}=await import('../src/server/insights.ts');
 const {sql,db}=insightDb();t.after(()=>sql.close());
 t.mock.method(globalThis,'fetch',async()=>aiResponse());
 sql.exec("CREATE TRIGGER reject_run BEFORE INSERT ON ai_runs BEGIN SELECT RAISE(ABORT,'audit_unavailable'); END");
 await assert.rejects(generateInsight(db,aiEnv,input),/audit_unavailable/);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM ai_suggestions').get().n,0);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM ai_runs').get().n,0);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM ai_generation_locks').get().n,0);
});
