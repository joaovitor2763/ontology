import test from "node:test";
import assert from "node:assert/strict";

// Relógio fixo, como nos testes do resumo (0042): prazos relativos e "hoje" iguais nos dois caminhos.
const FIXED = Date.parse("2026-10-06T15:20:00.000Z");
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [FIXED])); }
  static now() { return FIXED; }
};
const { activeWorkspace, session, touchSlice, writeSummaries, indexOwners, GENERATION } =
  await import("./helpers/active-workspace.mjs");
const { instrumentQueries } = await import("../src/server/timing.ts");
const { readExecutionBoard, forgetExecutionBoards } = await import("../src/server/operations/execution-board.ts");
const { executeDeliveryCommand } = await import("../src/server/operations/delivery.ts");
const { projectClients } = await import("../src/modules/clients/infrastructure/snapshot.ts");
const { normalizeCatalogSnapshot } = await import("../src/modules/catalog/infrastructure/snapshot.ts");
const { projectClientExecution } = await import("../src/modules/delivery/infrastructure/client-projection.ts");
const { boardTaskOf, decodeBoardTasks, encodeBoardTasks, BOARD_TASK_FIELDS } =
  await import("../src/modules/delivery/infrastructure/execution-board-wire.ts");
const { filterBoardTasks } = await import("../src/modules/delivery/application/board-filters.ts");
const { boardColumns, boardOrder, boardLane } = await import("../src/modules/delivery/application/board.ts");
const { inferEvidence, awaitingApproval } = await import("../src/modules/delivery/domain/evidence.ts");
const { directDueDatePatch } = await import("../src/modules/delivery/domain/delivery-policy.ts");
const { decodeStateBody } = await import("../src/server/state-body.ts");
const { boardColumnPayload, BOARD_PREFIX } = await import("../src/server/delivery-client-summary-board.ts");
const { deflateRawSync } = await import("node:zlib");
/** Regrava o JSON de uma coluna no formato 2 (para adulterar nos testes). */
const packBoard = (part) => BOARD_PREFIX + deflateRawSync(JSON.stringify(part)).toString("base64");

/**
 * Quadro global de execução (`/api/execution/board`) servido pelos resumos por
 * cliente (0042) e enviado só com os campos do quadro, em tabela. O oráculo é
 * o código anterior: projetar a fatia de cada cliente ativo e devolver as
 * tarefas inteiras (sem comentários e histórico). A resposta nova tem de ser
 * esse oráculo recortado em `BOARD_TASK_FIELDS`, e cartões, colunas,
 * contagens, filtros, ordem e selo de evidência calculados com as tarefas
 * recortadas têm de ser os mesmos que com as tarefas inteiras.
 */
const admin = session("admin");
const day = (offset) => new Date(FIXED + offset * 86_400_000).toISOString().slice(0, 10);
const json = (value) => JSON.parse(JSON.stringify(value));
const doc = (f, key) => JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE workspace_id='default' AND key=?")
  .get(key)?.body ?? "{}");

/** O `readExecutionBoard` anterior, projetando todas as fatias. */
async function oracle(f) {
  const clientState = projectClients(doc(f, "ontology.clients.v3"));
  const catalog = normalizeCatalogSnapshot(doc(f, "ontology.catalog.v2"));
  const clientStarts = Object.fromEntries(clientState.clients.map((client) => [client.slug, client.startedAt]));
  const enrollmentStarts = Object.fromEntries(clientState.enrollments.map((row) => [row.id, row.startsAt]));
  const rows = f.sql.prepare("SELECT company,revision,incarnation,body FROM delivery_client_snapshots WHERE generation=? ORDER BY company")
    .all(GENERATION);
  const slices = new Map(await Promise.all(rows.map(async (row) => [row.company, await decodeStateBody(row.body)])));
  const tasks = [], cycles = [], referenceTasks = [];
  for (const client of clientState.clients) {
    const execution = projectClientExecution(slices.get(client.slug), catalog, client, clientState.enrollments,
      clientStarts, enrollmentStarts, true);
    tasks.push(...execution.tasks.map((value) => { const task = { ...value }; delete task.comments; delete task.history; return task; }));
    referenceTasks.push(...execution.referenceTasks);
    cycles.push(...execution.cycles.map((cycle) => ({ id: cycle.id, company: cycle.company, name: cycle.name,
      status: cycle.status, taskIds: cycle.taskIds, productId: cycle.productId, enrollmentId: cycle.enrollmentId,
      templateId: cycle.templateId, milestone: cycle.milestone, startsAt: cycle.startsAt, endsAt: cycle.endsAt,
      ownerId: cycle.ownerId, acceptance: cycle.acceptance.map((item) => ({ done: item.done, approvedBy: item.approvedBy })) })));
  }
  const meta = f.sql.prepare("SELECT compatibility_version FROM delivery_client_shadow_meta").get();
  return json({ tasks, cycles, referenceTasks, compatibilityVersion: meta.compatibility_version,
    clientSnapshots: Object.fromEntries(rows.map((row) => [row.company, `${GENERATION}:${row.incarnation}:${row.revision}`])) });
}

