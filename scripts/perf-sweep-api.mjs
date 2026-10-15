// Varredura de todas as rotas de API: média, p50, p95, máximo, idas ao D1.
// Uso: node perf-sweep-api.mjs [baseUrl]   (PERF_ROUNDS, PERF_WRITE_ROUNDS, PERF_COMPANY, PERF_OUT)
const base = process.argv[2] ?? "http://localhost:3000";
const rounds = Number(process.env.PERF_ROUNDS ?? 20);
const writeRounds = Number(process.env.PERF_WRITE_ROUNDS ?? 10);
const company = process.env.PERF_COMPANY ?? "vertice-seguros";
const token = process.env.PERF_TOKEN ?? "";
const cookie = process.env.PERF_COOKIE ?? "";
const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(new URL(base).origin);
const writes = local || process.env.PERF_WRITES === "1";
const out = process.env.PERF_OUT ?? "";

function headers(extra = {}, bearer = false) {
  return {
    "x-perf-timing": "1",
    ...(cookie && !bearer ? { cookie } : {}),
    ...(bearer && token ? { authorization: `Bearer ${token}` } : {}),
    ...(bearer && !token && cookie ? { cookie } : {}),
    ...extra,
  };
}
function parseTiming(h) {
  if (!h) return null;
  const d1 = /d1;dur=([\d.]+);desc="(\d+) idas, (\d+) comandos"/.exec(h);
  const total = /total;dur=([\d.]+)/.exec(h);
  return { d1: d1 ? Number(d1[1]) : null, trips: d1 ? Number(d1[2]) : null, stmts: d1 ? Number(d1[3]) : null, total: total ? Number(total[1]) : null };
}
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, mean: Math.round(mean * 10) / 10, p50: pct(s, 0.5), p95: pct(s, 0.95), max: s[s.length - 1], min: s[0] };
}
const rows = [];
function print(r) {
  const t = r.timing;
  console.log(
    `| ${r.label} | ${r.status} | ${fmtSize(r.size)} | ${r.wall.mean} | ${r.wall.p50} | ${r.wall.p95} | ${r.wall.max} | ${t.total != null ? t.total : "—"} | ${t.d1 != null ? `${t.d1} ms · ${t.trips} idas · ${t.stmts} cmd` : "—"} |`,
  );
}
function fmtSize(b) { return b == null ? "—" : b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`; }
async function measure(label, run, n = rounds, warmup = 2) {
  const wall = [], timings = [];
  let status = "", size = null;
  for (let i = 0; i < warmup + n; i += 1) {
    const start = performance.now();
    let res;
    try { res = await run(i); } catch (e) { status = `ERR ${e.message.slice(0, 40)}`; continue; }
    const ms = performance.now() - start;
    if (i < warmup) continue;
    wall.push(Math.round(ms * 10) / 10);
    status = String(res.status);
    if (res.size != null) size = res.size;
    const t = parseTiming(res.headers?.get?.("server-timing"));
    if (t) timings.push(t);
  }
  if (!wall.length) { console.log(`| ${label} | ${status || "sem execução"} | | | | | | | |`); return; }
  const avg = (k) => timings.length && timings[0][k] != null ? Math.round((timings.reduce((a, t) => a + (t[k] ?? 0), 0) / timings.length) * 10) / 10 : null;
  const r = { label, status, size, wall: stats(wall), timing: { d1: avg("d1"), trips: avg("trips"), stmts: avg("stmts"), total: avg("total") } };
  rows.push(r); print(r);
  return r;
}
async function get(path, init) {
  const bearer = path.startsWith("/api/v1/");
  const response = await fetch(base + path, { ...init, cache: "no-store", headers: headers(init?.headers ?? {}, bearer) });
  const body = await response.arrayBuffer();
  return { status: response.status, size: body.byteLength, headers: response.headers };
}
async function readJson(path) {
  const r = await fetch(base + path, { cache: "no-store", headers: headers({}, path.startsWith("/api/v1/")) });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function command(name, input) {
  const response = await fetch(`${base}/api/v1/commands`, {
    method: "POST",
    headers: headers({ "content-type": "application/json", ...(token ? {} : { origin: base }), "Idempotency-Key": crypto.randomUUID() }, true),
    body: JSON.stringify({ command: name, input }),
  });
  const body = await response.arrayBuffer();
  if (!response.ok) throw new Error(`${name}: ${response.status} ${new TextDecoder().decode(body).slice(0, 120)}`);
  return { status: response.status, size: body.byteLength, headers: response.headers };
}

const KEYS = ["ontology.clients.v3","ontology.catalog.v2","ontology.delivery.v2","ontology.documents.v3","ontology.engagement.v2","ontology.knowledge.v2","ontology.relationship.v1","ontology.stakeholders.v1","ontology.workspace.v3"];

// IDs reais do ambiente
const clients = (await readJson("/api/v1/clients")).data ?? [];
const tasks = (await readJson(`/api/v1/tasks?company=${company}&limit=50`)).data ?? [];
const cycles = (await readJson(`/api/v1/cycles?company=${company}&limit=50`)).data ?? [];
const meetings = (await readJson(`/api/v1/meetings?limit=50`)).data ?? [];
const products = (await readJson(`/api/v1/products`)).data ?? [];
const plans = (await readJson(`/api/v1/plans`)).data ?? [];
const members = (await readJson(`/api/v1/members?limit=50`)).data ?? [];
const taskId = process.env.PERF_TASK_ID ?? tasks[0]?.id ?? "d-vs-3";
const cycleId = cycles[0]?.id, meetingId = meetings[0]?.id, productId = products[0]?.id, planId = plans[0]?.id, memberId = members[0]?.id;

console.log(`\n# Varredura de API em ${base} — ${rounds} execuções por leitura, ${writeRounds} por gravação, 2 de aquecimento; cliente ${company}\n`);
console.log(`Dados: ${clients.length} clientes, ${tasks.length}+ tarefas do cliente, ${cycles.length} ciclos, ${meetings.length} reuniões, ${products.length} produtos, ${plans.length} planos, ${members.length} membros\n`);
const HEAD = "| Rota | Status | Tamanho | média ms | p50 | p95 | máx | servidor ms | D1 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |";

const skipReads = process.env.PERF_SKIP_READS === "1";
if (!skipReads) {
console.log("## Rotas internas (sessão)\n\n" + HEAD);
await measure("GET /api/health", () => get("/api/health"));
await measure("GET /api/me", () => get("/api/me"));
await measure("GET /api/users", () => get("/api/users"));
await measure("GET /api/google/status", () => get("/api/google/status"));
await measure("GET /api/ai/status", () => get("/api/ai/status"));
await measure("GET /api/whatsapp/status", () => get("/api/whatsapp/status"));
await measure(`GET /api/insights?company=${company}`, () => get(`/api/insights?company=${company}`));
await measure(`GET /api/g4-os?company=${company}`, () => get(`/api/g4-os?company=${company}`));
await measure("GET /api/files/inexistente", () => get("/api/files/inexistente"));

console.log("\n## Documentos (`/api/state`)\n\n" + HEAD);
for (const key of KEYS) await measure(`GET /api/state/${key}`, () => get(`/api/state/${key}`), Math.min(rounds, 10));
await measure(`GET /api/state?keys=9 (sem versões, corpo inteiro)`, () => get(`/api/state?keys=${KEYS.join(",")}`));
const current = (await readJson(`/api/state?keys=${KEYS.join(",")}`)).documents ?? [];
const versions = current.map((d) => `${d.key}:${d.version}`).join(",");
await measure(`GET /api/state?keys=9&versions=atuais (polling, nada mudou)`, () => get(`/api/state?keys=${KEYS.join(",")}&versions=${versions}`));
const seven = KEYS.filter((k) => !["ontology.relationship.v1","ontology.stakeholders.v1"].includes(k));
await measure(`GET /api/state?keys=7 (carga típica de tela)`, () => get(`/api/state?keys=${seven.join(",")}`));

console.log("\n## REST v1 — leituras\n\n" + HEAD);
const reads = [
  "/api/v1/me", "/api/v1/capabilities", `/api/v1/capabilities?company=${company}`,
  "/api/v1/clients", `/api/v1/clients/${company}`, `/api/v1/clients/${company}/context`, `/api/v1/clients/${company}/stakeholder-map`,
  `/api/v1/clients/${company}/enrollments`, `/api/v1/clients/${company}/participants`, `/api/v1/clients/${company}/stakeholders`,
  "/api/v1/enrollments", "/api/v1/participants", "/api/v1/stakeholders",
  "/api/v1/products", productId ? `/api/v1/products/${productId}` : null, productId ? `/api/v1/products/${productId}/versions` : null,
  "/api/v1/plans", planId ? `/api/v1/plans/${planId}` : null,
  "/api/v1/cycles", `/api/v1/cycles?company=${company}`, cycleId ? `/api/v1/cycles/${cycleId}` : null,
  "/api/v1/tasks?limit=50", "/api/v1/tasks?limit=100&cursor=300", `/api/v1/tasks?company=${company}&limit=100`, `/api/v1/tasks/${taskId}`,
  "/api/v1/meetings", `/api/v1/meetings?company=${company}`, meetingId ? `/api/v1/meetings/${meetingId}` : null,
  `/api/v1/alerts?company=${company}&limit=50`, "/api/v1/alerts/count",
  "/api/v1/members", "/api/v1/members/pending", memberId ? `/api/v1/members?includeInactive=true` : null,
  `/api/v1/allocations?company=${company}`, `/api/v1/knowledge/${company}`, `/api/v1/documents?company=${company}`,
  `/api/v1/inbox/threads?company=${company}`, `/api/v1/signals?company=${company}`, `/api/v1/program-events?company=${company}`,
  `/api/v1/pains?company=${company}`, `/api/v1/solutions?company=${company}`, `/api/v1/hypotheses?company=${company}`,
  `/api/v1/interactions?company=${company}`, "/api/v1/events?limit=50", `/api/v1/events?company=${company}&limit=50`,
  "/api/v1/webhooks", "/api/v1/api-keys", "/api/v1/credentials", "/api/v1/workspace/settings",
  `/api/v1/insights?company=${company}`, `/api/v1/whatsapp/messages?company=${company}`,
  "/api/v1/openapi.json", "/api/v1/docs",
].filter(Boolean);
for (const path of reads) await measure(`GET ${path}`, () => get(path));

console.log("\n## Concorrência (o que o navegador faz de uma vez)\n\n" + HEAD);
await measure("carga de tela: state×7 + alerts/count + health + google/status em paralelo", async () => {
  const rs = await Promise.all([get(`/api/state?keys=${seven.join(",")}`), get("/api/v1/alerts/count"), get("/api/health"), get("/api/google/status")]);
  return { status: rs.map((r) => r.status).join("/"), size: rs.reduce((a, r) => a + r.size, 0), headers: rs[0].headers };
}, Math.min(rounds, 10));
await measure("5 abas em polling ao mesmo tempo (5× state?versions)", async () => {
  const rs = await Promise.all(Array.from({ length: 5 }, () => get(`/api/state?keys=${KEYS.join(",")}&versions=${versions}`)));
  return { status: rs[0].status, size: rs[0].size, headers: rs[0].headers };
}, Math.min(rounds, 10));
await measure("5 pessoas abrindo a tela ao mesmo tempo (5× state×7)", async () => {
  const rs = await Promise.all(Array.from({ length: 5 }, () => get(`/api/state?keys=${seven.join(",")}`)));
  return { status: rs[0].status, size: rs[0].size, headers: rs[0].headers };
}, Math.min(rounds, 10));
}

if (!writes) console.log("\nGravações desligadas fora de localhost (PERF_WRITES=1 liga).");
else {
  console.log("\n## Gravações\n\n" + HEAD);
  const doc = await readJson("/api/state/ontology.knowledge.v2");
  await measure("PUT /api/state/ontology.knowledge.v2 (legado, sem mudança)", async () => {
    const response = await fetch(`${base}/api/state/ontology.knowledge.v2`, { method: "PUT", headers: headers({ "content-type": "application/json", origin: base }), body: JSON.stringify({ value: doc.value, baseVersion: doc.version }) });
    const body = await response.json();
    if (response.ok || response.status === 409) { doc.version = body.version; if (body.value !== undefined) doc.value = body.value; } else throw new Error(`PUT ${response.status}`);
    return { status: response.status, size: JSON.stringify(body).length, headers: response.headers };
  }, writeRounds);
  const original = tasks.find((t) => t.id === taskId)?.status ?? "fila";
  await measure(`POST commands tasks.update (status, ${taskId})`, (i) => command("tasks.update", { taskId, patch: { status: i % 2 === 0 ? "fila" : "em-curso" } }), writeRounds % 2 ? writeRounds + 1 : writeRounds);
  await command("tasks.update", { taskId, patch: { status: original } }).catch(() => {});
  await measure(`POST commands tasks.update (título, ${taskId})`, () => command("tasks.update", { taskId, patch: { title: tasks.find((t) => t.id === taskId)?.title ?? "Tarefa" } }), writeRounds);
  await measure(`POST commands tasks.checklist (${taskId}) — item inexistente`, () => command("tasks.checklist", { taskId, itemId: "perf-inexistente", done: true }).catch((e) => ({ status: e.message.match(/: (\d{3})/)?.[1] ?? "ERR", size: 0, headers: new Headers() })), writeRounds);
  const open = (await readJson(`/api/v1/alerts?company=${company}&limit=50`)).data ?? [];
  let ackTarget = open[0]?.id;
  if (ackTarget) {
    // Repetir a mesma ciência serve? Testa uma vez; se recusar, usa um alerta diferente por execução.
    let repeatable = true;
    try { await command("alerts.acknowledge", { company, alertId: ackTarget }); await command("alerts.acknowledge", { company, alertId: ackTarget }); } catch { repeatable = false; }
    let cursor = 1;
    await measure(`POST commands alerts.acknowledge (${repeatable ? "mesmo alerta" : "um alerta por execução"})`, () => {
      const id = repeatable ? ackTarget : open[cursor++]?.id;
      if (!id) throw new Error("sem alerta");
      return command("alerts.acknowledge", { company, alertId: id });
    }, Math.min(writeRounds, repeatable ? writeRounds : open.length - 1));
  } else console.log("| alerts.acknowledge | sem alerta aberto | | | | | | | |");
  await measure("POST commands (comando inexistente, 4xx)", () => command("nada.aqui", {}).catch((e) => ({ status: e.message.match(/: (\d{3})/)?.[1] ?? "ERR", size: 0, headers: new Headers() })), writeRounds);
  await measure("POST /api/v1/commands sem Idempotency-Key (400)", async () => {
    const r = await fetch(`${base}/api/v1/commands`, { method: "POST", headers: headers({ "content-type": "application/json", origin: base }, true), body: "{}" });
    const b = await r.arrayBuffer(); return { status: r.status, size: b.byteLength, headers: r.headers };
  }, writeRounds);
}
if (out) { const { writeFileSync } = await import("node:fs"); writeFileSync(out, JSON.stringify({ base, rounds, writeRounds, at: new Date().toISOString(), rows }, null, 2)); console.log(`\nJSON em ${out}`); }
console.log("");
