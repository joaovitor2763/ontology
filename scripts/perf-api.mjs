// Medição direta das rotas de API, sem navegador.
// Uso: node scripts/perf-api.mjs [baseUrl]
//
// Local (`next dev`, modo `dev`): a autenticação vem de DEV_USER_EMAIL e basta o fetch.
//
// Ambiente publicado: a medição exige identidade.
//   PERF_TOKEN=g4d_…   chave pessoal (Configurações → API), usada como Bearer em /api/v1/*
//   PERF_COOKIE="…"    cookie de sessão do navegador, usado em /api/state e nas páginas
//   PERF_WRITES=1      libera as medições que gravam (PUT legado e comandos)
// Toda requisição envia `x-perf-timing: 1`, que liga o Server-Timing no servidor
// para requisições autenticadas. O cabeçalho não carrega segredo nenhum.
//
// As medições de gravação executam comandos de verdade (mudam status de tarefa,
// escondem um alerta). Fora de localhost elas só rodam com PERF_WRITES=1, e
// nunca devem ser apontadas para dados de clientes reais.
const base = process.argv[2] ?? "http://localhost:3100";
const task = process.env.PERF_TASK_ID ?? "d-vs-3";
const rounds = Number(process.env.PERF_ROUNDS ?? 5);
const token = process.env.PERF_TOKEN ?? "";
const cookie = process.env.PERF_COOKIE ?? "";
const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(new URL(base).origin);
const writes = local || process.env.PERF_WRITES === "1";

/** `x-perf-timing` liga a medição; a identidade vem do cookie ou da chave pessoal. */
function headers(extra = {}, bearer = false) {
  return {
    "x-perf-timing": "1",
    ...(cookie && !bearer ? { cookie } : {}),
    ...(bearer && token ? { authorization: `Bearer ${token}` } : {}),
    ...(bearer && !token && cookie ? { cookie } : {}),
    ...extra,
  };
}

const KEYS = [
  "ontology.clients.v3",
  "ontology.catalog.v2",
  "ontology.delivery.v2",
  "ontology.documents.v3",
  "ontology.engagement.v2",
  "ontology.knowledge.v2",
  "ontology.relationship.v1",
  "ontology.stakeholders.v1",
  "ontology.workspace.v3",
];

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  return `mediana ${mid} ms (${sorted[0]}–${sorted[sorted.length - 1]} ms)`;
}

async function timed(label, run, times = rounds) {
  const durations = [];
  let last;
  for (let i = 0; i < times; i += 1) {
    const start = Date.now();
    last = await run(i);
    durations.push(Date.now() - start);
  }
  const timing = last?.headers?.get("server-timing") ?? "";
  console.log(`${label.padEnd(52)} ${stats(durations)}${timing ? `  [${timing}]` : ""}`);
  return last;
}

async function get(path, init) {
  const bearer = path.startsWith("/api/v1/");
  const response = await fetch(base + path, {
    ...init,
    cache: "no-store",
    headers: headers(init?.headers ?? {}, bearer),
  });
  await response.arrayBuffer();
  return response;
}

/** Leitura auxiliar (não medida): mesma identidade, corpo já em JSON. */
async function readJson(path) {
  const response = await fetch(base + path, {
    cache: "no-store",
    headers: headers({}, path.startsWith("/api/v1/")),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

async function command(name, input) {
  const response = await fetch(`${base}/api/v1/commands`, {
    method: "POST",
    headers: headers({
      "content-type": "application/json",
      // A guarda de origem vale para sessão por cookie; Bearer não a usa.
      ...(token ? {} : { origin: base }),
      "Idempotency-Key": crypto.randomUUID(),
    }, true),
    body: JSON.stringify({ command: name, input }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${name}: ${response.status} ${body.slice(0, 200)}`);
  return response;
}

console.log(`\n# API em ${base} (${rounds} execuções por medição)\n`);

await timed("GET /api/health", () => get("/api/health"));
await timed("GET /api/google/status", () => get("/api/google/status"));

console.log("");
for (const key of KEYS)
  await timed(`GET /api/state/${key}`, () => get(`/api/state/${key}`), 3);

console.log("");
await timed(`GET /api/state × ${KEYS.length} em paralelo`, async () => {
  const responses = await Promise.all(KEYS.map((key) => get(`/api/state/${key}`)));
  return responses[0];
}, 3);

console.log("");
if (!writes)
  console.log("Medições de gravação desligadas fora de localhost. Use PERF_WRITES=1 para incluí-las.");
if (writes) {
const current = await readJson("/api/state/ontology.knowledge.v2");
await timed("PUT /api/state/ontology.knowledge.v2 (sem mudança)", async () => {
  const response = await fetch(`${base}/api/state/ontology.knowledge.v2`, {
    method: "PUT",
    headers: headers({ "content-type": "application/json", origin: base }),
    body: JSON.stringify({ value: current.value, baseVersion: current.version }),
  });
  const body = await response.json();
  if (response.ok) current.version = body.version;
  else if (response.status === 409) {
    current.value = body.value;
    current.version = body.version;
  } else throw new Error(`PUT: ${response.status}`);
  return response;
});

// Mesma rota com diferença efetiva: um modelo de mensagem que vai e volta.
// Quase todo campo dos documentos já pertence a um comando; os modelos de
// comunicação são um dos poucos que o caminho antigo ainda pode alterar.
const relationship = await readJson("/api/state/ontology.engagement.v2");
await timed("PUT /api/state/ontology.engagement.v2 (com mudança)", async (i) => {
  const value = { ...relationship.value, extraTemplates: i % 2 === 0 ? [{ id: "perf-medicao", name: "Medição", channel: "email", body: "x" }] : [] };
  const response = await fetch(`${base}/api/state/ontology.engagement.v2`, {
    method: "PUT",
    headers: headers({ "content-type": "application/json", origin: base }),
    body: JSON.stringify({ value, baseVersion: relationship.version }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`PUT com mudança: ${response.status} ${JSON.stringify(body)}`);
  relationship.value = value;
  relationship.version = body.version;
  return response;
}, rounds % 2 === 0 ? rounds : rounds + 1);

await timed("POST /api/v1/commands tasks.update (status)", (i) =>
  command("tasks.update", { taskId: task, patch: { status: i % 2 === 0 ? "fila" : "em-curso" } }),
  rounds % 2 === 0 ? rounds : rounds + 1);

// O primeiro cliente que ainda tenha alerta aberto; marcar como visto esconde.
const clients = (await readJson("/api/v1/clients")).data ?? [];
let target = null;
for (const client of clients) {
  const open = await readJson(`/api/v1/alerts?company=${client.slug}&limit=5`);
  if (open.data?.[0]?.id) {
    target = { company: client.slug, alertId: open.data[0].id };
    break;
  }
}
if (target)
  await timed("POST /api/v1/commands alerts.acknowledge", () => command("alerts.acknowledge", target));
else console.log("POST /api/v1/commands alerts.acknowledge        sem alerta aberto para medir");
}

console.log("");