/** As duas formas da resposta, conferidas entre si e com o oráculo. */
async function board(f) {
  const expected = await oracle(f);
  forgetExecutionBoards();
  const objects = json(await readExecutionBoard({ DB: f.db }, admin));
  const table = json(await readExecutionBoard({ DB: f.db }, admin, null, "table"));
  assert.deepEqual(objects.tasks, json(expected.tasks.map(boardTaskOf)), "tarefas = oráculo nos campos do quadro");
  for (const key of ["cycles", "referenceTasks", "compatibilityVersion", "clientSnapshots"])
    assert.deepEqual(objects[key], expected[key], key);
  assert.deepEqual(decodeBoardTasks(table.taskTable), objects.tasks, "a tabela devolve as mesmas tarefas");
  assert.equal("tasks" in table, false);
  const rest = (body, key) => Object.fromEntries(Object.entries(body).filter(([name]) => name !== key && name !== "etag"));
  assert.deepEqual(rest(table, "taskTable"), rest(objects, "tasks"));
  assert.notEqual(table.etag, objects.etag, "cada forma tem o seu ETag");
  return { objects, table, full: expected.tasks };
}

/** Quantos clientes o quadro atendeu sem projetar a fatia (pelo resumo com a parte do quadro). */
async function served(f) {
  let bodies = 0;
  const prepare = f.db.prepare.bind(f.db);
  const db = { prepare: (query) => { if (/company IN \(SELECT value FROM json_each/.test(query)) bodies += 1; return prepare(query); },
    batch: f.db.batch.bind(f.db) };
  const { env, meter } = instrumentQueries({ DB: db });
  forgetExecutionBoards();
  await readExecutionBoard(env, admin, null, "table");
  return { trips: meter.trips, bodies };
}

function updateDoc(f, key, mutate) {
  const value = doc(f, key);
  mutate(value);
  f.sql.prepare("UPDATE state_documents SET version=version+1,body=? WHERE workspace_id='default' AND key=?")
    .run(JSON.stringify(value), key);
  if (key === "ontology.clients.v3")
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET source_clients_version=source_clients_version+1").run();
}

/** Tudo o que o quadro lê e o que ele não deve levar: pedidos, evidência, checklist, prazo relativo, comentários. */
function enrich(f) {
  const slugs = f.clients.slice(5, 17).map((client) => client.slug);
  updateDoc(f, "ontology.clients.v3", (value) => {
    value.enrollments = slugs.map((slug, index) => ({ id: `enr-${slug}`, company: slug, productId: "founding",
      planId: "founding-companies", status: index % 4 === 3 ? "cancelada" : "ativa", startsAt: day(-60 - index) }));
  });
  for (const [index, slug] of slugs.entries()) touchSlice(f, slug, (value) => {
    const base = value.extraTasks[0];
    value.extraTasks.push(
      { ...base, id: `${slug}-request`, title: `Pedido ${index}`, kind: "request", requestedBy: "Cliente",
        priority: "alta", status: "fila", dueAt: day(0), description: "Relatório mensal", workstream: "Dados" },
      { ...base, id: `${slug}-evidence`, title: `Ata de kickoff ${index}`, status: "entregue", dueAt: day(-3),
        evidence: "Gravação no drive", approvalRequired: true, requiresEvidence: true,
        comments: [{ id: "c", authorId: "admin", at: "2026-10-01T10:00:00Z", text: "Comentário longo" }],
        history: [{ at: "2026-10-01T10:00:00Z", by: "admin", field: "status", from: "fila", to: "entregue" }] },
      { ...base, id: `${slug}-checklist`, title: `Checklist ${index}`, status: "revisao", dueAt: day(5),
        checklist: [{ id: "a", title: "Primeiro", done: true }, { id: "b", title: "Segundo", done: index % 2 === 0 }] },
      { ...base, id: `${slug}-relative`, title: `Relativa ${index}`, status: "fila", dueAt: day(1),
        startsAt: day(-1), deadline: { mode: "client", offsetDays: 150 + index }, milestone: 3 },
      { ...base, id: `${slug}-backlog`, title: `Sem prazo ${index}`, status: "fila", dueAt: "", productId: "founding",
        enrollmentId: `enr-${slug}`, blocker: { reason: "Acesso", owner: "cliente", since: day(-4) } },
    );
  });
}

/** O que o quadro e a lista calculam com as tarefas: tem de ser igual com as inteiras e com as recortadas. */
function screen(tasks, cycles, filters) {
  const names = { admin: "Ana Admin", operator: "Otávio" };
  const inCycle = new Set(cycles.flatMap((cycle) => cycle.taskIds));
  const context = { today: day(0), mine: new Set(["bench-003", "santa-clara"]),
    companyName: (slug) => `Cliente ${slug}`, ownerName: (id) => names[id] ?? id, inCycle: (id) => inCycle.has(id) };
  const filtered = filterBoardTasks(tasks, filters, context);
  return {
    ids: filtered.map((task) => task.id),
    columns: boardColumns(filtered, boardOrder).map((column) => [column.status, column.total, column.hidden,
      column.visible.map((task) => task.id)]),
    cards: filtered.slice(0, 400).map((task) => {
      const cycle = cycles.find((row) => row.company === task.company && row.taskIds.includes(task.id));
      const documents = task.id.endsWith("-request") ? [{ kind: "relatorio", relatedTaskId: task.id, reviewStatus: "aprovado" }] : [];
      return [task.id, task.title, task.status, task.dueAt, task.company, task.kind, task.priority, task.ownerId,
        task.milestone, task.productId, boardLane(task), !task.deadline || task.deadline.mode === "fixed",
        task.deadline?.mode, inferEvidence(task, { documents: task.id.endsWith("-evidence") ? [] : documents,
          meetings: ["2026-09-01"], cycleAcceptance: cycle ? { total: cycle.acceptance.length,
            approved: cycle.acceptance.filter((item) => item.done && item.approvedBy).length } : undefined }),
        awaitingApproval(task, documents), directDueDatePatch(task, day(9)), directDueDatePatch(task, day(-90)),
        Boolean(task.startsAt)];
    }),
  };
}

const NO_FILTERS = { scope: "project", statuses: [], q: "", clients: [], owners: [], milestones: [], kinds: [],
  period: "all", dateFrom: "", dateTo: "", dueOrder: "soonest" };
const FILTERS = [
  NO_FILTERS, { ...NO_FILTERS, dueOrder: "default" }, { ...NO_FILTERS, scope: "all" }, { ...NO_FILTERS, scope: "requests" },
  { ...NO_FILTERS, scope: "all", q: "relatório" }, { ...NO_FILTERS, q: "dados" }, { ...NO_FILTERS, q: "otávio" }, { ...NO_FILTERS, q: "cliente bench-01" },
  { ...NO_FILTERS, q: "diagn" }, { ...NO_FILTERS, statuses: ["revisao", "bloqueado"] }, { ...NO_FILTERS, clients: ["bench-007", "__mine__"] },
  { ...NO_FILTERS, owners: ["operator"] }, { ...NO_FILTERS, milestones: ["3", "1"] }, { ...NO_FILTERS, kinds: ["ciclo"] },
  { ...NO_FILTERS, scope: "all", kinds: ["solicitacao", "plano"] }, { ...NO_FILTERS, period: "overdue" },
  { ...NO_FILTERS, period: "today", scope: "all" }, { ...NO_FILTERS, period: "next7" },
  { ...NO_FILTERS, period: "custom", dateFrom: day(-10), dateTo: day(10) },
];

function sameScreens(full, slim, cycles) {
  const sizes = FILTERS.map((filters) => {
    const expected = screen(full, cycles, filters);
    assert.deepEqual(screen(slim, cycles, filters), expected, JSON.stringify(filters));
    return expected.ids.length;
  });
  // Os recortes não são vazios à toa: busca por descrição e frente, origem, períodos.
  assert.ok(sizes.every((size) => size > 0), JSON.stringify(sizes));
}

for (const extraClients of [92, 95, 200]) {
  test(`the board from summaries shows the same cards, columns, counts and filters as projecting every slice (${extraClients + 5} clients)`, async () => {
    const f = activeWorkspace({ extraClients, now: new Date() });
    try {
      enrich(f);
      const before = await board(f);
      const active = f.clients.length - f.archived.length;
      assert.ok(before.objects.tasks.length > active * 100, "o plano de referência entra em todas as fatias");
      assert.ok(before.full.some((task) => task.evidence) && before.full.some((task) => task.checklist?.length));
      assert.ok(before.objects.tasks.every((task) => Object.keys(task).every((key) => BOARD_TASK_FIELDS.includes(key))));
      sameScreens(before.full, before.objects.tasks, before.objects.cycles);

      writeSummaries(f);
      assert.deepEqual((await board(f)).objects, before.objects, "todos pelo resumo: mesma resposta, mesmo ETag");
      // Até 300 clientes as páginas de fatias vão no primeiro lote. Marcador (em paralelo com a
      // autorização), roster, projeção de acesso, cadastro (a projeção ficou para trás com
      // `enrich`), lote e catálogo (em paralelo com o lote).
      assert.deepEqual(await served(f), { trips: 6, bodies: 0 });

      // Resumos ausentes, ilegíveis, sem a coluna do quadro (gravados antes de 0043), com a
      // coluna ilegível, de outra linha, com outra lista de campos ou com linhas a menos:
      // esses clientes projetam a fatia.
      const missing = f.clients.filter((_, index) => index % 4 === 1).map((client) => client.slug);
      f.sql.prepare("DELETE FROM delivery_client_summary WHERE company IN (SELECT value FROM json_each(?))").run(JSON.stringify(missing));
      f.sql.prepare("UPDATE delivery_client_summary SET body='{corrompido' WHERE company=?").run(f.clients[2].slug);
      f.sql.prepare("UPDATE delivery_client_summary SET board=NULL WHERE company=?").run(f.clients[6].slug);
      f.sql.prepare("UPDATE delivery_client_summary SET board='{corrompido' WHERE company=?").run(f.clients[10].slug);
      const tamper = (slug, change) => {
        const part = JSON.parse(boardColumnPayload(f.sql.prepare("SELECT board FROM delivery_client_summary WHERE company=?").get(slug).board));
        change(part);
        f.sql.prepare("UPDATE delivery_client_summary SET board=? WHERE company=?").run(packBoard(part), slug);
      };
      tamper(f.clients[7].slug, (part) => { part.tasks.fields = part.tasks.fields.slice(1); });
      tamper(f.clients[8].slug, (part) => { part.references.push(part.tasks.rows.length); });
      tamper(f.clients[15].slug, (part) => { part.plan.followedId = "outro"; });
      tamper(f.clients[11].slug, (part) => { part.references.push(["x", "y", null]); });
      tamper(f.clients[12].slug, (part) => { part.r -= 1; });
      tamper(f.clients[14].slug, (part) => { part.inputs = "{}"; });
      const mixed = await board(f);
      assert.deepEqual(mixed.objects, before.objects, "resumos e fatias misturados");
      assert.equal((await served(f)).bodies, 1, "uma ida a mais para os corpos dos recusados");

      // Rollback: um Worker anterior regrava corpo e revisão do resumo sem conhecer a
      // coluna; a coluna antiga fica, mas não é da linha nova e o quadro projeta a fatia.
      writeSummaries(f);
      const rolled = f.clients[13].slug;
      const stale = f.sql.prepare("SELECT board FROM delivery_client_summary WHERE company=?").get(rolled).board;
      touchSlice(f, rolled, (value) => { value.extraTasks[0].title = "Mudou no Worker anterior"; });
      writeSummaries(f, { only: [rolled] });
      f.sql.prepare("UPDATE delivery_client_summary SET board=? WHERE company=?").run(stale, rolled);
      const afterRollback = await board(f);
      assert.ok(afterRollback.objects.tasks.some((task) => task.title === "Mudou no Worker anterior"));
      assert.equal((await served(f)).bodies, 1);
      if (extraClients !== 92) return;

      // Defasados pela revisão (movimento no quadro), pelo cadastro e pelo catálogo.
      writeSummaries(f);
      for (const client of f.clients.slice(3, 9))
        touchSlice(f, client.slug, (value) => { value.extraTasks[1].status = "fila"; value.extraTasks[0].dueAt = ""; });
      const moved = await board(f);
      assert.notDeepEqual(moved.objects.tasks, before.objects.tasks);
      assert.notEqual(moved.objects.etag, before.objects.etag);
      sameScreens(moved.full, moved.objects.tasks, moved.objects.cycles);
      updateDoc(f, "ontology.clients.v3", (value) => {
        value.clientEdits = { [f.clients[5].slug]: { journeyId: "programa-ia-leve" }, [f.clients[12].slug]: { startedAt: "2026-05-02" } };
        value.enrollments.find((row) => row.company === f.clients[9].slug).status = "cancelada";
      });
      const edited = await board(f);
      assert.notDeepEqual(edited.objects.tasks, moved.objects.tasks);
      assert.equal((await served(f)).bodies, 1);
      writeSummaries(f);
      updateDoc(f, "ontology.catalog.v2", (value) => { value.removedJourneys = ["founding-companies"]; });
      const replanned = await board(f);
      sameScreens(replanned.full, replanned.objects.tasks, replanned.objects.cycles);

      // Backfill de um Worker anterior na mesma revisão depois da troca de plano: corpo e
      // `inputs` novos, coluna do plano anterior. O plano seguido não bate e a fatia é projetada.
      updateDoc(f, "ontology.catalog.v2", (value) => { value.removedJourneys = []; });
      writeSummaries(f);
      const kept = f.sql.prepare("SELECT company,board FROM delivery_client_summary").all();
      updateDoc(f, "ontology.catalog.v2", (value) => { value.removedJourneys = ["founding-companies"]; });
      writeSummaries(f);
      for (const row of kept)
        f.sql.prepare("UPDATE delivery_client_summary SET board=? WHERE company=?").run(row.board, row.company);
      assert.deepEqual((await board(f)).objects.tasks, replanned.objects.tasks, "coluna de outro plano na mesma revisão");
      assert.equal((await served(f)).bodies, 1);
    } finally {
      f.sql.close();
    }
  });
}

test("production-sized clients (long descriptions, checklists, evidence, compressed slices): the column path equals projecting every slice", async () => {
  const f = activeWorkspace({ extraClients: 40, profile: "production" });
  try {
    const before = await board(f);
    writeSummaries(f);
    const after = await board(f);
    assert.equal(JSON.stringify(after.table), JSON.stringify(before.table), "mesmo JSON, byte a byte");
    assert.deepEqual(await served(f), { trips: 5, bodies: 0 });
    sameScreens(before.full, after.objects.tasks, after.objects.cycles);
  } finally {
    f.sql.close();
  }
});

test("ETag: each wire form revalidates with 304, a backfill keeps it, a slice write changes it", async () => {
  const f = activeWorkspace({ extraClients: 20 });
  try {
    const objects = await readExecutionBoard({ DB: f.db }, admin);
    const table = await readExecutionBoard({ DB: f.db }, admin, null, "table");
    assert.match(table.etag, /^"g4-board-tabela:/);
    assert.match(objects.etag, /^"g4-board:/, "a forma antiga mantém o ETag de antes da publicação");
    assert.deepEqual(await readExecutionBoard({ DB: f.db }, admin, table.etag, "table"), { notModified: true, etag: table.etag });
    assert.deepEqual(await readExecutionBoard({ DB: f.db }, admin, objects.etag), { notModified: true, etag: objects.etag });
    assert.ok(!(await readExecutionBoard({ DB: f.db }, admin, objects.etag, "table")).notModified, "ETag de outra forma não vale");
    writeSummaries(f);
    assert.deepEqual(await readExecutionBoard({ DB: f.db }, admin, table.etag, "table"), { notModified: true, etag: table.etag },
      "o resumo não muda a resposta, então o backfill não invalida o ETag");
    assert.deepEqual(json(await readExecutionBoard({ DB: f.db }, admin, null, "table")), json(table));
    touchSlice(f, f.clients[3].slug, (value) => { value.extraTasks[0].status = "em-curso"; });
    const next = await readExecutionBoard({ DB: f.db }, admin, table.etag, "table");
    assert.ok(!next.notModified);
    assert.notEqual(next.etag, table.etag);
  } finally {
    f.sql.close();
  }
});

test("a move or a due date saved through the client slice comes back on the board from the new summary", async () => {
  const f = activeWorkspace({ extraClients: 20 });
  try {
    indexOwners(f);
    writeSummaries(f);
    const env = { DB: f.db }, slug = f.clients[6].slug;
    const first = await readExecutionBoard(env, admin, null, "table");
    const moved = await executeDeliveryCommand(env, admin, "tasks.update",
      { taskId: `${slug}-late`, patch: { status: "em-curso" } }, "move-1", {}, false, first.clientSnapshots[slug]);
    assert.equal(moved.data.task.status, "em-curso");
    // Para o Backlog: sem prazo, regra fixa (o que o quadro envia ao soltar na coluna).
    await executeDeliveryCommand(env, admin, "tasks.update",
      { taskId: `${slug}-future`, patch: { status: "fila", dueAt: "", deadline: { mode: "fixed" } } }, "move-2", {}, false,
      moved.clientSnapshot);
    const after = await readExecutionBoard(env, admin, first.etag, "table");
    assert.ok(!after.notModified, "o ETag anterior deixa de valer");
    assert.deepEqual(await served(f), { trips: 5, bodies: 0 }, "o commit gravou o resumo da nova revisão");
    const tasks = decodeBoardTasks(json(after.taskTable));
    const row = (id) => tasks.find((task) => task.id === id);
    assert.equal(row(`${slug}-late`).status, "em-curso");
    assert.equal(boardLane(row(`${slug}-future`)), "backlog");
    assert.equal(after.clientSnapshots[slug], `${GENERATION}:inc-${slug}:${f.sql.prepare(
      "SELECT revision FROM delivery_client_snapshots WHERE company=?").get(slug).revision}`);
    assert.deepEqual(tasks, json((await oracle(f)).tasks.map(boardTaskOf)));
  } finally {
    f.sql.close();
  }
});

test("the board column only holds for the slice it was computed for, registry and followed plan included", async () => {
  const { buildClientSummary, summaryContext } = await import("../src/server/delivery-client-summary.ts");
  const { boardColumn, readBoardColumn, sameBoardColumn } = await import("../src/server/delivery-client-summary-board.ts");
  const f = activeWorkspace({ extraClients: 3 });
  try {
    const slug = f.clients[6].slug, raw = JSON.parse(f.sql.prepare("SELECT body FROM delivery_client_snapshots WHERE company=?").get(slug).body);
    const context = summaryContext(doc(f, "ontology.clients.v3"), doc(f, "ontology.catalog.v2"));
    const client = context.clientState.clients.find((row) => row.slug === slug);
    const summary = buildClientSummary(context, slug, raw);
    const identity = { generation: GENERATION, revision: 3, incarnation: "inc" };
    const text = boardColumn(identity, summary);
    assert.ok(text.startsWith(BOARD_PREFIX));
    const part = readBoardColumn(text, identity, context, client);
    const execution = projectClientExecution(raw, context.catalog, client, context.clientState.enrollments,
      context.clientStarts, context.enrollmentStarts, true);
    assert.deepEqual(json(part.tasks), json(execution.tasks.map(boardTaskOf)));
    assert.deepEqual(part.references, execution.referenceTasks);
    assert.ok(part.references.length > 0);
    // Outro plano seguido (backfill antigo na mesma revisão depois da troca de plano), outro cadastro.
    const payload = JSON.parse(boardColumnPayload(text));
    assert.ok(payload.references.every((row) => typeof row === "number"), "referência igual à tarefa vira índice");
    // Referência que difere da tarefa de mesmo id vai inteira.
    const moved = { ...payload, references: [...payload.references.slice(1), [execution.referenceTasks[0].id, "Outro", ""]] };
    assert.deepEqual(readBoardColumn(packBoard(moved), identity, context, client).references.at(-1),
      { id: execution.referenceTasks[0].id, company: slug, title: "Outro", dueAt: "" });
    assert.equal(readBoardColumn(packBoard({ ...payload, plan: { ...payload.plan, followedId: "outro" } }),
      identity, context, client), null);
    assert.equal(readBoardColumn(text, identity, context, { ...client, journeyId: "service-delivery" }), null);
    for (const other of [{ ...identity, revision: 4 }, { ...identity, incarnation: "x" }, { ...identity, generation: "g" }])
      assert.equal(readBoardColumn(text, other, context, client), null);
    // Formato 1 (JSON simples), texto ilegível e base64 corrompido: o quadro projeta a fatia.
    for (const stale of [JSON.stringify(payload), "{corrompido", `${BOARD_PREFIX}@@@`, `${BOARD_PREFIX}${text.slice(40)}`, null])
      assert.equal(readBoardColumn(stale, identity, context, client), null);
    // O backfill compara conteúdo, não bytes comprimidos.
    assert.ok(sameBoardColumn(packBoard(payload), text));
    assert.ok(!sameBoardColumn(JSON.stringify(payload), text));
    assert.ok(sameBoardColumn(null, null) && !sameBoardColumn(null, text));
    // Grande demais para o comando do backfill: sem coluna, nos dois escritores.
    const huge = { ...summary, body: { ...summary.body, cycles: [{ goal: "y".repeat(95_000) }] } };
    assert.equal(boardColumn(identity, huge), null);
  } finally {
    f.sql.close();
  }
});

test("isolate cache: repeated reads skip the slices, writes invalidate, authorization always runs, no sharing across bindings or workspaces", async () => {
  const f = activeWorkspace({ extraClients: 20 });
  try {
    writeSummaries(f);
    forgetExecutionBoards();
    let batches = 0;
    const db = { prepare: f.db.prepare.bind(f.db), batch: (statements) => { batches += 1; return f.db.batch(statements); } };
    const read = async (principal = admin, wire = "table", env = {}) => {
      const { env: metered, meter } = instrumentQueries({ DB: db, ...env });
      const body = await readExecutionBoard(metered, principal, null, wire);
      return { body, trips: meter.trips };
    };
    // Pedidos simultâneos com o cache vazio fazem um cálculo só.
    const [first, second, third] = await Promise.all([read(), read(), read(session("reader"))]);
    assert.equal(batches, 1, "um lote de fatias para os três pedidos");
    assert.equal(second.body, first.body);
    assert.equal(third.body, first.body, "o quadro não depende da pessoa");
    // Acerto: marcador (em paralelo com a autorização) e autorização, nenhum corpo.
    const hit = await read(session("operator"));
    assert.equal(batches, 1);
    assert.ok(hit.trips <= 3, `${hit.trips} idas`);
    assert.deepEqual(json(hit.body), json(first.body));
    const objects = await read(admin, "objects");
    assert.equal(batches, 1, "a outra forma sai do mesmo quadro");
    assert.deepEqual(decodeBoardTasks(json(first.body.taskTable)), json(objects.body.tasks));
    // Backfill não muda a resposta nem a chave: continua do cache.
    writeSummaries(f);
    await read();
    assert.equal(batches, 1);
    // Escrita numa fatia, cadastro e catálogo invalidam.
    touchSlice(f, f.clients[3].slug, (value) => { value.extraTasks[0].title = "Mudou"; });
    const moved = await read();
    assert.equal(batches, 2);
    assert.ok(decodeBoardTasks(json(moved.body.taskTable)).some((task) => task.title === "Mudou"));
    assert.notEqual(moved.body.etag, first.body.etag);
    f.sql.prepare("UPDATE state_documents SET version=version+1 WHERE key='ontology.catalog.v2'").run();
    await read();
    assert.equal(batches, 3);
    f.sql.prepare("UPDATE state_documents SET version=version+1 WHERE key='ontology.clients.v3'").run();
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET source_clients_version=source_clients_version+1").run();
    const registry = await read();
    assert.equal(batches, 4);
    assert.deepEqual(json(registry.body), json(await readExecutionBoard({ DB: f.db }, admin, null, "table")),
      "o que ficou no cache é o que a leitura daria");
    // Autorização antes do cache: integração, quem não é membro e outro workspace não recebem nada.
    await assert.rejects(read({ ...admin, kind: "integration" }), { code: "session_required" });
    await assert.rejects(read({ ...admin, email: "intruso@example.test", memberId: "intruso" }));
    await assert.rejects(read(admin, "table", { WORKSPACE_ID: "outro" }));
    assert.equal(batches, 4);
    // Outro binding (outro banco com os mesmos dados) calcula o seu.
    const g = activeWorkspace({ extraClients: 20 });
    try {
      let other = 0;
      const gdb = { prepare: g.db.prepare.bind(g.db), batch: (statements) => { other += 1; return g.db.batch(statements); } };
      await readExecutionBoard({ DB: gdb }, admin, null, "table");
      assert.equal(other, 1);
    } finally {
      g.sql.close();
    }
  } finally {
    forgetExecutionBoards();
    f.sql.close();
  }
});

test("the wire table round-trips any task exactly and gives each task its own objects", () => {
  const tasks = [
    { id: "a", company: "x", title: "1", description: "", status: "fila", ownerId: "o", dueAt: "", milestone: 0,
      checklist: [{ id: "c", title: "t", done: true }], deadline: { mode: "fixed" }, requiresEvidence: false },
    { id: "b", company: "x", title: 1, description: "1", status: "fila", ownerId: "o", dueAt: "2026-01-01", milestone: 1,
      checklist: [{ id: "c", title: "t", done: true }], deadline: { mode: "fixed" }, requiresEvidence: true, evidence: "1",
      approvalRequired: false, kind: "request", priority: "alta", productId: "p", startsAt: "2025-12-01", workstream: "w" },
    { id: "c", company: "y", title: "true", status: "entregue", milestone: 1, hours: 4, comments: [1] },
  ];
  const decoded = decodeBoardTasks(json(encodeBoardTasks(tasks)));
  assert.deepEqual(decoded, json(tasks.map(boardTaskOf)));
  assert.equal(typeof decoded[1].title, "number", "1 e \"1\" não se confundem");
  assert.notEqual(decoded[0].checklist, decoded[1].checklist, "objetos não são compartilhados entre tarefas");
  assert.equal(decoded[2].hours, undefined, "campo fora do quadro não viaja");
  assert.deepEqual(decodeBoardTasks(encodeBoardTasks([])), []);
  assert.throws(() => decodeBoardTasks({ fields: ["title"], values: [null], rows: [["a", 3]] }));
  assert.throws(() => decodeBoardTasks({ fields: ["title"], values: [null], rows: [[1, 0]] }));
  assert.throws(() => decodeBoardTasks({ fields: ["__proto__"], values: [null, {}], rows: [["a", 1]] }), "só campos do quadro");
});
