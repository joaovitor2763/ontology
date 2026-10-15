import test from "node:test";
import assert from "node:assert/strict";
import { activeWorkspace, session, touchSlice, GENERATION } from "./helpers/active-workspace.mjs";
import { instrumentQueries } from "../src/server/timing.ts";
import { decodeStateBody } from "../src/server/state-body.ts";
import { readActiveAlertDelivery } from "../src/server/operations/delivery-alert-source.ts";
import { keys, projectAlerts, alertAudience, alertClockOf } from "../src/server/operations/alerts.ts";
import { countAlerts, alertQueueValidUntil, alertHour } from "../src/server/operations/alerts-count.ts";
import { readAcknowledged, unseenBy, acknowledgmentStatement } from "../src/server/operations/alert-acknowledgments.ts";
import { readPortfolioSummary } from "../src/server/operations/portfolio.ts";
import { readAlertQueue } from "../src/server/operations/alert-queue.ts";
import { readExecutionBoard } from "../src/server/operations/execution-board.ts";
import { readExecutionCycles } from "../src/server/operations/execution-cycles.ts";
import { searchTasks } from "../src/server/operations/search-tasks.ts";
import { readStateBatch } from "../src/server/operations/state-batch.ts";
import { freshDocumentSnapshot } from "../src/server/operations/request-context.ts";
import { workspaceMinute } from "../src/shared/lib/format.ts";

/**
 * Leituras globais em `active` (plano de desempenho do banco, fases A e B):
 * mesmas respostas do leitor antigo, menos idas ao D1 e um contador de alertas
 * que calcula a fila do workspace uma vez e aplica o recorte de cada pessoa em
 * memória.
 */

/** O leitor anterior à fase A, como estava em `main`: marcador, lote, marcador ×2. */
async function legacyReadActiveAlertDelivery(db, workspace, company) {
  const marker = (generation) => db.prepare(`SELECT compatibility_version FROM delivery_client_shadow_meta
    WHERE workspace_id=? AND generation=? AND mode='active'`).bind(workspace, generation);
  const page = (generation, last) => db.prepare(`SELECT company,revision,incarnation,body
    FROM delivery_client_snapshots WHERE workspace_id=? AND generation=?
      ${company ? "AND company=?" : ""} AND company>? ORDER BY company LIMIT 100`)
    .bind(workspace, generation, ...(company ? [company] : []), last);
  for (let attempt = 0; attempt < 3; attempt++) {
    const meta = await db.prepare(`SELECT m.generation,m.compatibility_version,
        m.expected_clients,m.source_clients_version,c.version AS current_clients_version
      FROM delivery_client_shadow_meta m LEFT JOIN state_documents c ON c.workspace_id=m.workspace_id
        AND c.key='ontology.clients.v3' WHERE m.workspace_id=? AND m.mode='active'`).bind(workspace).first();
    if (!meta) return null;
    if (meta.current_clients_version !== meta.source_clients_version) throw new Error("incomplete");
    const [first, current] = await db.batch([page(meta.generation, ""), marker(meta.generation)]);
    if (current.results[0]?.compatibility_version !== meta.compatibility_version) continue;
    const rows = [...first.results];
    while (rows.length && rows.length % 100 === 0) {
      const next = await page(meta.generation, rows.at(-1).company).all();
      rows.push(...next.results);
      if (next.results.length < 100) break;
    }
    const final = await marker(meta.generation).first();
    if (final?.compatibility_version !== meta.compatibility_version) continue;
    if (rows.length !== (company ? 1 : meta.expected_clients)) throw new Error("incomplete");
    const slices = await Promise.all(rows.map(async (row) => ({ company: row.company, raw: await decodeStateBody(row.body) })));
    return { slices, heads: rows.map(({ company, revision, incarnation }) => ({ company, revision, incarnation })),
      generation: meta.generation, compatibilityVersion: meta.compatibility_version };
  }
  throw new Error("snapshot_changed");
}

