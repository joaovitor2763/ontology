import test from "node:test";
import assert from "node:assert/strict";
import {
  allocationError,
  assignedFrom,
  memberLoad,
  removeAllocation,
  seedAllocations,
  upsertAllocation,
} from "../src/modules/clients/domain/allocation.ts";
import {
  charterMissing,
  clientError,
  slugify,
} from "../src/modules/clients/domain/models.ts";
import {
  initialsOf,
  memberError,
} from "../src/modules/workspace/domain/models.ts";
import { companies } from "../src/modules/clients/infrastructure/seed.ts";
import { paths } from "../src/shared/lib/routes.ts";

test("client names become stable slugs and duplicates are refused", () => {
  assert.equal(slugify("Hospital São João · Unidade 2"), "hospital-sao-joao-unidade-2");
  assert.equal(slugify("   "), "");
  assert.equal(clientError({ slug: "", name: "" }, []), "Informe o nome do cliente.");
  assert.equal(
    clientError({ slug: "santa-clara", name: "Santa Clara" }, companies),
    "Já existe um cliente com este nome.",
  );
  assert.equal(clientError({ slug: "novo", name: "Novo" }, companies), null);
});

test("allocations keep one lead and one CS per client and derive the assigned pair", () => {
  let all = seedAllocations(companies, {});
  const santa = assignedFrom(all, "santa-clara", { leadId: "x", csId: "y" });
  assert.deepEqual(santa, { leadId: "marina", csId: "omar" });
  all = upsertAllocation(all, {
    id: "a1",
    company: "santa-clara",
    memberId: "thiago",
    role: "responsavel",
    percent: 40,
  });
  assert.equal(
    all.filter((a) => a.company === "santa-clara" && a.role === "responsavel")
      .length,
    1,
  );
  assert.equal(assignedFrom(all, "santa-clara", { leadId: "x", csId: "y" }).leadId, "thiago");
  all = upsertAllocation(all, {
    id: "product-lead",
    company: "santa-clara",
    memberId: "marina",
    role: "responsavel",
    enrollmentId: "purchase-1",
    percent: 15,
  });
  assert.equal(all.filter(a => a.company === "santa-clara" && a.role === "responsavel").length, 2);
  assert.equal(assignedFrom(all, "santa-clara", { leadId: "x", csId: "y" }).leadId, "thiago", "product responsibility does not replace the client-wide lead");
  all = upsertAllocation(all, {
    id: "a2",
    company: "santa-clara",
    memberId: "beatriz",
    role: "consultor",
    percent: 20,
  });
  all = upsertAllocation(all, {
    id: "a3",
    company: "banco-litoral",
    memberId: "beatriz",
    role: "consultor",
    percent: 50,
  });
  // Beatriz already leads Vértice (30%) in the seed.
  const load = memberLoad(all, "beatriz", 40);
  assert.equal(load.percent, 100);
  assert.equal(load.hours, 40);
  assert.equal(load.clients, 3);
  assert.equal(load.over, false);
  assert.equal(removeAllocation(all, "a3").some((a) => a.id === "a3"), false);
});

test("legacy assignments override seed pairs when converting to allocations", () => {
  const all = seedAllocations(companies, {
    logisul: { leadId: "beatriz", csId: "thiago" },
  });
  assert.deepEqual(assignedFrom(all, "logisul", { leadId: "", csId: "" }), {
    leadId: "beatriz",
    csId: "thiago",
  });
});

test("allocation and member validation explain the problem", () => {
  assert.equal(
    allocationError({ id: "a", company: "c", memberId: "", role: "cs", percent: 10 }),
    "Escolha um membro da equipe.",
  );
  assert.equal(
    allocationError({ id: "a", company: "c", memberId: "m", role: "cs", percent: 120 }),
    "A dedicação deve ficar entre 0% e 100%.",
  );
  assert.equal(
    allocationError({
      id: "a",
      company: "c",
      memberId: "m",
      role: "cs",
      percent: 10,
      from: "2026-10-01",
      to: "2026-09-01",
    }),
    "O término precisa ser igual ou posterior ao início.",
  );
  assert.equal(initialsOf("Ana Beatriz Souza"), "AS");
  assert.equal(
    memberError({ id: "n", name: "Ana", role: "Consultora", email: "x" }, []),
    "Informe um e-mail válido.",
  );
  assert.equal(
    memberError(
      { id: "n", name: "Ana", role: "Consultora", email: "a@b.co" },
      [{ id: "m", email: "A@B.co" }],
    ),
    "Este e-mail já pertence a outra pessoa no workspace.",
  );
  assert.equal(
    memberError({ id: "n", name: "Ana", role: "Consultora", capacityHoursWeek: 40 }, []),
    null,
  );
});

test("route helpers encode views and filters consistently", () => {
  assert.equal(paths.client("acme"), "/clientes/acme");
  assert.equal(paths.clientPlan("acme"), "/clientes/acme/plano");
  assert.equal(paths.clientPlan("acme", "ciclos"), "/clientes/acme/plano?visao=ciclos");
  assert.equal(paths.clientDeliveries("acme", "solicitacoes"), "/clientes/acme/solicitacoes");
  assert.equal(paths.execution(), "/execucao");
  assert.equal(paths.execution("cronograma", "acme"), "/execucao?visao=cronograma&cliente=acme");
  assert.equal(paths.alerts("acme"), "/alertas?cliente=acme");
  assert.equal(paths.catalogProducts("consultoria"), "/catalogo/produtos?produto=consultoria");
});

test("the value contract lists what is still missing and seeded charters are complete", () => {
  assert.deepEqual(charterMissing(undefined), ["objective", "finishedLooksLike", "keyQuestion"]);
  assert.deepEqual(
    charterMissing({ objective: "x", finishedLooksLike: "  ", keyQuestion: "" }),
    ["finishedLooksLike", "keyQuestion"],
  );
  assert.deepEqual(
    charterMissing({ objective: "a", finishedLooksLike: "b", keyQuestion: "c" }),
    [],
  );
  for (const c of companies.filter((x) => x.charter))
    assert.deepEqual(charterMissing(c.charter), [], c.slug);
});


test("client alerts return to the original view and reject unrelated destinations", async () => {
  const { paths, alertReturnPath } = await import("../src/shared/lib/routes.ts");
  const origin = "/clientes/acme/plano?visao=ciclos&marco=2";
  const alerts = new URL(paths.alerts("acme", origin), "https://delivery.local");
  assert.equal(alerts.searchParams.get("origem"), origin);
  assert.equal(alertReturnPath("acme", origin), origin);
  for (const from of [null, "//evil.test", "https://evil.test", "/clientes/other", "/clientes/acme/../../equipe", "/clientes/acme-other", "/clientes/acme/../other"]) {
    assert.equal(alertReturnPath("acme", from), "/clientes/acme");
  }
});
