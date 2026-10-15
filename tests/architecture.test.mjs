import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
const walk = (path) =>
  readdirSync(path, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory()
      ? walk(`${path}/${item.name}`)
      : [`${path}/${item.name}`],
  );
test("domain and application layers remain independent of frameworks, storage and presentation", () => {
  const files = walk("src/modules").filter((path) =>
    /\/(domain|application)\//.test(path),
  );
  assert.ok(files.length > 12);
  for (const path of files) {
    const code = readFileSync(path, "utf8");
    assert.doesNotMatch(
      code,
      /from ["'][^"']*(react|next|infrastructure|presentation|shared\/ui)[^"']*["']/,
      path,
    );
    assert.doesNotMatch(code, /\b(localStorage|window|document)\./, path);
  }
});
test("routes compose screens and the former global state and catch-all folders are gone", () => {
  assert.equal(existsSync("src/components/state/AppState.tsx"), false);
  for (const path of walk("src/app").filter((path) =>
    path.endsWith("/page.tsx"),
  )) {
    const code = readFileSync(path, "utf8");
    assert.ok(code.split("\n").length < 60, path);
    // A server page that wraps a client screen in a new Suspense boundary
    // shows its fallback while the screen chunk loads and React throttles the
    // reveal by 300 ms on every client navigation. The boundary lives inside
    // the client screen instead.
    if (!/^["']use client["']/.test(code))
      assert.doesNotMatch(code, /<Suspense\b/, path);
  }
  for (const path of walk("src/modules")) {
    assert.doesNotMatch(
      readFileSync(path, "utf8"),
      /@\/(components|data|lib)\//,
      path,
    );
  }
});

test("the server layer stays independent of the interface and modules never import it", () => {
  for (const path of walk("src/server")) {
    const code = readFileSync(path, "utf8");
    assert.doesNotMatch(code, /from ["']@\/modules\/[^"']*presentation/, path);
    assert.doesNotMatch(code, /from ["']react["']/, path);
  }
  for (const path of walk("src/modules")) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /@\/server\//, path);
  }
});

// Ler um arquivo não deve custar meia hora. Acima deste tamanho um arquivo
// esconde mais de uma responsabilidade; as exceções são dados (seeds e
// catálogos) e o índice de primitivos da interface, que são listas, não lógica.
test("no source file grows past seven hundred lines", () => {
  const allowed = new Set([
    "src/modules/catalog/infrastructure/g4-os-founding-companies.ts",
    "src/modules/clients/infrastructure/seed.ts",
    "src/modules/delivery/infrastructure/seed.ts",
    "src/modules/documents/infrastructure/deliverable-templates.ts",
    "src/modules/engagement/infrastructure/g4-os-messages.ts",
    "src/modules/engagement/infrastructure/seed.ts",
    "src/modules/knowledge/infrastructure/santa-clara-ontology.ts",
    "src/modules/knowledge/infrastructure/seed.ts",
    "src/modules/workspace/infrastructure/seed.ts",
    "src/shared/ui/primitives.tsx",
  ]);
  for (const path of allowed)
    assert.doesNotMatch(
      path,
      /\/presentation\//,
      `${path}: nenhum arquivo de presentation entra nas exceções`,
    );
  const large = walk("src")
    .filter((path) => /\.tsx?$/.test(path) && !allowed.has(path))
    .map((path) => [path, readFileSync(path, "utf8").split("\n").length])
    .filter(([, lines]) => lines > 700);
  assert.deepEqual(large, []);
});

// Um gesto que espera o servidor informa pelo botão, não por um bloco que
// aparece e some ao lado do formulário. O bloco é só para erro.
test("no screen shows a progress block while a command confirms", () => {
  for (const path of walk("src").filter((path) => /\.tsx?$/.test(path))) {
    const code = readFileSync(path, "utf8");
    assert.doesNotMatch(code, /"Confirmando alteração…"|"Aguardando confirmação\.?"/, path);
  }
  // O app reusa o OperationFeedback/OperationButton do G4OS-DS; a garantia vale para a fonte do DS.
  assert.match(
    readFileSync("src/shared/ui/OperationFeedback.tsx", "utf8"),
    /export \{ OperationButton, OperationFeedback \} from "@g4ai\/ds";/,
  );
  const feedback = readFileSync("node_modules/@g4ai/ds/src/components/feedback.tsx", "utf8");
  assert.match(feedback, /if \(!operation\.error\) return null;/);
  // O botão conta o progresso: desabilita enquanto confirma e troca o rótulo.
  assert.match(feedback, /const running = operation\.busy \|\| operation\.pending;/);
  assert.match(feedback, /disabled=\{disabled \|\| running\}/);
  assert.match(feedback, /operation\.busy \? \(busyLabel \?\? operation\.busyLabel\) : children/);
  for (const path of [
    "src/modules/catalog/presentation/useCatalogOperations.tsx",
    "src/modules/knowledge/presentation/useKnowledgeOperation.tsx",
  ])
    assert.match(readFileSync(path, "utf8"), /if\(!operation(\?)?\.error\)return null;/, path);
});

test("every API route that authenticates runs inside the request context", () => {
  // `apiRoute`/`apiResponse`/`instrumentQueries` dão a memória de leitura por
  // requisição, o cache do roster e o Server-Timing. Uma rota fora deles relê o
  // roster a cada verificação e não aparece na régua de desempenho.
  const routes = [
    ...walk("src/app/api").filter((path) => path.endsWith("route.ts")),
    ...walk("src/server").filter((path) => /-route\.ts$/.test(path)),
  ];
  for (const path of routes) {
    const source = readFileSync(path, "utf8");
    const authenticates = /\b(authenticate|resolveOperationPrincipal|resolveMember)\(/.test(source);
    const wrapped = /\b(apiRoute|apiResponse|instrumentQueries|readStateBatch|mcpResponse|googleGuard)\(/.test(source);
    if (authenticates && !wrapped) assert.fail(`${path} autentica fora de apiRoute()`);
  }
});