const WORKSPACE = "ontology.workspace.v3";
/** Fila esperada, calculada à parte: documentos frescos, leitor antigo, ciência e público da pessoa. */
async function expectedQueue(f, principal, at, nowIso = workspaceMinute(at)) {
  // Pelo banco sem o contador de `sliceReads`: o oráculo não conta como leitura do código.
  const db = f.unhooked ?? f.db;
  const [clients, catalog, engagement, stakeholders, roster] =
    await freshDocumentSnapshot(db, "default", [keys[0], keys[2], keys[3], keys[4], WORKSPACE]);
  const docs = [clients, null, catalog, engagement, stakeholders, roster];
  const effective = await legacyReadActiveAlertDelivery(db, "default");
  const { candidates, work } = projectAlerts(docs, undefined, nowIso, effective);
  const unseen = unseenBy(await readAcknowledged(db, "default", principal.memberId), work.hidden);
  const audience = alertAudience(docs, principal, at);
  return candidates.filter((a) => unseen(a) && (!audience || audience.has(a.company)));
}

/** Conta quantas leituras de corpos de fatia (a parte cara) passaram pelo banco. */
function sliceReads(f) {
  const prepare = f.db.prepare.bind(f.db);
  f.unhooked = { prepare, batch: f.db.batch.bind(f.db) };
  const counter = { n: 0 };
  f.db.prepare = (sql) => {
    if (/^\s*SELECT[\s\S]*\bbody\b[\s\S]*FROM\s+delivery_client_s(?:hadow_meta|napshots)[\s\S]*delivery_client_snapshots|^\s*SELECT company,revision,incarnation,body/.test(sql)) counter.n++;
    return prepare(sql);
  };
  return counter;
}

/** Roda `read` e o oráculo no mesmo minuto do relógio do app (refreshNow), repetindo se o minuto virar no meio. */
async function inOneMinute(read) {
  for (;;) {
    const before = workspaceMinute();
    const result = await read(before);
    if (workspaceMinute() === before) return result;
  }
}

const people = ["admin", "gestor", "operator", "reader"].map(session);
const bodyOf = (result) => JSON.parse(JSON.stringify(result));

test("the batched active reader returns exactly what the previous reader returned, with and without pagination", async () => {
  for (const extraClients of [0, 94, 95, 200]) {
    const f = activeWorkspace({ extraClients });
    try {
      const legacy = await legacyReadActiveAlertDelivery(f.db, "default");
      const current = await readActiveAlertDelivery(f.db, "default");
      assert.equal(current.slices.length, extraClients + 5);
      const { sourceClientsVersion, ...rest } = current;
      assert.equal(sourceClientsVersion, 9);
      assert.deepEqual(rest, legacy, `${extraClients + 5} clientes`);
      const company = f.clients[1].slug;
      const one = await readActiveAlertDelivery(f.db, "default", company);
      delete one.sourceClientsVersion;
      assert.deepEqual(one, await legacyReadActiveAlertDelivery(f.db, "default", company));
    } finally {
      f.sql.close();
    }
  }
});

