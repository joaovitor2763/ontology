import { defaultService } from "../src/modules/clients/domain/service-config.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptanceWaitingDays,
  applyStatusChange,
  cycleError,
  cycleProgress,
  serviceDate,
} from "../src/modules/delivery/domain/services.ts";
import {
  serviceCycles,
  serviceConfigs,
} from "../src/modules/delivery/infrastructure/services.ts";
import { companies } from "../src/modules/clients/infrastructure/seed.ts";
import { deliveries } from "../src/modules/delivery/infrastructure/seed.ts";
import { ontologies } from "../src/modules/knowledge/infrastructure/seed.ts";
import { people } from "../src/modules/workspace/infrastructure/seed.ts";
import { enrichSantaClara } from "../src/modules/knowledge/infrastructure/santa-clara-ontology.ts";
import {
  businessOntology,
  typeOf,
} from "../src/modules/knowledge/domain/ontology.ts";
import { networkLayout } from "../src/modules/knowledge/domain/ontology-layout.ts";
import { formatDate } from "../src/shared/lib/format.ts";
const task = { id: "t", company: "c", status: "fila" };
const cycle = {
  id: "test",
  name: "Ciclo",
  goal: "Resultado acordado",
  company: "c",
  startsAt: "2026-09-07",
  endsAt: "2026-09-20",
  taskIds: ["t"],
  acceptance: [{ id: "a", text: "Aceite do cliente", done: false }],
  status: "em-curso",
};

