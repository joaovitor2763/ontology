import test from "node:test";
import assert from "node:assert/strict";
import { coalesced } from "../src/shared/infrastructure/coalesce.ts";
import { dropWarmResponses, earlyFetch, takeEarlyResponse, warmEarlyFetch } from "../src/shared/infrastructure/early-boot.ts";
import { warmupPlan } from "../src/shared/infrastructure/navigation-warmup.ts";
import { clientEntryPath } from "../src/shared/infrastructure/client-entry.ts";
import { newerBookmark, noteApiResponse } from "../src/shared/infrastructure/d1-bookmark.ts";
import { dropWarmReads, fetchDocuments, patchSyncStatus, refreshAlertCount, warmDocuments } from "../src/shared/infrastructure/persistence.ts";
import { bootstrapKeysFor } from "../src/shared/infrastructure/bootstrap-keys.ts";

test("focus and visibility arriving together refresh once", async () => {
  let runs = 0, clock = 0;
  let release;
  const run = coalesced(() => { runs += 1; return new Promise((done) => { release = done; }); }, 1_000, () => clock);
  run();
  run();
  assert.equal(runs, 1, "segundo disparo durante a leitura não repete");
  release();
  await new Promise((done) => setImmediate(done));
  clock = 500;
  run();
  assert.equal(runs, 1, "dentro da janela, mesmo depois de terminar");
  clock = 1_500;
  run();
  assert.equal(runs, 2);
});

function withWindow(fn) {
  return async () => {
    const original = { window: globalThis.window, fetch: globalThis.fetch };
    const requested = [];
    globalThis.window = {};
    globalThis.fetch = async (url) => { requested.push(url); return new Response(JSON.stringify({ url })); };
    try { await fn(requested); } finally {
      dropWarmResponses();
      globalThis.window = original.window;
      globalThis.fetch = original.fetch;
    }
  };
}

test("a navigation gesture starts the screen's read once and the screen takes it", withWindow(async (requested) => {
  warmEarlyFetch("/api/portfolio");
  warmEarlyFetch("/api/portfolio");
  assert.deepEqual(requested, ["/api/portfolio"], "o mesmo endereço não sai duas vezes");
  const response = await earlyFetch("/api/portfolio", { cache: "no-store" });
  assert.equal((await response.json()).url, "/api/portfolio");
  assert.deepEqual(requested, ["/api/portfolio"], "a tela usou a leitura adiantada");
  await earlyFetch("/api/portfolio", { cache: "no-store" });
  assert.equal(requested.length, 2, "uma única vez: a seguinte vai ao servidor");
  // Leitura com cabeçalho condicional nunca usa a adiantada.
  warmEarlyFetch("/api/portfolio");
  await earlyFetch("/api/portfolio", { headers: { "if-none-match": "x" } });
  assert.equal(requested.length, 4);
}));

test("a write drops what was read ahead, and an old read is never used", withWindow(async (requested) => {
  warmEarlyFetch("/api/portfolio");
  dropWarmResponses();
  assert.equal(takeEarlyResponse("/api/portfolio"), null);
  warmEarlyFetch("/api/alerts", Date.now() - 60_000);
  assert.equal(takeEarlyResponse("/api/alerts"), null, "mais de 10 s");
  assert.equal(requested.length, 2);
}));

test("the warm-up plan is the target screen's own first reads, never the global execution document", () => {
  const here = { pathname: "/", search: "", origin: "https://delivery.test" };
  assert.deepEqual(warmupPlan("/clientes", here), { data: ["/api/portfolio"], keys: [...bootstrapKeysFor("/clientes")] });
  assert.deepEqual(warmupPlan("https://delivery.test/clientes/acme/entregas", here).data, [
    "/api/v1/clients/acme/execution-snapshot",
    "/api/v1/tasks?company=acme&limit=100",
    "/api/v1/cycles?company=acme&limit=100",
  ]);
  assert.deepEqual(warmupPlan("/clientes/acme/entregas", here, true).data, ["/api/v1/clients/acme/execution-snapshot"]);
  assert.deepEqual(warmupPlan("/alertas?cliente=acme", here).data, ["/api/alerts?company=acme"]);
  // O quadro e os ciclos usam ETag no carregador: nada adiantado.
  assert.deepEqual(warmupPlan("/execucao", here).data, []);
  for (const path of ["/catalogo", "/equipe", "/clientes/acme"])
    assert.ok(!warmupPlan(path, here).keys.includes("ontology.delivery.v2"), path);
  assert.equal(warmupPlan("/", here), null, "a própria tela");
  assert.equal(warmupPlan("https://outro.test/clientes", here), null);
  assert.equal(warmupPlan("/api/portfolio", here), null);
  assert.equal(warmupPlan("/entrar", here), null);
});

