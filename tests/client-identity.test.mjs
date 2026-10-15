import test from "node:test";
import assert from "node:assert/strict";
import { clientInitials, validClientLogo } from "../src/modules/clients/domain/identity.ts";
import { migrateClientIdentity } from "../src/shared/infrastructure/migration.ts";

test("client marks use two automatic or customized characters", () => {
  assert.equal(clientInitials("G4"), "G4");
  assert.equal(clientInitials("Chicarino Quaresma"), "CQ");
  assert.equal(clientInitials("Acme"), "AC");
  assert.equal(clientInitials("A"), "A—");
  assert.equal(clientInitials("Acme", "xy"), "XY");
});
test("logo payload only accepts small normalized WebP thumbnails", () => {
  assert.equal(validClientLogo("data:image/webp;base64,YWJj"), true);
  assert.equal(validClientLogo("data:image/svg+xml;base64,YWJj"), false);
  assert.equal(validClientLogo("https://example.com/logo.png"), false);
  assert.equal(validClientLogo("data:image/webp;base64," + "A".repeat(32_000)), false);
});
test("identity migration preserves clients and customizations", () => {
  const old = { extraClients: [{ name: "Acme" }], clientEdits: { g4: { initials: "G4", logo: "" } } };
  const next = migrateClientIdentity(old);
  assert.deepEqual(next.extraClients[0], { name: "Acme", initials: "", logo: "" });
  assert.equal(next.clientEdits.g4.initials, "G4");
  assert.deepEqual(migrateClientIdentity(next), next);
  assert.equal(old.extraClients[0].initials, undefined);
});
