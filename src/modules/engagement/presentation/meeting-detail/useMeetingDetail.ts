"use client";
import { useMeetingContent } from "../useMeetingContent";
import { useMeetingGoogleSync } from "./useMeetingGoogleSync";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { useDocumentsState } from "@/modules/documents/infrastructure/state";
import { useServices } from "@/modules/delivery/presentation/state";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useStakeholders } from "@/modules/clients/infrastructure/stakeholders-state";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { documentsFor } from "@/modules/documents/infrastructure/queries";
import {
  interviewSummaryMissing,
  meetingPrepChecklist,
} from "@/modules/engagement/domain/meetings";
import { useLiveOntology } from "@/modules/knowledge/infrastructure/state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { NOW } from "@/shared/lib/format";

export type MeetingContent = ReturnType<typeof useMeetingContent>;
export type MeetingPerson = ReturnType<ReturnType<typeof useTeam>["resolve"]>;

/** Everything the meeting page reads and writes; the screen only composes the sections. */
export function useMeetingDetail(id: string) {
  const {
    meetingsIncludingRemoved,
    removedMeetingIds,
    allPains,
    allSolutions,
    allHypotheses,
    notes,
  } = useEngagementState();
  const m = meetingsIncludingRemoved.find((x) => x.id === id);
  const content = useMeetingContent(m);
  const updateMeeting = content.update;
  const { forCompany } = useStakeholders();
  const { resolve, active, me } = useTeam();
  const { clientBySlug } = useClientsState();
  const { extraDocs, removedDocs } = useDocumentsState();
  const liveOnt = useLiveOntology(m?.company ?? "");
  const { configFor, cycles } = useServices();
  const google = useMeetingGoogleSync(m);
  const { statusMap, extraTasks, taskPatches } = useDeliveryState();
  const linkedCycle = m?.cycleId
    ? cycles.find((cy) => cy.id === m.cycleId)
    : undefined;
  const linkedDelivery =
    m?.deliveryId && m
      ? deliveriesFor(m.company, statusMap, extraTasks, taskPatches).find(
          (d) => d.id === m.deliveryId,
        )
      : undefined;
  const ont = configFor(m?.company ?? "").modules.ontology ? liveOnt : undefined;

  if (!m) return { meeting: undefined, content, google } as const;

  const meeting = m;
  const attendee = (aid: string): MeetingPerson =>
    (forCompany(meeting.company).find((s) => s.id === aid) as
      | MeetingPerson
      | undefined) ?? resolve(aid);
  const prepItems = meetingPrepChecklist(meeting);

  function togglePrep(itemId: string) {
    const prep = { ...(meeting.prep ?? {}) };
    if (itemId === "homework") prep.homeworkDone = !prep.homeworkDone;
    else if (itemId === "preread") prep.preReadSent = !prep.preReadSent;
    else if (itemId === "rehearsal") prep.rehearsed = !prep.rehearsed;
    else return;
    updateMeeting({ ...meeting, prep }, null);
  }

  return {
    meeting,
    content,
    google,
    notes,
    removed: removedMeetingIds.includes(meeting.id),
    client: clientBySlug(meeting.company),
    concepts: (meeting.relatedNodeIds ?? [])
      .map((nid) => ont?.nodes.find((n) => n.id === nid))
      .filter((n): n is NonNullable<typeof n> => Boolean(n)),
    files: documentsFor(meeting.company, extraDocs, removedDocs).filter(
      (d) => d.relatedMeetingId === meeting.id,
    ),
    pains: allPains.filter(
      (p) => p.meetingId === meeting.id || meeting.painIds?.includes(p.id),
    ),
    solutions: allSolutions.filter(
      (s) => s.meetingId === meeting.id || meeting.solutionIds?.includes(s.id),
    ),
    companyPains: allPains.filter((p) => p.company === meeting.company),
    allSolutions,
    attendee,
    owners: [
      ...active,
      ...forCompany(meeting.company).filter((s) => s.active),
    ] as MeetingPerson[],
    me,
    upcoming: meeting.startsAt > NOW,
    prepItems,
    prepDone: prepItems.filter((i) => i.done).length,
    prepHypotheses: (meeting.prep?.hypothesisIds ?? [])
      .map((hid) => allHypotheses.find((h) => h.id === hid))
      .filter((h): h is NonNullable<typeof h> => Boolean(h)),
    summaryMissing: interviewSummaryMissing(meeting, NOW),
    tested: (meeting.hypothesisEvidence ?? []).map((ev) => ({
      ...ev,
      hypothesis: allHypotheses.find((h) => h.id === ev.hypothesisId),
    })),
    linkedCycle,
    linkedDelivery,
    togglePrep,
  };
}
