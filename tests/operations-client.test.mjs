import test from "node:test";
import assert from "node:assert/strict";
import { patchSyncStatus } from "../src/shared/infrastructure/persistence.ts";
import { applyProvisionalNow, operationDocumentBaseline, operationDocumentSnapshot, setProvisional, withOperationDocuments } from "../src/shared/infrastructure/useLocalStorageState.ts";
import { executeClientOperation, operationAttempt, operationDocuments } from "../src/shared/infrastructure/operations.ts";

test("commands lock and send versions only for documents they can write", () => {
  for (const command of ["enrollments.update", "enrollments.archive", "enrollments.restore"])
    assert.deepEqual(operationDocuments(command), ["ontology.clients.v3"], command);
  for (const command of ["enrollments.remove", "enrollments.rebuild"])
    assert.deepEqual(operationDocuments(command), ["ontology.clients.v3", "ontology.delivery.v2"], command);
  assert.deepEqual(operationDocuments("tasks.update"), ["ontology.delivery.v2"]);
  assert.deepEqual(operationDocuments("meetings.syncArtifacts"), ["ontology.engagement.v2", "ontology.documents.v3"]);
});

test("client commands serialize, preserve failed drafts and retry the same intent without rolling back newer cache", async () => {
  const original = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, window: globalThis.window };
  const cache = new Map();
  globalThis.localStorage = { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) };
  globalThis.window = { clearTimeout, setTimeout };
  patchSyncStatus({ mode: "remote", resolved: true, hydrated: true, user: { email: "test@example.test", name: "Test" } });
  const key = "ontology.clients.v3";
  const document = (version, name) => ({ key, value: { extraClients: [{ name }] }, version });
  const adopt = (doc) => withOperationDocuments([key], async () => ({ documents: [doc] }));
  try {
    await adopt(document(1, "Before"));
    const baseline = operationDocumentBaseline([key]);
    const input = { client: { name: "After" } };
    const attempt = operationAttempt("clients.configure", input);
    assert.equal(operationAttempt("clients.configure", { client: { name: "After" } }, attempt), attempt);
    assert.notEqual(operationAttempt("clients.configure", { client: { name: "Changed" } }, attempt).key, attempt.key);
    const requests = [];
    globalThis.fetch = async (_url, init) => {
      requests.push({ body: JSON.parse(init.body), key: init.headers["Idempotency-Key"] });
      throw new Error("Lost response");
    };
    await assert.rejects(executeClientOperation("clients.configure", input, attempt, baseline), /Lost response/);
    assert.equal(JSON.parse(cache.get(key)).extraClients[0].name, "Before");
    await adopt(document(3, "Newer update"));
    globalThis.fetch = async (_url, init) => {
      requests.push({ body: JSON.parse(init.body), key: init.headers["Idempotency-Key"] });
      return Response.json({ data: { name: "After" }, documents: [document(2, "After")] });
    };
    await executeClientOperation("clients.configure", input, attempt, baseline);
    assert.deepEqual(requests[0], requests[1], "uncertain retry keeps the original preconditions and idempotency key");
    assert.equal(JSON.parse(cache.get(key)).extraClients[0].name, "Newer update", "receipt replay must not roll back cache");
    let sent = false;
    const next = operationAttempt("clients.configure", { changed: true });
    globalThis.fetch = async () => { sent = true; throw new Error("Should not send"); };
    await assert.rejects(executeClientOperation("clients.configure", { changed: true }, next, baseline), /dados mudaram/);
    assert.equal(sent, false, "a stale form is rejected before sending");

    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const order = [];
    const first = withOperationDocuments([key], async () => { order.push("first"); await held; return { documents: [document(4, "First")] }; });
    const second = withOperationDocuments([key], async () => { order.push("second"); return { documents: [document(5, "Second")] }; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ["first"]);
    release();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first", "second"]);
    assert.equal(JSON.parse(cache.get(key)).extraClients[0].name, "Second");
    await assert.rejects(withOperationDocuments([key], async () => ({ documents: [document(6, "Partial"), { key: "outside", value: {}, version: 1 }] })), /documentos inválidos/);
    assert.equal(JSON.parse(cache.get(key)).extraClients[0].name, "Second", "validate every returned document before adopting any");
  } finally {
    globalThis.fetch = original.fetch;
    globalThis.localStorage = original.localStorage;
    globalThis.window = original.window;
    patchSyncStatus({ user: null, mode: "local", resolved: false, hydrated: false });
  }
});

