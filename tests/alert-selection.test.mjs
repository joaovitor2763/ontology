import test from "node:test";
import assert from "node:assert/strict";
import { alertKey, alertSelection } from "../src/modules/workspace/domain/alert-selection.ts";

const rows = [
  { company: "acme", id: "a1" },
  { company: "acme", id: "a2" },
  { company: "beta", id: "a1" },
  { company: "gama", id: "g1" },
];

test("selecionar filtrados alcança todas as linhas que a pessoa pode marcar", () => {
  const selection = alertSelection(rows, new Set(), () => true);
  assert.equal(selection.selectable.length, 4);
  assert.equal(selection.label, "Selecionar filtrados (4)");
  const all = alertSelection(rows, new Set(rows.map(alertKey)), () => true);
  assert.equal(all.all, true);
  assert.equal(all.selectedRows.length, 4);
  assert.equal(all.label, "Desmarcar filtrados");
});

test("o rótulo diz quantas linhas ficam fora por permissão", () => {
  const selection = alertSelection(rows, new Set(), company => company === "acme");
  assert.deepEqual(selection.selectable.map(alertKey), [alertKey(rows[0]), alertKey(rows[1])]);
  assert.equal(selection.blocked, 2);
  assert.equal(selection.label, "Selecionar filtrados (2 de 4 podem ser marcados por você)");
  const done = alertSelection(rows, new Set([alertKey(rows[0]), alertKey(rows[1])]), company => company === "acme");
  assert.equal(done.all, true);
  assert.equal(done.some, false);
});

test("o mesmo ID em clientes diferentes são duas linhas distintas", () => {
  assert.notEqual(alertKey(rows[0]), alertKey(rows[2]));
  const selection = alertSelection(rows, new Set([alertKey(rows[2])]), () => true);
  assert.deepEqual(selection.selectedRows, [rows[2]]);
  assert.equal(selection.some, true);
});

test("seleção antiga de linhas que saíram da fila não conta", () => {
  const selection = alertSelection(rows.slice(0, 2), new Set([alertKey(rows[3])]), () => true);
  assert.equal(selection.selectedRows.length, 0);
  assert.equal(selection.all, false);
});

test("a permissão é consultada uma vez por cliente", () => {
  const calls = [];
  alertSelection(rows, new Set(), company => { calls.push(company); return true; });
  assert.deepEqual(calls, ["acme", "beta", "gama"]);
});
