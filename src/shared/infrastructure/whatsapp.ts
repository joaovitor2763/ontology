"use client";
import type { WhatsAppMessage } from "@/modules/engagement/application/whatsapp";
import { useEffect, useState } from "react";

export type WhatsAppStatus = {
  enabled: boolean;
  configured: boolean;
  source: "supabase" | "z-api";
  table: string;
  groupColumn: string;
  groupNameColumn?: string;
};

const OFF: WhatsAppStatus = {
  enabled: false,
  configured: false,
  source: "supabase",
  table: "",
  groupColumn: "",
};

let cached: WhatsAppStatus | null = null;
let pending: Promise<WhatsAppStatus> | null = null;

/** Reads `/api/whatsapp/status` once per session. */
export function fetchWhatsAppStatus(): Promise<WhatsAppStatus> {
  if (cached) return Promise.resolve(cached);
  if (!pending)
    pending = fetch("/api/whatsapp/status", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<WhatsAppStatus>) : OFF))
      .catch(() => OFF)
      .then((status) => {
        cached = status;
        return status;
      });
  return pending;
}

export function useWhatsAppStatus() {
  const [status, setStatus] = useState<WhatsAppStatus>(cached ?? OFF);
  useEffect(() => {
    let alive = true;
    void fetchWhatsAppStatus().then((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return status;
}

export async function fetchGroupMessages(
  company: string,
  before?: string,
  signal?: AbortSignal,
  refresh = false,
): Promise<{
  stale: boolean;
  messages: WhatsAppMessage[];
  fetchedAt: string;
  nextCursor: string | null;
}> {
  const query=new URLSearchParams({company,refresh:String(refresh)});
  if(before)query.set("before",before);
  const response = await fetch(`/api/v1/whatsapp/messages?${query}`, {signal,cache:"no-store"});
  const result = await response.json().catch(() => ({})) as {error?:{message?:string};data?:unknown};
  if(!response.ok)throw new Error(result.error?.message??"Não foi possível ler as conversas do grupo.");
  const payload = (result.data??{}) as {
    stale?: boolean;
    messages?: WhatsAppMessage[];
    fetchedAt?: string;
    nextCursor?: string | null;
    error?: string;
  };
  return {
    stale: payload.stale === true,
    nextCursor: payload.nextCursor ?? null,
    messages: payload.messages ?? [],
    fetchedAt: payload.fetchedAt ?? new Date().toISOString(),
  };
}