test("an optimistic command shows the change at once, adopts the server document and reverts on failure", async () => {
  const original = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, window: globalThis.window };
  const cache = new Map();
  globalThis.localStorage = { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) };
  globalThis.window = { clearTimeout, setTimeout };
  patchSyncStatus({ mode: "remote", resolved: true, hydrated: true, user: { email: "test@example.test", name: "Test" } });
  const key = "ontology.delivery.v2";
  const value = (status) => ({ taskEdits: { "d-1": { status } } });
  const shown = () => operationDocumentSnapshot(key);
  const stored = () => JSON.parse(cache.get(key));
  try {
    await withOperationDocuments([key], async () => ({ documents: [{ key, value: value("fila"), version: 1 }] }));
    assert.equal(shown().taskEdits["d-1"].status, "fila");

    // 1. Aplicação: a tela mostra o novo status antes de o servidor responder.
    let seenDuringFlight;
    await withOperationDocuments([key], async () => {
      seenDuringFlight = shown().taskEdits["d-1"].status;
      assert.equal(stored().taskEdits["d-1"].status, "fila", "o provisório não vai para o navegador");
      return { documents: [{ key, value: value("em-curso"), version: 2 }] };
    }, undefined, () => setProvisional(key, value("em-curso")));
    assert.equal(seenDuringFlight, "em-curso");

    // 2. Reconciliação: o documento devolvido substitui o provisório.
    assert.equal(shown().taskEdits["d-1"].status, "em-curso");
    assert.equal(stored().taskEdits["d-1"].status, "em-curso");

    // 3. Reversão em 500: o valor provisório é descartado.
    await assert.rejects(
      withOperationDocuments([key], async () => { throw new Error("Não foi possível salvar (500). Tente novamente."); },
        undefined, () => setProvisional(key, value("bloqueado"))),
      /500/,
    );
    assert.equal(shown().taskEdits["d-1"].status, "em-curso", "a falha volta ao último documento confirmado");

    // 4. Reversão em 409: idem, e a chave de idempotência do retry é a mesma.
    const input = { taskId: "d-1", patch: { status: "bloqueado" } };
    const attempt = operationAttempt("tasks.update", input);
    const keys = [];
    globalThis.fetch = async (_url, init) => {
      keys.push(init.headers["Idempotency-Key"]);
      return Response.json({ error: { code: "version_conflict", message: "Os dados mudaram. Atualize e tente novamente." } }, { status: 409 });
    };
    await assert.rejects(
      executeClientOperation("tasks.update", input, attempt, undefined, () => setProvisional(key, value("bloqueado"))),
      /Os dados mudaram/,
    );
    assert.equal(shown().taskEdits["d-1"].status, "em-curso");
    globalThis.fetch = async (_url, init) => {
      keys.push(init.headers["Idempotency-Key"]);
      return Response.json({ data: {}, documents: [{ key, value: value("bloqueado"), version: 3 }] });
    };
    await executeClientOperation("tasks.update", input, attempt, undefined, () => setProvisional(key, value("bloqueado")));
    assert.equal(new Set(keys).size, 1, "o retry reusa a mesma chave de idempotência");
    assert.equal(stored().taskEdits["d-1"].status, "bloqueado");
  } finally {
    globalThis.fetch = original.fetch;
    globalThis.localStorage = original.localStorage;
    globalThis.window = original.window;
    patchSyncStatus({ user: null, mode: "local", resolved: false, hydrated: false });
  }
});

