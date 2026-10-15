import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Relógio fixo: as rotas leem `refreshNow()`/`new Date()` e as comparações
// precisam do mesmo minuto nos dois caminhos.
const FIXED = Date.parse("2026-10-06T15:20:00.000Z");
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [FIXED])); }
  static now() { return FIXED; }
};
const { activeWorkspace, session, touchSlice, writeSummaries, GENERATION } = await import("./helpers/active-workspace.mjs");
const { instrumentQueries } = await import("../src/server/timing.ts");
const { readPortfolioSummary } = await import("../src/server/operations/portfolio.ts");
const { readAlertQueue } = await import("../src/server/operations/alert-queue.ts");
const { countAlerts } = await import("../src/server/operations/alerts-count.ts");
const { alertDocuments, readAlerts } = await import("../src/server/operations/alerts.ts");
const { planSummaryBackfill, summaryBackfillSql } = await import("../src/server/delivery-client-summary-backfill.ts");
const { projectClientExecution, projectClientExecutionWithPlan, followedPlanId } =
  await import("../src/modules/delivery/infrastructure/client-projection.ts");
const { normalizeCatalogSnapshot } = await import("../src/modules/catalog/infrastructure/snapshot.ts");

/**
 * Fase C do plano de desempenho do banco: carteira, fila e contador leem o
 * resumo persistido por cliente (0042) e caem na fatia quando ele não vale. O
 * critério é igualdade exata com o caminho antigo (tabela de resumos vazia =
 * projetar todas as fatias, como antes) em qualquer mistura de resumos atuais,
 * ausentes, ilegíveis e defasados por revisão, por cadastro ou por catálogo.
 */
const admin = session("admin"), operator = session("operator"), reader = session("reader");
const day = (offset) => new Date(FIXED + offset * 86_400_000).toISOString().slice(0, 10);
const json = (value) => JSON.parse(JSON.stringify(value));
/** Um binding novo por leitura: o contador não reaproveita a fila de outro cenário. */
const fresh = (f) => ({ DB: { prepare: f.db.prepare.bind(f.db), batch: f.db.batch.bind(f.db) } });

async function reads(f) {
  const company = f.clients[1].slug, out = {};
  out.portfolio = await readPortfolioSummary(fresh(f), admin);
  out.member = await readPortfolioSummary(fresh(f), admin, "operator");
  for (const person of [admin, operator, reader]) {
    out[`queue-${person.memberId}`] = await readAlertQueue(fresh(f), person);
    out[`count-${person.memberId}`] = await countAlerts(fresh(f), person);
  }
  out.queueCompany = await readAlertQueue(fresh(f), admin, company);
  out.v1 = await readAlerts(fresh(f), admin, { company: f.clients[7].slug, limit: 100 });
  return json(out);
}

/** O caminho antigo: as mesmas leituras com a tabela de resumos vazia (e devolvida depois). */
async function legacyReads(f) {
  f.sql.exec("CREATE TEMP TABLE kept AS SELECT * FROM delivery_client_summary; DELETE FROM delivery_client_summary;");
  try { return await reads(f); }
  finally { f.sql.exec("INSERT INTO delivery_client_summary SELECT * FROM kept; DROP TABLE kept;"); }
}

/** Quantos clientes ativos a leitura atendeu pelo resumo. */
async function summarized(f) {
  const { effective } = await alertDocuments(f.db, "default", "ontology.workspace.v3");
  return { executions: effective.executions.size, slices: effective.slices.length };
}

function updateDoc(f, key, mutate) {
  const row = f.sql.prepare("SELECT version,body FROM state_documents WHERE workspace_id='default' AND key=?").get(key);
  const value = JSON.parse(row.body);
  mutate(value);
  f.sql.prepare("UPDATE state_documents SET version=version+1,body=? WHERE workspace_id='default' AND key=?")
    .run(JSON.stringify(value), key);
  if (key === "ontology.clients.v3")
    f.sql.prepare("UPDATE delivery_client_shadow_meta SET source_clients_version=source_clients_version+1").run();
}

