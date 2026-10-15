import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { sqliteD1 } from "./sqlite-d1.mjs";
import { projectClients } from "../../src/modules/clients/infrastructure/snapshot.ts";
import { planSummaryBackfill, summaryBackfillSql } from "../../src/server/delivery-client-summary-backfill.ts";

/**
 * Workspace em modo `active` com muitos clientes, para medir e comparar as
 * leituras globais (carteira, fila e contador de alertas, quadro, ciclos).
 * Cada cliente tem uma fatia própria com tarefas atrasadas, bloqueadas, futuras
 * e um ciclo; há reuniões no passado e no futuro (regras por hora) e quatro
 * pessoas com níveis diferentes, duas delas alocadas em parte dos clientes.
 */
export const GENERATION = "active-bench";
export const MEMBERS = [
  { id: "admin", email: "admin@example.test", access: "admin" },
  { id: "gestor", email: "gestor@example.test", access: "gestor" },
  { id: "operator", email: "operator@example.test", access: "ai_master" },
  { id: "reader", email: "reader@example.test", access: "leitor" },
];
export const session = (memberId) => {
  const member = MEMBERS.find((row) => row.id === memberId);
  return { id: `member:${memberId}`, kind: "session", email: member.email, memberId,
    access: member.access, application: "web", scopes: null, companies: null, guards: [] };
};

const sha = (text) => createHash("sha256").update(text).digest("hex");
/** O formato de `encodeCompressedStateBody` (como as fatias ficam em produção); o hash é do JSON. */
const GZIP = "!g4-state-gzip-v1:";
const stored = (plain, compress) => compress ? GZIP + gzipSync(plain).toString("base64") : plain;
const plainOf = (body) => body.startsWith(GZIP) ? gunzipSync(Buffer.from(body.slice(GZIP.length), "base64")).toString() : body;

/**
 * `profile: "production"` troca as fatias simples (4 tarefas e 1 ciclo, plano
 * `founding-companies` com 126 tarefas de referência) pelo volume medido em
 * produção (`productionSlice`).
 */
export function activeWorkspace({ extraClients = 95, now = new Date(), profile = "simple" } = {}) {
  const f = sqliteD1();
  const seed = projectClients({}).allClients;
  const extra = Array.from({ length: extraClients }, (_, index) => ({
    ...seed[0], slug: `bench-${String(index).padStart(3, "0")}`, name: `Cliente ${index}`,
    ...(profile === "production" ? { journeyId: "service-delivery" } : {}),
  }));
  const archived = extra.length ? [extra.at(-1).slug] : [];
  const allocations = [];
  [...seed, ...extra].forEach((client, index) => {
    if (index % 3 === 0) allocations.push({ id: `op-${index}`, company: client.slug, memberId: "operator", role: "responsavel", percent: 50 });
    if (index % 7 === 0) allocations.push({ id: `rd-${index}`, company: client.slug, memberId: "reader", role: "analista", percent: 10 });
  });
  const clientsDoc = { extraClients: extra, archivedClients: archived, allocationsMigrated: true, allocations };
  const day = (offset) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const hours = (offset) => new Date(now.getTime() + offset * 3_600_000).toISOString();
  const all = [...seed, ...extra];
  const meeting = (row) => ({ durationMin: 60, summary: "", notes: "", decisions: [], actions: [], ...row });
  const meetings = all.slice(0, 12).flatMap((client, index) => [
    meeting({ id: `past-${index}`, company: client.slug, title: "Alinhamento", kind: "alinhamento",
      startsAt: hours(-24 * (index + 1)), attendeeIds: [] }),
    meeting({ id: `pres-${index}`, company: client.slug, title: "Apresentação", kind: "apresentacao",
      startsAt: hours(3 + index * 7), attendeeIds: [] }),
    meeting({ id: `int-${index}`, company: client.slug, title: "Entrevista", kind: "entrevista",
      startsAt: hours(30 + index * 5), attendeeIds: [] }),
  ]);
  const docs = [
    ["ontology.workspace.v3", 4, { hidden: [], extraMembers: MEMBERS }],
    ["ontology.clients.v3", 9, clientsDoc],
    ["ontology.catalog.v2", 2, {}],
    ["ontology.engagement.v2", 3, { extraMeetings: meetings }],
    ["ontology.delivery.v2", 1, {}],
  ];
  for (const [key, version, value] of docs)
    f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,?,?)")
      .run(key, version, key === "ontology.delivery.v2" ? "not-json" : JSON.stringify(value));
  f.sql.prepare(`INSERT INTO delivery_client_shadow_meta
    (workspace_id,generation,mode,source_delivery_version,source_clients_version,
     compatibility_version,expected_clients,expected_owners,expected_orphans,
     expected_array_order,expected_map_order,updated_at)
    VALUES('default',?,'active',1,9,5,?,0,0,0,0,'2026-09-27')`).run(GENERATION, all.length);
  // Projeção de autorização (0032) atual, como em produção: leituras do
  // workspace não precisam do corpo do cadastro para autorizar.
  f.sql.prepare(`INSERT INTO client_access_meta(workspace_id,generation,source_clients_version,
    expected_companies,updated_at) VALUES('default','access',9,?,'2026-09-27')`).run(all.length);
  for (const client of all)
    f.sql.prepare(`INSERT INTO client_access_allocations(workspace_id,generation,company,body)
      VALUES('default','access',?,?)`).run(client.slug, JSON.stringify(allocations
        .filter((row) => row.company === client.slug).map(({ memberId }) => ({ memberId }))));
  let ordinal = 0;
  for (const [index, client] of all.entries()) {
    const base = { company: client.slug, ownerId: index % 2 ? "operator" : "admin", hours: 2,
      workstream: "", milestone: 1, completion: "checklist", comments: [], history: [] };
    const { tasks, cycles } = profile === "production" ? productionSlice(client.slug, index, day)
      : simpleSlice(client.slug, index, base, day);
    const body = JSON.stringify({ extraTasks: tasks, extraCycles: cycles });
    f.sql.prepare(`INSERT INTO delivery_client_snapshots
      (workspace_id,generation,company,revision,body,body_sha256,incarnation)
      VALUES('default',?,?,?,?,?,?)`).run(GENERATION, client.slug, 1 + (index % 4),
        stored(body, profile === "production"), sha(body), `inc-${client.slug}`);
    for (const task of tasks)
      f.sql.prepare(`INSERT INTO delivery_client_array_order
        (workspace_id,generation,kind,id,ordinal,company) VALUES('default',?,'extraTasks',?,?,?)`)
        .run(GENERATION, task.id, ordinal++, client.slug);
  }
  return { ...f, clients: all, archived };
}

