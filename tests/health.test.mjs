import test from "node:test";
import assert from "node:assert/strict";
import {
  operationalHealth,
  isBlockedDelivery,
} from "../src/modules/clients/domain/health.ts";

const today = "2026-09-12T12:00:00";
const delivery = (id, over = {}) => ({ id, status: "fila", dueAt: "2026-09-20", ...over });
const base = () => ({
  today,
  openDeliveries: [delivery("a")],
  currentCycle: { status: "em-curso", endsAt: "2026-09-20" },
  nextStep: { text: "Workshop", dueAt: "2026-09-18" },
  openRisks: [],
});

test("a client with no pending problems is green with a full score and no reasons", () => {
  const h = operationalHealth(base());
  assert.equal(h.score, 100);
  assert.equal(h.flag, "green");
  assert.deepEqual(h.reasons, []);
  assert.equal(h.version, "v2");
});

test("one active blocker caps the score at 49 and explains itself", () => {
  const h = operationalHealth({
    ...base(),
    openDeliveries: [delivery("b", { status: "bloqueado", blockers: "Sem acesso" })],
  });
  assert.equal(h.flag, "red");
  assert.ok(h.score <= 49);
  assert.equal(h.reasons[0].code, "bloqueios");
  assert.equal(h.reasons[0].severity, "critical");
  assert.equal(h.reasons[0].points, -35);
  assert.equal(h.limit, "Pontuação limitada a 49 por bloqueio ativo.");
});

test("a resolved structured blocker no longer counts as blocked", () => {
  assert.equal(
    isBlockedDelivery({ id: "x", status: "em-curso", blockers: "antigo", blocker: { resolvedAt: "2026-09-10" } }),
    false,
  );
  assert.equal(isBlockedDelivery({ id: "y", status: "em-curso", blocker: { since: "2026-09-10" } }), true);
});

test("historical manual next-step fields do not affect operational health", () => {
  for(const nextStep of [null,{text:"x"},{text:"x",dueAt:"2020-01-01"}]) {
    const health=operationalHealth({...base(),nextStep});
    assert.equal(health.score,100);assert.deepEqual(health.reasons,[]);
  }
});

test("overdue deliveries, critical ones, late cycles, stalled acceptance and registered risks deduct with limits", () => {
  const many = operationalHealth({
    ...base(),
    openDeliveries: [1, 2, 3, 4, 5].map((n) => delivery(`d${n}`, { dueAt: "2026-09-01" })),
  });
  assert.equal(many.reasons.find((r) => r.code === "entregas-vencidas").points, -24);
  const critical = operationalHealth({
    ...base(),
    openDeliveries: [delivery("c", { dueAt: "2026-09-01", priority: "critica" })],
  });
  assert.ok(critical.reasons.some((r) => r.code === "entrega-critica-vencida"));
  const lateCycle = operationalHealth({ ...base(), currentCycle: { status: "em-curso", endsAt: "2026-08-20" } });
  const cycleReason = lateCycle.reasons.find((r) => r.code === "ciclo-atrasado");
  assert.equal(cycleReason.severity, "critical");
  assert.ok(lateCycle.score <= 49);
  const stalled = operationalHealth({
    ...base(),
    currentCycle: { status: "em-aceite", endsAt: "2026-09-01", acceptanceRequestedAt: "2026-09-01" },
  });
  assert.equal(stalled.reasons[0].code, "aceite-parado");
  assert.equal(stalled.score, 85);
  const risky = operationalHealth({ ...base(), openRisks: [{ severity: "critico" }, { severity: "critico" }, { severity: "critico" }] });
  assert.equal(risky.reasons[0].points, -40);
  assert.equal(risky.flag, "yellow");
});

test("a current cycle or a recent acceptance cannot hide another overdue cycle", () => {
  const healthyCurrent = { name: "Mapeamento de soluções", status: "em-curso", endsAt: "2026-10-28" };
  const cycles = [
    { name: "Setup", status: "em-aceite", endsAt: "2026-08-25", acceptanceRequestedAt: "2026-09-12" },
    { name: "Kickoff", status: "em-curso", endsAt: "2026-08-20" },
    healthyCurrent,
  ];
  const health = operationalHealth({ ...base(), currentCycle: healthyCurrent, cycles });
  assert.equal(health.flag, "red");
  assert.equal(health.score, 49);
  assert.equal(health.reasons.length, 1);
  assert.equal(health.reasons[0].label, "Ciclo Kickoff fora do prazo há 23 dias");
  assert.equal(health.reasons[0].points, -30);
  assert.equal(health.limit, "Pontuação limitada a 49 por ciclo atrasado há mais de 7 dias.");
});

test("cycle delays and acceptance waits each deduct once across all cycles", () => {
  const health = operationalHealth({ ...base(), cycles: [
    { name: "Concluído", status: "concluido", endsAt: "2026-01-01" },
    { name: "Kickoff", status: "planejado", endsAt: "2026-09-01" },
    { name: "Setup", status: "em-curso", endsAt: "2026-09-02" },
    { name: "Diagnóstico", status: "em-aceite", endsAt: "2026-08-01", acceptanceRequestedAt: "2026-09-03" },
    { name: "Piloto", status: "em-aceite", endsAt: "2026-08-01", acceptanceRequestedAt: "2026-09-04" },
  ] });
  assert.deepEqual(health.reasons.map(reason => reason.points), [-30, -15]);
  assert.match(health.reasons[1].label, /Diagnóstico.*9 dias/);
});

test("completed cycles and acceptance within five days do not penalize a current cycle", () => {
  const health = operationalHealth({ ...base(), cycles: [
    { status: "concluido", endsAt: "2026-01-01" },
    { status: "em-aceite", endsAt: "2026-08-01", acceptanceRequestedAt: "2026-09-07" },
    { status: "em-curso", endsAt: "2026-09-20" },
  ] });
  assert.equal(health.score, 100);
  assert.deepEqual(health.reasons, []);
  assert.equal(health.limit, undefined);
});

test("a cap is not explained as a further deduction when the score is already below it", () => {
  const health = operationalHealth({ ...base(),
    openDeliveries: [delivery("blocked", { status: "bloqueado" }), delivery("late", { dueAt: "2026-09-01", priority: "critica" })],
    cycles: [{ status: "em-curso", endsAt: "2026-08-01" }],
  });
  assert.ok(health.score < 49);
  assert.equal(health.limit, undefined);
});
