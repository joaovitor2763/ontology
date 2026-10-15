// Varredura de todas as páginas e das interações principais no navegador.
// Uso: PW=<playwright> node perf-sweep-pages.mjs [baseUrl]  (PERF_ROUNDS=5, PERF_COMPANY, PERF_OUT)
// PERF_LATENCY_MS=40 emula a viagem navegador → Worker em cada requisição (e PERF_MBPS=20 a banda),
// para medir cascatas localmente; PERF_PAGES=/,/execucao limita as páginas (prefixos exatos, vírgula).
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
const base = process.argv[2] ?? "http://localhost:3000";
const rounds = Number(process.env.PERF_ROUNDS ?? 5);
const company = process.env.PERF_COMPANY ?? "vertice-seguros";
const out = process.env.PERF_OUT ?? "";
const cookie = process.env.PERF_COOKIE ?? "";
const latency = Number(process.env.PERF_LATENCY_MS ?? 0);
const throughput = (Number(process.env.PERF_MBPS ?? 20) * 1024 * 1024) / 8;
const pagesOnly = (process.env.PERF_PAGES ?? "").split(",").filter(Boolean);
let blockedWrites = 0;
const authFailures = new Set();
const pw = await import(process.env.PW ?? `${homedir()}/node_modules/playwright/index.js`);
const chromium = pw.chromium ?? pw.default?.chromium;
const browser = await chromium.launch();
async function newContext() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-perf-timing": "1" }, serviceWorkers: "block" });
  if (cookie) await context.addCookies(cookie.split(";").filter((part) => part.trim()).map((part) => {
    const separator = part.indexOf("=");
    if (separator < 1) throw new Error("PERF_COOKIE inválido");
    return { name: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim(), url: new URL(base).origin, secure: base.startsWith("https:") };
  }));
  await context.route("**/*", async (route) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
      blockedWrites += 1;
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  context.on("response", (response) => {
    if (response.status() === 401 && new URL(response.url()).origin === new URL(base).origin) authFailures.add(new URL(response.url()).pathname);
  });
  return context;
}
const pct = (s, p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
const stats = (v) => { const s = [...v].filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; return { mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length), p50: Math.round(pct(s, 0.5)), p95: Math.round(pct(s, 0.95)), max: Math.round(s[s.length - 1]) }; };
const fmt = (st) => (st ? `${st.mean} / ${st.p50} / ${st.p95}` : "—");

async function newPage(context) {
  const page = await context.newPage();
  const api = [];
  page.on("requestfinished", async (request) => {
    const url = request.url();
    if (!url.includes("/api/")) return;
    try {
      const response = await request.response();
      const timing = request.timing();
      api.push({ method: request.method(), path: url.replace(base, ""), status: response?.status(), ms: Math.round(timing.responseEnd), st: (await response?.headerValue("server-timing")) ?? "" });
    } catch {}
  });
  page.api = api;
  return page;
}
const TRIPS = (st) => Number(/desc="(\d+) idas/.exec(st)?.[1] ?? 0);

async function loadOnce(context, path, ready) {
  const page = await newPage(context);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (latency) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency, downloadThroughput: throughput, uploadThroughput: throughput });
  const t0 = Date.now();
  await page.goto(base + path, { waitUntil: "domcontentloaded" });
  let first = null;
  try { await page.locator(ready).first().waitFor({ timeout: 30_000 }); first = Date.now() - t0; } catch {}
  await page.waitForLoadState("networkidle").catch(() => {});
  const settled = Date.now() - t0;
  const m = await page.evaluate(() => new Promise((resolve) => {
    const nav = performance.getEntriesByType("navigation")[0];
    const paint = Object.fromEntries(performance.getEntriesByType("paint").map((p) => [p.name, p.startTime]));
    const scripts = performance.getEntriesByType("resource").filter((r) => /\.js(\?|$)/.test(r.name));
    let lcp = null;
    try {
      const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) lcp = e.startTime; });
      po.observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}
    setTimeout(() => resolve({
      ttfb: nav?.responseStart ?? null, dcl: nav?.domContentLoadedEventEnd ?? null, load: nav?.loadEventEnd || null,
      fcp: paint["first-contentful-paint"] ?? null, lcp,
      scripts: scripts.length, jsKB: Math.round(scripts.reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0) / 1024),
      html: document.documentElement.outerHTML.length, nodes: document.getElementsByTagName("*").length,
    }), 50);
  }));
  const { metrics } = await cdp.send("Performance.getMetrics");
  const js = Math.round(metrics.find((x) => x.name === "ScriptDuration").value * 1000);
  const layout = Math.round(metrics.find((x) => x.name === "LayoutDuration").value * 1000);
  const heap = Math.round(metrics.find((x) => x.name === "JSHeapUsedSize").value / 1048576);
  const api = page.api.splice(0);
  const lastApi = api.length ? Math.max(...api.map((a) => a.ms)) : null;
  await page.close();
  return { first, settled, ...m, js, layout, heap, apiCalls: api.length, apiMs: api.reduce((s, a) => s + a.ms, 0), trips: api.reduce((s, a) => s + TRIPS(a.st), 0), lastApi, api };
}

