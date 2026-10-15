/**
 * Persistence mode and the remote document protocol.
 *
 * Every context repository stores one JSON document under a key. In `local`
 * mode the browser keeps it; in `remote` mode the same document lives in the
 * workspace database (D1) and the browser copy is a cache. Documents carry a
 * version so concurrent edits from two people are detected instead of lost.
 *
 * The mode is discovered at runtime from the page bootstrap
 * (`GET /api/state?with=session,google,alerts`), so the same build works in the
 * browser-only demo and behind the API on Cloudflare. The same response carries
 * the documents the screen subscribed to, the Google connection and the alert
 * count: one round trip per page load instead of a chain of four.
 */
import { BOOTSTRAP_TABLE } from "./bootstrap-keys.ts";
import { dropWarmResponses, earlyBootPlan, takeEarlyResponse } from "./early-boot.ts";
import { installD1BookmarkTracking } from "./d1-bookmark.ts";

// Réplicas do D1 (flag do servidor): o maior bookmark visto vai num cookie.
installD1BookmarkTracking();

export type PersistenceMode = "local" | "remote";

/** Repository documents; view preferences (display, sidebar) stay in the browser. */
export const SYNCED_KEY =
  /^ontology\.(catalog|clients|delivery|documents|engagement|knowledge|relationship|stakeholders|workspace)\.v\d+$/;

export type SessionUser = {
  email: string;
  name: string;
  memberId?: string;
  approved?: boolean;
  authMode?: string;
};

export type SyncStatus = {
  mode: PersistenceMode;
  resolved: boolean;
  pending: number;
  error: string | null;
  lastSyncAt: string | null;
  hydrated: boolean;
  user: SessionUser | null;
  authMode?: string;
};

const forcedLocal =
  typeof process !== "undefined" &&
  (process.env.NEXT_PUBLIC_PERSISTENCE as string | undefined) === "local";

let status: SyncStatus = {
  mode: "local",
  resolved: forcedLocal,
  pending: 0,
  error: null,
  lastSyncAt: null,
  hydrated: forcedLocal,
  user: null,
};
const SERVER_STATUS: SyncStatus = { ...status };
const statusListeners = new Set<() => void>();

export function getSyncStatus() {
  return status;
}
export function getServerSyncStatus() {
  return SERVER_STATUS;
}
export function patchSyncStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  queueMicrotask(() => statusListeners.forEach((listener) => listener()));
}
export function subscribeSyncStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function persistenceMode(): PersistenceMode {
  return status.mode;
}

export function isSyncedKey(key: string) {
  return status.mode === "remote" && SYNCED_KEY.test(key);
}

/**
 * A mesma resposta de `usesRemoteOperations()`, sem esperar nada: só é `true`
 * quando o modo já foi resolvido e a pessoa aprovada está na sessão. Serve ao
 * caminho que precisa decidir dentro do próprio evento, antes de qualquer
 * `await`; quem responder `false` segue pelo caminho assíncrono de sempre.
 */
export function remoteOperationsSettled(): boolean {
  return (
    status.resolved &&
    status.mode === "remote" &&
    !!status.user &&
    status.user.approved !== false
  );
}

let resolving: Promise<PersistenceMode> | null = null;

/**
 * Documentos que vieram no bootstrap, à espera da primeira hidratação da tela.
 * Valem por pouco tempo: uma tela que monte muito depois lê do servidor.
 */
let preloaded: { at: number; batch: BatchDocuments } | null = null;
const PRELOAD_TTL = 10_000;

/** Blocos extras do bootstrap, guardados para quem os pedir em seguida. */
let bootstrapGoogle: { at: number; body: unknown } | null = null;
export function getBootstrapGoogle(): { at: number; body: unknown } | null {
  return bootstrapGoogle;
}

let alertCount: number | null = null;
const alertListeners = new Set<() => void>();
export function getAlertCount() {
  return alertCount;
}
export function setAlertCount(next: number | null) {
  if (next === alertCount) return;
  alertCount = next;
  queueMicrotask(() => alertListeners.forEach((listener) => listener()));
}
export function subscribeAlertCount(listener: () => void) {
  alertListeners.add(listener);
  return () => {
    alertListeners.delete(listener);
  };
}
/**
 * A ciência de alerta é por pessoa e não muda nenhum documento: quem mostra
 * números derivados da fila (menu, carteira, perfil) escuta esta marca para
 * reler do servidor depois de um "Marcar como visto" confirmado.
 */
