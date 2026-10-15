/**
 * Contexto de uma requisição: cada documento do workspace é lido uma vez só.
 *
 * `requestDatabase(db)` devolve um invólucro do binding D1 com identidade
 * própria para aquela requisição — é o que separa a memória de leitura de duas
 * requisições concorrentes, que compartilham o mesmo binding. `getDoc` consulta
 * essa memória, então autorização, roster, projeções e o documento devolvido ao
 * final deixam de reler o que já foi lido.
 *
 * Toda escrita em `state_documents` (`putDoc`, `commitOperation`, a guarda do
 * OAuth) chama `forgetDocuments` e, quando sabe o que gravou, `rememberDocument`
 * com o valor exato: a leitura seguinte é o documento gravado, sem nova ida ao
 * banco e sem risco de servir um valor velho.
 *
 * `loadDocuments` lê as chaves que faltam em um único `SELECT`, e
 * `workspaceDocument` resolve o documento do workspace por uma lista fixa de
 * chaves, sem `LIKE` nem `CAST` sobre o nome da chave.
 *
 * O documento do workspace é o roster: toda requisição autenticada o lê para
 * saber quem é a pessoa e o que ela pode. Por isso ele também tem um cache **do
 * isolate**, por binding do D1 e por workspace, validado por versão: a
 * requisição consulta só `key, version` e, se a versão bate, reaproveita o corpo
 * já lido. Qualquer gravação no isolate (`forgetDocuments`) descarta o cache, e
 * `rememberDocument` o repõe com o valor exato que acabou de ser gravado. Um
 * workspace nunca enxerga o cache de outro, nem um banco o de outro, e a guarda
 * de versão da transação continua sendo a garantia final: roster velho não vira
 * gravação aceita. Sem `requestDatabase` (um banco montado direto, como nos
 * testes) não há cache nenhum.
 */
import type { StoredDoc } from "../db.ts";
import { decodeStateBody } from "../state-body.ts";
import { readActiveDeliveryCompatibility } from "./delivery-compatibility-read.ts";

/** Consulta de um documento por chave; repetida aqui para não depender de `db.ts`. */
const DOCUMENT_SQL =
  "SELECT body, version, updated_at FROM state_documents WHERE workspace_id = ? AND key = ?";
const ACTIVE_DOCUMENT_SQL =
  `SELECT CASE WHEN m.mode='active' THEN NULL ELSE d.body END AS body,
    d.version,d.updated_at,m.mode AS delivery_mode
    FROM state_documents d LEFT JOIN delivery_client_shadow_meta m
      ON m.workspace_id=d.workspace_id AND d.key='ontology.delivery.v2'
    WHERE d.workspace_id=? AND d.key=?`;

/** Várias chaves em uma consulta só: uma ida e um comando preparado. */
const documentsSql = (keys: readonly string[]) => {
  const placeholders = Array.from({ length: keys.length }, () => "?").join(",");
  if (!keys.includes('ontology.delivery.v2'))
    return `SELECT key, body, version, updated_at FROM state_documents WHERE workspace_id = ? AND key IN (${placeholders})`;
  return `SELECT d.key,CASE WHEN m.mode='active' THEN NULL ELSE d.body END AS body,
    d.version,d.updated_at,m.mode AS delivery_mode
    FROM state_documents d LEFT JOIN delivery_client_shadow_meta m
      ON m.workspace_id=d.workspace_id AND d.key='ontology.delivery.v2'
    WHERE d.workspace_id=? AND d.key IN (${placeholders})`;
};

type Row = { body: string | null; version: number; updated_at: string;
  delivery_mode?: string | null };
type KeyedRow = Row & { key: string };
type Memory = Map<string, Promise<StoredDoc | null>>;

const memories = new WeakMap<D1Database, Memory>();

/**
 * Rascunho da requisição para leituras que não são documentos (a sessão de
 * login, por exemplo): o que já foi consultado uma vez não volta ao banco na
 * segunda autenticação da mesma requisição. Vive e morre com o invólucro.
 */
const scratches = new WeakMap<D1Database, Map<string, unknown>>();
export function requestScratch(db: D1Database): Map<string, unknown> | undefined {
  return scratches.get(db);
}

