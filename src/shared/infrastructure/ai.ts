"use client";
import { useEffect, useState } from "react";

export type AiStatus = {
  enabled: boolean;
  configured: boolean;
  provider: string;
  model: string;
  gateway: string | null;
};

const OFF: AiStatus = {
  enabled: false,
  configured: false,
  provider: "openai",
  model: "",
  gateway: null,
};

let cached: AiStatus | null = null;
let pending: Promise<AiStatus> | null = null;

/** Reads `/api/ai/status` once per session; the interface shows AI actions only when enabled. */
export function fetchAiStatus(): Promise<AiStatus> {
  if (cached) return Promise.resolve(cached);
  if (!pending)
    pending = fetch("/api/ai/status", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AiStatus>) : OFF))
      .catch(() => OFF)
      .then((status) => {
        cached = status;
        return status;
      });
  return pending;
}

export function useAiStatus() {
  const [status, setStatus] = useState<AiStatus>(cached ?? OFF);
  useEffect(() => {
    let alive = true;
    void fetchAiStatus().then((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return status;
}

/** Calls the AI endpoint; callers must treat the result as a draft for human review. */
export async function runAi<T = { text: string }>(body: unknown): Promise<T> {
  const response = await fetch("/api/ai/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) throw new Error(payload.error ?? "Falha na IA.");
  return payload;
}
