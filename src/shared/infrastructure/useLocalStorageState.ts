"use client";

import { OperationRefused } from "./operation-error.ts";
import { coalesced } from "./coalesce.ts";
import { skipsGlobalDeliveryRead } from "./bootstrap-keys.ts";
import { skipsActiveExecutionDocument } from "./execution-view-state.ts";
import { useCallback, useSyncExternalStore, type SetStateAction } from "react";
import {
  dropWarmReads,
  fetchDocuments,
  getServerSyncStatus,
  getSyncStatus,
  isSyncedKey,
  patchSyncStatus,
  resolvePersistenceMode,
  saveDoc,
  subscribeSyncStatus,
  SYNCED_KEY,
} from "./persistence.ts";

type Entry = {
  raw: string | null;
  value: unknown;
  error: string | null;
  /** Server version of the document, when the key is synced. */
  version?: number;
  hydrated?: boolean;
  /** Server copy retained in memory because the browser cache rejected it. */
  memoryOnly?: boolean;
  /** Local edits not yet accepted by the server. */
  dirty?: boolean;
  /** A scoped write advanced the server document without returning its body. */
  stale?: boolean;
  /**
   * Valor provisório de um comando em confirmação: o que a pessoa acabou de
   * fazer, mostrado enquanto o servidor responde. Nunca vai para o navegador
   * nem para o servidor; a resposta o substitui e a falha o descarta.
   */
  provisional?: { value: unknown };
  /**
   * Conta quantas vezes o valor desta chave mudou nesta aba. É o que um
   * formulário aberto guarda para saber se os dados mudaram por baixo dele,
   * no lugar de serializar o documento inteiro a cada gesto.
   */
  revision?: number;
};
let revisions = 0;
const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const healthListeners = new Set<() => void>();
function reportHealth() {
  queueMicrotask(() => healthListeners.forEach((listener) => listener()));
}
function emit(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}
export function useStorageHealth() {
  return useSyncExternalStore(
    (listener) => {
      healthListeners.add(listener);
      return () => {
        healthListeners.delete(listener);
      };
    },
    () => [...entries.values()].find((entry) => entry.error)?.error ?? null,
    () => null,
  );
}

export function useSyncStatus() {
  return useSyncExternalStore(
    subscribeSyncStatus,
    getSyncStatus,
    getServerSyncStatus,
  );
}

/**
 * Whether one repository document has reached the browser. Global hydration is
 * deliberately insufficient here: large contexts can finish after the client
 * record and must not be represented by their canonical fallback in-between.
 */
export function useDocumentHydrated(key: string) {
  const { mode, resolved } = useSyncStatus();
  const subscribe = useCallback((listener: () => void) => {
    const group = listeners.get(key) ?? new Set<() => void>();
    listeners.set(key, group);
    group.add(listener);
    return () => {
      group.delete(listener);
    };
  }, [key]);
  const hydrated = useSyncExternalStore(
    subscribe,
    () => Boolean(entries.get(key)?.hydrated),
    () => false,
  );
  return resolved && (mode !== "remote" || hydrated);
}

/** Fields missing or with an unexpected type fall back to the initial value. */
function normalize<T>(value: unknown, fallback: T): T {
  if (
    typeof fallback !== "object" ||
    fallback === null ||
    Array.isArray(fallback)
  )
    return value as T;
  const parsed =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.entries(fallback).map(([field, initial]) => {
      const candidate = parsed[field];
      const valid = Array.isArray(initial)
        ? Array.isArray(candidate)
        : candidate !== null &&
          typeof candidate === typeof initial &&
          !Array.isArray(candidate);
      return [field, valid ? candidate : initial];
    }),
  ) as T;
}

function read<T>(key: string, fallback: T, migrate?: () => T): T {
  const previous = entries.get(key);
  // The provisional value of a command in flight is what the person just did.
  if (previous?.provisional) return previous.provisional.value as T;
  // A large remote document may exceed this browser's localStorage quota. The
  // in-memory server copy must win over any smaller stale value left behind.
  if (previous?.memoryOnly) return previous.value as T;
  // Keep edits usable in memory when the browser cannot persist them.
  if (previous?.error) return previous.value as T;
  try {
    const raw = localStorage.getItem(key);
    if (previous && previous.raw === raw) return previous.value as T;
    const value = normalize(
      raw === null ? (migrate?.() ?? fallback) : JSON.parse(raw),
      fallback,
    );
    entries.set(key, { ...previous, raw, value, error: null, revision: ++revisions });
    return value;
  } catch {
    entries.set(key, {
      raw: null,
      value: previous?.value ?? fallback,
      error:
        "Não foi possível acessar os dados salvos neste navegador. Suas alterações estão disponíveis apenas nesta sessão.",
    });
    reportHealth();
    return (previous?.value ?? fallback) as T;
  }
}