test("o provisório adiantado aparece sem espera, não é aplicado duas vezes e some quando o comando é recusado", async () => {
  const original = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, window: globalThis.window };
  const cache = new Map();
  globalThis.localStorage = { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) };
  globalThis.window = { clearTimeout, setTimeout };
  patchSyncStatus({ mode: "remote", resolved: true, hydrated: true, user: { email: "test@example.test", name: "Test" } });
  const key = "ontology.delivery.v2";
  const value = (status) => ({ taskEdits: { "d-1": { status } } });
  const shown = () => operationDocumentSnapshot(key);
  const stored = () => JSON.parse(cache.get(key));
  try {
    // O documento anterior deste arquivo já está na versão 3.
    await withOperationDocuments([key], async () => ({ documents: [{ key, value: value("fila"), version: 4 }] }));

    // 1. Sem nenhum `await` no caminho: a tela já mostra o novo status.
    let applications = 0;
    const apply = () => { applications += 1; setProvisional(key, value("em-curso")); };
    assert.equal(applyProvisionalNow([key], apply), true);
    assert.equal(shown().taskEdits["d-1"].status, "em-curso");
    assert.equal(stored().taskEdits["d-1"].status, "fila", "o provisório não vai para o navegador");

    // 2. A fila recebe o comando sabendo que o provisório já está na tela.
    const confirmed = withOperationDocuments([key], async () => ({ documents: [{ key, value: value("em-curso"), version: 5 }] }), undefined, apply, true);
    assert.equal(applyProvisionalNow([key], apply), false, "com um comando na fila o provisório espera a vez");
    await confirmed;
    assert.equal(applications, 1, "a fila não reaplica o que já está na tela");
    assert.equal(stored().taskEdits["d-1"].status, "em-curso");

    // 3. Recusa antes do envio: o provisório adiantado é descartado.
    assert.equal(applyProvisionalNow([key], () => setProvisional(key, value("bloqueado"))), true);
    assert.equal(shown().taskEdits["d-1"].status, "bloqueado");
    let sent = false;
    await assert.rejects(
      withOperationDocuments([key], async () => { sent = true; return { documents: [] }; }, { [key]: "0" }, undefined, true),
      /dados mudaram/,
    );
    assert.equal(sent, false);
    assert.equal(shown().taskEdits["d-1"].status, "em-curso", "a recusa volta ao último documento confirmado");
  } finally {
    globalThis.fetch = original.fetch;
    globalThis.localStorage = original.localStorage;
    globalThis.window = original.window;
    patchSyncStatus({ user: null, mode: "local", resolved: false, hydrated: false });
  }
});

