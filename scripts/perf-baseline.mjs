// Desempenho percebido no navegador, medido contra um dev server ou contra um
// ambiente publicado.
// Uso: node scripts/perf-baseline.mjs [baseUrl]
// Playwright vem do ambiente (não é dependência deste repositório): defina PW
// com o caminho do pacote ou deixe o script procurar as instalações usuais.
//
// Ambiente publicado:
//   PERF_COOKIE="…"  cookie de sessão do navegador (Aplicação → Cookies), que
//                    identifica a pessoa nas páginas e em /api/state
//   PERF_WRITES=1    libera os gestos que gravam (mover card, marcar alerta)
// Toda requisição envia `x-perf-timing: 1`, que liga o Server-Timing do servidor
// para requisições autenticadas; o cabeçalho não carrega segredo nenhum.
import { homedir } from "node:os";

async function loadChromium() {
  const candidates = [
    process.env.PW,
    "playwright",
    `${homedir()}/node_modules/playwright/index.js`,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const loaded = await import(candidate);
      const chromium = loaded.chromium ?? loaded.default?.chromium;
      if (chromium) return chromium;
    } catch {
      // Tenta o próximo caminho.
    }
  }
  throw new Error("Playwright não encontrado. Defina PW com o caminho do pacote.");
}

const base = process.argv[2] ?? "http://localhost:3100";
const taskTitle = process.env.PERF_TASK ?? "Extensão para vida";
const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(new URL(base).origin);
const writes = local || process.env.PERF_WRITES === "1";
const chromium = await loadChromium();
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  extraHTTPHeaders: { "x-perf-timing": "1" },
});
// A sessão vem do cookie do navegador da pessoa; nada é gravado no repositório.
if (process.env.PERF_COOKIE) {
  const { hostname } = new URL(base);
  await context.addCookies(
    process.env.PERF_COOKIE.split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const at = part.indexOf("=");
        return { name: part.slice(0, at), value: part.slice(at + 1), domain: hostname, path: "/" };
      }),
  );
}
const page = await context.newPage();

const api = [];
page.on("requestfinished", async (request) => {
  const url = request.url();
  if (!url.includes("/api/")) return;
  try {
    const response = await request.response();
    api.push({
      method: request.method(),
      path: url.replace(base, ""),
      status: response?.status(),
      ms: Math.round(request.timing().responseEnd),
      at: Date.now(),
      timing: (await response?.headerValue("server-timing")) ?? "",
    });
  } catch {
    // Requisição cancelada ao trocar de página.
  }
});

function summary(label, wall, start) {
  const rows = api.splice(0);
  const total = rows.reduce((sum, row) => sum + row.ms, 0);
  const last = rows.length && start ? Math.max(...rows.map((row) => row.at)) - start : 0;
  console.log(`\n## ${label}: ${wall} ms de parede (silêncio de 500 ms do Playwright incluído)${last ? `, ${last} ms até a última resposta /api` : ""}, ${rows.length} chamadas /api (${total} ms somados)`);
  for (const row of rows)
    console.log(`  ${row.method} ${row.path} ${row.status} ${row.ms}ms ${row.timing}`);
  return { calls: rows.length, wall };
}

/**
 * `primeiro` é quando o conteúdo aparece (ainda pode vir do padrão local) e
 * `parede` é quando os documentos do servidor chegaram e o quadro está certo.
 */
async function loadPage(path, ready) {
  api.splice(0);
  const start = Date.now();
  await page.goto(base + path, { waitUntil: "domcontentloaded" });
  await page.locator(ready).first().waitFor({ timeout: 60_000 });
  const first = Date.now() - start;
  await page.waitForLoadState("networkidle");
  const wall = Date.now() - start;
  console.log(`\n# ${path}: ${first} ms até o primeiro conteúdo`);
  const nav = await page.evaluate(() => {
    const scripts = performance.getEntriesByType("resource").filter((r) => r.name.includes(".js"));
    return {
      scripts: scripts.length,
      bytes: scripts.reduce((sum, r) => sum + (r.transferSize || 0), 0),
    };
  });
  console.log(`  ${nav.scripts} scripts, ${(nav.bytes / 1024).toFixed(0)} KB JS transferidos`);
  return summary(`carga ${path}`, wall, start);
}

/**
 * Mede o gesto dentro da página, não por round-trip do CDP.
 *
 * O laço `while (await page.evaluate(...))` que existia aqui media o intervalo
 * entre o fim do `dragTo` e a primeira consulta que chegasse depois da troca de
 * coluna — dois tempos que não são o gesto. O relógio do navegador começa no
 * evento (`drop` ou `click`) e para quando o DOM mostra o resultado, e ainda
 * anota quando o pedido saiu para o servidor.
 */
