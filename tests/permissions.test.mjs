import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeStateRead,
  authorizeStateWrite,
  can,
  matrixCell,
  normalizeAccess,
  permissionMatrix,
} from "../src/modules/workspace/domain/permissions.ts";

test("legacy and unknown levels normalize safely", () => {
  assert.equal(normalizeAccess("membro"), "ai_master");
  assert.equal(normalizeAccess(undefined), "leitor");
  assert.equal(normalizeAccess("qualquer"), "leitor");
  assert.equal(normalizeAccess("gestor"), "gestor");
});

test("the matrix follows the product rules", () => {
  const admin = { access: "admin", memberId: "a" };
  const gestor = { access: "gestor", memberId: "g" };
  const master = { access: "ai_master", memberId: "m" };
  const leitor = { access: "leitor", memberId: "l" };
  // everyone sees every client
  for (const actor of [admin, gestor, master, leitor]) assert.ok(can(actor, "clientes.ver"));
  // allocation is for managers and admins only
  assert.ok(can(admin, "alocacao.editar"));
  assert.ok(can(gestor, "alocacao.editar"));
  assert.equal(can(master, "alocacao.editar", { responsibleIds: ["m"] }), false);
  // ontology: the client's AI Master, a manager or an admin
  assert.ok(can(master, "ontologia.editar", { responsibleIds: ["m", "x"] }));
  assert.equal(can(master, "ontologia.editar", { responsibleIds: ["x"] }), false);
  assert.ok(can(gestor, "ontologia.editar", { responsibleIds: [] }));
  assert.ok(can(master, "entregas.remover", { responsibleIds: ["m"] }));
  assert.equal(can(master, "entregas.remover", { responsibleIds: ["x"] }), false);
  assert.ok(can(gestor, "entregas.remover"));
  assert.equal(can(leitor, "entregas.remover", { responsibleIds: ["l"] }), false);
  // team and settings: admin only
  assert.equal(can(gestor, "equipe.gerenciar"), false);
  assert.equal(can(gestor, "configuracoes.editar"), false);
  assert.equal(can(gestor, "auditoria.ver"), false);
  assert.ok(can(admin, "equipe.gerenciar"));
  assert.ok(can(admin, "auditoria.ver"));
  // readers change nothing, but may connect their own Google account? no: nothing
  assert.equal(can(leitor, "interacoes.registrar", { responsibleIds: ["l"] }), false);
  assert.equal(can(leitor, "google.conectar"), false);
  assert.ok(can(master, "google.conectar"));
  assert.equal(matrixCell("ai_master", "plano.editar"), "alocado");
  assert.equal(matrixCell("gestor", "plano.editar"), "tudo");
  assert.equal(matrixCell("leitor", "plano.editar"), "nao");
  assert.ok(permissionMatrix.length > 10);
});

test("state documents: bootstrap opens the door once, then the roster decides", () => {
  assert.deepEqual(authorizeStateWrite({ member: null, bootstrap: true, key: "ontology.clients.v3" }), { ok: true });
  assert.equal(authorizeStateWrite({ member: null, bootstrap: false, key: "ontology.clients.v3" }).ok, false);
  assert.equal(authorizeStateWrite({ member: { access: "leitor", active: true }, bootstrap: false, key: "ontology.clients.v3" }).ok, false);
  assert.equal(authorizeStateWrite({ member: { access: "ai_master", active: false }, bootstrap: false, key: "ontology.clients.v3" }).ok, false);
  assert.equal(authorizeStateWrite({ member: { access: "ai_master", active: true }, bootstrap: false, key: "ontology.catalog.v2" }).ok, false);
  assert.ok(authorizeStateWrite({ member: { access: "gestor", active: true }, bootstrap: false, key: "ontology.catalog.v2" }).ok);
  assert.ok(authorizeStateWrite({ member: { access: "membro", active: true }, bootstrap: false, key: "ontology.delivery.v4" }).ok);
  assert.equal(authorizeStateWrite({ member: { access: "gestor", active: true }, bootstrap: false, key: "ontology.workspace.v2", guardedChanged: true }).ok, false);
  assert.ok(authorizeStateWrite({ member: { access: "gestor", active: true }, bootstrap: false, key: "ontology.workspace.v2", guardedChanged: false }).ok);
  assert.ok(authorizeStateWrite({ member: { access: "admin", active: true }, bootstrap: false, key: "ontology.workspace.v2", guardedChanged: true }).ok);
  // reads: the roster is public to the signed-in; the rest waits for approval
  assert.ok(authorizeStateRead({ member: null, bootstrap: false, key: "ontology.workspace.v2" }).ok);
  assert.equal(authorizeStateRead({ member: null, bootstrap: false, key: "ontology.clients.v3" }).ok, false);
  assert.ok(authorizeStateRead({ member: { active: true }, bootstrap: false, key: "ontology.clients.v3" }).ok);
});
