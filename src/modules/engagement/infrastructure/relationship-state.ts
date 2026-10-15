"use client";

import type { Thread, ThreadMessage } from "@/modules/engagement/domain/models";
import { threadsFor } from "@/modules/engagement/infrastructure/queries";
import { migrateInteractionTags } from "@/shared/infrastructure/migration";
import { useLocalStorageState } from "@/shared/infrastructure/useLocalStorageState";

const INITIAL = {
  notes: {} as Record<string, ThreadMessage[]>,
  spaces: [] as Thread[],
  read: [] as string[],
  /** Threads the user marked as unread again after reading. */
  unread: [] as string[],
  pinned: [] as string[],
};

export function useInboxState() {
  const [state, setState, error] = useLocalStorageState("ontology.relationship.v1", INITIAL);
  return [migrateInteractionTags(state), setState, error] as const;
}

export function threadUnread(
  thread: Pick<Thread, "id" | "unread">,
  state: { read: string[]; unread: string[] },
) {
  if (state.unread.includes(thread.id)) return Math.max(1, thread.unread);
  if (state.read.includes(thread.id)) return 0;
  return thread.unread;
}

export function useLiveThreads(slug?: string) {
  const [state] = useInboxState();
  return [...state.spaces, ...threadsFor()]
    .filter((thread) => !slug || thread.company === slug)
    .map((thread) => {
      const notes = state.notes[thread.id] ?? [];
      const latest = [...notes].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
      return {
        ...thread,
        unread: threadUnread(thread, state),
        lastAt: latest?.at ?? thread.lastAt,
        preview: latest?.text ?? thread.preview,
        messages: [...thread.messages, ...notes],
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
