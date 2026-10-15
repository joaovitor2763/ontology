import test from "node:test";
import assert from "node:assert/strict";
import { matchesTaskScope } from "../src/modules/delivery/domain/task-scope.ts";
import { paths, clientSectionLabel } from "../src/shared/lib/routes.ts";

test("project tasks exclude requests while retaining legacy tasks", () => {
  const tasks = [{ id: "legacy" }, { id: "plan", kind: "journey" }, { id: "ticket", kind: "request" }];
  assert.deepEqual(tasks.filter(t => matchesTaskScope(t, "project")).map(t => t.id), ["legacy", "plan"]);
  assert.deepEqual(tasks.filter(t => matchesTaskScope(t, "requests")).map(t => t.id), ["ticket"]);
  assert.equal(tasks.filter(t => matchesTaskScope(t, "all")).length, 3);
  const ticket = { ...tasks[2], status: "bloqueado" };
  assert.equal(matchesTaskScope(ticket, "requests"), true);
  assert.equal(matchesTaskScope(ticket, "all"), true);
});

test("tickets have a client section and legacy helpers link to it", () => {
  assert.equal(paths.clientRequests("acme"), "/clientes/acme/solicitacoes");
  assert.equal(paths.clientDeliveries("acme", "solicitacoes"), paths.clientRequests("acme"));
  assert.equal(clientSectionLabel.solicitacoes, "Tickets");
  assert.equal(paths.clientDeliveries("acme", undefined, 2), "/clientes/acme/entregas?marco=2");
});