test("one D1 batch per active read: up to 99 clients the slices, marker and versions are a single trip", async () => {
  const f = activeWorkspace({ extraClients: 92 });
  try {
    const admin = session("admin");
    const trips = async (run) => {
      const { env, meter } = instrumentQueries({ DB: f.db });
      await run(env);
      return meter.trips;
    };
    // roster, documentos (pré-carga), autorização por índice e o lote das fatias.
    assert.equal(await trips((env) => readPortfolioSummary(env, admin)), 4, "portfolio: antes 10");
    assert.equal(await trips((env) => readAlertQueue(env, admin)), 4, "alerts: antes 10");
    // O quadro lê também o marcador (em paralelo com a autorização) para acertar o cache do isolate.
    assert.equal(await trips((env) => readExecutionBoard(env, admin)), 5, "board: antes 9");
    assert.equal(await trips((env) => readExecutionCycles(env, admin)), 4, "cycles: antes 9");
    assert.equal(await trips((env) => searchTasks(env, admin, "Atrasada")), 4, "search: antes 10");
    // ETag igual: um comando para marcador e versões (antes dois).
    const board = await readExecutionBoard({ DB: f.db }, admin);
    const cycles = await readExecutionCycles({ DB: f.db }, admin);
    const tagged = async (run) => {
      const { env, meter } = instrumentQueries({ DB: f.db });
      const result = await run(env);
      assert.equal(result.notModified, true);
      return meter.trips;
    };
    assert.equal(await tagged((env) => readExecutionBoard(env, admin, board.etag)), 3,
      "marcador em paralelo com roster e autorização; sem pré-carga de documentos");
    assert.equal(await tagged((env) => readExecutionCycles(env, admin, cycles.etag)), 3,
      "roster, autorização e um comando de marcador e versões; nenhum corpo");
    // Contador: primeiro pedido calcula a fila; os seguintes, de qualquer pessoa, só revalidam.
    const at = new Date();
    assert.equal(await trips((env) => countAlerts(env, admin, { now: at })), 5, "falha do cache: antes 8");
    assert.equal(await trips((env) => countAlerts(env, admin, { now: at })), 3, "acerto: antes 4");
    assert.equal(await trips((env) => countAlerts(env, session("operator"), { now: at })), 4,
      "outra pessoa acerta a mesma fila (+ cadastro para o recorte); antes 8, recalculando tudo");
    // Até 300 clientes as páginas vão no primeiro lote (antes: uma ida por página de 100).
    const g = activeWorkspace({ extraClients: 200 });
    try {
      const { env, meter } = instrumentQueries({ DB: g.db });
      await readPortfolioSummary(env, admin);
      assert.equal(meter.trips, 4, "205 clientes: antes 6");
    } finally {
      g.sql.close();
    }
    // Acima de 300, cada página seguinte é uma ida com o marcador.
    const h = activeWorkspace({ extraClients: 305 });
    try {
      const { env, meter } = instrumentQueries({ DB: h.db });
      const portfolio = await readPortfolioSummary(env, admin);
      assert.equal(meter.trips, 5);
      assert.equal(Object.keys(portfolio.data).length, h.clients.length);
    } finally {
      h.sql.close();
    }
  } finally {
    f.sql.close();
  }
});

test("portfolio, queue, count, board and cycles answer the same as an independent projection of the same data", async () => {
  const f = activeWorkspace({ extraClients: 40 });
  try {
    const env = { DB: f.db }, at = new Date();
    for (const person of people) {
      const expected = await expectedQueue(f, person, at);
      assert.equal((await countAlerts(env, person, { now: at })).data.count, expected.length, person.memberId);
      // A fila lê o relógio na hora do pedido (`refreshNow()`); o oráculo usa o mesmo minuto.
      const [queue, expectedForQueue] = await inOneMinute(async (minute) =>
        [await readAlertQueue(env, person), await expectedQueue(f, person, new Date(), minute)]);
      assert.deepEqual(queue.data.map((a) => a.id).sort(), expectedForQueue.map((a) => a.id).sort(), person.memberId);
    }
    const admin = session("admin");
    const legacy = await legacyReadActiveAlertDelivery(f.db, "default");
    // As mesmas respostas pelo invólucro da requisição (memória, cache do roster) e direto no banco.
    for (const read of [(e) => readPortfolioSummary(e, admin), (e) => readPortfolioSummary(e, admin, "operator"),
      (e) => readExecutionBoard(e, admin), (e) => readExecutionCycles(e, admin), (e) => searchTasks(e, admin, "Bloqueada 1")]) {
      const plain = bodyOf(await read(env));
      assert.deepEqual(bodyOf(await read(instrumentQueries(env).env)), plain);
    }
    const board = await readExecutionBoard(env, admin);
    assert.deepEqual(board.clientSnapshots, Object.fromEntries(legacy.heads.map((h) =>
      [h.company, `${GENERATION}:${h.incarnation}:${h.revision}`])));
    assert.equal(board.compatibilityVersion, legacy.compatibilityVersion);
    const [portfolio, visible] = await inOneMinute(async (minute) =>
      [await readPortfolioSummary(env, admin), await expectedQueue(f, admin, new Date(), minute)]);
    for (const client of f.clients.slice(0, 10))
      assert.equal(portfolio.data[client.slug].alertCount, visible.filter((a) => a.company === client.slug).length);
  } finally {
    f.sql.close();
  }
});

