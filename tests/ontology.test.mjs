import test from "node:test";
import assert from "node:assert/strict";
import {
  businessOntology,
  edgeError,
  elementChecks,
  normalized,
  typeOf,
} from "../src/modules/knowledge/domain/ontology.ts";

const company = {
  slug: "santa-clara",
  name: "Hospital Santa Clara",
  summary: "Unidade hospitalar",
  sector: "Saúde",
  city: "São Paulo",
  uf: "SP",
  sponsorId: "helena",
  leadId: "marina",
};
const people = [
  { id: "helena", name: "Helena", role: "CIO", org: "client" },
  { id: "marina", name: "Marina", role: "AI Master", org: "praxis" },
];
const original = {
  company: "santa-clara",
  domains: [{ id: "assistencia", label: "Assistência", color: "#ffffff" }],
  nodes: [
    {
      id: "sc-internacao",
      label: "Internação",
      kind: "class",
      domain: "assistencia",
      description: "Episódio hospitalar",
      properties: [],
      coverage: 74,
      x: 0,
      y: 0,
    },
  ],
  edges: [],
};

test("extends the business map while preserving existing entity identities and domain meaning", () => {
  const snapshot = structuredClone(original);
  const map = businessOntology(original, company, people);
  assert.deepEqual(original, snapshot);
  assert.equal(map.nodes.filter((n) => typeOf(n) === "company").length, 1);
  assert.equal(map.nodes.filter((n) => typeOf(n) === "area").length, 3);
  assert.equal(map.nodes.filter((n) => typeOf(n) === "person").length, 2);
  assert.equal(
    typeOf(map.nodes.find((n) => n.id === "sc-internacao")),
    "process",
  );
  assert.equal(map.nodes.find((n) => n.id === "sc-internacao").coverage, 74);
  assert.equal(
    map.nodes.find((n) => typeOf(n) === "company").coverageAssessed,
    false,
  );
  assert.equal(new Set(map.nodes.map((n) => n.id)).size, map.nodes.length);
  assert.ok(
    map.edges.every(
      (e) =>
        map.nodes.some((n) => n.id === e.from) &&
        map.nodes.some((n) => n.id === e.to),
    ),
  );
});

test("connection validation rejects dangling endpoints, self-links and equivalent duplicates", () => {
  const map = businessOntology(original, company, people);
  const edge = {
    id: "custom",
    from: "santa-clara-company",
    to: "sc-internacao",
    label: "depende de",
  };
  assert.equal(edgeError(edge, map), null);
  assert.match(edgeError({ ...edge, to: edge.from }, map), /diferentes/);
  assert.match(edgeError({ ...edge, to: "deleted" }, map), /disponível/);
  assert.match(edgeError({ ...edge, label: " " }, map), /descreva/);
  const connected = { ...map, edges: [...map.edges, edge] };
  assert.match(
    edgeError({ ...edge, id: "another", label: " DEPENDE_DE " }, connected),
    /já existe/,
  );
  assert.equal(
    edgeError({ ...edge, description: "Updated context" }, connected),
    null,
  );
  assert.equal(
    edgeError(
      { ...edge, id: "reverse", from: edge.to, to: edge.from },
      connected,
    ),
    null,
  );
});

test("documentation checks use actual context and detect a removed owner", () => {
  const map = businessOntology(original, company, people);
  const node = {
    ...map.nodes[0],
    ownerId: map.nodes.find((n) => typeOf(n) === "person").id,
  };
  assert.equal(elementChecks(node, map).filter((c) => c.done).length, 5);
  const withoutOwner = {
    ...map,
    nodes: map.nodes.filter((n) => n.id !== node.ownerId),
  };
  assert.equal(
    elementChecks(node, withoutOwner).find((c) => c.label === "Responsável")
      .done,
    false,
  );
  assert.equal(normalized("  OPERAÇÕES  "), "operacoes");
});

test("unassessed organizational elements do not dilute evaluated coverage", async () => {
  const { coverageAvg } = await import("../src/shared/lib/format.ts");
  assert.equal(
    coverageAvg([
      { coverage: 80 },
      { coverage: 60 },
      { coverage: 0, coverageAssessed: false },
    ]),
    70,
  );
  assert.equal(coverageAvg([{ coverage: 0, coverageAssessed: false }]), 0);
  assert.equal(
    coverageAvg([{ coverage: 80 }, { coverage: 0, coverageAssessed: true }]),
    40,
  );
});

test("network layout preserves real nodes, anchors dragged nodes and remains deterministic", async () => {
  const { networkLayout } =
    await import("../src/modules/knowledge/domain/ontology-layout.ts");
  const map = businessOntology(original, company, people);
  const first = networkLayout(map.nodes, map.edges);
  assert.equal(first.positions.size, map.nodes.length);
  assert.deepEqual(first, networkLayout(map.nodes, map.edges));
  assert.equal(first.groups.get("santa-clara-company"), "");
  const fixed = { x: 320, y: -120 };
  const changed = map.nodes.map((n, i) =>
    i === 0 ? { ...n, networkPosition: fixed } : n,
  );
  assert.deepEqual(
    networkLayout(changed, map.edges).positions.get(changed[0].id),
    fixed,
  );
  assert.ok(
    [...first.positions.values()].every(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
    ),
  );
});

test("new clients start with an empty map and retain their first saved element and connections", async () => {
  const { emptyOntology, emptyOntologyDraft, mergeOntology } =
    await import("../src/modules/knowledge/application/ontology-draft.ts");
  const base = emptyOntology("new-client");
  assert.equal(base.company, "new-client");
  assert.equal(base.nodes.length, 0);
  assert.ok(base.domains.some((d) => d.id === "organizacao"));
  const draft = emptyOntologyDraft();
  draft.extraNodes.push(
    { id: "area", label: "Operações", domain: "organizacao", properties: [] },
    {
      id: "person",
      label: "Responsável",
      domain: "organizacao",
      properties: [],
    },
  );
  draft.extraEdges.push({
    id: "edge",
    from: "area",
    to: "person",
    label: "inclui",
  });
  const saved = JSON.parse(JSON.stringify(draft));
  const result = mergeOntology(emptyOntology("new-client"), saved);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges.length, 1);
  saved.removedNodes.push("person");
  assert.equal(mergeOntology(base, saved).edges.length, 0);
  assert.equal(
    mergeOntology(emptyOntology("other-client"), emptyOntologyDraft()).nodes
      .length,
    0,
  );
});