function simpleSlice(slug, index, base, day) {
  const tasks = [
    { ...base, id: `${slug}-late`, title: `Atrasada ${index}`, status: "fila", dueAt: day(-5 - (index % 9)) },
    { ...base, id: `${slug}-blocked`, title: `Bloqueada ${index}`, status: "bloqueado", blockers: "Aguardando dados", dueAt: day(4) },
    { ...base, id: `${slug}-future`, title: `Futura ${index}`, status: "em-curso", dueAt: day(20) },
    { ...base, id: `${slug}-done`, title: `Entregue ${index}`, status: "entregue", dueAt: day(-30) },
  ];
  const cycles = [{ id: `${slug}-cycle`, company: slug, name: `Ciclo ${index}`, goal: "",
    startsAt: day(-40), endsAt: day(index % 2 ? -3 : 10), ownerId: "admin",
    status: index % 5 === 0 ? "em-aceite" : "em-curso", taskIds: tasks.map((task) => task.id), acceptance: [] }];
  return { tasks, cycles };
}

/**
 * Fatia com o volume de produção (06/10/2026, 131 clientes): ~19 tarefas e ~5
 * ciclos por cliente, plano sem tarefas de referência (`service-delivery`),
 * descrições e checklists de modelos repetidos entre clientes (um quarto próprio). A coluna do
 * quadro (formato 1, JSON simples) fica entre ~12 e ~34 KB e o corpo do resumo até 28 KB, como lá.
 */
const WORDS = ("diagnóstico comercial processo vendas indicadores reunião cliente equipe plano ação "
  + "entrega revisão aprovação documento relatório financeiro margem custo receita meta prazo "
  + "responsável alinhamento mapeamento operação estoque logística atendimento marketing campanha "
  + "funil conversão contrato proposta treinamento liderança cultura gestão rotina painel dados "
  + "integração sistema automação inteligência artificial agente modelo prompt validação piloto "
  + "implantação cronograma risco premissa decisão próximo passo pendência acesso planilha base "
  + "histórico análise resultado ganho economia produtividade qualidade fornecedor parceiro "
  + "jurídico fiscal contábil orçamento investimento expansão unidade filial região canal").split(" ");