/** Versões das chaves do workspace: uma consulta sem corpo. */
const workspaceVersionsSql = (count: number) =>
  `SELECT key, version FROM state_documents WHERE workspace_id = ? AND key IN (${Array.from({ length: count }, () => "?").join(",")})`;

type CachedWorkspace = { key: string; version: number; body: string; updatedAt: string };

/**
 * Cache do documento do workspace por isolate, preso ao binding de origem.
 * Guarda o corpo **serializado**: cada requisição faz o seu próprio `JSON.parse`,
 * então nenhuma delas pode alterar o que a outra vai ler.
 */
const rosters = new WeakMap<D1Database, Map<string, CachedWorkspace>>();

/** Binding real por trás do invólucro da requisição: é ele que dá identidade ao cache. */
const origins = new WeakMap<D1Database, D1Database>();

/** Stable binding identity for small isolate caches; request wrappers remain isolated. */
export function databaseOrigin(db: D1Database): D1Database {
  return origins.get(db) ?? db;
}

function rosterCache(db: D1Database) {
  const origin = origins.get(db);
  if (!origin) return undefined;
  let cache = rosters.get(origin);
  if (!cache) rosters.set(origin, (cache = new Map()));
  return cache;
}

/** Documento do workspace: chaves suportadas, da mais nova para a mais antiga. */
export const WORKSPACE_KEYS = ["ontology.workspace.v3", "ontology.workspace.v2"] as const;

export function memoryKey(workspace: string, key: string) {
  // Separador que não aparece em nenhum id: o byte era literal no arquivo e o git o tratava como binário.
  return `${workspace}\u0000${key}`;
}

export function documentMemory(db: D1Database): Memory | undefined {
  return memories.get(db);
}

/**
 * Um binding por requisição, com memória de leitura própria. `origin` é o
 * binding do ambiente, que sobrevive à requisição e identifica o cache de
 * roster do isolate.
 */
export function requestDatabase(db: D1Database, origin?: D1Database): D1Database {
  const wrapper = {
    prepare: (query: string) => db.prepare(query),
    batch: <T = unknown>(statements: D1PreparedStatement[]) => db.batch<T>(statements),
    exec: (query: string) => db.exec(query),
    dump: () => db.dump(),
    withSession: (constraint?: string) => db.withSession(constraint),
  } as unknown as D1Database;
  memories.set(wrapper, new Map());
  scratches.set(wrapper, new Map());
  if (origin) origins.set(wrapper, origin);
  return wrapper;
}

/**
 * Descarta a memória: chamado por quem grava, antes de anunciar o que gravou, e
 * por quem revalida depois de um serviço externo. O cache do isolate cai junto:
 * é pequeno, e recomeçar dele é uma consulta de versão.
 */
export function forgetDocuments(db: D1Database) {
  memories.get(db)?.clear();
  rosterCache(db)?.clear();
  const scratch = scratches.get(db);
  if (scratch) for (const key of [...scratch.keys()])
    if (key.startsWith(ROSTER_FLIGHT) || key.startsWith("client-access ")) scratch.delete(key);
}

/** Leitura do roster em andamento nesta requisição (ver `workspaceDocument`). */
const ROSTER_FLIGHT = "workspace-document ";

/** Anuncia o documento gravado nesta requisição, com valor e versão exatos. */
export function rememberDocument(db: D1Database, workspace: string, key: string, doc: StoredDoc) {
  memories.get(db)?.set(memoryKey(workspace, key), Promise.resolve(doc));
  if ((WORKSPACE_KEYS as readonly string[]).includes(key))
    rosterCache(db)?.set(workspace, {
      key,
      version: doc.version,
      body: JSON.stringify(doc.value),
      updatedAt: doc.updatedAt,
    });
}

async function rowToDoc(db: D1Database, workspace: string, key: string,
  row: Row | null | undefined): Promise<StoredDoc | null> {
  if (!row) return null;
  if (key === 'ontology.delivery.v2' && row.delivery_mode === 'active') {
    const current = await readActiveDeliveryCompatibility(db, workspace);
    if (!current) throw new Error('Active execution authority disappeared during read');
    return { value: current.snapshot, version: current.version, updatedAt: current.updatedAt };
  }
  if (row.body === null) throw new Error('State document body is missing');
  return { value: await decodeStateBody(row.body), version: row.version, updatedAt: row.updated_at };
}

