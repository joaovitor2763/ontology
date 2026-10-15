import test from "node:test";
import assert from "node:assert/strict";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { executeDeliveryCommand } from "../src/server/operations/delivery.ts";
import { issueIntegrationCredential, revokeIntegrationCredential } from "../src/server/operations/credentials.ts";
import { resolveOperationPrincipal } from "../src/server/operations/principal.ts";

function fixture() {
  const f = sqliteD1();
  const put = (key, value) => f.sql.prepare("INSERT INTO state_documents(workspace_id,key,version,body) VALUES('default',?,1,?) ON CONFLICT(workspace_id,key) DO UPDATE SET body=excluded.body,version=version+1").run(key, JSON.stringify(value));
  put("ontology.workspace.v3", { extraMembers: [{ id: "admin", name: "Admin", email: "admin@example.test", access: "admin" }, { id: "master", name: "Master", email: "master@example.test", access: "ai_master" }] });
  put("ontology.clients.v3", { extraClients: ["one", "two"].map(slug => ({ slug, name: slug, status: "ativo", startedAt: "2026-01-01", leadId: "admin", csId: "admin", milestone: 1 })), allocationsMigrated: true, allocations: [{ id: "allocation", company: "one", memberId: "master", role: "responsavel", percent: 30 }], enrollments: [{ id: "purchase-one", company: "one", productId: "product", startsAt: "2026-01-01" }, { id: "purchase-other", company: "one", productId: "product", startsAt: "2026-02-01" }, { id: "purchase-two", company: "two", productId: "product", startsAt: "2026-03-01" }] });
  put("ontology.catalog.v2", { extraProducts: [{ id: "product", name: "Product", description: "", version: 1, cycles: [] }] });
  const principal = { id: "member:admin", kind: "session", email: "admin@example.test", memberId: "admin", access: "admin", application: "web", scopes: null, companies: null, guards: [] };
  const env = { DB: f.db };
  return { ...f, put, env, principal, run: (command, input, key = crypto.randomUUID(), versions = {}, actor = principal) => executeDeliveryCommand(env, actor, command, input, key, versions),
    read: key => JSON.parse(f.sql.prepare("SELECT body FROM state_documents WHERE key=?").get(key).body),
    count: table => f.sql.prepare(`SELECT count(*) n FROM ${table}`).get().n,
  };
}
const task = (overrides = {}) => ({ title: "Tarefa", ownerId: "admin", dueAt: "2026-01-20", ...overrides });
const cycle = (taskIds, overrides = {}) => ({ name: "Ciclo", goal: "Resultado", startsAt: "2026-01-01", endsAt: "2026-01-31", ownerId: "admin", taskIds, acceptance: [{ text: "Resultado aprovado" }], ...overrides });

test("completion enforces checklist and scoped current evidence; closed cycles protect work and attribution is server-owned", async () => {
  const f = fixture();
  try {
    const made = await f.run("tasks.create", { company: "one", task: task({ checklist: [{ title: "Revisar" }], requiresEvidence: true }) });
    const t = made.data.task;
    assert.equal(t.history[0].by, "admin");
    const c = (await f.run("cycles.save", { company: "one", cycle: cycle([t.id]) })).data.cycle;
    await assert.rejects(f.run("tasks.complete", { taskId: t.id }), /checklist/);
    await assert.rejects(f.run("tasks.complete", { taskId: t.id, checklist: [{ id: "invented", done: true }] }), /Item não encontrado/);
    await f.run("tasks.checklist", { taskId: t.id, action: "set", itemId: t.checklist[0].id, done: true });
    f.put("ontology.documents.v3", { extraDocs: [{ id: "foreign", company: "two", relatedTaskId: t.id }, { id: "removed", company: "one", relatedTaskId: t.id }], removedDocIds: ["removed"] });
    await assert.rejects(f.run("tasks.complete", { taskId: t.id }), /evidência/);
    f.put("ontology.documents.v3", { extraDocs: [{ id: "evidence", company: "one", relatedTaskId: t.id }], removedDocIds: [] });
    const done = (await f.run("tasks.complete", { taskId: t.id })).data.task;
    assert.equal(done.status, "entregue");
    assert.equal(done.checklist[0].doneBy, "admin");
    assert.ok(done.checklist[0].doneAt);
    const closed = (await f.run("cycles.save", { cycleId: c.id, cycle: { status: "concluido", acceptance: [{ id: c.acceptance[0].id, done: true, approvedBy: "Patrocinador", channel: "reuniao" }] } })).data.cycle;
    assert.equal(closed.transitions.at(-1).by, "admin");
    assert.ok(closed.acceptance[0].approvedAt);
    await assert.rejects(f.run("tasks.update", { taskId: t.id, patch: { status: "fila" } }), /Reabra o ciclo/);
    await assert.rejects(f.run("cycles.remove", { cycleId: c.id }), /Reabra o ciclo/);
    await assert.rejects(f.run("cycles.save", { cycleId: c.id, cycle: { endsAt: "2026-02-01" } }), /Reabra o ciclo/);
    await assert.rejects(f.run("tasks.update", { taskId: t.id, patch: { dueAt: "2026-02-01" } }), /prazo concluído/);
    await assert.rejects(f.run("tasks.checklist", { taskId: t.id, action: "set", itemId: t.checklist[0].id, done: false }), /Reabra/);
    const commented = (await f.run("tasks.comment", { taskId: t.id, text: "Registrado após aceite" })).data.task;
    assert.equal(commented.comments.at(-1).by, "admin");
    assert.equal(commented.checklist[0].doneBy, "admin");
    await assert.rejects(f.run("tasks.update", { taskId: t.id, patch: { history: [] } }), /campos/);
    await assert.rejects(f.run("cycles.save", { cycleId: c.id, cycle: { transitions: [] } }), /campos/);
  } finally { f.sql.close(); }
});

