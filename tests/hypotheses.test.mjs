import test from "node:test";
import assert from "node:assert/strict";
import {
  evidenceSentence,
  evidenceSummary,
  hypothesisError,
  refineHypothesis,
  singleOptionPains,
  staleHypotheses,
} from "../src/modules/engagement/domain/hypotheses.ts";
import {
  hypotheses,
  meetings,
  pains,
  solutions,
} from "../src/modules/engagement/infrastructure/seed.ts";
import { companies } from "../src/modules/clients/infrastructure/seed.ts";

const base = {
  id: "h-1",
  company: "acme",
  statement: "O atraso vem da revisão manual.",
  status: "em-teste",
  painIds: [],
  evidence: [],
  createdAt: "2026-09-01T10:00:00",
};

test("a hypothesis needs a statement of at least three characters", () => {
  assert.match(hypothesisError({ statement: "" }), /Escreva a hipótese/);
  assert.match(hypothesisError({ statement: "ab" }), /3 caracteres/);
  assert.equal(hypothesisError({ statement: "abc" }), null);
});

test("evidence is summarised by kind with the most recent date and a pt-BR sentence", () => {
  const h = {
    ...base,
    evidence: [
      { id: "e1", at: "2026-09-02T10:00:00", kind: "confirma", note: "x" },
      { id: "e2", at: "2026-09-05T10:00:00", kind: "contradiz", note: "y" },
      { id: "e3", at: "2026-09-03T10:00:00", kind: "confirma", note: "z" },
    ],
  };
  const s = evidenceSummary(h);
  assert.deepEqual(
    { confirma: s.confirma, contradiz: s.contradiz, refina: s.refina, total: s.total },
    { confirma: 2, contradiz: 1, refina: 0, total: 3 },
  );
  assert.equal(s.lastAt, "2026-09-05T10:00:00");
  assert.equal(evidenceSentence(h), "2 confirmam · 1 contradiz");
  assert.equal(evidenceSentence(base), "Sem evidência");
});

test("open hypotheses without recent evidence are stale; closed ones never are", () => {
  const fresh = {
    ...base,
    id: "fresh",
    evidence: [{ id: "e", at: "2026-09-10T10:00:00", kind: "confirma", note: "n" }],
  };
  const idle = { ...base, id: "idle", createdAt: "2026-08-01T10:00:00" };
  const closed = { ...idle, id: "closed", status: "refutada" };
  const stale = staleHypotheses([fresh, idle, closed], "2026-09-14", 14);
  assert.deepEqual(
    stale.map((s) => s.hypothesis.id),
    ["idle"],
  );
  assert.equal(stale[0].idleDays, 44);
  assert.equal(staleHypotheses([idle], "2026-09-14", 60).length, 0);
});

test("pains with exactly one non-discarded option trigger the options-led warning", () => {
  const painList = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
  const options = [
    { id: "s1", painIds: ["p1"], status: "proposta" },
    { id: "s2", painIds: ["p2"], status: "proposta" },
    { id: "s3", painIds: ["p2"], status: "aprovada" },
    { id: "s4", painIds: ["p3"], status: "descartada" },
  ];
  assert.deepEqual(
    singleOptionPains(painList, options).map((p) => p.id),
    ["p1"],
  );
});

test("refining keeps company, pains and owner and links the child to the parent", () => {
  const parent = { ...base, painIds: ["p1"], ownerId: "marina", rootCause: "rc" };
  const child = refineHypothesis(parent, "Nova leitura.", "h-2", "2026-09-14T10:00:00");
  assert.equal(child.parentId, "h-1");
  assert.equal(child.status, "aberta");
  assert.deepEqual(child.painIds, ["p1"]);
  assert.equal(child.ownerId, "marina");
  assert.equal(child.rootCause, "rc");
  assert.equal(child.evidence.length, 0);
  assert.notEqual(child.painIds, parent.painIds);
});

test("seed hypotheses reference existing clients, pains and meetings and include a refined chain", () => {
  const slugs = new Set(companies.map((c) => c.slug));
  const painIds = new Set(pains.map((p) => p.id));
  const meetingIds = new Set(meetings.map((m) => m.id));
  const ids = new Set(hypotheses.map((h) => h.id));
  assert.ok(hypotheses.length >= 4);
  for (const h of hypotheses) {
    assert.ok(slugs.has(h.company), `${h.id} aponta para cliente desconhecido`);
    for (const id of h.painIds) assert.ok(painIds.has(id), `${h.id} aponta para dor desconhecida`);
    for (const e of h.evidence)
      if (e.meetingId) assert.ok(meetingIds.has(e.meetingId), `${h.id} aponta para reunião desconhecida`);
    if (h.parentId) assert.ok(ids.has(h.parentId), `${h.id} aponta para hipótese-mãe desconhecida`);
    assert.equal(hypothesisError(h), null);
  }
  const refined = hypotheses.find((h) => h.status === "refinada");
  assert.ok(refined);
  assert.ok(hypotheses.some((h) => h.parentId === refined.id));
  assert.ok(hypotheses.some((h) => h.status === "refutada" && h.evidence.some((e) => e.kind === "contradiz")));
});

test("seed options carry tradeoffs and exactly one chosen option explains why", () => {
  const withTradeoffs = solutions.filter((s) => s.tradeoffs);
  assert.ok(withTradeoffs.length >= 2);
  const chosen = solutions.filter((s) => s.chosen);
  assert.equal(chosen.length, 1);
  assert.ok(chosen[0].chosenReason.length > 20);
  assert.equal(singleOptionPains(pains, solutions).some((p) => p.id === "pain-sc-1"), false);
});