/**
 * Lê várias chaves novas no mesmo snapshot do SQLite, sem reaproveitar a
 * memória da requisição. É usado quando uma resposta precisa combinar
 * documentos relacionados depois de revalidar a autorização.
 */
export async function freshDocumentSnapshot(
  db: D1Database,
  workspace: string,
  keys: readonly string[],
): Promise<(StoredDoc | null)[]> {
  if (!keys.length) return [];
  const unique = [...new Set(keys)];
  const result = await db
    .prepare(documentsSql(unique))
    .bind(workspace, ...unique)
    .all<KeyedRow>();
  const rows = new Map(await Promise.all(result.results.map(async (row) =>
    [row.key, await rowToDoc(db, workspace, row.key, row)] as const)));
  return keys.map((key) => rows.get(key) ?? null);
}

/** Lê as chaves que faltam em uma única ida ao banco e guarda o resultado. */
export async function loadDocuments(
  db: D1Database,
  workspace: string,
  keys: readonly string[],
): Promise<(StoredDoc | null)[]> {
  const memory = memories.get(db);
  const read = (key: string) =>
    db.prepare(key === 'ontology.delivery.v2' ? ACTIVE_DOCUMENT_SQL : DOCUMENT_SQL)
      .bind(workspace, key).first<Row>()
      .then(row => rowToDoc(db, workspace, key, row));
  if (!memory) return Promise.all(keys.map(read));
  const missing = [...new Set(keys)].filter((key) => !memory.has(memoryKey(workspace, key)));
  // Uma entrada da memória pode nunca ser esperada (pré-carga de uma chave que a
  // autorização acabou negando); a rejeição dela não vira erro solto.
  const remember = (key: string, entry: Promise<StoredDoc | null>) => {
    entry.catch(() => undefined);
    memory.set(memoryKey(workspace, key), entry);
  };
  if (missing.length === 1) {
    remember(missing[0], read(missing[0]));
  } else if (missing.length > 1) {
    const work = db
      .prepare(documentsSql(missing))
      .bind(workspace, ...missing)
      .all<KeyedRow>()
      .then(async (result) => new Map(await Promise.all(result.results.map(async (row) =>
        [row.key, await rowToDoc(db, workspace, row.key, row)] as const))));
    missing.forEach((key) => remember(key, work.then((rows) => rows.get(key) ?? null)));
  }
  return Promise.all(keys.map((key) => memory.get(memoryKey(workspace, key))!));
}

/** Version check for a state revalidation. Active execution uses its logical
 * revision; reading its frozen physical document would miss client writes. */
export async function loadDocumentVersions(
  db: D1Database, workspace: string, keys: readonly string[],
): Promise<Map<string, number>> {
  if (!keys.length) return new Map();
  return documentVersions(await documentVersionsStatement(db, workspace, keys).all());
}

/**
 * O comando de `loadDocumentVersions`, para ir no mesmo `db.batch` de outra
 * leitura (as fatias ativas, por exemplo): versões e dados saem da mesma
 * transação. `documentVersions` lê o resultado. Exige ao menos uma chave.
 */
export function documentVersionsStatement(db: D1Database, workspace: string,
  keys: readonly string[]): D1PreparedStatement {
  const placeholders = keys.map(() => '?').join(',');
  return db.prepare(`SELECT d.key,
      CASE WHEN d.key='ontology.delivery.v2' AND m.mode='active'
        THEN m.compatibility_version ELSE d.version END AS version
    FROM state_documents d LEFT JOIN delivery_client_shadow_meta m
      ON m.workspace_id=d.workspace_id AND d.key='ontology.delivery.v2'
    WHERE d.workspace_id=? AND d.key IN (${placeholders})`)
    .bind(workspace, ...keys);
}

