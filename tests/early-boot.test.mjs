import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { BOOTSTRAP_TABLE, bootstrapKeysFor } from "../src/shared/infrastructure/bootstrap-keys.ts";
import { earlyBootPlan, earlyBootScript, earlyFetch, takeEarlyResponse } from "../src/shared/infrastructure/early-boot.ts";
import { loadClientExecutionWorkspace } from "../src/modules/delivery/infrastructure/client-collection.ts";
import { loadExecutionBoard } from "../src/modules/delivery/infrastructure/execution-board-collection.ts";

/** Runs the inline script as the browser would, recording what it requests. */
function runScript(pathname, search = "", storage) {
  const requested = [];
  const sandbox = {
    ...(storage ? { localStorage: { getItem: (key) => storage[key] ?? null } } : {}),
    location: { pathname, search },
    URLSearchParams,
    fetch: (url, init) => {
      requested.push({ url, init });
      return Promise.resolve(new Response("{}"));
    },
    window: {},
    Date,
  };
  vm.runInNewContext(earlyBootScript(BOOTSTRAP_TABLE), sandbox);
  return { requested: requested.map((call) => call.url), boot: sandbox.window.__g4boot };
}

const bootstrapUrl = (path) =>
  `/api/state?${new URLSearchParams({ keys: bootstrapKeysFor(path).join(","), with: "session,google,alerts" })}`;

test("the inline script asks for the same bootstrap the persistence layer would", () => {
  for (const path of ["/", "/clientes", "/clientes/acme", "/clientes/acme/entregas", "/execucao", "/alertas",
    "/agenda", "/reunioes/m1", "/equipe/membros", "/perfil", "/ontologia", "/nada", "/clientes/acme/"]) {
    const { requested, boot } = runScript(path);
    assert.equal(requested[0], bootstrapUrl(path), path);
    assert.equal(earlyBootPlan(path, "", BOOTSTRAP_TABLE).bootstrap, bootstrapUrl(path), path);
    assert.deepEqual(Object.keys(boot.requests), requested, path);
  }
});

test("each screen's first data read starts with the bootstrap", () => {
  const data = (path, search) => runScript(path, search).requested.slice(1);
  assert.deepEqual(data("/"), ["/api/portfolio"]);
  assert.deepEqual(data("/clientes"), ["/api/portfolio"]);
  assert.deepEqual(data("/equipe/alocacao"), ["/api/portfolio"]);
  assert.deepEqual(data("/alertas"), ["/api/alerts"]);
  assert.deepEqual(data("/alertas", "?cliente=acme&origem=%2Fclientes"), ["/api/alerts?company=acme"]);
  assert.deepEqual(data("/execucao"), ["/api/execution/board?formato=tabela"]);
  assert.deepEqual(data("/execucao", "?visao=entregas&cliente=acme"), ["/api/execution/board?formato=tabela"]);
  assert.deepEqual(data("/execucao", "?visao=ciclos"), ["/api/execution/cycles"]);
  assert.deepEqual(data("/execucao", "?visao=cronograma"), ["/api/execution/cycles"]);
  assert.deepEqual(data("/clientes/acme/plano"), [
    "/api/v1/clients/acme/execution-snapshot",
    "/api/v1/tasks?company=acme&limit=100",
    "/api/v1/cycles?company=acme&limit=100",
  ]);
  // A browser that last saw legacy execution reads only the slice answer.
  assert.deepEqual(runScript("/clientes/acme", "", { "g4.execution-mode": "legacy" }).requested.slice(1),
    ["/api/v1/clients/acme/execution-snapshot"]);
  assert.equal(runScript("/clientes/acme", "", { "g4.execution-mode": "active" }).requested.length, 4);
  assert.deepEqual(data("/agenda"), []);
  assert.deepEqual(data("/equipe/membros"), []);
  assert.deepEqual(runScript("/entrar").requested, []);
});

test("loaders consume the early responses once, by the exact address they would request", async () => {
  const original = globalThis.window;
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ data: { mode: "legacy" } }), { headers: { "content-type": "application/json" } });
  };
  try {
    const early = (body) => Promise.resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
    const plan = earlyBootPlan("/clientes/acme", "", BOOTSTRAP_TABLE);
    const board = earlyBootPlan("/execucao", "", BOOTSTRAP_TABLE);
    globalThis.window = { __g4boot: { at: Date.now(), requests: {
      [plan.data[0]]: early({ data: { mode: "legacy" } }),
      [plan.data[1]]: early({ data: [], total: 0, snapshotVersion: 1, nextCursor: null }),
      [plan.data[2]]: early({ data: [], total: 0, snapshotVersion: 1, nextCursor: null }),
      [board.data[0]]: early({ mode: "legacy" }),
    } } };
    assert.deepEqual(await loadClientExecutionWorkspace("acme"), { mode: "legacy" });
    assert.deepEqual(await loadExecutionBoard(), { mode: "legacy" });
    assert.deepEqual(calls, []);
    assert.deepEqual(Object.keys(globalThis.window.__g4boot.requests), []);
    // A second read goes to the network.
    await earlyFetch("/api/execution/board?formato=tabela", { cache: "no-store" });
    assert.deepEqual(calls, ["/api/execution/board?formato=tabela"]);
  } finally {
    globalThis.window = original;
    globalThis.fetch = realFetch;
  }
});

test("stale or conditional reads never use an early response", async () => {
  const original = globalThis.window;
  try {
    const response = Promise.resolve(new Response("{}"));
    globalThis.window = { __g4boot: { at: Date.now() - 60_000, requests: { "/api/portfolio": response } } };
    assert.equal(takeEarlyResponse("/api/portfolio"), null);
    globalThis.window = { __g4boot: { at: Date.now(), requests: { "/api/execution/board?formato=tabela": response } } };
    const realFetch = globalThis.fetch;
    let network = 0;
    globalThis.fetch = async () => { network++; return new Response("{}"); };
    try {
      await earlyFetch("/api/execution/board?formato=tabela", { headers: { "if-none-match": "x" } });
      assert.equal(network, 1);
      assert.ok(globalThis.window.__g4boot.requests["/api/execution/board?formato=tabela"]);
    } finally {
      globalThis.fetch = realFetch;
    }
  } finally {
    globalThis.window = original;
  }
});
