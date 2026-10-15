import {
  events,
  meetings,
  threads,
} from "@/modules/engagement/infrastructure/seed";
export function meetingsFor(slug?: string) {
  return meetings
    .filter((m) => !slug || m.company === slug)
    .slice()
    .sort((a, b) => +new Date(b.startsAt) - +new Date(a.startsAt));
}

export function threadsFor(slug?: string) {
  return threads
    .filter((t) => !slug || t.company === slug)
    .slice()
    .sort((a, b) => +new Date(b.lastAt) - +new Date(a.lastAt));
}

export function eventsFor(
  slug?: string,
  extras?: import("@/modules/engagement/domain/models").ProgramEvent[],
) {
  return [...events, ...(extras ?? [])]
    .filter((e) => !slug || e.company === slug)
    .slice()
    .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
}

export function meetingById(id: string) {
  return meetings.find((m) => m.id === id);
}