test("cycle aggregates refuse foreign client or purchase tasks without partial writes; generated tasks commit with the cycle", async () => {
  const f = fixture();
  try {
    const foreign = (await f.run("tasks.create", { company: "two", task: task() })).data.task;
    const receipts = f.count("operation_receipts");
    await assert.rejects(f.run("cycles.save", { company: "one", cycle: cycle([foreign.id]), tasks: [task()] }), /mesmo cliente/);
    assert.equal(f.count("operation_receipts"), receipts);
    assert.equal(f.read("ontology.delivery.v2").extraTasks.length, 1);
    const purchased = (await f.run("tasks.create", { company: "one", task: task({ productId: "product", enrollmentId: "purchase-one" }) })).data.task;
    await assert.rejects(f.run("cycles.save", { company: "one", cycle: cycle([purchased.id], { productId: "product", enrollmentId: "purchase-other" }) }), /mesmo cliente, produto e contratação/);
    await assert.rejects(f.run("tasks.create", { company: "one", task: task({ productId: "product", enrollmentId: "purchase-two" }) }), /Contratação/);
    const created = await f.run("cycles.save", { company: "one", cycle: cycle([], { productId: "product", enrollmentId: "purchase-one" }), tasks: [task({ checklist: [{ title: "Validar" }] })] }, "aggregate");
    assert.equal(created.data.tasks.length, 1);
    assert.equal(created.data.tasks[0].enrollmentId, "purchase-one");
    assert.deepEqual(created.data.cycle.taskIds, [created.data.tasks[0].id]);
    assert.equal(created.data.tasks[0].checklist[0].done, false);
    const replay = await f.run("cycles.save", { company: "one", cycle: cycle([], { productId: "product", enrollmentId: "purchase-one" }), tasks: [task({ checklist: [{ title: "Validar" }] })] }, "aggregate");
    assert.equal(replay.data.cycle.id, created.data.cycle.id);
    assert.equal(f.read("ontology.delivery.v2").extraCycles.length, 1);
    await f.run("cycles.remove", { cycleId: created.data.cycle.id });
    assert.equal(f.read("ontology.delivery.v2").extraTasks.length, 3, "removing a cycle keeps its tasks");
  } finally { f.sql.close(); }
});

test("deadlines recalculate within authorized scope, preserve completed dates and reject cycles or cross-client references", async () => {
  const f = fixture();
  try {
    const base = (await f.run("tasks.create", { company: "one", task: task({ dueAt: "2026-01-10" }) })).data.task;
    const dependent = (await f.run("tasks.create", { company: "one", task: task({ deadline: { mode: "task", taskId: base.id, offsetDays: 2 } }) })).data.task;
    assert.equal(dependent.dueAt, "2026-01-12");
    const frozen = (await f.run("tasks.create", { company: "one", task: task({ deadline: { mode: "task", taskId: base.id, offsetDays: 3 } }) })).data.task;
    await f.run("tasks.complete", { taskId: frozen.id });
    await f.run("tasks.update", { taskId: base.id, patch: { dueAt: "2026-01-15" } });
    const state = f.read("ontology.delivery.v2");
    assert.equal(state.taskPatches[dependent.id].dueAt, "2026-01-17");
    assert.equal(state.taskPatches[frozen.id].dueAt, "2026-01-13");
    await assert.rejects(f.run("tasks.update", { taskId: base.id, patch: { deadline: { mode: "task", taskId: dependent.id, offsetDays: 1 } } }), /dependências formam um ciclo/);
    await assert.rejects(f.run("tasks.create", { company: "two", task: task({ deadline: { mode: "task", taskId: base.id, offsetDays: 1 } }) }), /mesmo cliente/);
    const blocked = (await f.run("tasks.blocker", { taskId: base.id, blocker: { reason: "Aguardando acesso", ownerId: "admin" } })).data.task;
    assert.equal(blocked.status, "bloqueado"); assert.ok(blocked.blocker.since);
    const resolved = (await f.run("tasks.blocker", { taskId: base.id, blocker: null })).data.task;
    assert.equal(resolved.status, "em-curso"); assert.ok(resolved.blocker.resolvedAt); assert.equal(resolved.history.at(-1).by, "admin");
  } finally { f.sql.close(); }
});

test("bulk edits authorize every client, reject stale versions atomically and replay cannot bypass credential revocation", async () => {
  const f = fixture();
  try {
    const one = (await f.run("tasks.create", { company: "one", task: task() })).data.task;
    const two = (await f.run("tasks.create", { company: "two", task: task() })).data.task;
    const master = { ...f.principal, id: "member:master", memberId: "master", email: "master@example.test", access: "ai_master" };
    await assert.rejects(f.run("tasks.update", { taskIds: [one.id, two.id], patch: { priority: "alta" } }, "denied-bulk", {}, master), { code: "permission_denied" });
    assert.equal(f.read("ontology.delivery.v2").taskPatches[one.id]?.priority, undefined);
    await assert.rejects(f.run("tasks.update", { taskId: one.id, patch: { title: "Stale" } }, "stale", { "ontology.delivery.v2": 0 }), { code: "version_conflict" });
    const batch = await f.run("tasks.update", { taskIds: [one.id, two.id], patch: { priority: "alta" } });
    assert.equal(batch.data.tasks.length, 2);
    const events = f.sql.prepare("SELECT company,data FROM operation_events WHERE type='tasks.update'").all();
    for (const event of events) assert.deepEqual(JSON.parse(event.data).taskIds, [event.company === "one" ? one.id : two.id], "event payload stays inside its client scope");
    const token = await issueIntegrationCredential(f.db, "default", "admin@example.test", { name: "Integration", ownerEmail: "admin@example.test", scopes: ["delivery:write"], companies: ["one"], expiresAt: new Date(Date.now() + 3600000).toISOString() });
    const principal = await resolveOperationPrincipal(new Request("https://delivery.test", { headers: { authorization: `Bearer ${token.token}` } }), f.env);
    const result = await f.run("tasks.comment", { taskId: one.id, text: "Uma vez" }, "comment", {}, principal);
    assert.deepEqual(result.documents, []);
    await f.run("tasks.comment", { taskId: one.id, text: "Uma vez" }, "comment", {}, principal);
    assert.equal(f.read("ontology.delivery.v2").taskPatches[one.id].comments.length, 1);
    await revokeIntegrationCredential(f.db, "default", "admin@example.test", token.id);
    await assert.rejects(f.run("tasks.comment", { taskId: one.id, text: "Uma vez" }, "comment", {}, principal), { code: "invalid_token" });
  } finally { f.sql.close(); }
});