/** Writes a value to memory and the browser cache without touching the server. */
function adopt<T>(key: string, value: T, version?: number) {
  const raw = JSON.stringify(value);
  let memoryOnly = false;
  try {
    localStorage.setItem(key, raw);
  } catch {
    memoryOnly = true;
    // A stale remote cache with the same server version would otherwise replace
    // the fresh server document on the next render. In local mode it is the last
    // durable copy, so retain it for a later reload.
    if (getSyncStatus().mode === "remote") {
      try { localStorage.removeItem(key); } catch { /* memory remains canonical */ }
    }
  }
  const previous = entries.get(key);
  entries.set(key, {
    ...previous,
    raw,
    value,
    error: null,
    version: version ?? previous?.version,
    hydrated: true,
    memoryOnly,
    dirty: false,
    stale: false,
    provisional: undefined,
    revision: ++revisions,
  });
  emit(key);
}

/** Keys whose `update()` writes the provisional layer instead of the cache. */
const optimisticKeys = new Set<string>();

/** Guarda o valor provisório de uma chave sob comando otimista. */
export function setProvisional<T>(key: string, next: T) {
  const previous = entries.get(key) ?? { raw: null, value: next, error: null };
  entries.set(key, { ...previous, provisional: { value: next }, revision: ++revisions });
  emit(key);
}

/** O que a tela está vendo para esta chave, provisório incluído. */
export function operationDocumentSnapshot(key: string): unknown {
  const entry = entries.get(key);
  return entry?.provisional ? entry.provisional.value : entry?.value;
}

/** A scoped command changed a document without returning the global snapshot. */
export function invalidateOperationDocument(key: string) {
  const entry = entries.get(key);
  if (!entry?.hydrated) return;
  entries.set(key, { ...entry, stale: true, revision: ++revisions });
  emit(key);
}

/** Drops the provisional value: the last confirmed document is shown again. */
function clearProvisional(key: string) {
  const entry = entries.get(key);
  if (!entry?.provisional) return;
  entries.set(key, { ...entry, provisional: undefined, revision: ++revisions });
  emit(key);
}

const hydrating = new Set<string>();
/** Chaves que esta aba ainda não tem nem está buscando (o que a próxima tela vai pedir). */
export const keysToHydrate = (keys: readonly string[]) => keys.filter(key => !entries.get(key)?.hydrated && !hydrating.has(key) && !hydrationWork.has(key));
const hydrationWork = new Map<string, Promise<void>>();
const pushing = new Map<string, Promise<boolean>>();
const operationLocks = new Set<string>();
const controlledKey = /^ontology\.(clients|catalog|delivery|stakeholders)\.v\d+$/;
const timers = new Map<string, number>();
let pollingStarted = false;

/**
 * Hidratação em lote: as chaves pedidas no mesmo tique viram uma chamada só a
 * `/api/state`. Cada chave mantém a sua regra — documento controlado sem cópia
 * no servidor volta ao padrão canônico, documento livre sobe a cópia local.
 */
const hydrationQueue = new Map<string, { fallback: unknown; migrate?: () => unknown }>();
let queuedHydration: Promise<void> | null = null;

function hydrate<T>(key: string, fallback: T, migrate?: () => T): Promise<void> {
  if (operationLocks.has(key)) return operationQueue.then(() => hydrate(key, fallback, migrate));
  const existing = hydrationWork.get(key);
  if (existing) return existing;
  hydrationQueue.set(key, { fallback, migrate: migrate as (() => unknown) | undefined });
  queuedHydration ??= Promise.resolve().then(() => {
    queuedHydration = null;
    const batch = [...hydrationQueue];
    hydrationQueue.clear();
    return hydrateDocuments(batch);
  });
  const work = queuedHydration.finally(() => hydrationWork.delete(key));
  hydrationWork.set(key, work);
  return work;
}