const PAGES = [
  ["/", "main"], ["/clientes", "main"], [`/clientes/${company}`, "main"], [`/clientes/${company}/plano`, "main"],
  [`/clientes/${company}/entregas`, '[aria-label^="Abrir tarefa:"]'], [`/clientes/${company}/entregas/d-vs-3`, "main"],
  [`/clientes/${company}/ciclos/__CYCLE__`, "main"], [`/clientes/${company}/agenda`, "main"], [`/clientes/${company}/solicitacoes`, "main"],
  [`/clientes/${company}/stakeholders`, "main"], [`/clientes/${company}/conversas`, "main"], [`/clientes/${company}/documentos`, "main"],
  [`/clientes/${company}/ontologia`, "main"], [`/clientes/${company}/uso`, "main"],
  ["/execucao", '[aria-label^="Abrir tarefa:"]'], ["/agenda", "main"], ["/alertas", '[aria-label^="Abrir alerta:"]'], ["/conversas", "main"],
  ["/documentos", "main"], ["/reunioes", "main"], ["/reunioes/m-vs-q3", "main"], ["/catalogo/produtos", "main"], ["/catalogo/planos", "main"],
  ["/equipe/membros", "main"], ["/equipe/membros/beatriz", "main"], ["/equipe/alocacao", "main"], ["/ontologia", "main"], ["/configuracoes", "main"], ["/perfil", "main"],
];
// ciclo real do cliente
const cycleId = await (async () => { const r = await fetch(`${base}/api/v1/cycles?company=${company}&limit=1`, { headers: cookie ? { cookie } : {}, redirect: "error" }); if (!r.ok) { await browser.close(); throw new Error(`Leitura de ciclos: HTTP ${r.status}`); } const j = await r.json(); return j.data?.[0]?.id ?? ""; })();

