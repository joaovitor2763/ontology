"use client";
import { InsightsPanel } from "../InsightsPanel";
import { SummarySection } from "./SummarySection";
import { DecisionsSection } from "./DecisionsSection";
import { PainsSection, SolutionsSection } from "./DiagnosisSections";
import { InterviewSummarySection } from "./InterviewSummarySection";
import { CommitmentSection } from "./CommitmentSection";
import { TestedHypothesesSection } from "./TestedHypothesesSection";
import { ActionsSection } from "./ActionsSection";
import { NotesSection } from "./NotesSection";
import type { MeetingDetailView } from "./MeetingSidebar";

export function MeetingDetailMain({
  detail,
  onRemoveAction,
}: {
  detail: MeetingDetailView;
  onRemoveAction: (actionId: string | undefined) => void;
}) {
  const {
    meeting,
    content,
    notes,
    pains,
    solutions,
    companyPains,
    allSolutions,
    summaryMissing,
    tested,
    upcoming,
    attendee,
    owners,
    me,
    client,
  } = detail;
  return (
    <div className="min-w-0 space-y-7">
      <SummarySection meeting={meeting} content={content} />
      <InsightsPanel company={meeting.company} meeting={meeting.id} />
      <DecisionsSection meeting={meeting} content={content} />
      <PainsSection
        company={meeting.company}
        pains={pains}
        solutions={allSolutions}
      />
      <SolutionsSection solutions={solutions} companyPains={companyPains} />
      {meeting.kind === "entrevista" && !upcoming && (
        <InterviewSummarySection
          meeting={meeting}
          content={content}
          summaryMissing={summaryMissing}
        />
      )}
      {meeting.kind === "apresentacao" && !upcoming && (
        <CommitmentSection meeting={meeting} content={content} />
      )}
      {tested.length > 0 && (
        <TestedHypothesesSection company={meeting.company} tested={tested} />
      )}
      <ActionsSection
        meeting={meeting}
        content={content}
        attendee={attendee}
        owners={owners}
        meId={me.id}
        tint={client?.tint}
        onRemoveAction={onRemoveAction}
      />
      <NotesSection meeting={meeting} content={content} notes={notes} />
    </div>
  );
}