test("a permission dependency changing before commit rolls back task, receipt and event together", async () => {
  const f = fixture();
  try {
    const made = (await f.run("tasks.create", { company: "one", task: task() })).data.task;
    const before = f.read("ontology.delivery.v2"), events = f.count("operation_events"), receipts = f.count("operation_receipts");
    const batch = f.db.batch.bind(f.db);
    f.db.batch = async (statements) => {
      f.sql.prepare("UPDATE state_documents SET version=version+1 WHERE key='ontology.workspace.v3'").run();
      return batch(statements);
    };
    await assert.rejects(f.run("tasks.update", { taskId: made.id, patch: { title: "Must not commit" } }), { code: "version_conflict" });
    assert.deepEqual(f.read("ontology.delivery.v2"), before);
    assert.equal(f.count("operation_events"), events);
    assert.equal(f.count("operation_receipts"), receipts);
  } finally { f.sql.close(); }
});

test("cycle draft references remap to server IDs and template baseline comes from catalog; replay creates nothing twice", async () => {
  const f = fixture();
  try {
    const template = { id: "template", name: "Modelo oficial", goal: "Resultado", durationDays: 14, acceptance: ["Validado"], deliveries: [], milestones: [{ id: "resultado", name: "Modelo oficial" }] };
    f.put("ontology.catalog.v2", { extraProducts: [{ id: "product", name: "Product", version: 3, cycles: [template] }] });
    const input = { company: "one", cycle: cycle([], { productId: "product", enrollmentId: "purchase-one", templateId: "template" }), tasks: [
      { ...task(), draftRef: "draft-first" },
      { ...task({ title: "Dependente", deadline: { mode: "task", taskId: "draft-first", offsetDays: 2 } }), draftRef: "draft-second" },
    ] };
    const result = await f.run("cycles.save", input, "retry-cycle");
    assert.deepEqual(result.data.cycle.productBaseline, template);
    assert.equal(result.data.cycle.productVersion, 3);
    assert.equal(result.data.cycle.templateName, "Modelo oficial");
    const saved = f.read("ontology.delivery.v2").extraTasks;
    assert.notEqual(saved[0].id, "draft-first");
    assert.equal(saved[1].deadline.taskId, saved[0].id);
    assert.equal(result.data.tasks[1].dueAt, "2026-01-22");
    assert.equal(saved[0].draftRef, undefined);
    const replay = await f.run("cycles.save", input, "retry-cycle");
    assert.equal(replay.data.cycle.id, result.data.cycle.id);
    assert.equal(f.read("ontology.delivery.v2").extraTasks.length, 2);
    await assert.rejects(f.run("cycles.save", { ...input, cycle: { ...input.cycle, productBaseline: { forged: true } } }), /campos/);
    await assert.rejects(f.run("cycles.save", { ...input, tasks: [input.tasks[0], input.tasks[0]] }), /referências únicas/);
    await assert.rejects(f.run("cycles.save", { ...input, cycle: { ...input.cycle, templateId: "missing" } }), /Modelo/);
  } finally { f.sql.close(); }
});

test("task creation preserves unplanned requests and completion atomically saves editor fields, effort and server-owned checklist history", async () => {
  const f = fixture();
  try {
    const created = (await f.run("tasks.create", { company: "one", task: task({ milestone: 0, kind: "request", requestedBy: "Contato", origin: "whatsapp", checklist: [{ title: "Validar" }], requiresEvidence: true }) })).data.task;
    assert.equal(created.milestone, 0);
    assert.equal(created.kind, "request");
    const input = { taskId: created.id, patch: { title: "Título revisado", hours: 8 }, effortActual: 2.5, evidence: "Validação registrada", checklist: [{ id: created.checklist[0].id, done: true }] };
    const receipts = f.count("operation_receipts");
    await assert.rejects(f.run("tasks.complete", { ...input, evidence: "" }), /evidência/);
    assert.equal(f.read("ontology.delivery.v2").extraTasks[0].title, "Tarefa");
    assert.equal(f.count("operation_receipts"), receipts);
    await assert.rejects(f.run("tasks.complete", { ...input, patch: { ...input.patch, company: "two" } }), /campos/);
    await assert.rejects(f.run("tasks.complete", { ...input, effortActual: -1 }), /número|valor|inválido/i);
    const completed = (await f.run("tasks.complete", input, "completion-retry")).data.task;
    assert.equal(completed.title, "Título revisado");
    assert.equal(completed.effortActual, 2.5);
    assert.equal(completed.checklist[0].doneBy, "admin");
    assert.equal(completed.status, "entregue");
    assert.ok(completed.history.every(row => row.by === "admin"));
    const historyLength = completed.history.length;
    assert.equal((await f.run("tasks.complete", input, "completion-retry")).data.task.history.length, historyLength);
    await assert.rejects(f.run("tasks.complete", { taskId: created.id, checklist: [{ id: created.checklist[0].id, done: false }] }), /checklist/);
    await assert.rejects(f.run("tasks.complete", { taskId: created.id, evidence: "" }), /evidência/);
    const cleared = (await f.run("tasks.complete", { taskId: created.id, effortActual: null })).data.task;
    assert.equal(cleared.effortActual, undefined);
    await assert.rejects(f.run("tasks.complete", { taskId: created.id, patch: { dueAt: "2026-02-02" } }), /Reabra/);
  } finally { f.sql.close(); }
});