const only = process.env.PERF_ONLY ?? "";
console.log(`\n# Páginas em ${base} — ${rounds} cargas frias por página (contexto novo, cache vazio), 1440×900${latency ? `, rede emulada: +${latency} ms por requisição, ${Number(process.env.PERF_MBPS ?? 20)} Mbps` : ""}\n`);
console.log("Colunas em ms como média / p50 / p95. `1º conteúdo` = seletor da tela visível; `última /api` = fim da última resposta de dados; `JS` = ScriptDuration do Chrome até a rede parar.\n");
console.log("| Página | TTFB | FCP | LCP | 1º conteúdo | última /api | rede parada | chamadas /api (idas D1) | JS ms | layout ms | heap MB | JS KB (arquivos) | nós DOM |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
const results = [];
for (const [rawPath, ready] of (only === "interactions" ? [] : PAGES.filter(([path]) => !pagesOnly.length || pagesOnly.includes(path)))) {
  const path = rawPath.replace("__CYCLE__", cycleId);
  const runs = [];
  for (let i = 0; i < rounds; i += 1) {
    const context = await newContext();
    try { runs.push(await loadOnce(context, path, ready)); } catch (e) { console.error(`  ${path}: ${e.message.slice(0, 80)}`); }
    await context.close();
  }
  if (!runs.length) continue;
  const col = (k) => stats(runs.map((r) => r[k]));
  const last = runs[runs.length - 1];
  const row = { path, ttfb: col("ttfb"), fcp: col("fcp"), lcp: col("lcp"), first: col("first"), lastApi: col("lastApi"), settled: col("settled"), apiCalls: col("apiCalls"), trips: col("trips"), js: col("js"), layout: col("layout"), heap: col("heap"), jsKB: last.jsKB, scripts: last.scripts, nodes: last.nodes, api: last.api.map((a) => `${a.method} ${a.path.split("?")[0]} ${a.status} ${a.ms}ms [${a.st}]`) };
  results.push(row);
  console.log(`| ${path} | ${fmt(row.ttfb)} | ${fmt(row.fcp)} | ${fmt(row.lcp)} | ${fmt(row.first)} | ${fmt(row.lastApi)} | ${fmt(row.settled)} | ${row.apiCalls.p50} (${row.trips.p50}) | ${fmt(row.js)} | ${fmt(row.layout)} | ${row.heap.p50} | ${row.jsKB} (${row.scripts}) | ${row.nodes} |`);
}
console.log("\n## Chamadas /api por página (última carga)\n");
for (const r of results) { console.log(`- ${r.path}:`); for (const a of r.api) console.log(`  - ${a}`); }

// Interações num contexto quente (mesma aba, JS já carregado)
console.log(`\n# Interações (contexto quente, ${rounds} repetições, ms do evento até o DOM mostrar o resultado)\n`);
console.log("| Interação | média | p50 | p95 | máx | chamadas /api |\n| --- | --- | --- | --- | --- | --- |");
const context = await newContext();
const page = await newPage(context);
async function gesture(label, setup, act, settled) {
  const vals = [], calls = [];
  for (let i = 0; i < rounds; i += 1) {
   try {
    await setup(i);
    page.api.splice(0);
    await page.evaluate((settled) => {
      window.__g = { at: performance.now(), done: null };
      const ready = new Function("return (" + settled + ")")();
      if (ready()) { window.__g.done = window.__g.at; return; }
      const obs = new MutationObserver(() => { if (window.__g.done === null && ready()) { window.__g.done = performance.now(); obs.disconnect(); } });
      obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    }, settled);
    await act(i);
    const start = Date.now();
    while (Date.now() - start < 15_000) { const g = await page.evaluate(() => window.__g); if (g.done !== null) { vals.push(g.done - g.at); break; } }
    await page.waitForTimeout(150);
    calls.push(page.api.length);
   } catch (e) { console.error(`  ${label}: ${e.message.split("\n")[0].slice(0, 90)}`); }
  }
  const st = stats(vals);
  console.log(`| ${label} | ${st ? st.mean : "—"} | ${st ? st.p50 : "—"} | ${st ? st.p95 : "—"} | ${st ? st.max : "—"} | ${Math.round(calls.reduce((a, b) => a + b, 0) / (calls.length || 1))} |`);
  results.push({ gesture: label, stats: st, calls });
}
await page.goto(base + "/execucao", { waitUntil: "domcontentloaded" });
await page.locator('[aria-label^="Abrir tarefa:"]').first().waitFor();
await page.waitForLoadState("networkidle");
await gesture("abrir drawer da tarefa (clique no card)",
  async () => { await page.keyboard.press("Escape"); await page.locator("dialog[open]").waitFor({ state: "detached", timeout: 5000 }).catch(() => {}); },
  async () => { await page.locator('[aria-label^="Abrir tarefa:"]').first().click({ noWaitAfter: true }); },
  `() => !!document.querySelector("dialog[open] h2, dialog[open] h1")`);
await gesture("fechar drawer da tarefa (Escape)",
  async () => { if (!(await page.locator("dialog[open]").count())) { await page.locator('[aria-label^="Abrir tarefa:"]').first().click(); await page.locator("dialog[open]").waitFor(); } },
  async () => { await page.keyboard.press("Escape"); },
  `() => !document.querySelector("dialog[open]")`);
await gesture("busca global: abrir com / e digitar 1 letra até a lista",
  async () => { await page.goto(base + "/execucao", { waitUntil: "domcontentloaded" }); await page.locator('[aria-label^="Abrir tarefa:"]').first().waitFor(); await page.waitForLoadState("networkidle"); },
  async () => { await page.keyboard.press("/"); await page.keyboard.type("v"); },
  `() => !!document.querySelector('[role="listbox"] [role="option"]')`);
await gesture("busca global: 2ª letra (lista já aberta)",
  async () => { await page.goto(base + "/execucao", { waitUntil: "domcontentloaded" }); await page.locator('[aria-label^="Abrir tarefa:"]').first().waitFor(); await page.waitForLoadState("networkidle"); await page.keyboard.press("/"); await page.keyboard.type("v"); await page.locator('[role="option"]').first().waitFor({ timeout: 10000 }); },
  async () => { await page.keyboard.type("e"); },
  `() => { const o = document.querySelectorAll('[role="option"]'); return o.length > 0 && [...o].every((x) => /ve/i.test(x.textContent)); }`);
await gesture("filtro do quadro: 1 tecla",
  async () => { await page.goto(base + "/execucao", { waitUntil: "domcontentloaded" }); await page.locator('[aria-label^="Abrir tarefa:"]').first().waitFor(); await page.waitForLoadState("networkidle"); await page.getByLabel("Filtrar tarefas").first().click(); },
  async () => { await page.keyboard.type("r"); },
  `() => document.querySelectorAll('[aria-label^="Abrir tarefa:"]').length < 150`);
await gesture("menu do card: abrir (clique)",
  async () => { await page.goto(base + "/execucao", { waitUntil: "domcontentloaded" }); await page.locator('[aria-label^="Abrir tarefa:"]').first().waitFor(); await page.waitForLoadState("networkidle"); },
  async () => { const card = page.locator('[aria-label^="Abrir tarefa:"]').first(); const btn = card.locator("xpath=..").getByRole("button").last(); await btn.click({ noWaitAfter: true }); },
  `() => !!document.querySelector('[role="menu"]')`);
await page.keyboard.press("Escape");
await gesture("navegação no cliente: /clientes → cliente (link)",
  async () => { await page.goto(base + "/clientes", { waitUntil: "domcontentloaded" }); await page.locator(`a[href="/clientes/${company}"]`).first().waitFor(); await page.waitForLoadState("networkidle"); },
  async () => { await page.locator(`a[href="/clientes/${company}"]`).first().click({ noWaitAfter: true }); },
  `() => location.pathname === "/clientes/${company}" && !!document.querySelector("main")`);
await gesture("navegação no cliente: cliente → /execucao (menu lateral)",
  async () => { await page.goto(base + `/clientes/${company}`, { waitUntil: "domcontentloaded" }); await page.locator("main").waitFor(); await page.waitForLoadState("networkidle"); },
  async () => { await page.locator('a[href="/execucao"]').first().click({ noWaitAfter: true }); },
  `() => location.pathname === "/execucao" && !!document.querySelector('[aria-label^="Abrir tarefa:"]')`);
await gesture("navegação no cliente: /execucao → /alertas (menu lateral)",
  async () => { await page.goto(base + "/execucao", { waitUntil: "domcontentloaded" }); await page.locator('[aria-label^="Abrir tarefa:"]').first().waitFor(); await page.waitForLoadState("networkidle"); },
  async () => { await page.locator('a[href="/alertas"]').first().click({ noWaitAfter: true }); },
  `() => location.pathname === "/alertas" && !!document.querySelector('[aria-label^="Abrir alerta:"]')`);
await context.close();
await browser.close();
console.log(`\nSomente leitura: ${blockedWrites} requisições de escrita bloqueadas; ${authFailures.size} rotas com HTTP 401.`);
if (authFailures.size) { console.error(`Sessão inválida: ${[...authFailures].join(", ")}`); process.exitCode = 1; }
if (out) writeFileSync(out, JSON.stringify({ base, rounds, at: new Date().toISOString(), results }, null, 2));
console.log("");