test("os gestos otimistas de resolver, remover e restaurar voltam atrás quando o servidor recusa", async () => {
  const original = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, window: globalThis.window };
  const cache = new Map();
  globalThis.localStorage = { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) };
  globalThis.window = { clearTimeout, setTimeout };
  patchSyncStatus({ mode: "remote", resolved: true, hydrated: true, user: { email: "test@example.test", name: "Test" } });
  // Um gesto por comando: a chave que ele muda, o que a tela mostra antes e o
  // que a mutação local do contexto escreve enquanto o comando viaja.
  const gestures = [
    ["signals.resolve", "ontology.relationship.v1", { company: "acme", signalId: "s-1" }],
    ["signals.reopen", "ontology.relationship.v1", { company: "acme", signalId: "s-1" }],
    ["inbox.thread.update", "ontology.relationship.v1", { threadId: "t-1", read: true }],
    ["program-events.remove", "ontology.engagement.v2", { company: "acme", eventId: "e-1" }],
    ["program-events.restore", "ontology.engagement.v2", { company: "acme", eventId: "e-1" }],
    ["hypotheses.remove", "ontology.engagement.v2", { company: "acme", hypothesisId: "h-1" }],
    ["hypotheses.restore", "ontology.engagement.v2", { company: "acme", hypothesisId: "h-1" }],
    ["documents.remove", "ontology.documents.v3", { documentId: "doc-1" }],
    ["documents.restore", "ontology.documents.v3", { documentId: "doc-1" }],
    ["members.setActive", "ontology.workspace.v3", { memberId: "m-1", active: false }],
    ["allocations.remove", "ontology.clients.v3", { company: "acme", allocationId: "a-1" }],
    ["clients.archive", "ontology.clients.v3", { company: "acme" }],
    ["clients.restore", "ontology.clients.v3", { company: "acme" }],
    ["tasks.checklist", "ontology.delivery.v2", { taskId: "d-1", items: [] }],
    ["tasks.blocker", "ontology.delivery.v2", { taskId: "d-1", blocker: null }],
  ];
  try {
    let version = 0;
    for (const [command, key, input] of gestures) {
      version += 1;
      const keys = operationDocuments(command);
      const confirmed = { mark: `confirmado-${command}` };
      // O provisório adiantado exige todos os documentos do comando presentes.
      await withOperationDocuments(keys, async () => ({
        documents: keys.map((each) => ({ key: each, value: confirmed, version })),
      }));
      assert.deepEqual(operationDocumentSnapshot(key), confirmed, command);

      // 1. O gesto aparece na hora, dentro do próprio evento.
      const local = () => setProvisional(key, { mark: `provisório-${command}` });
      assert.equal(applyProvisionalNow(keys, local), true, command);
      assert.equal(operationDocumentSnapshot(key).mark, `provisório-${command}`, command);

      // 2. O servidor recusa: a tela volta ao último documento confirmado.
      globalThis.fetch = async () =>
        Response.json({ error: { message: "Os dados mudaram. Atualize e tente novamente." } }, { status: 409 });
      const attempt = operationAttempt(command, input);
      await assert.rejects(
        executeClientOperation(command, input, attempt, undefined, local, true),
        /Os dados mudaram/,
        command,
      );
      assert.deepEqual(operationDocumentSnapshot(key), confirmed, `${command} desfaz o provisório`);
      assert.deepEqual(JSON.parse(cache.get(key)), confirmed, `${command} não grava o provisório no navegador`);

      // 3. Repetido com a mesma chave, o gesto confirma e substitui o provisório.
      const settled = { mark: `gravado-${command}` };
      version += 1;
      globalThis.fetch = async () => Response.json({ data: {}, documents: [{ key, value: settled, version }] });
      await executeClientOperation(command, input, attempt, undefined, local, false);
      assert.deepEqual(operationDocumentSnapshot(key), settled, command);
    }
  } finally {
    globalThis.fetch = original.fetch;
    globalThis.localStorage = original.localStorage;
    globalThis.window = original.window;
    patchSyncStatus({ user: null, mode: "local", resolved: false, hydrated: false });
  }
});

test("compact command references refresh only the changed document", async () => {
  const original = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, window: globalThis.window };
  const cache = new Map();
  globalThis.localStorage = { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) };
  globalThis.window = { clearTimeout, setTimeout };
  patchSyncStatus({ mode: "remote", resolved: true, hydrated: true, user: { email: "test@example.test", name: "Test" } });
  const key = "ontology.delivery.v2", initial={mark:"before"}, confirmed={mark:"after"};
  try {
    await withOperationDocuments([key], async () => ({documents:[{key,value:initial,version:10_000}]}));
    const calls=[];
    globalThis.fetch=async(url)=>{
      calls.push(String(url));
      if(String(url).startsWith('/api/v1/commands')) return Response.json({data:{saved:true},documents:[{key,version:10_001}]});
      return Response.json({documents:[{key,value:confirmed,version:10_001}],unchanged:[],denied:[]});
    };
    const input={taskId:"task",patch:{status:"fila"}};
    await executeClientOperation("tasks.update",input,operationAttempt("tasks.update",input));
    assert.deepEqual(operationDocumentSnapshot(key),confirmed);
    assert.equal(calls.filter(url=>url.startsWith('/api/state?')).length,1);
  } finally {
    globalThis.fetch=original.fetch;globalThis.localStorage=original.localStorage;globalThis.window=original.window;
    patchSyncStatus({user:null,mode:"local",resolved:false,hydrated:false});
  }
});