/** Controlled documents start from their canonical defaults, never browser data. */
async function hydrateDocuments(batch: [string, { fallback: unknown; migrate?: () => unknown }][]) {
  const wanted = batch.filter(([key]) => !hydrating.has(key) && !entries.get(key)?.hydrated);
  if (!wanted.length) return;
  const keys = wanted.map(([key]) => key);
  for (const key of keys) hydrating.add(key);
  try {
    const result = await fetchDocuments(keys);
    const uploads: Promise<void>[] = [];
    for (const [key, { fallback, migrate }] of wanted) {
      const refused = result.denied.get(key);
      if (refused) {
        patchSyncStatus({ error: refused });
        continue;
      }
      const doc = result.documents.get(key) ?? null;
      if (doc) adopt(key, normalize(doc.value, fallback), doc.version);
      else if (controlledKey.test(key)) adopt(key, fallback, 0);
      else {
        const local = read(key, fallback, migrate);
        uploads.push(saveDoc(key, local, 0).then((saved) => {
          if (saved.ok) adopt(key, local, saved.version);
          else adopt(key, normalize(saved.conflict.value, fallback), saved.conflict.version);
        }));
      }
    }
    await Promise.all(uploads);
    patchSyncStatus({ error: null, lastSyncAt: new Date().toISOString() });
    if ([...entries.entries()].every(([key, entry]) => !isSyncedKey(key) || entry.hydrated))
      patchSyncStatus({ hydrated: true });
  } catch (error) {
    patchSyncStatus({
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível sincronizar com o servidor.",
    });
  } finally {
    for (const key of keys) hydrating.delete(key);
  }
}

/** Pushes local edits; on conflict the server copy wins and the user is told. */
function push<T>(key: string, fallback: T): Promise<boolean> {
  const existing = pushing.get(key);
  if (existing) return existing;
  const work = pushDocument(key, fallback).finally(() => pushing.delete(key));
  pushing.set(key, work);
  return work;
}

async function pushDocument<T>(key: string, fallback: T): Promise<boolean> {
  const entry = entries.get(key);
  if (!entry?.dirty) return true;
  dropWarmReads();
  patchSyncStatus({ pending: getSyncStatus().pending + 1 });
  try {
    const result = await saveDoc(key, entry.value, entry.version ?? 0);
    dropWarmReads(); // o que foi adiantado durante a gravação também é anterior a ela
    if (result.ok) {
      const current = entries.get(key);
      if (current && current.value === entry.value) {
        entries.set(key, { ...current, version: result.version, dirty: false });
      } else if (current) {
        entries.set(key, { ...current, version: result.version });
        schedulePush(key, fallback);
      }
      patchSyncStatus({ error: null, lastSyncAt: new Date().toISOString() });
      return true;
    } else {
      adopt(key, normalize(result.conflict.value, fallback), result.conflict.version);
      patchSyncStatus({
        error:
          "Outra pessoa salvou esta área antes de você. A versão do servidor foi carregada; refaça sua alteração.",
      });
      return false;
    }
  } catch (error) {
    entries.set(key, { ...entries.get(key)!, dirty: true });
    patchSyncStatus({
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível salvar no servidor. Tentaremos de novo.",
    });
    window.setTimeout(() => schedulePush(key, fallback), 5000);
    return false;
  } finally {
    patchSyncStatus({ pending: Math.max(0, getSyncStatus().pending - 1) });
  }
}

function schedulePush<T>(key: string, fallback: T) {
  const existing = timers.get(key);
  if (existing) window.clearTimeout(existing);
  timers.set(
    key,
    window.setTimeout(() => {
      timers.delete(key);
      if (!operationLocks.has(key)) void push(key, fallback);
    }, 400),
  );
}

export type OperationDocument = {
  key: string;
  /** O comando devolve só a referência; respostas antigas com valor continuam aceitas. */
  value?: unknown;
  version: number;
  updatedAt?: string;
  updatedBy?: string;
};

/**
 * O que o formulário viu ao abrir: a revisão de cada documento, não o seu JSON.
 * Comparar números troca a serialização de seis documentos por gesto por uma
 * comparação de igualdade, e detecta a mesma coisa — qualquer gravação, adoção
 * ou valor provisório avança a revisão da chave.
 */
export function operationDocumentBaseline(keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.flatMap((key) => {
    const entry = entries.get(key);
    return entry?.hydrated && !entry.stale ? [[key, String(entry.revision ?? 0)]] : [];
  }));
}

