"use client";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import {
  needsArtifacts,
  needsResponses,
  useMeetArtifacts,
} from "@/modules/engagement/presentation/useMeetArtifacts";
import { useGoogleStatus } from "@/shared/infrastructure/google";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { useEffect, useRef } from "react";

const EVERY = 15 * 60_000;

/**
 * Keeps meetings in step with Google while the app is open: answers to the
 * invitations of upcoming meetings, and the recording and transcript of the
 * ones that already happened. Runs for the meetings organized by the
 * signed-in member, one at a time, at most once an hour per meeting.
 *
 * O sincronizador está no shell, então ele monta em toda página; os documentos
 * de que precisa, não. Enquanto o Google não estiver ligado e conectado, aqui
 * só se lê a sessão e o estado da integração, e as reuniões continuam fora da
 * hidratação de telas que não falam de reunião nenhuma.
 */
export function MeetSync() {
  const { mode } = useSyncStatus();
  const google = useGoogleStatus();
  if (!(mode === "remote" && google.enabled && google.connected)) return null;
  return <MeetSyncRunner />;
}

function MeetSyncRunner() {
  const { hydrated, user } = useSyncStatus();
  const { allMeetings } = useEngagementState();
  const { pullArtifacts, pullResponses } = useMeetArtifacts();
  const running = useRef(false);
  const latest = useRef({ allMeetings, pullArtifacts, pullResponses, email: user?.email });
  useEffect(() => {
    latest.current = { allMeetings, pullArtifacts, pullResponses, email: user?.email };
  });
  const active = hydrated;

  useEffect(() => {
    if (!active) return;
    let alive = true;
    async function sweep() {
      if (running.current) return;
      running.current = true;
      try {
        const { allMeetings, pullArtifacts, pullResponses, email } = latest.current;
        const now = Date.now();
        for (const m of allMeetings.filter((x) => needsArtifacts(x, email, now)).slice(0, 5)) {
          if (!alive) return;
          await pullArtifacts(m).catch(() => {});
        }
        for (const m of allMeetings.filter((x) => needsResponses(x, email, now)).slice(0, 10)) {
          if (!alive) return;
          await pullResponses(m).catch(() => {});
        }
      } finally {
        running.current = false;
      }
    }
    const first = setTimeout(() => void sweep(), 4000);
    const timer = setInterval(() => void sweep(), EVERY);
    const onFocus = () => void sweep();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [active]);
  return null;
}