test("a server document that exceeds browser cache quota remains canonical in memory", async () => {
  const original = { localStorage: globalThis.localStorage, window: globalThis.window };
  const key = "ontology.knowledge.v2", cache = new Map([[key, JSON.stringify({ mark: "stale" })]]);
  globalThis.localStorage = {
    getItem: (name) => cache.get(name) ?? null,
    setItem: () => { throw new Error("quota"); },
    removeItem: (name) => cache.delete(name),
  };
  globalThis.window = { clearTimeout, setTimeout };
  patchSyncStatus({ mode: "remote", resolved: true, hydrated: true, user: { email: "test@example.test", name: "Test" } });
  try {
    await withOperationDocuments([key], async () => ({ documents: [{ key, value: { mark: "fresh", payload: "x".repeat(100_000) }, version: 1 }] }));
    assert.equal(operationDocumentSnapshot(key).mark, "fresh");
    assert.equal(cache.has(key), false, "the stale browser copy is removed after quota rejection");
  } finally {
    globalThis.localStorage = original.localStorage;
    globalThis.window = original.window;
    patchSyncStatus({ user: null, mode: "local", resolved: false, hydrated: false });
  }
});

test("a local quota failure retains the last durable browser copy", async () => {
  const original = { localStorage: globalThis.localStorage, window: globalThis.window };
  const key = "ontology.local-fixture.v1", durable = JSON.stringify({ mark: "durable" });
  const cache = new Map([[key, durable]]);
  globalThis.localStorage = {
    getItem: (name) => cache.get(name) ?? null,
    setItem: () => { throw new Error("quota"); },
    removeItem: (name) => cache.delete(name),
  };
  globalThis.window = { clearTimeout, setTimeout };
  patchSyncStatus({ mode: "local", resolved: true, hydrated: true, user: null });
  try {
    await withOperationDocuments([key], async () => ({ documents: [{ key, value: { mark: "session" }, version: 1 }] }));
    assert.equal(operationDocumentSnapshot(key).mark, "session");
    assert.equal(cache.get(key), durable, "local mode keeps its last reload-safe copy");
  } finally {
    globalThis.localStorage = original.localStorage;
    globalThis.window = original.window;
    patchSyncStatus({ user: null, mode: "local", resolved: false, hydrated: false });
  }
});

test("scoped writes invalidate the global cache without rebuilding it for the next scoped command", async () => {
  const original = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, window: globalThis.window };
  const cache = new Map();
  globalThis.localStorage = { getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) };
  globalThis.window = { clearTimeout, setTimeout, dispatchEvent() {} };
  patchSyncStatus({ mode: "remote", resolved: true, hydrated: true, user: { email: "test@example.test", name: "Test" } });
  const key = "ontology.delivery.v2";
  try {
    await withOperationDocuments([key], async () => ({ documents: [{ key, value: { taskEdits: { before: true } }, version: 1_000_000 }] }));
    const oldForm = operationDocumentBaseline([key]);
    await withOperationDocuments([key], async versions => {
      assert.deepEqual(versions, {}, "scoped command ignores a freshly cached global revision");
      return { documents: [] };
    }, undefined, undefined, false, [key], true);
    assert.deepEqual(operationDocumentBaseline([key]), {});
    let reads = 0;
    globalThis.fetch = async url => {
      assert.match(String(url), /^\/api\/state\?/);
      reads++;
      return Response.json({ documents: [{ key, value: { taskEdits: { after: true } }, version: 1_000_001 }], unchanged: [], denied: [] });
    };
    await withOperationDocuments([key], async versions => {
      assert.deepEqual(versions, {}, "scoped command must not send a stale global precondition");
      return { documents: [] };
    }, undefined, undefined, false, [key], true);
    assert.equal(reads, 0, "successive scoped commands do not reconstruct the global document");
    await assert.rejects(withOperationDocuments([key], async () => { throw new Error("sent"); }, oldForm), /dados mudaram/);
    assert.equal(reads, 1, "legacy command reloads the global version once");
    await withOperationDocuments([key], async versions => {
      assert.equal(versions[key], 1_000_001);
      return { documents: [{ key, value: { taskEdits: { after: true } }, version: 1_000_001 }] };
    });
    assert.equal(reads, 1);
  } finally {
    globalThis.fetch = original.fetch;
    globalThis.localStorage = original.localStorage;
    globalThis.window = original.window;
    patchSyncStatus({ user: null, mode: "local", resolved: false, hydrated: false });
  }
});

