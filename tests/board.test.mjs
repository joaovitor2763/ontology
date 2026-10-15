import test from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_PAGE,
  boardColumns,
  expandColumn,
} from "../src/modules/delivery/application/board.ts";

const order = ["fila", "em-curso", "revisao", "entregue", "bloqueado"];
const tasks = (status, n, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `${status}-${from + i}`, status }));

test("board columns count everything and show a page at a time", () => {
  const all = [
    ...tasks("fila", 3),
    ...tasks("entregue", BOARD_PAGE + 7),
    ...tasks("bloqueado", 1),
  ];
  const columns = boardColumns(all, order);
  assert.deepEqual(
    columns.map((c) => [c.status, c.total, c.visible.length, c.hidden]),
    [
      ["fila", 3, 3, 0],
      ["em-curso", 0, 0, 0],
      ["revisao", 0, 0, 0],
      ["entregue", BOARD_PAGE + 7, BOARD_PAGE, 7],
      ["bloqueado", 1, 1, 0],
    ],
  );
  // Colunas abaixo do volume não escondem nada: nenhum controle aparece nelas.
  assert.equal(columns.filter((c) => c.hidden > 0).length, 1);
  // A ordem da coluna é a da projeção, e a janela é o começo dela.
  assert.deepEqual(
    columns[3].visible.slice(0, 2).map((t) => t.id),
    ["entregue-0", "entregue-1"],
  );
});

test("showing more expands one column and leaves the others alone", () => {
  const all = tasks("entregue", BOARD_PAGE * 3);
  const once = expandColumn({}, "entregue");
  assert.deepEqual(once, { entregue: BOARD_PAGE * 2 });
  const twice = expandColumn(once, "entregue");
  const [entregue] = boardColumns(all, ["entregue"], twice);
  assert.equal(entregue.visible.length, BOARD_PAGE * 3);
  assert.equal(entregue.hidden, 0);
  assert.deepEqual(expandColumn(once, "fila"), {
    entregue: BOARD_PAGE * 2,
    fila: BOARD_PAGE * 2,
  });
  // Uma coluna menor que a janela nunca mostra "hidden" negativo.
  const [fila] = boardColumns(tasks("fila", 2), ["fila"], { fila: 500 });
  assert.equal(fila.hidden, 0);
  assert.equal(fila.visible.length, 2);
});

test("a task pinned to the board stays visible past the cut, in its own place", () => {
  const all = tasks("entregue", BOARD_PAGE + 10);
  const late = `entregue-${BOARD_PAGE + 5}`;
  const [column] = boardColumns(all, ["entregue"], {}, [late]);
  assert.equal(column.total, BOARD_PAGE + 10);
  assert.equal(column.visible.length, BOARD_PAGE + 1);
  assert.equal(column.hidden, 9);
  assert.equal(column.visible.at(-1).id, late);
  // Fixar uma tarefa que já cabia na janela não duplica nem muda a contagem.
  const [same] = boardColumns(all, ["entregue"], {}, ["entregue-0"]);
  assert.equal(same.visible.length, BOARD_PAGE);
  assert.equal(same.hidden, 10);
});

test("tasks in fila without a deadline form the derived Backlog column before A fazer", async () => {
  const { boardOrder, boardLane, boardLaneLabel, laneStatus } = await import("../src/modules/delivery/application/board.ts");
  const all = [
    { id: "sem-data", status: "fila", dueAt: "" },
    { id: "com-data", status: "fila", dueAt: "2026-10-01" },
    { id: "curso", status: "em-curso", dueAt: "2026-10-02" },
  ];
  const columns = boardColumns(all, boardOrder);
  assert.deepEqual(columns.slice(0, 3).map((c) => [c.status, c.visible.map((t) => t.id)]), [
    ["backlog", ["sem-data"]],
    ["fila", ["com-data"]],
    ["em-curso", ["curso"]],
  ]);
  assert.deepEqual([boardLaneLabel.backlog, boardLaneLabel.fila], ["Backlog", "A fazer"]);
  assert.equal(boardLane(all[0]), "backlog");
  assert.equal(laneStatus("backlog"), "fila");
  // Without a Backlog column in the order, a dateless task stays with its status.
  assert.deepEqual(boardColumns(all, order)[0].visible.map((t) => t.id), ["sem-data", "com-data"]);
});