/** Contratações, pedidos, bloqueio estruturado, prioridade e prazo relativo ao início do cliente. */
function enrich(f) {
  const slugs = f.clients.slice(5, 17).map((client) => client.slug);
  updateDoc(f, "ontology.clients.v3", (value) => {
    value.enrollments = slugs.flatMap((slug, index) => [
      { id: `enr-${slug}`, company: slug, productId: "founding", planId: "founding-companies",
        status: "ativa", startsAt: day(-60 - index) },
      ...index % 3 === 0 ? [{ id: `old-${slug}`, company: slug, productId: "old", status: "cancelada", startsAt: day(-200) }] : [],
    ]);
  });
  for (const [index, slug] of slugs.entries()) touchSlice(f, slug, (value) => {
    const base = value.extraTasks[0];
    value.extraTasks.push(
      { ...base, id: `${slug}-request`, title: `Pedido ${index}`, kind: "request", requestedBy: "Cliente",
        priority: "alta", status: "fila", dueAt: day(-2) },
      { ...base, id: `${slug}-struct`, title: `Estruturado ${index}`, status: "em-curso", dueAt: day(3),
        blocker: { reason: "Acesso", owner: "cliente", since: day(-4) }, priority: "critica" },
      { ...base, id: `${slug}-relative`, title: `Relativa ${index}`, status: "fila", dueAt: day(1),
        deadline: { mode: "client", offsetDays: 150 + index } },
      { ...base, id: `${slug}-enrolled`, title: `Contratada ${index}`, status: "fila", dueAt: day(-9),
        enrollmentId: index % 3 === 0 ? `old-${slug}` : `enr-${slug}`,
        deadline: { mode: "client", offsetDays: 40 } },
    );
  });
}

for (const extraClients of [92, 95, 200]) {
  test(`summaries answer exactly like projecting every slice (${extraClients + 5} clients)`, async () => {
    const f = activeWorkspace({ extraClients, now: new Date() });
    try {
      enrich(f);
      const baseline = await reads(f);
      const active = f.clients.length - f.archived.length;
      assert.deepEqual(await summarized(f), { executions: 0, slices: f.clients.length });

      writeSummaries(f);
      assert.deepEqual(await summarized(f), { executions: active, slices: 0 }, "todos pelo resumo");
      assert.deepEqual(await reads(f), baseline, "todos os resumos atuais");

      // Ausentes e ilegíveis: a fatia é lida e projetada como antes.
      const missing = f.clients.filter((_, index) => index % 3 === 1).map((client) => client.slug);
      f.sql.prepare("DELETE FROM delivery_client_summary WHERE company IN (SELECT value FROM json_each(?))")
        .run(JSON.stringify(missing));
      f.sql.prepare("UPDATE delivery_client_summary SET body='{corrompido' WHERE company=?").run(f.clients[2].slug);
      assert.deepEqual(await reads(f), baseline, "ausentes e ilegíveis");
      // 100 e 205 clientes cobrem a paginação (resumos e corpos misturados em várias páginas).
      if (extraClients !== 92) return;

      // Defasados pela revisão: a fatia mudou depois do resumo.
      writeSummaries(f);
      for (const client of f.clients.slice(3, 9))
        touchSlice(f, client.slug, (value) => { value.extraTasks[1].status = "fila"; value.extraTasks[0].dueAt = day(-1); });
      const touched = await legacyReads(f);
      assert.notDeepEqual(touched, baseline);
      assert.deepEqual(await reads(f), touched, "defasados pela revisão");
      assert.equal((await summarized(f)).executions, active - 6);

      // Defasados pelo cadastro: plano, contratação cancelada e início do cliente mudaram.
      writeSummaries(f);
      updateDoc(f, "ontology.clients.v3", (value) => {
        value.clientEdits = { [f.clients[5].slug]: { journeyId: "programa-ia-leve" },
          [f.clients[6].slug]: { startedAt: "2026-05-02" } };
        value.enrollments.find((row) => row.company === f.clients[8].slug).status = "cancelada";
        value.allocations.push({ id: "extra", company: f.clients[9].slug, memberId: "reader", role: "analista", percent: 5 });
      });
      const edited = await legacyReads(f);
      assert.notDeepEqual(edited, touched);
      assert.deepEqual(await reads(f), edited, "defasados pelo cadastro");
      // Só os três clientes cujos valores mudaram caem na fatia (alocação não entra no resumo).
      assert.deepEqual(await summarized(f), { executions: active - 3, slices: 3 });

      // Defasados pelo catálogo: o plano seguido deixa de existir e todos caem no primeiro plano.
      writeSummaries(f);
      updateDoc(f, "ontology.catalog.v2", (value) => { value.removedJourneys = ["founding-companies"]; });
      const replanned = await legacyReads(f);
      assert.deepEqual(await reads(f), replanned, "defasados pelo catálogo");
      // Quem seguia o plano removido cai na fatia; quem segue outro plano continua no resumo.
      assert.ok((await summarized(f)).executions < 5);
      // Uma versão publicada nova do mesmo plano não muda o plano seguido: o resumo continua valendo.
      updateDoc(f, "ontology.catalog.v2", (value) => { value.removedJourneys = []; });
      writeSummaries(f);
      updateDoc(f, "ontology.catalog.v2", (value) => {
        value.journeyVersions = { "founding-companies": [{ version: 1, publishedAt: "2026-09-01",
          snapshot: { id: "founding-companies", name: "Founding", milestones: [] } }] };
      });
      assert.equal((await summarized(f)).executions, active);
      assert.deepEqual(await reads(f), await legacyReads(f), "versão publicada");
    } finally {
      f.sql.close();
    }
  });
}

