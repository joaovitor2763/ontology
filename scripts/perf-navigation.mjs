// Navegação dentro do app medida no navegador: carga fria de `/` e `/clientes` e as
// trocas de tela que a pessoa faz (menu → Visão geral, menu → Clientes, lista → cliente),
// do gesto até os DADOS aparecerem, com a rede emulada (PERF_LATENCY_MS, padrão 150,
// para imitar Brasil → Worker nos EUA). Conta chamadas /api, payloads do Next (`_rsc`)
// e chamadas repetidas. Só leitura (gravações bloqueadas fora de localhost).
//   PW=<playwright> node scripts/perf-navigation.mjs http://localhost:8790
//   (PERF_ROUNDS=5, PERF_COOKIE, PERF_HOVER_MS=250: tempo do mouse sobre o link antes do clique)
import { homedir } from "node:os";
const base = process.argv[2] ?? "http://localhost:3000";
const rounds = Number(process.env.PERF_ROUNDS ?? 5);
const latency = Number(process.env.PERF_LATENCY_MS ?? 150);
const hover = Number(process.env.PERF_HOVER_MS ?? 250);
const cookie = process.env.PERF_COOKIE ?? "";
const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(new URL(base).origin);
const pw = await import(process.env.PW ?? `${homedir()}/node_modules/playwright/index.js`);
const chromium = pw.chromium ?? pw.default?.chromium;
const browser = await chromium.launch();

const ready = {
  home: () => location.pathname === "/" && !!document.querySelector(".home-metric"),
  clients: () => location.pathname === "/clientes" && !!document.querySelector('main a[href^="/clientes/"]') &&
    !document.body.innerText.includes("Carregando carteira") && !document.body.innerText.includes("Carregando clientes"),
  client: () => /^\/clientes\/[^/]+/.test(location.pathname) && !!document.querySelector('[aria-label^="Abrir tarefa:"]'),
};

async function context() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (cookie) await ctx.addCookies(cookie.split(";").filter((p) => p.trim()).map((p) => {
    const at = p.indexOf("=");
    return { name: p.slice(0, at).trim(), value: p.slice(at + 1).trim(), url: new URL(base).origin, secure: base.startsWith("https:") };
  }));
  if (!local) await ctx.route("**/*", (route) => ["GET", "HEAD", "OPTIONS"].includes(route.request().method())
    ? route.continue() : route.abort("blockedbyclient"));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  if (latency) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency,
    downloadThroughput: 20 * 1024 * 1024 / 8, uploadThroughput: 20 * 1024 * 1024 / 8 });
  const log = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(base).origin) return;
    if (url.pathname.startsWith("/api/") || url.searchParams.has("_rsc"))
      log.push({ at: Date.now(), method: request.method(), path: url.pathname + url.search });
  });
  return { ctx, page, log };
}

const summarize = (log, since) => {
  const calls = log.filter((c) => c.at >= since);
  const api = calls.filter((c) => c.path.startsWith("/api/"));
  const key = (c) => `${c.method} ${c.path.split("&_rsc")[0]}`;
  const seen = new Map();
  for (const c of api) seen.set(key(c), (seen.get(key(c)) ?? 0) + 1);
  return { api: api.length, rsc: calls.filter((c) => c.path.includes("_rsc=")).length,
    duplicates: [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k.slice(0, 80)} ×${n}`),
    paths: api.map((c) => c.path.split("?")[0]) };
};

async function waitReady(page, check) {
  await page.waitForFunction(check, null, { timeout: 30_000, polling: 16 });
}

async function cold(path, check) {
  const { ctx, page, log } = await context();
  const t0 = Date.now();
  await page.goto(base + path, { waitUntil: "commit" });
  await waitReady(page, check);
  const ms = Date.now() - t0;
  await page.waitForTimeout(1500);
  const s = summarize(log, t0);
  await ctx.close();
  return { ms, ...s };
}

async function navigate(start, startCheck, link, check, withHover) {
  const { ctx, page, log } = await context();
  await page.goto(base + start, { waitUntil: "commit" });
  await waitReady(page, startCheck);
  await page.waitForTimeout(1500);
  const target = page.locator(link).first();
  await target.scrollIntoViewIfNeeded();
  const t0 = Date.now();
  if (withHover) { await target.hover(); await page.waitForTimeout(hover); }
  await target.click();
  await waitReady(page, check);
  const ms = Date.now() - t0;
  const url = new URL(page.url()).pathname;
  await page.waitForTimeout(1500);
  const s = summarize(log, t0);
  await ctx.close();
  return { ms: withHover ? ms - hover : ms, url, ...s };
}

const scenarios = [
  ["carga fria /", () => cold("/", ready.home)],
  ["carga fria /clientes", () => cold("/clientes", ready.clients)],
  ["menu → Visão geral (clique)", () => navigate("/clientes", ready.clients, 'nav a[href="/"]', ready.home, false)],
  ["menu → Visão geral (mouse 250 ms + clique)", () => navigate("/clientes", ready.clients, 'nav a[href="/"]', ready.home, true)],
  ["menu → Clientes (clique)", () => navigate("/", ready.home, 'nav a[href="/clientes"]', ready.clients, false)],
  ["menu → Clientes (mouse 250 ms + clique)", () => navigate("/", ready.home, 'nav a[href="/clientes"]', ready.clients, true)],
  ["lista → cliente (clique)", () => navigate("/clientes", ready.clients, 'main a[href^="/clientes/"]', ready.client, false)],
  ["lista → cliente (mouse 250 ms + clique)", () => navigate("/clientes", ready.clients, 'main a[href^="/clientes/"]', ready.client, true)],
];

const pct = (s, p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
console.log(`\n# Navegação em ${base} — rede +${latency} ms por requisição, ${rounds} rodadas; ms do gesto até os dados na tela (o mouse parado não conta)\n`);
console.log("| Cenário | média | p50 | p95 | /api | RSC | repetidas | destino |\n| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const [name, run] of scenarios) {
  const results = [];
  for (let i = 0; i < rounds; i++) {
    try { results.push(await run()); } catch (error) { console.error(`  ${name}: ${error.message.slice(0, 100)}`); }
  }
  if (!results.length) continue;
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const last = results.at(-1);
  console.log(`| ${name} | ${Math.round(ms.reduce((a, b) => a + b, 0) / ms.length)} | ${pct(ms, 0.5)} | ${pct(ms, 0.95)} | ${last.api} | ${last.rsc} | ${last.duplicates.join("; ") || "—"} | ${last.url ?? "—"} |`);
  if (process.env.PERF_VERBOSE) console.log(`  ${last.paths.join(", ")}`);
}
await browser.close();
