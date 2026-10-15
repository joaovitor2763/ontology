import test from "node:test";
import assert from "node:assert/strict";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { pruneOperationJournal } from "../src/server/operations/retention.ts";

const at = (days) => new Date(Date.now() - days * 86_400_000).toISOString();

test("the journal prune keeps every guarantee it exists for: receipts in the retry window, events a subscriber or a delivery still needs", async () => {
  const { db, sql } = sqliteD1();
  const receipt = (key, days) =>
    sql.prepare("INSERT INTO operation_receipts(workspace_id,principal_id,idempotency_key,id,command,request_hash,result,created_at) VALUES('default','member:a',?,?,'tasks.update','h','{}',?)")
      .run(key, `op-${key}`, at(days));
  const event = (sequence, days) =>
    sql.prepare("INSERT INTO operation_events(sequence,id,workspace_id,operation_id,type,company,subject,actor,application,data,created_at) VALUES(?,?,'default','op','tasks.update','santa-clara','s','member:a','web','{}',?)")
      .run(sequence, `e${sequence}`, at(days));

  receipt("recente", 3);
  receipt("no limite", 29);
  receipt("antigo", 40);
  for (const [sequence, days] of [[1, 200], [2, 150], [3, 120], [4, 10]]) event(sequence, days);
  // Uma assinatura ativa parada no evento 2: nada acima dele pode sair.
  sql.prepare("INSERT INTO webhook_subscriptions(id,workspace_id,url,secret,principal,types,active,cursor,created_at) VALUES('s1','default','https://x.test','k','member:a','[]',1,2,?)").run(at(300));
  // O evento 1 tem entrega registrada: o histórico da entrega não pode ficar órfão.
  sql.prepare("INSERT INTO webhook_deliveries(subscription_id,event_id,body,status,next_at) VALUES('s1','e1','{}','delivered',?)").run(at(200));

  const first = await pruneOperationJournal({ DB: db, WORKSPACE_ID: "default" });
  assert.equal(first.receipts, 1);
  assert.deepEqual(
    sql.prepare("SELECT idempotency_key FROM operation_receipts ORDER BY idempotency_key").all().map((r) => r.idempotency_key),
    ["no limite", "recente"],
  );
  assert.equal(first.events, 1, "só o evento 2 sai: velho, abaixo do cursor e sem entrega");
  assert.deepEqual(sql.prepare("SELECT sequence FROM operation_events ORDER BY sequence").all().map((r) => r.sequence), [1, 3, 4]);

  // Assinatura desativada: o cursor dela deixa de segurar o evento 3.
  sql.prepare("UPDATE webhook_subscriptions SET active=0 WHERE id='s1'").run();
  const second = await pruneOperationJournal({ DB: db, WORKSPACE_ID: "default" });
  assert.equal(second.events, 1);
  assert.deepEqual(sql.prepare("SELECT sequence FROM operation_events ORDER BY sequence").all().map((r) => r.sequence), [1, 4],
    "o evento com entrega registrada e o recente continuam");

  // Outro workspace não é tocado por esta poda.
  sql.prepare("INSERT INTO operation_events(sequence,id,workspace_id,operation_id,type,company,subject,actor,application,data,created_at) VALUES(9,'e9','outro','op','t','c','s','member:a','web','{}',?)").run(at(400));
  await pruneOperationJournal({ DB: db, WORKSPACE_ID: "default" });
  assert.equal(sql.prepare("SELECT count(*) n FROM operation_events WHERE workspace_id='outro'").get().n, 1);
  sql.close();
});