test("client links open the person's first tab directly", () => {
  assert.equal(clientEntryPath("acme", null), "/clientes/acme/entregas", "padrão: Tarefas");
  assert.equal(clientEntryPath("acme", "entregas"), "/clientes/acme/entregas");
  assert.equal(clientEntryPath("acme", "plano"), "/clientes/acme/plano");
  assert.equal(clientEntryPath("acme", "stakeholders"), "/clientes/acme/stakeholders");
  assert.equal(clientEntryPath("acme", "overview"), "/clientes/acme");
  // Abas que dependem de módulo do cliente: o endereço curto, e o CompanyChrome decide.
  assert.equal(clientEntryPath("acme", "ontologia"), "/clientes/acme");
  assert.equal(clientEntryPath("acme", "uso"), "/clientes/acme");
  assert.equal(clientEntryPath("acme", "qualquer"), "/clientes/acme/entregas");
});

test("the browser keeps the newest D1 bookmark and never goes back", () => {
  const a = "00000001-00000002-00000040-cc", b = "00000001-00000002-00000050-aa";
  assert.equal(newerBookmark(a, b), b);
  assert.equal(newerBookmark(b, a), b);
  assert.equal(newerBookmark(null, "lixo"), null);
  let cookie = "";
  const jar = { get: () => cookie, set: (value) => {
    const [pair] = value.split(";");
    const [name] = pair.split("=");
    cookie = [...cookie.split("; ").filter((p) => p && !p.startsWith(`${name}=`)), pair].join("; ");
  } };
  noteApiResponse(jar, "GET", b, true);
  assert.match(cookie, new RegExp(`g4_d1_bookmark=${b}`));
  noteApiResponse(jar, "GET", a, true);
  assert.match(cookie, new RegExp(`g4_d1_bookmark=${b}`), "resposta mais velha que chega depois não volta o cookie");
  noteApiResponse(jar, "POST", "00000001-00000002-00000099-ff", true);
  assert.match(cookie, /g4_d1_bookmark=00000001-00000002-00000099-ff/);
  // Escrita sem bookmark (rota fora do invólucro): leituras no primário por um tempo.
  noteApiResponse(jar, "PUT", null, true);
  assert.match(cookie, /g4_d1_primary=1/);
  // Com a flag desligada nenhum cabeçalho chega e nada é gravado.
  cookie = "";
  noteApiResponse(jar, "GET", null, true);
  noteApiResponse(jar, "POST", null, true);
  assert.equal(cookie, "");
});

test("two alert-count refreshes in flight share one request", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; await new Promise((done) => setTimeout(done, 5)); return Response.json({ data: { count: 3 } }); };
  try {
    await Promise.all([refreshAlertCount(), refreshAlertCount()]);
    assert.equal(calls, 1);
    await refreshAlertCount();
    assert.equal(calls, 2, "terminada a primeira, a próxima relê");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("documents read ahead are used once, merged with the rest, and dropped by a write", async () => {
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    const keys = new URL(url, "https://x.test").searchParams.get("keys").split(",");
    asked.push(keys.join(","));
    return Response.json({ documents: keys.filter((k) => k !== "d").map((key) => ({ key, value: { key }, version: 1, updatedAt: null })),
      unchanged: [], denied: keys.includes("d") ? [{ key: "d", reason: "não" }] : [] });
  };
  patchSyncStatus({ resolved: true, mode: "remote", user: { email: "a@example.test", name: "A" } });
  try {
    warmDocuments(["a", "b", "d"]);
    warmDocuments(["a"]);
    assert.deepEqual(asked, ["a,b,d"], "a mesma chave não sai duas vezes");
    const first = await fetchDocuments(["a", "c", "d"]);
    assert.deepEqual(asked, ["a,b,d", "c"], "só o que faltava vai ao servidor");
    assert.deepEqual([...first.documents.keys()].sort(), ["a", "c"]);
    assert.deepEqual([...first.denied.keys()], ["d"]);
    await fetchDocuments(["a"]);
    assert.equal(asked.at(-1), "a", "uma única vez: a seguinte relê");
    dropWarmReads();
    await fetchDocuments(["b"]);
    assert.equal(asked.at(-1), "b", "gravação descarta o adiantado");
    // Revalidação com versões nunca usa o adiantado.
    warmDocuments(["e"]);
    await fetchDocuments(["e"], { e: 1 });
    assert.equal(asked.at(-1), "e");
    assert.equal(asked.length, 6);
  } finally {
    dropWarmReads();
    patchSyncStatus({ resolved: false, mode: "local", user: null });
    globalThis.fetch = realFetch;
  }
});