function words(seed, count) {
  let state = seed >>> 0, text = [];
  for (let index = 0; index < count; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    text.push(WORDS[state % WORDS.length]);
  }
  return text.join(" ");
}
function productionSlice(slug, index, day) {
  const count = 11 + ((index * 7) % 15), seed = index * 1000;
  const statuses = ["fila", "em-curso", "revisao", "entregue", "entregue", "bloqueado"];
  const tasks = Array.from({ length: count }, (_, n) => {
    const status = statuses[(index + n) % statuses.length];
    // Clientes no mesmo produto repetem título, descrição e checklist do modelo; um terço é próprio.
    const own = (index + n) % 4 === 0, model = own ? seed + n : (n * 7 + (index % 4)) % 40;
    const task = { id: `${slug}-t${n}-${(seed + n).toString(36)}`, company: slug,
      title: `${words(model, 4)} ${own ? n : ""}`.trim(), description: words(model * 31, 40 + ((model * 13) % 90)),
      status, ownerId: n % 3 ? "operator" : "admin", dueAt: day(-20 + ((n * 5 + index) % 50)), hours: 1 + (n % 6),
      workstream: words(n % 5, 2), milestone: 1 + (n % 4), completion: n % 2 ? "checklist" : "deliverable",
      priority: ["baixa", "media", "alta", "critica"][n % 4], journeyId: "service-delivery", comments: [], history: [] };
    if (n % 2) task.checklist = Array.from({ length: 3 + (model % 5) }, (_, c) =>
      ({ id: `c${c}`, title: words(model * 7 + c, 8 + (c % 6)), done: (n + c) % 3 === 0 }));
    if (status === "entregue") Object.assign(task, { evidence: words(seed + n * 3, 18), requiresEvidence: true,
      approvalRequired: n % 4 === 0, completedAt: day(-2) });
    if (status === "bloqueado") task.blockers = words(seed + n, 10);
    if (n % 5 === 0) Object.assign(task, { kind: "request", requestedBy: "Cliente", origin: "whatsapp" });
    if (n % 6 === 1) Object.assign(task, { startsAt: day(-30 + n), productId: "founding" });
    if (n % 4 === 2) task.comments = [{ id: `m${n}`, authorId: "admin", at: "2026-10-01T10:00:00Z", text: words(seed + n, 40) }];
    return task;
  });
  const cycleCount = 3 + (index % 5);
  const cycles = Array.from({ length: cycleCount }, (_, n) => ({ id: `${slug}-ciclo-${n}`, company: slug,
    name: `Ciclo ${n + 1} · ${words(seed + n * 11, 3)}`, goal: words(seed + n * 17, 45),
    startsAt: day(-120 + n * 30), endsAt: day(-95 + n * 30), ownerId: n % 2 ? "operator" : "admin",
    status: n < cycleCount - 2 ? "concluido" : n === cycleCount - 1 ? "planejado" : "em-curso",
    milestone: 1 + n, templateId: `modelo-${n % 3}`,
    taskIds: tasks.filter((_, t) => t % cycleCount === n).map((task) => task.id),
    acceptance: Array.from({ length: 3 + (n % 3) }, (_, a) => ({ id: `a${a}`, text: words(seed + n * 5 + a, 14),
      done: n < cycleCount - 2, ...(n < cycleCount - 2 ? { approvedBy: "Cliente", approvedAt: "2026-09-01T12:00:00Z" } : {}) })),
    transitions: [{ from: "planejado", to: "em-curso", at: "2026-08-01T12:00:00Z", by: "admin" }] }));
  return { tasks, cycles };
}

/** Escreve uma fatia como o escritor faria: revisão, corpo e versão de compatibilidade. */
export function touchSlice(f, company, mutate) {
  const row = f.sql.prepare("SELECT body,revision FROM delivery_client_snapshots WHERE company=?").get(company);
  const value = JSON.parse(plainOf(row.body));
  mutate(value);
  const body = JSON.stringify(value);
  f.sql.prepare("UPDATE delivery_client_snapshots SET body=?,body_sha256=?,revision=revision+1 WHERE company=?")
    .run(body, sha(body), company);
  f.sql.prepare("UPDATE delivery_client_shadow_meta SET compatibility_version=compatibility_version+1").run();
}

/**
 * Índice de donos (`delivery_entity_owners`) das tarefas e ciclos das fatias,
 * que os comandos por fatia (`tasks.update`) consultam para achar o cliente.
 */
export function indexOwners(f) {
  for (const row of f.sql.prepare("SELECT id,company FROM delivery_client_array_order WHERE generation=?").all(GENERATION))
    f.sql.prepare(`INSERT OR IGNORE INTO delivery_entity_owners(workspace_id,generation,kind,id,company)
      VALUES('default',?,'task',?,?)`).run(GENERATION, row.id, row.company);
  for (const client of f.clients)
    f.sql.prepare(`INSERT OR IGNORE INTO delivery_entity_owners(workspace_id,generation,kind,id,company)
      VALUES('default',?,'cycle',?,?)`).run(GENERATION, `${client.slug}-cycle`, client.slug);
}

/**
 * Grava `delivery_client_summary` como o backfill gravaria (o mesmo plano e o
 * mesmo SQL), para as fatias atuais. `only` restringe aos clientes listados.
 */
export function writeSummaries(f, { only } = {}) {
  const doc = (key) => JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE workspace_id='default' AND key=?").get(key)?.body ?? "{}");
  const slices = f.sql.prepare(`SELECT company,revision,incarnation,body FROM delivery_client_snapshots
    WHERE workspace_id='default' AND generation=? ORDER BY company`).all(GENERATION)
    .filter((row) => !only || only.includes(row.company))
    .map((row) => ({ company: row.company, revision: row.revision, incarnation: row.incarnation, snapshot: JSON.parse(plainOf(row.body)) }));
  const existing = f.sql.prepare(`SELECT company,authority_generation,source_revision,source_incarnation,inputs,body,board
    FROM delivery_client_summary WHERE workspace_id='default'`).all();
  const plan = planSummaryBackfill({ generation: GENERATION, slices, clientsRaw: doc("ontology.clients.v3"),
    catalogRaw: doc("ontology.catalog.v2"), existing });
  for (const row of plan.filter((row) => row.state === "missing" || row.state === "stale"))
    f.sql.exec(summaryBackfillSql("default", GENERATION, row));
  return plan;
}