test("effective completion date can be historical while audit time stays server-owned", async () => {
  const f = fixture();
  try {
    const created = (await f.run("tasks.create", { company: "one", task: task() })).data.task;
    const completed = (await f.run("tasks.complete", { taskId: created.id, completedAt: "2020-03-10" }, "historical-completion")).data.task;
    assert.equal(completed.status, "entregue");
    assert.equal(completed.completedAt, "2020-03-10");
    const audit = f.sql.prepare("SELECT data,created_at FROM client_audit_log WHERE command='tasks.complete' AND subject=?").get(created.id);
    assert.equal(JSON.parse(audit.data).completedAt, "2020-03-10");
    assert.ok(Date.parse(audit.created_at) > Date.parse("2020-03-10T23:59:59Z"));

    const reopened = (await f.run("tasks.update", { taskId: created.id, patch: { status: "fila" } })).data.task;
    assert.equal(reopened.completedAt, undefined);
    assert.ok(f.read("ontology.delivery.v2").taskPatches[created.id].clearedFields.includes("completedAt"));
    const receipts = f.count("operation_receipts");
    await assert.rejects(f.run("tasks.complete", { taskId: created.id, completedAt: "2099-01-01" }), /futuro/);
    assert.equal(f.count("operation_receipts"), receipts);
    const current = (await f.run("tasks.complete", { taskId: created.id })).data.task;
    assert.match(current.completedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.notEqual(current.completedAt, "2020-03-10");
  } finally { f.sql.close(); }
});

test('cycle acceptance supports the informed date without accepting impossible dates or audit authors', async()=>{
 const f=fixture();try {
  const c=(await f.run('cycles.save',{company:'one',cycle:cycle([])})).data.cycle;
  const acceptance=[{id:c.acceptance[0].id,done:true,approvedBy:'admin',approvedAt:'2026-01-12'}];
  const saved=(await f.run('cycles.save',{cycleId:c.id,cycle:{acceptance}})).data.cycle;
  assert.equal(saved.acceptance[0].approvedAt,'2026-01-12');
  await assert.rejects(f.run('cycles.save',{cycleId:c.id,cycle:{acceptance:[{...acceptance[0],approvedAt:'2026-02-30'}]}}),/data válida/);
 }finally{f.sql.close();}
});


test("task update clears optional actual effort explicitly without accepting null for required effort", async () => {
  const f = fixture();
  try {
    const created = (await f.run("tasks.create", { company: "one", task: task({ effortActual: 3 }) })).data.task;
    const cleared = (await f.run("tasks.update", { taskId: created.id, patch: { effortActual: null } })).data.task;
    assert.equal(cleared.effortActual, undefined);
    assert.equal(f.read("ontology.delivery.v2").extraTasks.find(t => t.id === created.id).effortActual, undefined);
    await assert.rejects(f.run("tasks.update", { taskId: created.id, patch: { hours: null } }), /número|valor|inválido/i);
  } finally { f.sql.close(); }
});

test('new product cycles require an explicit purchase while legacy editing and unpurchased products remain compatible',async()=>{
 const f=fixture();try {
  await assert.rejects(f.run('cycles.save',{company:'one',cycle:cycle([],{productId:'product'})}),/explicitamente a contratação/);
  await assert.rejects(f.run('tasks.create',{company:'one',task:task({productId:'product'})}),/explicitamente a contratação/);
  const selected=(await f.run('cycles.save',{company:'one',cycle:cycle([],{productId:'product',enrollmentId:'purchase-other'})})).data.cycle;
  assert.equal(selected.enrollmentId,'purchase-other');
  const selectedTask=(await f.run('tasks.create',{company:'one',cycleId:selected.id,task:task()})).data.task;
  const clients=f.read('ontology.clients.v3');clients.enrollments=clients.enrollments.map(e=>e.id==='purchase-other'?{...e,status:'cancelada'}:e);f.put('ontology.clients.v3',clients);
  await assert.rejects(f.run('cycles.save',{cycleId:selected.id,cycle:{name:'Não pode mudar'}}),/encerrada ou arquivada/);
  await assert.rejects(f.run('cycles.save',{cycleId:selected.id,cycle:{enrollmentId:'purchase-one',name:'Não pode transferir'}}),/encerrada ou arquivada/);
  await assert.rejects(f.run('cycles.remove',{cycleId:selected.id}),/encerrada ou arquivada/);
  await assert.rejects(f.run('tasks.create',{company:'one',cycleId:selected.id,task:task()}),/encerrada ou arquivada/);
  await assert.rejects(f.run('tasks.update',{taskId:selectedTask.id,patch:{enrollmentId:'purchase-one',title:'Não pode transferir'}}),/encerrada ou arquivada/);
  await assert.rejects(f.run('tasks.blocker',{taskId:selectedTask.id,blocker:{reason:'Não pode alterar'}}),/encerrada ou arquivada/);
  await assert.rejects(f.run('tasks.blocker',{taskId:selectedTask.id,blocker:null}),/encerrada ou arquivada/);
  const inheritedState=f.read('ontology.delivery.v2'),inheritedTask=inheritedState.extraTasks.find(t=>t.id===selectedTask.id);delete inheritedTask.enrollmentId;delete inheritedTask.productId;f.put('ontology.delivery.v2',inheritedState);
  for(const [command,input] of [
    ['tasks.update',{taskId:selectedTask.id,patch:{title:'Não pode alterar'}}],
    ['tasks.complete',{taskId:selectedTask.id}],
    ['tasks.comment',{taskId:selectedTask.id,text:'Não pode comentar'}],
    ['tasks.checklist',{taskId:selectedTask.id,action:'add',title:'Não pode adicionar'}],
    ['tasks.blocker',{taskId:selectedTask.id,blocker:{reason:'Não pode bloquear'}}],
  ]) await assert.rejects(f.run(command,input),/encerrada ou arquivada/);
  const state=f.read('ontology.delivery.v2');const legacy={...selected,id:'legacy-cycle'};delete legacy.enrollmentId;state.extraCycles.push(legacy);f.put('ontology.delivery.v2',state);
  const edited=(await f.run('cycles.save',{cycleId:legacy.id,cycle:{name:'Legado preservado'},tasks:[task({title:'Nova tarefa legada'})]})).data.cycle;
  assert.equal(edited.enrollmentId,undefined);
  f.put('ontology.catalog.v2',{extraProducts:[{id:'uncontracted',name:'Avulso',description:'',version:1,cycles:[]}]});
  const uncontracted=(await f.run('cycles.save',{company:'one',cycle:cycle([],{productId:'uncontracted'})})).data.cycle;
  assert.equal(uncontracted.enrollmentId,undefined);
 }finally{f.sql.close();}
});

test('cleanup keeps working when historical owners are inactive or products leave the catalog',async()=>{
 const f=fixture();try {
  const savedCycle=(await f.run('cycles.save',{company:'one',cycle:cycle([],{productId:'product',enrollmentId:'purchase-other'})})).data.cycle;
  const savedTask=(await f.run('tasks.create',{company:'one',cycleId:savedCycle.id,task:task()})).data.task;
  const state=f.read('ontology.delivery.v2');
  state.extraCycles=state.extraCycles.map(row=>row.id===savedCycle.id?{...row,ownerId:'former-owner'}:row);
  state.extraTasks=state.extraTasks.map(row=>row.id===savedTask.id?{...row,ownerId:'former-owner'}:row);
  f.put('ontology.delivery.v2',state);f.put('ontology.catalog.v2',{extraProducts:[]});
  const blocked=(await f.run('tasks.blocker',{taskId:savedTask.id,blocker:{reason:'Dependência externa'}})).data.task;
  assert.equal(blocked.status,'bloqueado');
  const cleared=(await f.run('tasks.blocker',{taskId:savedTask.id,blocker:null})).data.task;
  assert.equal(cleared.status,'em-curso');
  await f.run('cycles.remove',{cycleId:savedCycle.id});
  assert.ok(f.read('ontology.delivery.v2').cycleEdits[savedCycle.id].removed);
 }finally{f.sql.close();}
});

test('remote cycle copy derives template baseline, preserves editable context and rolls back invalid template',async()=>{
 const f=fixture();try {
  const {cycleCopyInput}=await import('../src/modules/delivery/application/cycle-command-input.ts');
  const template={id:'copy-template',name:'Official template',goal:'Goal',durationDays:31,acceptance:['Accepted'],deliveries:[],milestones:[{id:'resultado',name:'Official template'}]};
  f.put('ontology.catalog.v2',{extraProducts:[{id:'product',name:'Product',version:3,cycles:[template]}]});
  const draft=task({id:'draft-copy',company:'one',priority:'critica',relatedNodeIds:['node-1'],origin:'reuniao',requestedBy:'Sponsor',responsibleRole:'lead',party:'equipe',assignmentSource:'papel',checklist:[{id:'old-check',title:'Review',done:true}]});
  const input=cycleCopyInput({...cycle([]),company:'one',productId:'product',enrollmentId:'purchase-one',templateId:template.id},[draft],[{...draft,id:'old'}]);
  const saved=(await f.run('cycles.save',input)).data;
  assert.equal(saved.cycle.templateId,template.id);assert.equal(saved.cycle.productVersion,3);assert.deepEqual(saved.cycle.productBaseline,template);
  for(const field of ['priority','relatedNodeIds','origin','requestedBy','responsibleRole','party','assignmentSource']) assert.deepEqual(saved.tasks[0][field],draft[field],field);
  assert.equal(saved.tasks[0].checklist[0].done,false);
  const before=f.read('ontology.delivery.v2'), receipts=f.count('operation_receipts'),events=f.count('operation_events');
  await assert.rejects(f.run('cycles.save',{...input,cycle:{...input.cycle,templateId:'missing-template'}}),/Modelo de ciclo/);
  assert.deepEqual(f.read('ontology.delivery.v2'),before);assert.equal(f.count('operation_receipts'),receipts);assert.equal(f.count('operation_events'),events);
 }finally{f.sql.close();}
});

test('optional clears survive SQLite projection reload and later concrete updates',async()=>{
 const f=fixture();try {
  const {projectDelivery}=await import('../src/modules/delivery/infrastructure/snapshot.ts');
  const created=(await f.run('tasks.create',{company:'one',task:task({startsAt:'2026-01-05',effortActual:3,deliverable:'project_charter'})})).data.task;
  await f.run('tasks.update',{taskId:created.id,patch:{startsAt:null,effortActual:null,deliverable:null}});
  const reload=()=>projectDelivery(f.read('ontology.delivery.v2'),'one').tasks.find(t=>t.id===created.id);
  for(const field of ['startsAt','effortActual','deliverable']) assert.equal(reload()[field],undefined,field);
  await f.run('tasks.update',{taskId:created.id,patch:{title:'Other edit'}});
  assert.equal(reload().startsAt,undefined,'unrelated edit must not regenerate a cleared start');
  await f.run('tasks.update',{taskId:created.id,patch:{startsAt:'2026-01-06',effortActual:4,deliverable:'action_plan'}});
  assert.equal(reload().startsAt,'2026-01-06');assert.equal(reload().effortActual,4);assert.equal(reload().deliverable,'action_plan');
  await f.run('tasks.complete',{taskId:created.id,effortActual:null,patch:{startsAt:null,deliverable:null}});for(const field of ['effortActual','startsAt','deliverable']) assert.equal(reload()[field],undefined);
  await assert.rejects(f.run('tasks.update',{taskId:created.id,patch:{dueAt:null}}),/texto|data|válido/i);
  const seed=(await import('../src/modules/delivery/infrastructure/seed.ts')).deliveries.find(t=>t.deliverable&&t.status!=='entregue'&&!projectDelivery().cycles.some(c=>c.taskIds.includes(t.id)));
  await f.run('tasks.update',{taskId:seed.id,patch:{deliverable:null}});
  assert.equal(projectDelivery(f.read('ontology.delivery.v2'),seed.company).tasks.find(t=>t.id===seed.id).deliverable,undefined,'immutable seed must stay cleared after reload');
 }finally{f.sql.close();}
});

test('clearing an optional start permits an earlier deadline atomically in update and completion',async()=>{
 const f=fixture();try {
  const {projectDelivery}=await import('../src/modules/delivery/infrastructure/snapshot.ts');
  for(const command of ['tasks.update','tasks.complete']){
   const created=(await f.run('tasks.create',{company:'one',task:task({startsAt:'2026-01-10',dueAt:'2026-01-20'})})).data.task;
   const input={taskId:created.id,patch:{startsAt:null,dueAt:'2026-01-05'}};
   const saved=(await f.run(command,input)).data.task;
   assert.equal(saved.startsAt,undefined);assert.equal(saved.dueAt,'2026-01-05');
   assert.equal(saved.status,command==='tasks.complete'?'entregue':'fila');
   const reloaded=projectDelivery(f.read('ontology.delivery.v2'),'one').tasks.find(t=>t.id===created.id);
   assert.equal(reloaded.startsAt,undefined);assert.equal(reloaded.dueAt,'2026-01-05');
  }
  const current=(await f.run('tasks.create',{company:'one',task:task({startsAt:'2026-01-10',dueAt:'2026-01-20'})})).data.task;
  await assert.rejects(f.run('tasks.update',{taskId:current.id,patch:{dueAt:'2026-01-05'}}),/início não pode/);
 }finally{f.sql.close();}
});

test('null clearing is patch-only: direct creation and aggregate drafts reject it without receipts or events',async()=>{
 const f=fixture();try {
  const beforeReceipts=f.count('operation_receipts'),beforeEvents=f.count('operation_events');
  for(const field of ['startsAt','effortActual','deliverable']){
   await assert.rejects(f.run('tasks.create',{company:'one',task:task({[field]:null})}),/Ao criar uma tarefa/);
   await assert.rejects(f.run('cycles.save',{company:'one',cycle:cycle([]),tasks:[task({[field]:null})]}),/Ao criar uma tarefa/);
  }
  assert.equal(f.count('operation_receipts'),beforeReceipts);assert.equal(f.count('operation_events'),beforeEvents);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM state_documents WHERE key='ontology.delivery.v2'").get().n,0);
 }finally{f.sql.close();}
});

test('reference tasks displayed in the client board are also found by global commands',async()=>{
 const f=fixture();
 try {
  const {deliveriesFor}=await import('../src/modules/delivery/infrastructure/queries.ts');
  const {companies}=await import('../src/modules/clients/infrastructure/seed.ts');
  const client=companies.find(c=>c.name.includes('Vértice'));
  assert.ok(client);
  const displayed=deliveriesFor(client.slug).find(t=>t.id.startsWith('pb-')&&t.status!=='entregue');
  assert.ok(displayed);
  assert.deepEqual(deliveriesFor().find(t=>t.id===displayed.id),displayed);
  const result=await f.run('tasks.update',{taskId:displayed.id,patch:{status:'em-curso'}});
  assert.equal(result.data.task.id,displayed.id);
  assert.equal(result.data.task.status,'em-curso');
  assert.equal(deliveriesFor(client.slug,f.read('ontology.delivery.v2').statusMap,[],f.read('ontology.delivery.v2').taskPatches).find(t=>t.id===displayed.id).status,'em-curso');
 } finally {f.sql.close();}
});

test("seed tasks inside a seed cycle inherit its product and can change status", async () => {
  const f = fixture();
  try {
    const { projectDelivery } = await import("../src/modules/delivery/infrastructure/snapshot.ts");
    const { cycles, tasks } = projectDelivery({});
    const pair = cycles.flatMap(cycle => cycle.taskIds.map(id => ({ cycle, task: tasks.find(t => t.id === id) })))
      .find(({ cycle, task }) => task && !task.productId && cycle.productId && cycle.status !== "concluido" && ["fila", "em-curso"].includes(task.status));
    assert.ok(pair, "the seed keeps at least one open task without product inside a product cycle");
    const next = pair.task.status === "fila" ? "em-curso" : "fila";
    const result = await f.run("tasks.update", { taskId: pair.task.id, patch: { status: next } });
    assert.equal(result.data.task.status, next);
    await assert.rejects(f.run("tasks.update", { taskId: pair.task.id, patch: { productId: "product" } }), /não podem ser alterados/);
  } finally { f.sql.close(); }
});

test("start/deadline checks only cover the tasks a command changes; legacy inconsistencies never block other edits", async () => {
  const f = fixture();
  try {
    const legacy = (id, overrides) => ({ id, company: "one", title: id, description: "", status: "fila", ownerId: "admin", hours: 0, workstream: "", milestone: 1, completion: "checklist", ...overrides });
    f.put("ontology.delivery.v2", { extraTasks: [
      legacy("late-start", { startsAt: "2026-11-10", dueAt: "2026-09-28" }),
      legacy("bad-year", { startsAt: "2026-01-05", dueAt: "0002-03-04" }),
    ] });
    const made = (await f.run("tasks.create", { company: "one", task: task() })).data.task;
    const edited = (await f.run("tasks.update", { taskId: made.id, patch: { title: "Outro título", dueAt: "2026-01-25" } })).data.task;
    assert.equal(edited.dueAt, "2026-01-25");
    // Stored start after the deadline is read (and shown) as the deadline itself.
    const late = (await f.run("tasks.update", { taskId: "late-start", patch: { title: "Legada" } })).data.task;
    assert.equal(late.startsAt, "2026-09-28");
    await assert.rejects(f.run("tasks.update", { taskId: "late-start", patch: { startsAt: "2026-10-10" } }), /posterior ao prazo/);
    await assert.rejects(f.run("tasks.update", { taskId: made.id, patch: { dueAt: "0002-01-25" } }), /datas válidas/);
    // A batch deadline before a task's start moves that start; others keep theirs.
    await f.run("tasks.update", { taskId: made.id, patch: { startsAt: "2026-01-20" } });
    const batch = (await f.run("tasks.update", { taskIds: [made.id, "late-start"], patch: { dueAt: "2026-01-15" } })).data.tasks;
    assert.deepEqual(batch.map(t => [t.startsAt, t.dueAt]), [["2026-01-15", "2026-01-15"], ["2026-01-15", "2026-01-15"]]);
  } finally { f.sql.close(); }
});

test("a task stored with year 0002 still accepts status, comments and a deadline-only repair", async () => {
  const f = fixture();
  try {
    const legacy = (id, overrides) => ({ id, company: "one", title: id, description: "", status: "fila", ownerId: "admin", hours: 0, workstream: "", milestone: 1, completion: "checklist", ...overrides });
    // No start: the lazy migration copies the broken deadline into startsAt too.
    f.put("ontology.delivery.v2", { extraTasks: [legacy("broken", { dueAt: "0002-03-04" })] });
    assert.equal((await f.run("tasks.update", { taskId: "broken", patch: { status: "em-curso" } })).data.task.status, "em-curso");
    assert.equal((await f.run("tasks.comment", { taskId: "broken", text: "Revisar prazo" })).data.task.comments.at(-1).text, "Revisar prazo");
    assert.equal((await f.run("tasks.update", { taskId: "broken", patch: { title: "Renomeada" } })).data.task.title, "Renomeada");
    const fixed = (await f.run("tasks.update", { taskId: "broken", patch: { dueAt: "2026-10-01" } })).data.task;
    assert.deepEqual([fixed.startsAt, fixed.dueAt], ["2026-10-01", "2026-10-01"]);
    await assert.rejects(f.run("tasks.update", { taskId: "broken", patch: { startsAt: "0002-01-01" } }), /datas válidas/);
  } finally { f.sql.close(); }
});

test("backlog: an empty deadline is allowed only in fila, is fixed and never refilled nor overdue", async () => {
  const f = fixture();
  try {
    const { deriveAlerts } = await import("../src/modules/workspace/domain/derived-alerts.ts");
    // Creation without a date lands in the Backlog; any other status needs a date.
    const backlog = (await f.run("tasks.create", { company: "one", task: task({ dueAt: "" }) })).data.task;
    assert.equal(backlog.dueAt, "");
    await assert.rejects(f.run("tasks.create", { company: "one", task: task({ dueAt: "", status: "em-curso" }) }), /Backlog/);
    await assert.rejects(f.run("tasks.update", { taskId: backlog.id, patch: { status: "em-curso" } }), /Defina um prazo/);
    await assert.rejects(f.run("tasks.complete", { taskId: backlog.id }), /prazo antes de concluir/);
    // Moving out of the Backlog with a date in the same patch is accepted.
    const started = (await f.run("tasks.update", { taskId: backlog.id, patch: { status: "em-curso", dueAt: "2026-01-22" } })).data.task;
    assert.deepEqual([started.status, started.dueAt], ["em-curso", "2026-01-22"]);
    await assert.rejects(f.run("tasks.update", { taskId: backlog.id, patch: { dueAt: "" } }), /Backlog/);
    // Back to the Backlog: a relative rule becomes fixed so recalculation keeps the date empty.
    const base = (await f.run("tasks.create", { company: "one", task: task({ dueAt: "2026-01-10" }) })).data.task;
    const dependent = (await f.run("tasks.create", { company: "one", task: task({ startsAt: "2026-01-05", deadline: { mode: "task", taskId: base.id, offsetDays: 2 } }) })).data.task;
    const cleared = (await f.run("tasks.update", { taskId: dependent.id, patch: { status: "fila", dueAt: "", startsAt: null } })).data.task;
    assert.deepEqual([cleared.dueAt, cleared.deadline, cleared.startsAt], ["", { mode: "fixed" }, undefined]);
    await f.run("tasks.update", { taskId: base.id, patch: { dueAt: "2026-01-15" } });
    const { projectDelivery } = await import("../src/modules/delivery/infrastructure/snapshot.ts");
    const reloaded = projectDelivery(f.read("ontology.delivery.v2"), "one").tasks.find(t => t.id === dependent.id);
    assert.equal(reloaded.dueAt, "");
    assert.equal(reloaded.startsAt, undefined);
    const alerts = deriveAlerts({ today: "2026-09-28", clients: [{ slug: "one", name: "One" }], deliveries: [reloaded, { ...reloaded, id: "request", kind: "request" }], cycles: [], meetings: [] });
    assert.ok(!alerts.some(a => a.relatedDeliveryId === dependent.id || a.relatedDeliveryId === "request"));
  } finally { f.sql.close(); }
});

test('custom task deletion preserves history/documents, detaches open cycles and replays exactly once',async()=>{
  const f=fixture();try {
    const made=(await f.run('tasks.create',{company:'one',task:task()})).data.task;
    const linked=(await f.run('cycles.save',{company:'one',cycle:cycle([made.id])})).data.cycle;
    await f.run('tasks.comment',{taskId:made.id,text:'Histórico preservado'});
    f.put('ontology.documents.v3',{extraDocs:[{id:'evidence',company:'one',relatedTaskId:made.id}],removedDocIds:[]});
    const result=await f.run('tasks.remove',{taskId:made.id},'remove-task');assert.deepEqual(result.data,{taskId:made.id,removed:true});
    const state=f.read('ontology.delivery.v2');assert.equal(state.extraTasks.length,1);assert.equal(state.taskPatches[made.id].removed,true);assert.equal(state.taskPatches[made.id].removedBy,'admin');assert.ok(state.taskPatches[made.id].removedAt);
    assert.equal(state.taskPatches[made.id].comments.at(-1).text,'Histórico preservado');assert.deepEqual(state.extraCycles.find(c=>c.id===linked.id).taskIds,[]);
    const {projectDelivery,normalizeDeliverySnapshot}=await import('../src/modules/delivery/infrastructure/snapshot.ts');
    assert.ok(!projectDelivery(normalizeDeliverySnapshot(JSON.parse(JSON.stringify(state)))).tasks.some(t=>t.id===made.id));
    assert.equal(f.read('ontology.documents.v3').extraDocs[0].relatedTaskId,made.id);
    assert.deepEqual((await f.run('tasks.remove',{taskId:made.id},'remove-task')).data,result.data);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM client_audit_log WHERE command='tasks.remove'").get().n,1);
    await assert.rejects(f.run('tasks.update',{taskId:made.id,patch:{title:'Ressuscitar'}}),{code:'task_not_found'});
  }finally{f.sql.close();}
});

test('task removal accepts model tasks and preserves deadline, closed-cycle and access protections',async()=>{
  const f=fixture();try {
    const made=(await f.run('tasks.create',{company:'one',task:task()})).data.task;
    const dependent=(await f.run('tasks.create',{company:'one',task:task({deadline:{mode:'task',taskId:made.id,offsetDays:1}})})).data.task;
    await assert.rejects(f.run('tasks.remove',{taskId:made.id}),/define o prazo/);
    await f.run('tasks.update',{taskId:dependent.id,patch:{deadline:{mode:'fixed'}}});
    const state=f.read('ontology.delivery.v2');state.extraTasks.push({...made,id:'model-task',baseDeliveryId:'model'});f.put('ontology.delivery.v2',state);
    await assert.rejects(f.run('tasks.update',{taskId:'model-task',patch:{baseDeliveryId:null}}),/campos/);
    assert.equal((await f.run('tasks.remove',{taskId:'model-task'})).data.removed,true);
    assert.equal(f.read('ontology.delivery.v2').taskPatches['model-task'].baseDeliveryId,'model');
    const master={...f.principal,id:'member:master',memberId:'master',email:'master@example.test'};
    const foreign=(await f.run('tasks.create',{company:'two',task:task()})).data.task;
    await assert.rejects(f.run('tasks.remove',{taskId:foreign.id},'not-allocated',{},master),{code:'permission_denied'});
    const linked=(await f.run('cycles.save',{company:'one',cycle:cycle([made.id])})).data.cycle;
    await f.run('tasks.complete',{taskId:made.id});
    await f.run('cycles.save',{cycleId:linked.id,cycle:{status:'concluido',acceptance:[{id:linked.acceptance[0].id,done:true,approvedBy:'Patrocinador',channel:'reuniao'}]}});
    await assert.rejects(f.run('tasks.remove',{taskId:made.id}),/Reabra o ciclo/);
  }finally{f.sql.close();}
});

test('responsibility transfer edits only the owner, records manual assignment and preserves legacy dates',async()=>{
  const f=fixture();try {
    const created=(await f.run('tasks.create',{company:'one',task:task()})).data.task;
    const state=f.read('ontology.delivery.v2');state.extraTasks[0].dueAt='0002-01-20';f.put('ontology.delivery.v2',state);
    const moved=(await f.run('tasks.update',{taskId:created.id,patch:{ownerId:'master'}})).data.task;
    assert.equal(moved.ownerId,'master');assert.equal(moved.assignmentSource,'manual');assert.equal(moved.dueAt,'0002-01-20');
    assert.ok(moved.history.some(row=>row.field==='ownerId'&&row.from==='admin'&&row.to==='master'));
    await assert.rejects(f.run('tasks.update',{taskId:created.id,patch:{ownerId:'missing'}}),/responsável ativo/);
    f.put('ontology.workspace.v3',{extraMembers:[{id:'admin',email:'admin@example.test',access:'admin'},{id:'master',email:'master@example.test',access:'ai_master'}],deactivatedIds:['master']});
    await assert.rejects(f.run('tasks.update',{taskId:created.id,patch:{ownerId:'master'}}),/responsável ativo/);
  }finally{f.sql.close();}
});

test('reference task deletion retains its snapshot and cannot be resurrected by a fresh seed',async()=>{
  const { taskRemovalError, removeDeliveryTask } = await import('../src/modules/delivery/application/task-removal.ts');
  const { selectDeliveries } = await import('../src/modules/delivery/application/deliveries.ts');
  const reference={id:'seed',company:'one',title:'Reference',status:'fila'};
  assert.equal(taskRemovalError(reference,[reference],[]),null);
  const state=removeDeliveryTask({extraTasks:[],taskPatches:{},extraCycles:[],cycleEdits:{}},reference,[reference],[],'admin','2026-10-06T12:00:00Z');
  assert.equal(state.taskPatches.seed.title,'Reference');
  assert.equal(state.taskPatches.seed.removedBy,'admin');
  assert.deepEqual(selectDeliveries([{...reference,title:'Updated seed'}],'one',{},state.taskPatches),[]);
});