let operationQueue: Promise<unknown> = Promise.resolve();
/** Comandos já na fila: com algum deles esperando, o provisório espera também. */
let queuedOperations = 0;

/**
 * Aplica o valor provisório agora, dentro do próprio evento, sem passar pela
 * fila. É o que faz o card trocar de coluna na mesma renderização em que o
 * indicador de confirmação aparece, em vez de uma renderização depois.
 *
 * Só vale quando nada pode mudar o documento antes do comando: nenhuma
 * operação na fila, nenhuma hidratação ou gravação pendente, nada sujo e tudo
 * hidratado. Fora disso devolve `false` e o comando segue pela ordem de sempre,
 * aplicando o provisório dentro da fila como antes.
 */
export function applyProvisionalNow(keys: readonly string[], apply: () => void): boolean {
  if (queuedOperations > 0) return false;
  for (const key of keys) {
    const entry = entries.get(key);
    if (
      operationLocks.has(key) ||
      hydrationWork.has(key) ||
      pushing.has(key) ||
      timers.has(key) ||
      !entry?.hydrated ||
      entry.dirty
    )
      return false;
  }
  for (const key of keys) optimisticKeys.add(key);
  try {
    apply();
  } finally {
    for (const key of keys) optimisticKeys.delete(key);
  }
  return true;
}

/** Descarta o provisório adiantado quando o comando nem chegou à fila. */
export function discardProvisionalNow(keys: readonly string[]) {
  for (const key of keys) clearProvisional(key);
}

/**
 * Serialize commands with legacy snapshots. Failed commands never adopt a draft.
 *
 * `optimistic` aplica a alteração localmente antes de enviar: o valor fica na
 * camada provisória da chave, a resposta do servidor o substitui e qualquer
 * falha o descarta, deixando à vista o último documento confirmado.
 */