async function armGesture(page, { event, settled }) {
  await page.evaluate(
    ({ event, settled }) => {
      window.__gesture = { at: null, done: null, sent: null };
      const mark = () => {
        if (window.__gesture.at === null) window.__gesture.at = performance.now();
        document.removeEventListener(event, mark, true);
      };
      document.addEventListener(event, mark, true);
      if (!window.__fetchPatched) {
        window.__fetchPatched = true;
        const original = window.fetch;
        window.fetch = function (...args) {
          const url = String(args[0]?.url ?? args[0] ?? "");
          if (url.includes("/api/v1/commands") && window.__gesture && window.__gesture.sent === null)
            window.__gesture.sent = performance.now();
          return original.apply(this, args);
        };
      }
      const ready = new Function("return (" + settled + ")");
      const observer = new MutationObserver(() => {
        if (window.__gesture.done === null && ready()()) {
          window.__gesture.done = performance.now();
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    },
    { event, settled },
  );
}

/** Do evento até o DOM mostrar o resultado, em milissegundos. */
async function readGesture(page) {
  const g = await page.evaluate(() => window.__gesture);
  return {
    reaction: g?.at != null && g?.done != null ? Math.round(g.done - g.at) : null,
    sent: g?.at != null && g?.sent != null ? Math.round(g.sent - g.at) : null,
  };
}

/** Coluna atual do card, lida pelo título da seção que o contém. */
async function columnOf(title) {
  return page.evaluate((label) => {
    const card = [...document.querySelectorAll('[aria-label^="Abrir tarefa:"]')]
      .find((node) => node.getAttribute("aria-label") === `Abrir tarefa: ${label}`);
    return card?.closest("section")?.querySelector("h3")?.textContent?.trim() ?? null;
  }, title);
}

await loadPage("/execucao", '[aria-label^="Abrir tarefa:"]');
await loadPage("/clientes/vertice-seguros/entregas", '[aria-label^="Abrir tarefa:"]');
await loadPage("/alertas", '[aria-label^="Abrir alerta:"]');

// Mover um card entre colunas: tempo até a coluna mudar e até a gravação acabar.
// Grava de verdade; fora de localhost só com PERF_WRITES=1.
if (!writes) {
  console.log("\nGestos que gravam desligados fora de localhost. Use PERF_WRITES=1 para incluí-los.");
  await browser.close();
  process.exit(0);
}
await page.goto(base + "/clientes/vertice-seguros/entregas", { waitUntil: "domcontentloaded" });
const card = page.locator(`[aria-label="Abrir tarefa: ${taskTitle}"]`);
await card.waitFor({ timeout: 60_000 });
await page.waitForLoadState("networkidle");
api.splice(0);
const from = await columnOf(taskTitle);
const to = from === "Em curso" ? "Fila" : "Em curso";
const target = page.locator("section").filter({ has: page.locator("h3", { hasText: to }) }).first();
await armGesture(page, {
  event: "drop",
  settled: `() => {
    const card = [...document.querySelectorAll('[aria-label^="Abrir tarefa:"]')]
      .find((node) => node.getAttribute("aria-label") === ${JSON.stringify(`Abrir tarefa: ${taskTitle}`)});
    return card?.closest("section")?.querySelector("h3")?.textContent?.trim() === ${JSON.stringify(to)};
  }`,
});
let start = Date.now();
await card.dragTo(target);
while (Date.now() - start < 30_000 && (await columnOf(taskTitle)) !== to);
const drop = await readGesture(page);
await page.getByText("Salvando status…").waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
await page.waitForLoadState("networkidle");
console.log(`\n# mover "${taskTitle}" de ${from} para ${to}: ${drop.reaction} ms do drop até o card trocar de coluna (pedido enviado ${drop.sent} ms depois do drop), ${Date.now() - start} ms até a rede parar`);
summary("mover card", Date.now() - start, start);

// Digitar no filtro do quadro: mede o recálculo por tecla.
await page.goto(base + "/execucao", { waitUntil: "domcontentloaded" });
await page.locator('[aria-label^="Abrir tarefa:"]').first().waitFor({ timeout: 60_000 });
await page.waitForLoadState("networkidle");
const filter = page.getByLabel("Filtrar tarefas");
await filter.click();
const typed = "revisao";
// ScriptDuration do Chrome: o tempo de JavaScript que cada tecla custa.
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");
const scripting = async () => {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return metrics.find((m) => m.name === "ScriptDuration").value * 1000;
};
const before = await scripting();
start = Date.now();
for (const letter of typed) await filter.press(letter);
const wall = Date.now() - start;
const cpu = (await scripting()) - before;
console.log(`\n# digitar "${typed}" no filtro do quadro: ${wall} ms (${(wall / typed.length).toFixed(1)} ms por tecla), ${cpu.toFixed(0)} ms de JavaScript (${(cpu / typed.length).toFixed(1)} ms por tecla)`);
api.splice(0);

// Marcar um alerta como visto: tempo até a linha sumir e até a gravação acabar.
await page.goto(base + "/alertas", { waitUntil: "domcontentloaded" });
const row = page.locator('[aria-label^="Abrir alerta:"]').first();
await row.waitFor({ timeout: 60_000 });
await page.waitForLoadState("networkidle");
api.splice(0);
const alert = await row.getAttribute("aria-label");
await armGesture(page, {
  event: "click",
  settled: `() => !document.querySelector(${JSON.stringify(`[aria-label="${alert}"]`)})`,
});
start = Date.now();
await row.getByRole("button", { name: "Marcar como visto" }).click();
await page.locator(`[aria-label="${alert}"]`).waitFor({ state: "detached", timeout: 30_000 });
const seen = await readGesture(page);
await page.getByText("Confirmando alteração…").waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
await page.waitForLoadState("networkidle");
console.log(`\n# "${alert}": ${seen.reaction} ms do clique até a linha sumir (pedido enviado ${seen.sent} ms depois do clique), ${Date.now() - start} ms até a rede parar`);
summary("marcar alerta como visto", Date.now() - start, start);

await browser.close();
