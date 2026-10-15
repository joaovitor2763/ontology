import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapKeysFor, skipsGlobalDeliveryRead } from "../src/shared/infrastructure/bootstrap-keys.ts";

const SYNCED = /^ontology\.(catalog|clients|delivery|documents|engagement|knowledge|relationship|stakeholders|workspace)\.v\d+$/;

test("every address maps to valid synced keys, always including workspace and clients", () => {
  for (const path of ["/", "/clientes", "/clientes/x", "/clientes/x/entregas", "/clientes/x/entregas/t1", "/execucao", "/agenda", "/alertas", "/reunioes", "/reunioes/m1", "/catalogo/planos", "/equipe/membros", "/equipe/membros/b", "/equipe/alocacao", "/ontologia", "/configuracoes", "/perfil", "/entrar", "/nada"]) {
    const keys = bootstrapKeysFor(path);
    assert.ok(keys.every((key) => SYNCED.test(key)), path);
    assert.equal(new Set(keys).size, keys.length, path);
    assert.ok(keys.includes("ontology.workspace.v3") && keys.includes("ontology.clients.v3"), path);
  }
});

test("execution views load only the documents their screens read", () => {
  assert.ok(!bootstrapKeysFor("/execucao").includes("ontology.delivery.v2"));
  assert.ok(!bootstrapKeysFor("/execucao?visao=entregas&cliente=acme").includes("ontology.delivery.v2"));
  assert.ok(!bootstrapKeysFor("/execucao?visao=ciclos").includes("ontology.delivery.v2"));
  assert.ok(!bootstrapKeysFor("/execucao?visao=cronograma").includes("ontology.delivery.v2"));
  assert.ok(bootstrapKeysFor("/clientes/acme/").includes("ontology.relationship.v1"));
  assert.ok(bootstrapKeysFor("/clientes/acme").includes("ontology.knowledge.v2"));
  assert.ok(bootstrapKeysFor("/reunioes/m1").includes("ontology.knowledge.v2"));
  assert.ok(!bootstrapKeysFor("/reunioes/m1").includes("ontology.delivery.v2"));
  assert.equal(skipsGlobalDeliveryRead("/reunioes/m1"), true);
  assert.equal(bootstrapKeysFor("/equipe/membros").length, 2);
  assert.equal(bootstrapKeysFor("/agenda").length, 3);
});

test("client routes hydrate execution from their scoped provider", () => {
  for (const path of ["/clientes/acme", "/clientes/acme/plano",
    "/clientes/acme/solicitacoes", "/clientes/acme/entregas",
    "/clientes/acme/entregas/t1"])
    assert.ok(!bootstrapKeysFor(path).includes("ontology.delivery.v2"), path);
});

test("client portfolio hydrates a compact summary instead of the global execution document", () => {
  assert.ok(!bootstrapKeysFor("/").includes("ontology.delivery.v2"));
  assert.ok(!bootstrapKeysFor("/clientes").includes("ontology.delivery.v2"));
  assert.ok(!bootstrapKeysFor("/alertas").includes("ontology.delivery.v2"));
  assert.ok(!bootstrapKeysFor("/equipe/alocacao").includes("ontology.delivery.v2"));
  assert.ok(!bootstrapKeysFor("/equipe/membros/marina").includes("ontology.delivery.v2"));
  assert.ok(!bootstrapKeysFor("/perfil").includes("ontology.delivery.v2"));
  assert.equal(skipsGlobalDeliveryRead("/"), true);
  assert.equal(skipsGlobalDeliveryRead("/clientes"), true);
  assert.equal(skipsGlobalDeliveryRead("/alertas"), true);
  assert.equal(skipsGlobalDeliveryRead("/equipe/alocacao"), true);
  assert.equal(skipsGlobalDeliveryRead("/equipe/membros/marina"), true);
  assert.equal(skipsGlobalDeliveryRead("/perfil"), true);
  assert.equal(skipsGlobalDeliveryRead("/clientes/santa-clara/entregas"), true);
  assert.equal(skipsGlobalDeliveryRead("/execucao"), false);
});

test("global pages without execution consumers skip the delivery document", () => {
  for (const path of ["/agenda", "/reunioes", "/configuracoes", "/ontologia", "/catalogo/produtos", "/catalogo/planos", "/documentos", "/conversas"]) {
    assert.ok(!bootstrapKeysFor(path).includes("ontology.delivery.v2"), path);
    assert.equal(skipsGlobalDeliveryRead(path), true, path);
  }
});

test("overview and clients bootstrap exactly the documents their screens mount", () => {
  // Medido com uma sonda em `hydrate` no Worker local (06/10/2026): Visão geral monta
  // equipe, cadastro e reuniões; Clientes monta equipe, cadastro, contatos e catálogo.
  assert.deepEqual([...bootstrapKeysFor("/")].sort(),
    ["ontology.clients.v3", "ontology.engagement.v2", "ontology.workspace.v3"]);
  assert.deepEqual([...bootstrapKeysFor("/clientes")].sort(),
    ["ontology.catalog.v2", "ontology.clients.v3", "ontology.stakeholders.v1", "ontology.workspace.v3"]);
  for (const path of ["/", "/clientes"])
    assert.ok(!bootstrapKeysFor(path).includes("ontology.documents.v3"), path);
  // As outras telas da carteira continuam com a lista anterior.
  assert.ok(bootstrapKeysFor("/alertas").includes("ontology.documents.v3"));
});