let alertAcknowledgments = 0;
const acknowledgmentListeners = new Set<() => void>();
export function getAlertAcknowledgments() {
  return alertAcknowledgments;
}
export function subscribeAlertAcknowledgments(listener: () => void) {
  acknowledgmentListeners.add(listener);
  return () => {
    acknowledgmentListeners.delete(listener);
  };
}
export function alertsAcknowledged() {
  alertAcknowledgments += 1;
  acknowledgmentListeners.forEach((listener) => listener());
  void refreshAlertCount();
}
/**
 * Relê o contador na rota própria: depois de uma ciência confirmada. Pedidos
 * que chegam enquanto um está em curso (a carga sem o bloco `alerts` e o menu,
 * ao hidratar) recebem a mesma resposta: eram duas chamadas iguais em toda carga.
 */
let alertCountFlight: Promise<void> | null = null;
export function refreshAlertCount(): Promise<void> {
  alertCountFlight ??= readAlertCount().finally(() => { alertCountFlight = null; });
  return alertCountFlight;
}
async function readAlertCount() {
  try {
    const response = await fetch("/api/v1/alerts/count", { headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { data?: { count?: number } };
    if (typeof body.data?.count === "number") setAlertCount(body.data.count);
  } catch {
    // A próxima revalidação tenta de novo; o número antigo continua à vista.
  }
}

type BatchBody = {
  documents: { key: string; value: unknown; version: number; updatedAt: string | null }[];
  unchanged: string[];
  denied: { key: string; reason: string }[];
  session?: { mode: PersistenceMode; user?: SessionUser | null; authMode?: string };
  google?: unknown;
  alerts?: { count: number } | null;
};

function toBatch(body: BatchBody): BatchDocuments {
  if (body.alerts !== undefined) setAlertCount(body.alerts?.count ?? null);
  return {
    documents: new Map(body.documents.map((doc) => [
      doc.key,
      doc.version > 0 && doc.value !== null ? { value: doc.value, version: doc.version } : null,
    ])),
    unchanged: new Set(body.unchanged),
    denied: new Map(body.denied.map((entry) => [entry.key, entry.reason])),
  };
}

/**
 * Descobre o modo uma vez, no bootstrap da página: uma chamada que já traz os
 * documentos que o endereço vai assinar, a sessão, o Google e o contador de
 * alertas. Falha de rede mantém os dados travados.
 */
export function resolvePersistenceMode(): Promise<PersistenceMode> {
  if (status.resolved) return Promise.resolve(status.mode);
  if (resolving) return resolving;
  resolving = (async () => {
    try {
      // O script inline do layout já pode ter disparado este mesmo pedido.
      const url = typeof window === "undefined"
        ? `${STATE_ENDPOINT}?${new URLSearchParams({ keys: "", with: "session,google,alerts" })}`
        : earlyBootPlan(window.location.pathname, window.location.search, BOOTSTRAP_TABLE).bootstrap;
      const load = () => fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
      const response = await (takeEarlyResponse(url)?.catch(load) ?? load());
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as BatchBody;
      const session = body.session ?? { mode: "remote" as const, user: null };
      if (body.google !== undefined) bootstrapGoogle = { at: Date.now(), body: body.google };
      if (session.user && body.documents.length + body.unchanged.length + body.denied.length)
        preloaded = { at: Date.now(), batch: toBatch(body) };
      else if (body.alerts !== undefined) setAlertCount(body.alerts?.count ?? null);
      // O servidor não segura a carga pelo contador quando a fila ainda está
      // sendo calculada: o bloco vem ausente e o número chega pela rota própria.
      if (session.user && session.user.approved !== false && body.alerts === undefined)
        void refreshAlertCount();
      patchSyncStatus({
        mode: session.mode,
        authMode: session.authMode,
        resolved: true,
        hydrated: session.mode === "local",
        user: session.user ? { ...session.user, authMode: session.authMode } : null,
      });
      return session.mode;
    } catch {
      patchSyncStatus({
        mode: "remote",
        resolved: true,
        hydrated: false,
        user: null,
        error: "Não foi possível verificar a sessão. Recarregue a página.",
      });
      return "remote";
    }
  })();
  return resolving;
}

export type RemoteDoc = { value: unknown; version: number; updatedAt?: string };

export const STATE_ENDPOINT = "/api/state";

const readDocuments = new Map<
  string,
  { etag: string; doc: RemoteDoc | null }
>();
let readUser: SessionUser | null = null;
export async function fetchDoc(key: string): Promise<RemoteDoc | null> {
  const user = status.user;
  if (readUser !== user) {
    readDocuments.clear();
    readUser = user;
  }
  const cached = readDocuments.get(key);
  const response = await fetch(`${STATE_ENDPOINT}/${encodeURIComponent(key)}`, {
    headers: {
      accept: "application/json",
      ...(cached ? { "if-none-match": cached.etag } : {}),
    },
    cache: "no-store",
  });
  if (response.status === 401 && status.authMode === "google") {
    patchSyncStatus({ user: null });
    throw new Error("Sua sessão expirou. Entre novamente.");
  }
  if (response.status === 304 && cached) return structuredClone(cached.doc);
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Falha ao carregar ${key} (${response.status})`);
  const doc = (await response.json()) as RemoteDoc;
  const value = doc.version > 0 && doc.value !== null ? doc : null;
  const etag = response.headers.get("etag");
  if (etag && status.user === user)
    readDocuments.set(key, { etag, doc: structuredClone(value) });
  return value;
}

export type BatchDocuments = {
  documents: Map<string, RemoteDoc | null>;
  unchanged: Set<string>;
  denied: Map<string, string>;
};

/**
 * Lê várias chaves em uma chamada. `versions` informa o que o navegador já tem,
 * e o servidor devolve só os corpos que mudaram — mesma economia do ETag, para
 * o conjunto inteiro. A rota por chave (`fetchDoc`) continua valendo.
 */
export async function fetchDocuments(
  keys: readonly string[],
  versions?: Record<string, number>,
  options?: { with?: readonly ("alerts" | "google")[] },
): Promise<BatchDocuments> {
  // Documentos adiantados pelo gesto de navegação (`warmDocuments`): a hidratação
  // da tela nova usa o que já chegou e pede só o resto.
  if (!versions) {
    const warm = takeWarmDocuments(keys);
    if (warm.length) {
      const covered = new Set(warm.flatMap(entry => entry.keys));
      const rest = keys.filter(key => !covered.has(key));
      try {
        const parts = await Promise.all([...warm.map(entry => entry.batch),
          ...(rest.length ? [fetchDocuments(rest, undefined, options)] : [])]);
        const pick = <T,>(map: Map<string, T>, wanted: (key: string) => boolean) =>
          [...map].filter(([key]) => wanted(key));
        const wanted = (key: string) => keys.includes(key);
        return {
          documents: new Map(parts.flatMap(part => pick(part.documents, wanted))),
          unchanged: new Set(parts.flatMap(part => [...part.unchanged].filter(wanted))),
          denied: new Map(parts.flatMap(part => pick(part.denied, wanted))),
        };
      } catch {
        // A leitura adiantada falhou: a hidratação segue pelo caminho normal.
      }
    }
  }
  // A primeira hidratação da página já veio no bootstrap: só pede o que faltou.
  if (!versions && preloaded) {
    if (Date.now() - preloaded.at > PRELOAD_TTL) preloaded = null;
    else {
      const ready = preloaded.batch;
      const inBatch = (key: string) => ready.documents.has(key) || ready.unchanged.has(key) || ready.denied.has(key);
      const missing = keys.filter((key) => !inBatch(key));
      if (!missing.length) return ready;
      if (missing.length < keys.length) {
        const rest = await fetchDocuments(missing, undefined, options);
        return {
          documents: new Map([...ready.documents, ...rest.documents]),
          unchanged: new Set([...ready.unchanged, ...rest.unchanged]),
          denied: new Map([...ready.denied, ...rest.denied]),
        };
      }
    }
  }
  const query = new URLSearchParams({ keys: keys.join(",") });
  const pairs = Object.entries(versions ?? {}).filter(([key]) => keys.includes(key));
  if (pairs.length) query.set("versions", pairs.map(([key, version]) => `${key}:${version}`).join(","));
  if (options?.with?.length) query.set("with", options.with.join(","));
  const response = await fetch(`${STATE_ENDPOINT}?${query}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (response.status === 401 && status.authMode === "google") {
    patchSyncStatus({ user: null });
    throw new Error("Sua sessão expirou. Entre novamente.");
  }
  if (!response.ok) throw new Error(`Falha ao carregar os dados (${response.status})`);
  const body = (await response.json()) as BatchBody;
  // Pediu o contador e ele veio ausente: o servidor ainda está calculando a
  // fila. Relê pela rota própria logo depois, em vez de esperar o próximo ciclo.
  if (options?.with?.includes("alerts") && body.alerts === undefined) scheduleAlertRefresh();
  return toBatch(body);
}

/**
 * Leituras de documentos adiantadas pelo gesto de navegação (`navigation-warmup.ts`):
 * as chaves que a tela de destino vai hidratar e que esta aba ainda não tem.
 * Valem por `PRELOAD_TTL`, uma vez por chave, e caem em qualquer gravação.
 */
type WarmDocuments = { at: number; keys: string[]; batch: Promise<BatchDocuments> };
let warmDocumentBatches: WarmDocuments[] = [];

export function warmDocuments(keys: readonly string[], now = Date.now()) {
  if (!keys.length || !remoteOperationsSettled()) return;
  warmDocumentBatches = warmDocumentBatches.filter(entry => now - entry.at <= PRELOAD_TTL);
  const covered = new Set(warmDocumentBatches.flatMap(entry => entry.keys));
  const missing = keys.filter(key => !covered.has(key));
  if (!missing.length) return;
  const batch = fetchDocuments(missing);
  batch.catch(() => undefined);
  warmDocumentBatches.push({ at: now, keys: missing, batch });
}

/** As leituras adiantadas que cobrem alguma destas chaves (consumidas aqui). */
function takeWarmDocuments(keys: readonly string[]): WarmDocuments[] {
  const now = Date.now();
  warmDocumentBatches = warmDocumentBatches.filter(entry => now - entry.at <= PRELOAD_TTL);
  const taken: WarmDocuments[] = [];
  for (const entry of warmDocumentBatches) {
    const hits = entry.keys.filter(key => keys.includes(key));
    if (!hits.length) continue;
    taken.push({ ...entry, keys: hits });
    entry.keys = entry.keys.filter(key => !hits.includes(key));
  }
  warmDocumentBatches = warmDocumentBatches.filter(entry => entry.keys.length);
  return taken;
}

/** Uma gravação torna velhas as leituras adiantadas (documentos e dados de tela) ainda não usadas. */
export function dropWarmReads() {
  warmDocumentBatches = [];
  dropWarmResponses();
}

let alertRefresh: ReturnType<typeof setTimeout> | null = null;
function scheduleAlertRefresh() {
  if (alertRefresh) return;
  alertRefresh = setTimeout(() => {
    alertRefresh = null;
    void refreshAlertCount();
  }, 3_000);
}

export type SaveResult =
  { ok: true; version: number } | { ok: false; conflict: RemoteDoc };

export async function saveDoc(
  key: string,
  value: unknown,
  baseVersion: number,
): Promise<SaveResult> {
  const response = await fetch(`${STATE_ENDPOINT}/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value, baseVersion }),
  });
  if (response.status === 401 && status.authMode === "google") {
    patchSyncStatus({ user: null });
    throw new Error("Sua sessão expirou. Entre novamente.");
  }
  if (response.status === 409)
    return { ok: false, conflict: (await response.json()) as RemoteDoc };
  if (!response.ok)
    throw new Error(`Falha ao salvar ${key} (${response.status})`);
  const body = (await response.json()) as { version: number };
  return { ok: true, version: body.version };
}