export function documentVersions(result: Pick<D1Result, 'results'>): Map<string, number> {
  return new Map((result.results as { key: string; version: number }[])
    .map(row => [row.key, row.version]));
}

/** As versões lidas batem com os documentos que a resposta usou (ausente = 0). */
export function sameVersions(versions: Map<string, number>,
  pairs: readonly (readonly [string, StoredDoc | null | undefined])[]) {
  return pairs.every(([key, doc]) => (versions.get(key) ?? 0) === (doc?.version ?? 0));
}

/**
 * Revalidação e leitura numa ida só (`GET /api/state` com `versions=`): para
 * cada chave devolve a versão atual e, só quando ela difere da versão que o
 * navegador já tem, o corpo. A comparação é feita no próprio `SELECT` (as
 * versões conhecidas vão num parâmetro JSON), então chave inalterada não traz
 * corpo pelo fio — a mesma economia de antes, sem a ida separada das versões.
 * Execução ativa compara pela versão lógica e, quando mudou, é reconstruída
 * como em `loadDocuments`. O que foi lido entra na memória da requisição.
 */
export async function loadChangedDocuments(
  db: D1Database, workspace: string, keys: readonly string[], known: ReadonlyMap<string, number>,
): Promise<{ unchanged: string[]; documents: Map<string, StoredDoc | null> }> {
  const unique = [...new Set(keys)];
  if (!unique.length) return { unchanged: [], documents: new Map() };
  // O que a requisição já leu (o roster da autorização) continua valendo como
  // em `loadDocuments`: o corpo só viria se a versão do banco fosse outra.
  const memory = memories.get(db);
  const remembered = new Map(await Promise.all(unique
    .filter(key => memory?.has(memoryKey(workspace, key)))
    .map(async key => [key, await memory!.get(memoryKey(workspace, key))!] as const)));
  const skipBody = unique.flatMap(key => remembered.has(key)
    ? [[key, remembered.get(key)?.version ?? 0]] : known.has(key) ? [[key, known.get(key)]] : []);
  const placeholders = unique.map(() => '?').join(',');
  const result = await db.prepare(`SELECT d.key,d.updated_at,m.mode AS delivery_mode,
      CASE WHEN d.key='ontology.delivery.v2' AND m.mode='active'
        THEN m.compatibility_version ELSE d.version END AS version,
      CASE WHEN d.key='ontology.delivery.v2' AND m.mode='active' THEN NULL
        WHEN k.version IS NOT NULL AND k.version=d.version THEN NULL
        ELSE d.body END AS body
    FROM state_documents d
    LEFT JOIN delivery_client_shadow_meta m
      ON m.workspace_id=d.workspace_id AND d.key='ontology.delivery.v2'
    LEFT JOIN (SELECT json_extract(value,'$[0]') AS key,json_extract(value,'$[1]') AS version
      FROM json_each(?)) k ON k.key=d.key
    WHERE d.workspace_id=? AND d.key IN (${placeholders})`)
    .bind(JSON.stringify(skipBody), workspace, ...unique)
    .all<KeyedRow>();
  const rows = new Map(result.results.map(row => [row.key, row]));
  const unchanged = unique.filter(key => known.has(key) && known.get(key) === (rows.get(key)?.version ?? 0));
  const documents = new Map(await Promise.all(unique.filter(key => !unchanged.includes(key))
    .map(async key => {
      if (remembered.has(key)) return [key, remembered.get(key)!] as const;
      const doc = await rowToDoc(db, workspace, key, rows.get(key));
      // Quem leu a chave enquanto este SELECT corria (o contador, em paralelo)
      // continua vendo o que leu: a memória nunca troca de valor no meio da requisição.
      if (memory && !memory.has(memoryKey(workspace, key)))
        memory.set(memoryKey(workspace, key), Promise.resolve(doc));
      return [key, doc] as const;
    })));
  return { unchanged, documents };
}

/**
 * Dispara a leitura das chaves que a requisição vai precisar, em um lote só,
 * antes de a autorização pedi-las uma a uma. Quem lê depois (`getDoc`,
 * `loadDocuments`) encontra a memória já preenchida: roster, cadastro de
 * clientes e documentos da coleção deixam de ser três idas em série. Ler antes
 * de autorizar não expõe nada — o que sai na resposta continua decidido depois.
 */