test("a global page refreshes a confirmed slice write before dropping its provisional card", async () => {
  const original = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, window: globalThis.window };
  const cache = new Map();
  globalThis.localStorage = { getItem: key => cache.get(key) ?? null,
    setItem: (key, value) => cache.set(key, value) };
  globalThis.window = { clearTimeout, setTimeout, location: { pathname: '/execucao' } };
  patchSyncStatus({ mode: "remote", resolved: true, hydrated: true,
    user: { email: "test@example.test", name: "Test" } });
  const key = 'ontology.delivery.v2';
  try {
    await withOperationDocuments([key], async () => ({ documents: [
      { key, value: { taskEdits: { before: true } }, version: 1_000_100 },
    ] }));
    const baseline = operationDocumentBaseline([key]);
    setProvisional(key, { taskEdits: { pending: true } });
    globalThis.fetch = async url => {
      assert.match(String(url), /^\/api\/state\?/);
      assert.equal(operationDocumentSnapshot(key).taskEdits.pending, true);
      return Response.json({ documents: [
        { key, value: { taskEdits: { confirmed: true } }, version: 1_000_101 },
      ], unchanged: [], denied: [] });
    };
    await withOperationDocuments([key], async versions => {
      assert.equal(versions[key], 1_000_100, 'the form retains its global precondition');
      return { documents: [] };
    }, undefined, undefined, true, [], true);
    assert.equal(operationDocumentSnapshot(key).taskEdits.confirmed, true);
    assert.notDeepEqual(operationDocumentBaseline([key]), baseline);
    setProvisional(key, { taskEdits: { secondPending: true } });
    globalThis.fetch = async () => { throw new Error('offline'); };
    await assert.rejects(withOperationDocuments([key], async () => ({ documents: [] }),
      undefined, undefined, true, [], true), /foi salva, mas a tela não pôde ser atualizada/);
    assert.equal(operationDocumentSnapshot(key).taskEdits.confirmed, true);
    let reads = 0;
    globalThis.fetch = async () => {
      reads++;
      return Response.json(reads === 1 ? { documents: [
        { key, value: { taskEdits: { replayed: true } }, version: 1_000_102 },
      ], unchanged: [], denied: [] } : { documents: [], unchanged: [key], denied: [] });
    };
    await withOperationDocuments([key], async versions => {
      assert.equal(versions[key], 1_000_102, 'retry preflight reads the committed revision');
      return { documents: [] };
    }, undefined, undefined, false, [], true);
    assert.equal(reads, 2);
    assert.equal(operationDocumentSnapshot(key).taskEdits.replayed, true);
  } finally {
    globalThis.fetch = original.fetch;
    globalThis.localStorage = original.localStorage;
    globalThis.window = original.window;
    patchSyncStatus({ user: null, mode: "local", resolved: false, hydrated: false });
  }
});
