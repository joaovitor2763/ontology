"use client";
import { signalReviewState } from "../infrastructure/snapshot";
import type { Signal, Thread } from "@/modules/engagement/domain/models";
import {
  extractSignals,
  groupHealth,
  nextBestAction,
  type GroupHealth,
} from "@/modules/engagement/domain/signals";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { useLiveThreads } from "@/modules/engagement/infrastructure/relationship-state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { NOW } from "@/shared/lib/format";
import { useMemo } from "react";

export type ThreadSignals = {
  thread: Thread;
  signals: Signal[];
  open: Signal[];
  health: GroupHealth;
  next?: Signal;
};

/**
 * Signals of every live thread of a client (or of all clients), with human
 * reviews and any AI classification applied on top of the rule output.
 */
export function useSignals(company?: string) {
  const threads = useLiveThreads(company);
  const { signalReviews, signalClassifications } = useEngagementState();
  const { members } = useTeam();
  const teamNames = useMemo(() => members.map((m) => m.name), [members]);
  return useMemo(() => {
    const isTeam = (author: string) =>
      teamNames.some((n) => author.replace(/\+.*/, "").trim().startsWith(n));
    const byThread: ThreadSignals[] = threads
      .filter(
        (t) =>
          t.channel === "whatsapp" ||
          t.channel === "call" ||
          t.channel === "email",
      )
      .map((thread) => {
        const signals = extractSignals(thread, { isTeam, now: NOW }).map(
          (s) => {
            const review = signalReviews[s.id];
            const ai = signalClassifications[s.id];
            return {
              ...s,
              ...(ai ?? {}),
              ...signalReviewState(review),
              deliveryId: review?.deliveryId ?? s.deliveryId,
            };
          },
        );
        const open = signals.filter((s) => !s.resolvedAt && !s.answeredLater);
        return {
          thread,
          signals,
          open,
          health: groupHealth(thread, signals, NOW),
          next: nextBestAction(signals),
        };
      });
    const all = byThread.flatMap((t) => t.signals);
    const openAll = all.filter((s) => !s.resolvedAt && !s.answeredLater);
    return {
      byThread,
      all,
      open: openAll,
      openCount: (threadId: string) =>
        byThread.find((t) => t.thread.id === threadId)?.open.length ?? 0,
      next: nextBestAction(all),
    };
  }, [threads, signalReviews, signalClassifications, teamNames]);
}
