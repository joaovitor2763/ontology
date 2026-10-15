"use client";
import type { MeetArtifacts } from "@/modules/engagement/application/google-meet";
import type { InviteResponse } from "@/modules/engagement/domain/models";
import { useCallback, useEffect, useState } from "react";
import { getBootstrapGoogle, resolvePersistenceMode } from "./persistence.ts";

export type GoogleStatus = {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  canConfigureMeet?: boolean;
  accountEmail: string | null;
  status: string | null;
  error?: string | null;
};

const OFF: GoogleStatus = {
  enabled: false,
  configured: false,
  connected: false,
  accountEmail: null,
  status: null,
};

/**
 * O estado da conexão é o mesmo para a página inteira: componentes que montam
 * juntos compartilham uma consulta só, e o resultado vale por um minuto. Quem
 * conectou ou desconectou pede `force` e lê de novo.
 */
let shared: { at: number; work: Promise<GoogleStatus> } | null = null;
const STATUS_TTL = 60_000;

export function fetchGoogleStatus(force = false): Promise<GoogleStatus> {
  if (force || !shared || Date.now() - shared.at > STATUS_TTL)
    shared = {
      at: Date.now(),
      work: (async () => {
        try {
          // O bootstrap da página já trouxe o estado; só pede de novo se for `force` ou velho.
          if (!force) {
            await resolvePersistenceMode();
            const seeded = getBootstrapGoogle();
            if (seeded && Date.now() - seeded.at <= STATUS_TTL) return seeded.body as GoogleStatus;
          }
          const response = await fetch("/api/google/status", { cache: "no-store" });
          return response.ok ? ((await response.json()) as GoogleStatus) : OFF;
        } catch {
          return OFF;
        }
      })(),
    };
  return shared.work;
}

/** Connection state of the signed-in member; re-read on demand after connecting or disconnecting. */
export function useGoogleStatus() {
  const [status, setStatus] = useState<GoogleStatus>(OFF);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchGoogleStatus(tick > 0).then((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, [tick]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { ...status, refresh };
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Falha ao falar com o Google.");
  return payload;
}

export type GoogleEventResult = {
  calendarId: string;
  eventId: string;
  htmlLink: string;
  meetLink: string;
  meetStatus: string;
  organizer: string;
  autoRecording: boolean;
  recordingWarning?: string;
};

export function createGoogleEvent(input: {
  requestId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  attendees: string[];
  withMeet: boolean;
}) {
  return post<GoogleEventResult>("/api/google/events", input);
}

export function fetchMeetArtifacts(input: { meetLink: string; startsAt: string; includeEarlierSessions?: boolean }) {
  return post<{ state: "ready" | "pending" | "not_found"; artifacts?: MeetArtifacts }>(
    "/api/google/artifacts",
    input,
  );
}

export type EventResponses = {
  status: string;
  attendees: { email: string; responseStatus: InviteResponse; organizer: boolean }[];
  meetLink: string | null;
  htmlLink: string | null;
};

export async function fetchEventResponses(eventId: string, calendarId?: string) {
  const response = await fetch(
    `/api/google/events/${encodeURIComponent(eventId)}?calendar=${encodeURIComponent(calendarId || "primary")}`,
    { cache: "no-store" },
  );
  const payload = (await response.json().catch(() => ({}))) as EventResponses & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Não foi possível ler as respostas do convite.");
  return payload;
}

export function disconnectGoogle() {
  return post<{ ok: boolean }>("/api/google/disconnect", {});
}