test("documents read before the batch must match the versions read with the slices, or the global screens refuse a mixed snapshot", async () => {
  const f = activeWorkspace({ extraClients: 10 });
  try {
    const admin = session("admin");
    const batch = f.db.batch.bind(f.db);
    let armed = false;
    // Uma gravação entre a pré-carga dos documentos e o lote das fatias.
    f.db.batch = async (statements) => {
      if (armed) {
        armed = false;
        f.sql.prepare("UPDATE state_documents SET version=version+1 WHERE key='ontology.catalog.v2'").run();
      }
      return batch(statements);
    };
    for (const read of [(e) => readPortfolioSummary(e, admin), (e) => readAlertQueue(e, admin),
      (e) => readExecutionCycles(e, admin)]) {
      const { env } = instrumentQueries({ DB: f.db });
      armed = true;
      await assert.rejects(read(env), { code: "snapshot_changed" });
    }
    // O quadro lê os documentos junto com o lote (não antes): recusa ou responde com a versão nova.
    const { env } = instrumentQueries({ DB: f.db });
    armed = true;
    const board = await readExecutionBoard(env, admin).catch((error) => error);
    const catalog = f.sql.prepare("SELECT version FROM state_documents WHERE key='ontology.catalog.v2'").get().version;
    assert.ok(board.code === "snapshot_changed" || board.etag.endsWith(`:${catalog}"`), String(board.etag ?? board.code));
    // Sem disputa, a mesma leitura responde.
    assert.ok((await readPortfolioSummary(instrumentQueries({ DB: f.db }).env, admin)).data);
  } finally {
    f.sql.close();
  }
});

test("a slice write between two pages restarts the read instead of mixing revisions", async () => {
  // Mais de 300 clientes: o primeiro lote leva três páginas e a quarta vem em outra ida.
  const f = activeWorkspace({ extraClients: 345 });
  try {
    const batch = f.db.batch.bind(f.db);
    let calls = 0;
    f.db.batch = async (statements) => {
      calls += 1;
      // Depois da primeira página, um escritor muda um cliente da primeira página.
      if (calls === 2) touchSlice(f, f.clients[0].slug, (value) => { value.extraTasks[0].title = "Mudou no meio"; });
      return batch(statements);
    };
    const current = await readActiveAlertDelivery(f.db, "default");
    assert.ok(calls >= 3, "the read restarted");
    const { sourceClientsVersion, ...rest } = current;
    assert.equal(sourceClientsVersion, 9);
    f.db.batch = batch;
    assert.deepEqual(rest, await legacyReadActiveAlertDelivery(f.db, "default"));
    assert.ok(current.slices.some((s) => s.raw.extraTasks?.[0]?.title === "Mudou no meio"));
  } finally {
    f.sql.close();
  }
});

test("the alert counter computes the workspace queue once and filters per person in memory", async () => {
  const f = activeWorkspace({ extraClients: 30 });
  try {
    const env = { DB: f.db }, at = new Date(), reads = sliceReads(f);
    const [admin, gestor, operator, reader] = people;
    const count = async (person, now = at) => (await countAlerts(env, person, { now })).data.count;
    assert.equal(await count(admin), (await expectedQueue(f, admin, at)).length);
    assert.ok(reads.n > 0);
    reads.n = 0;
    // Outras pessoas e níveis: mesma fila do workspace, recorte próprio, nenhuma fatia relida.
    assert.equal(await count(gestor), (await expectedQueue(f, gestor, at)).length);
    const operatorBefore = await count(operator);
    assert.equal(operatorBefore, (await expectedQueue(f, operator, at)).length);
    assert.ok(operatorBefore < await count(admin), "AI Master counts only allocated clients");
    assert.equal(await count(reader), (await expectedQueue(f, reader, at)).length);
    reads.n = 0;
    // A ciência é da pessoa: muda só o contador dela, sem recalcular a fila.
    const own = (await expectedQueue(f, operator, at))[0];
    await f.db.batch([acknowledgmentStatement(f.db, "default", "operator",
      [{ company: own.company, alertId: own.id }], at.toISOString())]);
    assert.equal(await count(operator), operatorBefore - 1);
    assert.equal(await count(admin), (await expectedQueue(f, admin, at)).length);
    assert.equal(reads.n, 0, "acknowledgment never invalidates the shared queue");
    // Perder a alocação tira o cliente do recorte já na próxima leitura.
    const clients = JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.clients.v3'").get().body);
    clients.allocations = clients.allocations.filter((a) => a.memberId !== "reader");
    f.sql.prepare("UPDATE state_documents SET body=?,version=10 WHERE key='ontology.clients.v3'").run(JSON.stringify(clients));
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET source_clients_version=10").run();
    f.sql.prepare("UPDATE client_access_meta SET source_clients_version=10").run();
    assert.equal(await count(reader), 0);
  } finally {
    f.sql.close();
  }
});

