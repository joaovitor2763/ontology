import test from "node:test";
import assert from "node:assert/strict";
import { aiConfigured, aiEnabled, aiStatus } from "../src/server/ai/gateway.ts";
import {
  assistantProfiles,
  fitPrompt,
  taskAssistantSystem,
  taskAssistantUser,
} from "../src/server/ai/prompts.ts";
import {
  stripFences,
  validateClassifications,
  validateDailySummary,
} from "../src/server/ai/validate.ts";

test("AI stays off until enabled and configured, and status never leaks the token", () => {
  assert.equal(aiEnabled({}), false);
  assert.equal(aiConfigured({ AI_GATEWAY_ACCOUNT_ID: "a", AI_GATEWAY_ID: "g" }), false);
  assert.equal(
    aiConfigured({ AI_GATEWAY_ACCOUNT_ID: "a", AI_GATEWAY_ID: "g", AI_GATEWAY_TOKEN: "t" }),
    true,
  );
  const status = aiStatus({ AI_ENABLED: "true", AI_GATEWAY_ID: "g", AI_GATEWAY_TOKEN: "secret" });
  assert.equal(status.enabled, true);
  assert.equal(JSON.stringify(status).includes("secret"), false);
});

test("task assistant prompts carry the guard rails and a compact context", () => {
  for (const profile of Object.keys(assistantProfiles)) {
    const system = taskAssistantSystem(profile);
    assert.match(system, /Não afirme que alterou, concluiu ou enviou nada/);
    assert.match(system, /NÃO CONFIÁVEL/);
  }
  const user = taskAssistantUser({
    delivery: { title: "Mapa", description: "x".repeat(10_000), status: "fila", dueAt: "2026-09-20" },
    client: { name: "Acme", scope: "Consultoria" },
    history: Array.from({ length: 20 }, (_, i) => ({ role: "user", content: `m${i}` })),
    message: "Prepare o plano",
  });
  assert.ok(user.length < 6000);
  assert.ok(user.includes("m19") && !user.includes("m0\n"));
});

test("classifier output is accepted only when it matches the contract exactly", () => {
  const ok = JSON.stringify({
    classifications: [
      { signalId: "s1", isPending: true, categories: ["pergunta"], priority: "media", title: "t", topic: "x", requestedAction: "responder", answeredLater: false, confidence: 0.8, reason: "r", evidenceMessageIds: ["m1"] },
    ],
  });
  const rows = validateClassifications("```json\n" + ok + "\n```", ["s1"], ["m1", "m2"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].priority, "media");
  assert.throws(() => validateClassifications(ok, ["s1", "s2"], ["m1"]), /Esperava 2/);
  const contradiction = ok.replace('"answeredLater":false', '"answeredLater":true');
  assert.throws(() => validateClassifications(contradiction, ["s1"], ["m1"]), /Contradição/);
  const badEvidence = ok.replace('"evidenceMessageIds":["m1"]', '"evidenceMessageIds":["zz"]');
  assert.throws(() => validateClassifications(badEvidence, ["s1"], ["m1"]), /desconhecido/);
  const badCategory = ok.replace('"categories":["pergunta"]', '"categories":["spam"]');
  assert.throws(() => validateClassifications(badCategory, ["s1"], ["m1"]), /Categoria inválida/);
});

test("daily summary is bounded and sentiment is validated", () => {
  const summary = validateDailySummary(
    JSON.stringify({ summary: { title: "Dia", summary: "ok", topics: Array(10).fill("t"), sentiment: "attention" } }),
  );
  assert.equal(summary.topics.length, 6);
  assert.equal(summary.sentiment, "attention");
  assert.throws(() => validateDailySummary(JSON.stringify({ summary: { sentiment: "meh" } })), /sentiment/);
  assert.equal(stripFences("```\n{}\n```"), "{}");
});

test("fitPrompt drops the oldest lines until the limit fits", () => {
  const text = fitPrompt(["a".repeat(50), "b".repeat(50), "c".repeat(50)], 110);
  assert.equal(text.startsWith("b"), true);
});
