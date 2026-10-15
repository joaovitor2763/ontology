import test from "node:test";
import assert from "node:assert/strict";
import {
  seedProducts,
  initialProducts,
  initialCycleTemplates,
} from "../src/modules/catalog/infrastructure/products.ts";
import {
  instantiateDeliveries,
  templateError,
  dateAfter,
} from "../src/modules/catalog/domain/products.ts";
import { serviceCycles } from "../src/modules/delivery/infrastructure/services.ts";
import {
  upsertStakeholder,
  stakeholderError,
} from "../src/modules/clients/domain/stakeholders.ts";

const template = seedProducts[0].cycles[0];
const context = {
  cycleId: "cycle-a",
  company: "client-a",
  productId: seedProducts[0].id,
  templateId: template.id,
  startsAt: "2026-09-28",
  ownerId: "marina",
};
test("all base models have valid delivery dates and seeded cycles keep their product relationship", () => {
  for (const p of seedProducts) {
    assert.equal(new Set(p.cycles.map((c) => c.id)).size, p.cycles.length);
    for (const t of p.cycles) assert.equal(templateError(t), null, t.id);
  }
  for (const c of serviceCycles) {
    const p = seedProducts.find((p) => p.id === initialProducts[c.company][0]);
    assert.ok(
      p.cycles.some((t) => t.id === initialCycleTemplates[c.id]),
      c.id,
    );
  }
});
test("client delivery copies are independent and use calendar dates across month boundaries", () => {
  const before = structuredClone(template);
  const first = instantiateDeliveries(template.deliveries, context);
  const second = instantiateDeliveries(template.deliveries, {
    ...context,
    cycleId: "cycle-b",
    company: "client-b",
  });
  first[0].title = "Customização do cliente A";
  first[0].dueAt = "2026-12-01";
  assert.deepEqual(template, before);
  assert.equal(second[0].title, template.deliveries[0].title);
  assert.equal(first[0].company, "client-a");
  assert.equal(second[0].company, "client-b");
  assert.ok(first.every((a) => second.every((b) => a.id !== b.id)));
  assert.equal(second.at(-1).dueAt, "2026-10-11");
  assert.equal(dateAfter("2026-12-31", 1), "2027-01-01");
  assert.equal(dateAfter("2028-02-28", 1), "2028-02-29");
});
test("models reject missing deliveries, invalid offsets and invalid effort", () => {
  assert.match(templateError({ ...template, deliveries: [] }), /tarefa base/);
  for (const patch of [
    { day: 0 },
    { day: 15 },
    { day: 1.5 },
    { hours: -1 },
    { hours: NaN },
    { title: " " },
  ]) {
    assert.ok(
      templateError({
        ...template,
        deliveries: [{ ...template.deliveries[0], ...patch }],
      }),
    );
  }
  assert.match(templateError({ ...template, acceptance: [] }), /aceite/);
});
const contact = {
  id: "a",
  company: "client-a",
  name: "Ana",
  role: "Diretora",
  initials: "A",
  org: "client",
  accountRole: "decisor",
  email: "ana@example.test",
  phone: "",
  area: "",
  notes: "",
  primary: true,
  active: true,
};
test("changing a primary stakeholder affects only that client and preserves inactive history", () => {
  const other = { ...contact, id: "b", company: "client-b" };
  const next = {
    ...contact,
    id: "c",
    name: "Carla",
    email: "carla@example.test",
  };
  const original = [contact, other];
  const saved = upsertStakeholder(original, next);
  assert.equal(saved.find((s) => s.id === "a").primary, false);
  assert.equal(saved.find((s) => s.id === "b").primary, true);
  assert.equal(saved.find((s) => s.id === "c").primary, true);
  assert.equal(original[0].primary, true);
  const archived = upsertStakeholder(saved, { ...next, active: false });
  assert.equal(archived.length, 3);
  assert.equal(archived.find((s) => s.id === "c").primary, false);
  assert.equal(archived.find((s) => s.id === "c").name, "Carla");
});
test("stakeholder contacts are globally unique and editing one's own record remains valid", () => {
  assert.equal(stakeholderError(contact, [contact]), null);
  assert.match(
    stakeholderError({ ...contact, id: "another", email: "ANA@example.test" }, [
      contact,
    ]),
    /outra pessoa/,
  );
  assert.match(
    stakeholderError({ ...contact, id: "another", company: "client-b" }, [
      contact,
    ]),
    /outra pessoa/,
  );
  assert.match(
    stakeholderError(
      { ...contact, id: "another", email: "", emails: ["other@example.test", "ANA@example.test"] },
      [contact],
    ),
    /outra pessoa/,
  );
  assert.match(
    stakeholderError(
      { ...contact, id: "another", email: "", emails: [], phone: "", phones: ["31999998888"] },
      [{ id: "member", org: "praxis", phone: "+55 31 99999-8888" }],
    ),
    /telefone.*outra pessoa/,
  );
  assert.match(
    stakeholderError({ ...contact, email: "invalid" }, []),
    /válido/,
  );
});