test("the counter cache is invalidated by data versions, the hour (day in São Paulo and UTC) and meeting edges", async () => {
  // Reuniões do exemplo relativas ao mesmo relógio fixo do teste (não à hora real da execução).
  const at = new Date("2026-10-06T15:20:00.000Z");
  const f = activeWorkspace({ extraClients: 20, now: at });
  try {
    const env = { DB: f.db }, admin = session("admin"), reads = sliceReads(f);
    const count = async (now = at) => (await countAlerts(env, admin, { now })).data.count;
    const fresh = async (now = at) => (await expectedQueue(f, admin, now)).length;
    await count();
    reads.n = 0;
    assert.equal(await count(new Date(at.getTime() + 60_000)), await fresh());
    assert.equal(reads.n, 0, "same data, same hour: no slice read (the old cache expired every minute)");
    // Uma escrita na fatia muda a versão lógica: a fila é recalculada.
    const company = f.clients[3].slug;
    touchSlice(f, company, (value) => { value.extraTasks.push({ ...value.extraTasks[0], id: `${company}-new`, title: "Nova", dueAt: "2026-01-01" }); });
    assert.equal(await count(), await fresh());
    assert.ok(reads.n > 0);
    // Documento do workspace (arquivo `hidden`) também é chave.
    const hiddenId = (await expectedQueue(f, admin, at))[0].id;
    const roster = JSON.parse(f.sql.prepare(`SELECT body FROM state_documents WHERE key='${WORKSPACE}'`).get().body);
    f.sql.prepare(`UPDATE state_documents SET body=?,version=version+1 WHERE key='${WORKSPACE}'`)
      .run(JSON.stringify({ ...roster, hidden: [hiddenId] }));
    assert.equal(await count(), await fresh());
    // Hora cheia, virada do dia UTC (21h em São Paulo) e do dia local (0h).
    for (const iso of ["2026-10-06T16:00:00.000Z", "2026-10-06T23:59:00.000Z", "2026-10-07T00:00:00.000Z",
      "2026-10-07T02:59:00.000Z", "2026-10-07T03:00:00.000Z"]) {
      reads.n = 0;
      const now = new Date(iso);
      assert.equal(await count(now), await fresh(now), iso);
      assert.ok(reads.n > 0, `recomputed at ${iso}`);
    }
    assert.equal(alertHour(new Date("2026-10-07T02:59:00.000Z")), "2026-10-06T23");
    assert.equal(alertHour(new Date("2026-10-07T03:00:00.000Z")), "2026-10-07T00");
  } finally {
    f.sql.close();
  }
});