test("cycles reject invalid dates, dates out of order and cross-company deliveries", () => {
  assert.equal(cycleError(cycle, [task]), null);
  assert.match(
    cycleError({ ...cycle, startsAt: "2026-02-31" }, [task]),
    /válidas/,
  );
  assert.match(
    cycleError({ ...cycle, endsAt: "2026-08-31" }, [task]),
    /posterior/,
  );
  assert.match(
    cycleError(cycle, [{ ...task, company: "other" }]),
    /desta conta/,
  );
  assert.match(
    cycleError({ ...cycle, taskIds: ["t", "t"] }, [task]),
    /desta conta/,
  );
});
test("closing needs completed linked deliveries and every acceptance criterion approved by someone", () => {
  const closing = { ...cycle, status: "concluido" };
  assert.match(cycleError(closing, [task]), /critérios/);
  const checkedOnly = {
    ...closing,
    acceptance: [{ ...cycle.acceptance[0], done: true }],
  };
  assert.match(cycleError(checkedOnly, [{ ...task, status: "entregue" }]), /quem aprovou/);
  const accepted = {
    ...closing,
    acceptance: [
      {
        ...cycle.acceptance[0],
        done: true,
        approvedBy: "sponsor",
        approvedAt: "2026-09-10",
        channel: "reuniao",
      },
    ],
  };
  assert.match(cycleError(accepted, [task]), /tarefas/);
  assert.equal(cycleError(accepted, [{ ...task, status: "entregue" }]), null);
  assert.match(
    cycleError({ ...accepted, acceptance: [] }, [
      { ...task, status: "entregue" },
    ]),
    /critérios/,
  );
  assert.equal(
    cycleProgress({ ...cycle, taskIds: ["t", "missing"] }, [
      { ...task, status: "entregue" },
    ]).percent,
    50,
  );
});
test("status changes are recorded with author and the acceptance request date", () => {
  const started = applyStatusChange(cycle, { ...cycle, status: "em-aceite" }, "marina", "2026-09-10T10:00:00");
  assert.equal(started.transitions.length, 1);
  assert.deepEqual(started.transitions[0], { status: "em-aceite", at: "2026-09-10T10:00:00", by: "marina" });
  assert.equal(started.acceptanceRequestedAt, "2026-09-10T10:00:00");
  assert.equal(acceptanceWaitingDays(started, "2026-09-14"), 4);
  assert.equal(applyStatusChange(started, started, "x", "2026-09-11"), started);
  const reopened = applyStatusChange(started, { ...started, status: "em-curso" }, "omar", "2026-09-12");
  assert.equal(reopened.transitions.length, 2);
  assert.equal(reopened.acceptanceRequestedAt, undefined);
  assert.equal(acceptanceWaitingDays(reopened, "2026-09-14"), null);
  const closed = applyStatusChange(started, { ...started, status: "concluido" }, "marina", "2026-09-13");
  assert.equal(closed.acceptanceRequestedAt, "2026-09-10T10:00:00");
});
test("every seeded cycle references an existing company, owner and delivery", () => {
  assert.equal(
    new Set(serviceCycles.map((c) => c.id)).size,
    serviceCycles.length,
  );
  for (const c of serviceCycles) {
    assert.ok(
      companies.some((x) => x.slug === c.company),
      c.id,
    );
    assert.ok(
      people.some((x) => x.id === c.ownerId),
      c.id,
    );
    assert.equal(cycleError(c, deliveries), null, c.id);
  }
  assert.deepEqual(defaultService.modules, { ontology: false });
  assert.deepEqual(serviceConfigs.logisul.modules, { ontology: false });
});
test("date-only values keep the calendar day in the user's timezone", () => {
  assert.equal(serviceDate("2026-09-07").getDate(), 7);
  assert.match(formatDate("2026-09-07"), /^7 de set/);
});
test("expanded Santa Clara map has complete typed entities and valid connected relationships", () => {
  const company = companies.find((c) => c.slug === "santa-clara");
  const original = businessOntology(ontologies[company.slug], company, people);
  const before = structuredClone(original);
  const map = enrichSantaClara(original);
  assert.deepEqual(original, before);
  assert.equal(map.nodes.length, 59);
  assert.equal(map.edges.length, 142);
  const ids = new Set(map.nodes.map((n) => n.id));
  assert.equal(ids.size, map.nodes.length);
  assert.equal(new Set(map.edges.map((e) => e.id)).size, map.edges.length);
  assert.equal(new Set(map.nodes.map(typeOf)).size, 9);
  assert.equal(map.nodes.filter((n) => typeOf(n) === "area").length, 6);
  for (const n of map.nodes) {
    assert.ok(
      map.domains.some((d) => d.id === n.domain),
      n.id,
    );
    assert.ok(
      map.edges.some((e) => e.from === n.id || e.to === n.id),
      n.id,
    );
    assert.ok(
      map.nodes.some((p) => p.id === n.ownerId && typeOf(p) === "person"),
      n.id,
    );
  }
  assert.ok(
    map.edges.every((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to),
  );
  const layout = networkLayout(map.nodes, map.edges);
  assert.ok(
    [...layout.positions.values()].every(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
    ),
  );
  assert.deepEqual(
    layout.positions,
    networkLayout(map.nodes, map.edges).positions,
  );
});
test("explicit element types survive business map enrichment", () => {
  const c = companies[0];
  const map = businessOntology(
    {
      ...ontologies[c.slug],
      nodes: [{ ...ontologies[c.slug].nodes[0], elementType: "metric" }],
    },
    c,
    people,
  );
  assert.equal(
    map.nodes.find((n) => n.id === "sc-paciente").elementType,
    "metric",
  );
});

test("every seeded cycle executes a milestone of its client's plan and its planned deliveries share it", async () => {
  const { seedJourneys } = await import("../src/modules/catalog/infrastructure/journey.ts");
  for (const cycle of serviceCycles) {
    const client = companies.find((c) => c.slug === cycle.company);
    const plan = seedJourneys.find((j) => j.id === client.journeyId);
    assert.ok(cycle.milestone, `${cycle.id} sem marco`);
    assert.ok(plan.milestones.some((m) => m.n === cycle.milestone), `${cycle.id} aponta para marco inexistente`);
    for (const id of cycle.taskIds) {
      const delivery = deliveries.find((d) => d.id === id);
      if (delivery && delivery.kind !== "request")
        assert.equal(delivery.milestone, cycle.milestone, `${id} fora do marco do ciclo ${cycle.id}`);
    }
  }
});