test("the summary read is still one batch; only clients whose summary no longer holds cost one more trip", async () => {
  const f = activeWorkspace({ extraClients: 92 });
  try {
    writeSummaries(f);
    const trips = async (run) => {
      const { env, meter } = instrumentQueries(fresh(f));
      await run(env);
      return meter.trips;
    };
    assert.equal(await trips((env) => readPortfolioSummary(env, admin)), 4);
    assert.equal(await trips((env) => readAlertQueue(env, admin)), 4);
    updateDoc(f, "ontology.clients.v3", (value) => {
      value.clientEdits = { [f.clients[10].slug]: { journeyId: "programa-ia-leve" } };
    });
    assert.equal(await trips((env) => readPortfolioSummary(env, admin)), 5, "+1: corpos das fatias que caíram");
    // Início de cliente sem prazo relativo não entra no resumo: nada cai.
    updateDoc(f, "ontology.clients.v3", (value) => {
      value.clientEdits = { [f.clients[10].slug]: { journeyId: "programa-ia-leve" }, [f.clients[0].slug]: { startedAt: "2026-01-02" } };
    });
    writeSummaries(f);
    assert.equal(await trips((env) => readPortfolioSummary(env, admin)), 4);
  } finally {
    f.sql.close();
  }
});

test("a slice that moves between the batch and the body fetch restarts the read instead of mixing revisions", async () => {
  const f = activeWorkspace({ extraClients: 20 });
  try {
    writeSummaries(f);
    updateDoc(f, "ontology.clients.v3", (value) => {
      value.enrollments = [{ id: "antiga", company: f.clients[10].slug, productId: "p", status: "cancelada" }];
    });
    const original = f.db.prepare.bind(f.db);
    let moved = false;
    f.db.prepare = (query) => {
      if (!moved && /company IN \(SELECT value FROM json_each/.test(query) && /delivery_client_snapshots/.test(query)) {
        moved = true;
        touchSlice(f, f.clients[10].slug, (value) => { value.extraTasks[0].status = "bloqueado"; });
      }
      return original(query);
    };
    const queue = await readAlertQueue({ DB: f.db }, admin);
    f.db.prepare = original;
    assert.equal(moved, true);
    assert.deepEqual(json(queue), json(await readAlertQueue(fresh(f), admin)));
    assert.ok(queue.data.some((alert) => alert.id === `derived-entrega-bloqueada-${f.clients[10].slug}-late`));
  } finally {
    f.sql.close();
  }
});

test("the plan the projection follows is the same id the summary recomputes from the catalog", () => {
  const catalog = normalizeCatalogSnapshot({ journeyVersions: { "founding-companies": [
    { version: 1, publishedAt: "2026-09-01", snapshot: { id: "founding-companies", name: "F", milestones: [] } },
    { version: 2, publishedAt: "2026-09-02", snapshot: { id: "founding-companies", name: "F2", milestones: [] } }] } });
  const raw = { productPlans: { priv: { id: "priv", name: "Privado", milestones: [] } },
    companyJourney: { x: "founding-companies" }, companyJourneyVersion: { x: 1 } };
  for (const client of [{ slug: "x" }, { slug: "y", journeyId: "priv" }, { slug: "z", journeyId: "inexistente" }]) {
    const { execution, plan } = projectClientExecutionWithPlan(raw, catalog, client, [], {}, {});
    assert.deepEqual(execution, projectClientExecution(raw, catalog, client, [], {}, {}));
    assert.equal(followedPlanId(catalog, plan.privatePlanIds, plan.planId, plan.pinnedVersion), plan.followedId);
  }
  assert.throws(() => followedPlanId(normalizeCatalogSnapshot({ removedJourneys: [] }), [], "a", undefined, []));
});

test("the backfill writes only missing or stale rows, is idempotent and never overwrites a slice that moved", () => {
  const f = activeWorkspace({ extraClients: 10 });
  try {
    const first = writeSummaries(f);
    assert.equal(first.filter((row) => row.state === "missing").length, f.clients.length);
    assert.ok(writeSummaries(f).every((row) => row.state === "current"), "segunda execução não grava nada");
    // Plano calculado, fatia muda antes da gravação: o CAS não grava e a linha fica defasada.
    const slug = f.clients[7].slug;
    updateDoc(f, "ontology.clients.v3", (value) => { value.enrollments = [{ id: "nova", company: slug,
      productId: "p", planId: "founding-companies", status: "ativa", startsAt: "2026-03-03" }]; });
    const doc = (key) => JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key=?").get(key).body);
    const slices = f.sql.prepare("SELECT company,revision,incarnation,body FROM delivery_client_snapshots").all()
      .map((row) => ({ ...row, snapshot: JSON.parse(row.body) }));
    const existing = f.sql.prepare("SELECT * FROM delivery_client_summary").all();
    const plan = planSummaryBackfill({ generation: GENERATION, slices, clientsRaw: doc("ontology.clients.v3"),
      catalogRaw: doc("ontology.catalog.v2"), existing });
    const stale = plan.filter((row) => row.state === "stale");
    assert.deepEqual(stale.map((row) => row.company), [slug]);
    touchSlice(f, slug, (value) => { value.extraTasks[0].title = "Mudou"; });
    const before = f.sql.prepare("SELECT * FROM delivery_client_summary WHERE company=?").get(slug);
    f.sql.exec(summaryBackfillSql("default", GENERATION, stale[0]));
    assert.deepEqual(f.sql.prepare("SELECT * FROM delivery_client_summary WHERE company=?").get(slug), before);
    assert.deepEqual(writeSummaries(f).filter((row) => row.state !== "current").map((row) => row.company), [slug]);
    assert.ok(writeSummaries(f).every((row) => row.state === "current"));
  } finally {
    f.sql.close();
  }
});

test("counter, queue and portfolio agree with and without summaries whatever the process time zone", () => {
  const results = ["UTC", "America/Sao_Paulo", "Asia/Tokyo"].map((zone) => JSON.parse(execFileSync(process.execPath,
    ["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--no-warnings",
      "tests/helpers/summary-clock.mjs"], { env: { ...process.env, TZ: zone }, encoding: "utf8" })));
  for (const result of results) {
    assert.deepEqual(result.summaries, result.slices, "resumo = fatias no mesmo fuso");
    assert.equal(result.summaries.count, result.summaries.queue);
    assert.equal(result.summaries.count, result.summaries.portfolio);
    assert.ok(result.summaries.count > 0);
  }
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[2], results[0]);
});
