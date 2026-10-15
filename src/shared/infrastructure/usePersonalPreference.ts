"use client";

import { useCallback, useEffect, type SetStateAction } from "react";
import { useLocalStorageState, useSyncStatus } from "./useLocalStorageState";

/**
 * Preferência pessoal de interface (visões salvas, aba inicial): abre na hora
 * pela cópia do navegador e acompanha a pessoa entre aparelhos pelo servidor
 * (`/api/me/preferences`). O carimbo de tempo é sempre o do servidor, então o
 * relógio de um aparelho não decide quem vence. Uma gravação que falhou fica
 * pendente e sobe na próxima abertura; uma preferência que só existia no
 * navegador sobe na primeira leitura.
 */
type Entry = { value: unknown; updatedAt: string };
let remote: Promise<Record<string, Entry> | null> | null = null;
let remoteOwner: string | null = null;

function loadRemote(owner: string) {
  if (remote && remoteOwner === owner) return remote;
  remoteOwner = owner;
  const request = fetch("/api/me/preferences", { cache: "no-store" })
    .then(async (response) => response.ok ? ((await response.json()) as { preferences: Record<string, Entry> }).preferences : null)
    .catch(() => null);
  remote = request;
  // Uma leitura que falhou não fica guardada: a próxima montagem tenta de novo.
  void request.then((all) => { if (!all && remote === request) remote = null; });
  return request;
}

type Sync = { at?: string; pending?: boolean };
const syncKey = (owner: string) => `ontology.preference-sync.v1.${owner}`;
function syncState(owner: string): Record<string, Sync> {
  try { return JSON.parse(localStorage.getItem(syncKey(owner)) ?? "{}") as Record<string, Sync>; } catch { return {}; }
}
function markSync(owner: string, name: string, next: Sync) {
  try { localStorage.setItem(syncKey(owner), JSON.stringify({ ...syncState(owner), [name]: next })); } catch { /* só esta sessão */ }
}
function push(owner: string, name: string, value: unknown) {
  markSync(owner, name, { ...syncState(owner)[name], pending: true });
  void fetch("/api/me/preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: name, value }),
  }).then(async (response) => {
    // Recusa (4xx) não melhora repetindo; só falha do servidor fica pendente.
    if (!response.ok) { if (response.status < 500) markSync(owner, name, { at: syncState(owner)[name]?.at }); return; }
    const { updatedAt } = (await response.json()) as { updatedAt: string };
    markSync(owner, name, { at: updatedAt });
    void remote?.then((all) => { if (all && remoteOwner === owner) all[name] = { value, updatedAt }; });
  }).catch(() => { /* fica pendente; a cópia do navegador continua valendo */ });
}

/**
 * `name` é a chave no servidor (ex.: `saved-views.clients`); `localKey` mantém
 * a chave já usada no navegador, para não perder o que a pessoa salvou antes.
 */
export function usePersonalPreference<T>(name: string, localKey: (owner: string) => string, fallback: T, localOwner?: string) {
  const sync = useSyncStatus();
  const owner = sync.resolved ? (sync.user?.email.toLowerCase() ?? (sync.mode === "local" ? localOwner ?? null : null)) : null;
  const synced = Boolean(owner && sync.mode === "remote" && sync.user);
  const [value, setLocal] = useLocalStorageState<T>(owner ? localKey(owner) : `ontology.preference-pending.${name}`, fallback);

  useEffect(() => {
    if (!owner || !synced) return;
    let cancelled = false;
    void loadRemote(owner).then((all) => {
      if (cancelled || !all) return;
      const server = all[name], local = syncState(owner)[name];
      let raw: string | null = null;
      try { raw = localStorage.getItem(localKey(owner)); } catch { raw = null; }
      if (local?.pending && raw !== null) {
        try { push(owner, name, JSON.parse(raw)); } catch { /* cópia local ilegível */ }
      } else if (server && server.updatedAt !== local?.at) {
        setLocal(server.value as T);
        markSync(owner, name, { at: server.updatedAt });
      } else if (!server && raw !== null) {
        try { push(owner, name, JSON.parse(raw)); } catch { /* cópia local ilegível */ }
      }
    });
    return () => { cancelled = true; };
  }, [owner, synced, name, localKey, setLocal]);

  const update = useCallback((action: SetStateAction<T>) => {
    setLocal((current) => {
      const next = typeof action === "function" ? (action as (value: T) => T)(current) : action;
      if (owner && synced) push(owner, name, next);
      return next;
    });
  }, [owner, synced, name, setLocal]);

  return [value, update, owner] as const;
}