export function prefetchDocuments(db: D1Database, workspace: string, keys: readonly string[]) {
  if (!memories.get(db) || !keys.length) return;
  loadDocuments(db, workspace, keys).catch(() => undefined);
}

/**
 * Documento do workspace e a chave em que ele está gravado.
 *
 * Duas chamadas simultâneas na mesma requisição (a autenticação adiantando o
 * roster enquanto a sessão é lida, e a autorização logo depois) compartilham a
 * mesma leitura: sem isso, a consulta de versão do cache do isolate saía duas vezes.
 */
export function workspaceDocument(
  db: D1Database,
  workspace: string,
): Promise<{ key: string; doc: StoredDoc | null }> {
  const scratch = scratches.get(db);
  const flight = ROSTER_FLIGHT + workspace;
  const running = scratch?.get(flight) as Promise<{ key: string; doc: StoredDoc | null }> | undefined;
  if (running) return running;
  const work = readWorkspaceDocument(db, workspace);
  if (scratch) {
    scratch.set(flight, work);
    // Terminada a leitura, a memória da requisição responde; a entrada sai.
    work.finally(() => { if (scratch.get(flight) === work) scratch.delete(flight); }).catch(() => undefined);
  }
  return work;
}

/**
 * Adianta a leitura do roster (sem esperar): quem autentica pela sessão do
 * Google lê a sessão e o roster em paralelo, em vez de um depois do outro.
 * Ler o roster antes de saber quem é a pessoa não expõe nada; a decisão
 * continua depois, com o mesmo documento.
 */
export function prefetchWorkspaceDocument(db: D1Database, workspace: string) {
  if (!scratches.get(db)) return;
  workspaceDocument(db, workspace).catch(() => undefined);
}

async function readWorkspaceDocument(
  db: D1Database,
  workspace: string,
): Promise<{ key: string; doc: StoredDoc | null }> {
  const memory = memories.get(db);
  // Se a requisição já leu alguma chave do workspace, ela manda: o cache do
  // isolate nunca pode contradizer o que esta requisição gravou ou releu.
  const seen = memory && WORKSPACE_KEYS.some((key) => memory.has(memoryKey(workspace, key)));
  if (seen) {
    // O que esta requisição já leu ou gravou decide, sem nova ida: a chave mais
    // nova presente na memória é o roster (pedir as que faltam custava uma ida
    // por requisição só para confirmar que `ontology.workspace.v2` não existe).
    for (const key of WORKSPACE_KEYS) {
      const known = memory.get(memoryKey(workspace, key));
      if (!known) continue;
      const doc = await known;
      if (doc) return { key, doc };
    }
  }
  const cache = rosterCache(db);
  const cached = seen ? undefined : cache?.get(workspace);
  if (cached) {
    const rows = await db
      .prepare(workspaceVersionsSql(WORKSPACE_KEYS.length))
      .bind(workspace, ...WORKSPACE_KEYS)
      .all<{ key: string; version: number }>();
    const versions = new Map(rows.results.map((row) => [row.key, row.version]));
    const newest = WORKSPACE_KEYS.find((key) => versions.has(key));
    if (newest === cached.key && versions.get(newest) === cached.version) {
      const doc: StoredDoc = {
        value: JSON.parse(cached.body),
        version: cached.version,
        updatedAt: cached.updatedAt,
      };
      memory?.set(memoryKey(workspace, cached.key), Promise.resolve(doc));
      return { key: cached.key, doc };
    }
    // Promoção, desativação ou troca de chave: o corpo volta do banco.
    cache?.delete(workspace);
  }
  const docs = await loadDocuments(db, workspace, WORKSPACE_KEYS);
  const found = docs.findIndex((doc) => doc !== null);
  const index = found === -1 ? 0 : found;
  const key = WORKSPACE_KEYS[index];
  const doc = docs[index];
  if (doc) cache?.set(workspace, { key, version: doc.version, body: JSON.stringify(doc.value), updatedAt: doc.updatedAt });
  else cache?.delete(workspace);
  return { key, doc };
}