test("time-based alert rules bound the cached queue at the next meeting edge", () => {
  const at = new Date("2026-10-06T15:20:00.000Z"), rules = { presentationRehearsalHours: 48 };
  assert.equal(alertQueueValidUntil(at, [], rules), Date.parse("2026-10-06T16:00:00.000Z"));
  // Uma reunião que começa antes da hora cheia: o limite é o início.
  assert.equal(alertQueueValidUntil(at, [{ startsAt: "2026-10-06T15:35:00.000Z" }], rules), Date.parse("2026-10-06T15:35:00.000Z"));
  // Entra na janela de 48 h (ensaio e entrevista) antes da hora cheia.
  assert.equal(alertQueueValidUntil(at, [{ startsAt: "2026-10-08T15:45:00.000Z" }], rules), Date.parse("2026-10-06T15:45:00.000Z"));
  assert.equal(alertQueueValidUntil(at, [{ startsAt: "2026-10-07T15:30:00.000Z" }], { presentationRehearsalHours: 24 }),
    Date.parse("2026-10-06T15:30:00.000Z"));
  // Texto sem fuso (comparado como texto com o ISO em UTC) e com fuso: os dois instantes contam.
  assert.equal(alertQueueValidUntil(at, [{ startsAt: "2026-10-06T15:50:00-03:00" }], rules), Date.parse("2026-10-06T15:50:00.000Z"));
  assert.equal(alertQueueValidUntil(at, [{ startsAt: "2026-10-06T15:25" }], rules), Date.parse("2026-10-06T15:25:00.000Z"));
  // Reunião passada ou data inválida não muda nada.
  assert.equal(alertQueueValidUntil(at, [{ startsAt: "2026-10-01T10:00:00.000Z" }, { startsAt: "" }], rules), Date.parse("2026-10-06T16:00:00.000Z"));
});

test("a meeting edge inside the hour expires the cached count exactly when the rule flips", async () => {
  const at = new Date("2026-10-06T15:20:00.000Z");
  const f = activeWorkspace({ extraClients: 5, now: at });
  try {
    const env = { DB: f.db }, admin = session("admin"), reads = sliceReads(f);
    const engagement = JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key='ontology.engagement.v2'").get().body);
    // Apresentação sem ensaio, gravada como instante ISO (como o app grava): entra na janela de
    // 48 h às 15:40 UTC, qualquer que seja o fuso do processo.
    engagement.extraMeetings.push({ id: "edge", company: f.clients[2].slug, title: "Borda", kind: "apresentacao",
      startsAt: "2026-10-08T15:40:00.000Z", attendeeIds: [], durationMin: 60, summary: "", notes: "", decisions: [], actions: [] });
    f.sql.prepare("UPDATE state_documents SET body=?,version=version+1 WHERE key='ontology.engagement.v2'").run(JSON.stringify(engagement));
    const before = (await countAlerts(env, admin, { now: at })).data.count;
    reads.n = 0;
    assert.equal((await countAlerts(env, admin, { now: new Date("2026-10-06T15:39:00.000Z") })).data.count, before);
    assert.equal(reads.n, 0);
    const after = new Date("2026-10-06T15:41:00.000Z");
    assert.equal((await countAlerts(env, admin, { now: after })).data.count, before + 1);
    assert.equal(before + 1, (await expectedQueue(f, admin, after)).length);
  } finally {
    f.sql.close();
  }
});

test("the counter cache is per workspace and never crosses workspaces on the same binding", async () => {
  const f = activeWorkspace({ extraClients: 10 });
  try {
    const admin = session("admin");
    const roster = f.sql.prepare(`SELECT body FROM state_documents WHERE key='${WORKSPACE}'`).get().body;
    f.sql.prepare("INSERT OR IGNORE INTO workspaces(id,name) VALUES('other','Outro')").run();
    f.sql.prepare(`INSERT INTO state_documents(workspace_id,key,version,body) VALUES('other',?,4,?)`).run(WORKSPACE, roster);
    const main = (await countAlerts({ DB: f.db }, admin)).data.count;
    const other = (await countAlerts({ DB: f.db, WORKSPACE_ID: "other" }, admin)).data.count;
    assert.notEqual(other, main);
    assert.equal((await countAlerts({ DB: f.db }, admin)).data.count, main);
    assert.equal((await countAlerts({ DB: f.db, WORKSPACE_ID: "other" }, admin)).data.count, other);
  } finally {
    f.sql.close();
  }
});