export function withOperationDocuments<T extends { documents: OperationDocument[] }>(
  keys: readonly string[],
  execute: (expectedVersions: Record<string, number>) => Promise<T>,
  baseline?: Record<string, string>,
  optimistic?: () => void,
  /** O provisório já foi aplicado por `applyProvisionalNow` antes da fila. */
  preApplied?: boolean,
  /** Active slice commands use their own revision fence, not a global one. */
  scopedKeys: readonly string[] = [],
  /** Active writes intentionally return no global delivery document. */
  invalidateMissingDelivery = false,
): Promise<T> {
  let applied = preApplied === true;
  const run = async () => {
    dropWarmReads();
    for (const key of keys) operationLocks.add(key);
    try {
      for (const key of keys) {
        const timer = timers.get(key);
        if (timer) window.clearTimeout(timer);
        timers.delete(key);
        await hydrationWork.get(key);
        const stale = entries.get(key);
        if (stale?.stale && !scopedKeys.includes(key)) {
          if (stale.dirty)
            throw new OperationRefused("Os dados mudaram no servidor enquanto havia alterações pendentes. Atualize antes de continuar.");
          try {
            const refreshed = await fetchDocuments([key], { [key]: stale.version ?? 0 });
            const doc = refreshed.documents.get(key);
            if (doc) adopt(key, doc.value, doc.version);
            else if (refreshed.unchanged.has(key))
              entries.set(key, { ...stale, stale: false });
            else throw new Error("Documento indisponível");
          } catch {
            throw new OperationRefused("Os dados mudaram no servidor e não puderam ser atualizados. Tente novamente.");
          }
        }
        if (baseline?.[key] !== undefined && String(entries.get(key)?.revision ?? 0) !== baseline[key])
          throw new OperationRefused("Os dados mudaram enquanto você editava. Feche e reabra o formulário para revisar a versão atual.");
        const pending = pushing.get(key);
        if (pending && !(await pending))
          throw new OperationRefused("Uma alteração anterior não foi salva. Confira os dados antes de continuar.");
        const entry = entries.get(key);
        if (entry && !entry.hydrated)
          throw new OperationRefused("Os dados ainda não foram carregados. Aguarde e tente novamente.");
        if (entry?.dirty && !(await push(key, entry.value)))
          throw new OperationRefused("Uma alteração anterior não foi salva. Confira os dados antes de continuar.");
      }
      patchSyncStatus({ pending: getSyncStatus().pending + 1 });
      try {
        const expectedVersions = Object.fromEntries(keys.flatMap((key) => {
          const entry = entries.get(key);
          const version = scopedKeys.includes(key) ? undefined : entry?.version;
          return version === undefined ? [] : [[key, version]];
        }));
        if (optimistic && !applied) {
          for (const key of keys) optimisticKeys.add(key);
          try {
            optimistic();
            applied = true;
          } finally {
            for (const key of keys) optimisticKeys.delete(key);
          }
        }
        const result = await execute(expectedVersions);
        if (!Array.isArray(result.documents) || result.documents.some((doc) =>
          !keys.includes(doc.key) || !Number.isSafeInteger(doc.version) || doc.version < 0,
        )) throw new Error("O servidor retornou documentos inválidos. Atualize os dados antes de continuar.");
        const missing=result.documents.filter(doc=>doc.value===undefined&&(entries.get(doc.key)?.version??0)<doc.version);
        const refreshed=missing.length?await fetchDocuments(missing.map(doc=>doc.key),Object.fromEntries(missing.map(doc=>[doc.key,entries.get(doc.key)?.version??0]))):null;
        const confirmed=result.documents.flatMap(doc=>{
          if(doc.value!==undefined) return [doc];
          if((entries.get(doc.key)?.version??0)>=doc.version) return [];
          const current=refreshed?.documents.get(doc.key);
          if(!current||current.version<doc.version) throw new Error("A gravação foi confirmada, mas o estado atualizado não pôde ser carregado. Repita para sincronizar.");
          return [{...doc,value:current.value,version:current.version,updatedAt:current.updatedAt??undefined}];
        });
        for (const doc of confirmed) {
          // A replay can return the original receipt after polling has seen newer work.
          if ((entries.get(doc.key)?.version ?? 0) <= doc.version)
            adopt(doc.key, doc.value, doc.version);
        }
        if (invalidateMissingDelivery && keys.includes("ontology.delivery.v2") &&
            !result.documents.some((doc) => doc.key === "ontology.delivery.v2")) {
          invalidateOperationDocument("ontology.delivery.v2");
          // Global pages render this document directly. Refresh it before the
          // optimistic layer is cleared so a confirmed card does not jump back.
          const path = typeof window === "undefined" ? "" : window.location?.pathname ?? "";
          const key = "ontology.delivery.v2";
          const entry = entries.get(key);
          if (entry?.hydrated && path && !skipsGlobalDeliveryRead(path) &&
              !skipsActiveExecutionDocument(path)) {
            try {
              const refreshed = await fetchDocuments([key], { [key]: entry.version ?? 0 });
              const doc = refreshed.documents.get(key);
              if (doc && doc.version >= (entries.get(key)?.version ?? 0))
                adopt(key, doc.value, doc.version);
              else if (refreshed.unchanged.has(key) &&
                  entries.get(key)?.version === entry.version) {
                const current = entries.get(key)!;
                entries.set(key, { ...current, stale: false });
              } else
                throw new Error("A cópia da tela ainda não foi atualizada.");
            } catch {
              // The write may already be committed. The caller retries with
              // the same idempotency key, and polling keeps the entry stale.
              throw new Error("A alteração foi salva, mas a tela não pôde ser atualizada. Verifique a mesma tentativa.");
            }
          }
        }
        patchSyncStatus({ error: null, lastSyncAt: new Date().toISOString() });
        return result;
      } finally {
        patchSyncStatus({ pending: Math.max(0, getSyncStatus().pending - 1) });
      }
    } finally {
      // Chaves sem documento na resposta voltam ao valor confirmado; uma recusa
      // antes do envio descarta o provisório que já estava na tela.
      if (applied) for (const key of keys) clearProvisional(key);
      for (const key of keys) {
        operationLocks.delete(key);
        const entry = entries.get(key);
        if (entry?.dirty) schedulePush(key, entry.value);
      }
    }
  };
  queuedOperations += 1;
  const result = operationQueue.then(run, run).finally(() => {
    queuedOperations -= 1;
  });
  operationQueue = result.catch(() => undefined);
  return result;
}

/**
 * Rereads every hydrated, clean key now: only the documents that changed come
 * back with a body. The 30-second poll uses it; a screen calls it after a
 * refused command, so the next attempt starts from the server's versions
 * instead of repeating the conflict.
 */
