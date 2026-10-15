import test from "node:test";
import assert from "node:assert/strict";
import {
  awaitingApproval,
  inferEvidence,
} from "../src/modules/delivery/domain/evidence.ts";
import { deliveryPatchError } from "../src/modules/delivery/domain/delivery-policy.ts";

const task = (over = {}) => ({
  title: "Entrevistas com stakeholders",
  status: "fila",
  dueAt: "2026-09-20",
  ...over,
});

test("a linked and approved document validates a completed delivery", () => {
  const r = inferEvidence(task({ status: "entregue" }), {
    documents: [{ kind: "entregavel", relatedTaskId: "t", reviewStatus: "aprovado" }],
  });
  assert.equal(r.status, "validada");
  assert.equal(r.source, "documento_aprovado");
});

test("a linked document on an open delivery says evidence is available", () => {
  const r = inferEvidence(task(), {
    documents: [{ kind: "evidencia", relatedTaskId: "t" }],
  });
  assert.equal(r.status, "evidencia_disponivel");
  assert.equal(r.source, "documento");
});

test("system state proves work by title: responsible, conversation, contract, meeting, acceptance", () => {
  assert.equal(
    inferEvidence(task({ title: "Definir responsável principal" }), { leadId: "marina" }).source,
    "responsavel",
  );
  assert.equal(
    inferEvidence(task({ title: "Criar grupo oficial no WhatsApp" }), { hasThread: true }).source,
    "conversa",
  );
  assert.equal(
    inferEvidence(task({ title: "Anexar proposta e contrato" }), {
      documents: [{ kind: "contrato" }],
    }).source,
    "contrato",
  );
  assert.equal(
    inferEvidence(task({ title: "Realizar kickoff" }), { meetings: ["2026-09-02T09:00:00"] }).source,
    "reuniao",
  );
  assert.equal(
    inferEvidence(task({ title: "Homologação com o cliente" }), {
      cycleAcceptance: { total: 2, approved: 2 },
    }).source,
    "aceite",
  );
  assert.equal(
    inferEvidence(task({ title: "Homologação com o cliente" }), {
      cycleAcceptance: { total: 2, approved: 1 },
    }).status,
    "pendente",
  );
});

test("a completed delivery without any trace asks for review; an open one stays pending", () => {
  const done = inferEvidence(task({ status: "entregue" }));
  assert.equal(done.status, "revisao_necessaria");
  assert.match(done.recommendedAction, /Anexe/);
  const open = inferEvidence(task({ requiresEvidence: true }));
  assert.equal(open.status, "pendente");
  assert.match(open.reason, /exige evidência/);
});

test("a fully checked checklist or a written evidence count as evidence", () => {
  assert.equal(
    inferEvidence(task({ checklist: [{ id: "a", title: "x", done: true }] })).source,
    "checklist",
  );
  assert.equal(inferEvidence(task({ evidence: "Print anexado no drive" })).source, "evidencia_texto");
});

test("approval required keeps a completed delivery waiting until a linked document is approved", () => {
  const d = { status: "entregue", approvalRequired: true };
  assert.equal(awaitingApproval(d, []), true);
  assert.equal(awaitingApproval(d, [{ relatedTaskId: "t", reviewStatus: "pendente" }]), true);
  assert.equal(awaitingApproval(d, [{ relatedTaskId: "t", reviewStatus: "aprovado" }]), false);
  assert.equal(awaitingApproval({ status: "em-curso", approvalRequired: true }, []), false);
});

test("completion policy refuses pending checklist items and missing required evidence", () => {
  const current = {
    status: "em-curso",
    checklist: [
      { id: "a", title: "x", done: true },
      { id: "b", title: "y", done: false },
    ],
  };
  assert.match(deliveryPatchError({ status: "entregue" }, undefined, { current }), /checklist/);
  assert.match(
    deliveryPatchError({ status: "entregue" }, undefined, {
      current: { status: "em-curso", requiresEvidence: true },
    }),
    /exige evidência/,
  );
  assert.equal(
    deliveryPatchError({ status: "entregue" }, undefined, {
      current: { status: "em-curso", requiresEvidence: true },
      linkedDocuments: 1,
    }),
    null,
  );
  assert.equal(
    deliveryPatchError({ status: "entregue", evidence: "ok" }, undefined, {
      current: { status: "em-curso", requiresEvidence: true },
    }),
    null,
  );
  // already completed deliveries are not re-validated
  assert.equal(
    deliveryPatchError({ status: "entregue" }, undefined, { current: { status: "entregue", requiresEvidence: true } }),
    null,
  );
});

test("backlog policy: an empty deadline only stays in fila", () => {
  const backlog = { status: "fila", dueAt: "" };
  assert.equal(deliveryPatchError({ dueAt: "" }, undefined, { current: { status: "fila", dueAt: "2026-10-01", startsAt: "2026-09-20" } }), null);
  assert.match(deliveryPatchError({ dueAt: "" }, undefined, { current: { status: "em-curso", dueAt: "2026-10-01" } }), /Backlog/);
  assert.match(deliveryPatchError({ status: "revisao" }, undefined, { current: backlog }), /Defina um prazo/);
  assert.match(deliveryPatchError({ status: "entregue" }, undefined, { current: backlog }), /antes de concluir/);
  assert.equal(deliveryPatchError({ status: "em-curso", dueAt: "2026-10-01" }, undefined, { current: backlog }), null);
  assert.match(deliveryPatchError({ dueAt: "" }), /prazo válido/);
});