test("the bootstrap never waits for an active counter that is not ready: it answers the documents and computes after the response", async () => {
  const f = activeWorkspace({ extraClients: 10 });
  try {
    const query = "keys=ontology.clients.v3,ontology.workspace.v3&with=session,google,alerts";
    const call = (options) => readStateBatch(new Request(`https://delivery.test/api/state?${query}`),
      { DB: f.db, AUTH_MODE: "dev", DEV_USER_EMAIL: "admin@example.test" }, options);
    const deferred = [];
    const first = await (await call({ waitUntil: (work) => deferred.push(work) })).json();
    assert.equal("alerts" in first, false, "absent block: the browser keeps its number and asks the count route");
    assert.deepEqual(first.documents.map((d) => d.key), ["ontology.clients.v3", "ontology.workspace.v3"]);
    assert.equal(deferred.length, 1);
    await Promise.all(deferred);
    const second = await (await call({ waitUntil: (work) => deferred.push(work) })).json();
    assert.equal(second.alerts.count, (await expectedQueue(f, session("admin"), new Date())).length);
    assert.equal(deferred.length, 1, "a ready queue is answered in the same response");
    // Sem `waitUntil` (fora do Worker) o pedido espera, como sempre.
    touchSlice(f, f.clients[1].slug, (value) => { value.extraTasks[1].status = "fila"; value.extraTasks[1].blockers = ""; });
    const blocking = await (await call()).json();
    assert.equal(blocking.alerts.count, (await expectedQueue(f, session("admin"), new Date())).length);
  } finally {
    f.sql.close();
  }
});

test("polling revalidates versions and reads only changed bodies in one statement", async () => {
  const f = activeWorkspace({ extraClients: 5 });
  try {
    const statements = [];
    const prepare = f.db.prepare.bind(f.db);
    f.db.prepare = (sql) => { statements.push(sql); return prepare(sql); };
    const call = async (versions) => (await readStateBatch(new Request(
      `https://delivery.test/api/state?keys=ontology.clients.v3,ontology.catalog.v2,ontology.workspace.v3&versions=${versions}`),
      { DB: f.db, AUTH_MODE: "dev", DEV_USER_EMAIL: "admin@example.test" })).json();
    const same = await call("ontology.clients.v3:9,ontology.catalog.v2:2,ontology.workspace.v3:4");
    assert.deepEqual(same.unchanged, ["ontology.clients.v3", "ontology.catalog.v2", "ontology.workspace.v3"]);
    assert.deepEqual(same.documents, []);
    statements.length = 0;
    const changed = await call("ontology.clients.v3:8,ontology.catalog.v2:2,ontology.workspace.v3:4");
    assert.deepEqual(changed.unchanged, ["ontology.catalog.v2", "ontology.workspace.v3"]);
    assert.deepEqual(changed.documents.map((d) => [d.key, d.version]), [["ontology.clients.v3", 9]]);
    assert.equal(changed.documents[0].value.extraClients.length, 5);
    assert.equal(statements.filter((sql) => /FROM state_documents/.test(sql) && /body/.test(sql)).length, 1,
      "versions and the changed body come from the same statement");
  } finally {
    f.sql.close();
  }
});

test("alert rules get the São Paulo date for day rules and the real instant for meetings, whatever clock the caller passes", () => {
  // 23h30 em São Paulo = 02h30 UTC do dia seguinte: o dia das regras continua o de São Paulo.
  const late = { today: "2026-10-06", now: "2026-10-07T02:30:00.000Z" };
  assert.deepEqual(alertClockOf("2026-10-06T23:30:00"), late, "hora de parede (refreshNow)");
  assert.deepEqual(alertClockOf("2026-10-07T02:30:00.000Z"), late, "instante");
  assert.deepEqual(alertClockOf("2026-10-06T23:30"), late, "sem segundos");
  assert.deepEqual(alertClockOf("2026-10-06"), { today: "2026-10-06", now: "2026-10-06T03:00:00.000Z" });
  assert.deepEqual(alertClockOf("2026-10-06T20:30:00-03:00"), { today: "2026-10-06", now: "2026-10-06T23:30:00.000Z" });
});