export async function revalidateDocuments() {
  if (typeof window === "undefined" || document.visibilityState !== "visible") return;
  // A client page reads its authoritative slice. A global document left in
  // memory from a previous page must not silently reconstruct every client
  // again on the 30-second poll.
  const clientRoute = skipsGlobalDeliveryRead(window.location.pathname) ||
    skipsActiveExecutionDocument(window.location.pathname);
  const watched = [...entries].filter(([key, entry]) =>
    isSyncedKey(key) && (!clientRoute || key !== 'ontology.delivery.v2') &&
    entry.hydrated && !entry.dirty && !operationLocks.has(key));
  if (!watched.length) return;
  const versions = Object.fromEntries(watched.map(([key, entry]) => [key, entry.version ?? 0]));
  try {
    // Uma chamada para o conjunto; só os documentos alterados voltam com corpo.
    // O contador de alertas do menu vem junto, sem relógio próprio.
    const result = await fetchDocuments(watched.map(([key]) => key), versions, { with: ["alerts"] });
    for (const [key, entry] of watched) {
      const doc = result.documents.get(key);
      const current = entries.get(key);
      if (!doc || result.unchanged.has(key) || doc.version === entry.version) continue;
      if (current?.dirty || operationLocks.has(key) || current?.version !== entry.version) continue;
      adopt(key, doc.value, doc.version);
    }
  } catch {
    // Next refresh will retry.
  }
}

/** Refreshes hydrated keys when the tab regains focus and every 30 seconds while visible. */
function startPolling() {
  if (pollingStarted || typeof window === "undefined") return;
  pollingStarted = true;
  const onReturn = coalesced(revalidateDocuments); // foco e visibilidade chegam juntos
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onReturn);
  window.setInterval(() => void revalidateDocuments(), 30_000);
  window.addEventListener("beforeunload", (event) => {
    if ([...entries.values()].some((entry) => entry.dirty)) event.preventDefault();
  });
}

export function useLocalStorageState<T>(
  key: string,
  fallback: T,
  migrate?: () => T,
  options?: { suspended?: boolean },
) {
  const suspended = options?.suspended ?? false;
  const subscribe = useCallback(
    (listener: () => void) => {
      if (suspended) return () => {};
      const group = listeners.get(key) ?? new Set<() => void>();
      listeners.set(key, group);
      group.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) {
          entries.delete(key);
          listener();
        }
      };
      window.addEventListener("storage", onStorage);
      if (SYNCED_KEY.test(key)) {
        void resolvePersistenceMode().then((mode) => {
          if (mode !== "remote" || !getSyncStatus().user || getSyncStatus().user?.approved === false) return;
          startPolling();
          void hydrate(key, fallback, migrate);
        });
      }
      return () => {
        group.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    [key, fallback, migrate, suspended],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => suspended ? fallback : read(key, fallback, migrate),
    () => fallback,
  );
  const update = useCallback(
    (action: SetStateAction<T>) => {
      if (suspended) throw new Error('Este documento está sob autoridade por cliente.');
      if (optimisticKeys.has(key)) {
        const current = read(key, fallback, migrate);
        setProvisional(
          key,
          typeof action === "function" ? (action as (value: T) => T)(current) : action,
        );
        return;
      }
      if (operationLocks.has(key)) {
        const message = "Aguarde a operação em andamento antes de alterar esta área.";
        patchSyncStatus({ error: message });
        throw new Error(message);
      }
      if (isSyncedKey(key) && !entries.get(key)?.hydrated) {
        throw new Error("Aguarde o carregamento dos dados antes de editar.");
      }
      const current = read(key, fallback, migrate);
      const next =
        typeof action === "function"
          ? (action as (value: T) => T)(current)
          : action;
      const raw = JSON.stringify(next);
      // Gravação que não muda nada não vira versão nova nem viagem ao servidor.
      if (raw === entries.get(key)?.raw) return;
      let error: string | null = null;
      try {
        localStorage.setItem(key, raw);
      } catch {
        error =
          "O navegador não conseguiu salvar as alterações. Elas permanecem nesta sessão; libere espaço para continuar salvando.";
      }
      const previous = entries.get(key);
      entries.set(key, {
        ...previous,
        raw,
        value: next,
        error,
        dirty: isSyncedKey(key),
        revision: ++revisions,
      });
      emit(key);
      reportHealth();
      if (isSyncedKey(key)) schedulePush(key, fallback);
    },
    [key, fallback, migrate, suspended],
  );
  return [value, update, entries.get(key)?.error ?? null] as const;
}
