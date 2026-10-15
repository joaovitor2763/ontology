import test from "node:test";
import assert from "node:assert/strict";
import {
  blockedMoveMessage,
  droppedMovesMessage,
  isFinalRefusal,
  isStatusOnlyPatch,
  shouldResendMove,
  taskFailureMessage,
} from "../src/modules/delivery/application/board-moves.ts";

const conflict = { status: 409, code: "snapshot_changed" };

test("only a status-only move is resent once after a client revision conflict", () => {
  assert.equal(isStatusOnlyPatch({ status: "revisao" }), true);
  assert.equal(isStatusOnlyPatch({ status: "revisao", dueAt: "2026-10-01" }), false);
  assert.equal(shouldResendMove(conflict, { status: "revisao" }, false), true);
  assert.equal(shouldResendMove(conflict, { status: "revisao" }, true), false);
  assert.equal(shouldResendMove(conflict, { dueAt: "2026-10-01" }, false), false);
  assert.equal(shouldResendMove({ status: 409, code: "version_conflict" }, { status: "fila" }, false), false);
  assert.equal(shouldResendMove({ status: 500 }, { status: "fila" }, false), false);
});

test("4xx refusals are final; server errors and lost responses stay uncertain", () => {
  assert.equal(isFinalRefusal({ status: 409, code: "snapshot_changed" }), true);
  assert.equal(isFinalRefusal({ status: 403 }), true);
  assert.equal(isFinalRefusal({ status: 503 }), false);
  assert.equal(isFinalRefusal({}), false);
});

test("failures name the task and keep the real cause", () => {
  assert.equal(taskFailureMessage(["Mapa de processos"], { status: "revisao" }, "A execução do cliente mudou. Atualize antes de salvar."),
    "«Mapa de processos» não foi movida: a execução do cliente mudou. Atualize antes de salvar.");
  assert.equal(taskFailureMessage(["Mapa"], { dueAt: "2026-10-01" }, "Prazo inválido"),
    "«Mapa» não foi atualizada: prazo inválido.");
  assert.equal(taskFailureMessage(["A", "B"], { status: "fila" }, ""),
    "2 tarefas não foram movidas: não foi possível salvar.");
  assert.match(blockedMoveMessage("Kickoff", "«Mapa» não foi movida: falha de rede."),
    /^«Kickoff» não foi movida: resolva antes a falha pendente\. «Mapa»/);
});

test("queued gestures dropped after a failure are listed by title", () => {
  assert.equal(droppedMovesMessage([]), "");
  assert.equal(droppedMovesMessage([{ title: "A", patch: { status: "fila" } }]),
    "«A» não foi movida: a alteração anterior falhou.");
  assert.equal(droppedMovesMessage([{ title: "A", patch: { status: "fila" } }, { title: "B", patch: { dueAt: "2026-10-01" } }]),
    "«A», «B» não foram atualizadas: a alteração anterior falhou.");
  assert.match(droppedMovesMessage(Array.from({ length: 5 }, (_, i) => ({ title: `T${i}`, patch: { status: "fila" } }))),
    /^5 tarefas não foram movidas/);
});
