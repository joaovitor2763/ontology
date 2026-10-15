"use client";
import { useState } from "react";
import { useGoogleStatus } from "@/shared/infrastructure/google";
import { useMeetArtifacts } from "../useMeetArtifacts";
import type { Meeting } from "@/modules/engagement/domain/models";

/** Recording, transcript and invitation answers of one meeting, with their own retry state. */
export function useMeetingGoogleSync(meeting: Meeting | undefined) {
  const status = useGoogleStatus();
  const {
    pullArtifacts: pullMeetArtifacts,
    pullResponses,
    resetResponses,
    resetArtifacts,
  } = useMeetArtifacts();
  const [pulling, setPulling] = useState(false);
  const [artifactNote, setArtifactNote] = useState("");
  const [artifactFailed, setArtifactFailed] = useState(false);
  const [refreshingResponses, setRefreshingResponses] = useState(false);
  const [responsesError, setResponsesError] = useState("");
  async function pullArtifacts() {
    if (!meeting?.google?.meetLink) return;
    setPulling(true);
    setArtifactNote("");
    setArtifactFailed(false);
    try {
      const { note } = await pullMeetArtifacts(meeting);
      setArtifactNote(note);
    } catch (failure) {
      setArtifactFailed(true);
      setArtifactNote(
        failure instanceof Error
          ? failure.message
          : "Não foi possível buscar os artefatos.",
      );
    } finally {
      setPulling(false);
    }
  }
  async function refreshResponses() {
    if (!meeting?.google?.eventId) return;
    setRefreshingResponses(true);
    setResponsesError("");
    try {
      await pullResponses(meeting);
    } catch (error) {
      setResponsesError(
        error instanceof Error
          ? error.message
          : "Não foi possível confirmar as respostas. Tente novamente.",
      );
    } finally {
      setRefreshingResponses(false);
    }
  }
  return {
    status,
    pulling,
    artifactNote,
    artifactFailed,
    pullArtifacts,
    resetArtifacts,
    clearArtifactNote: () => {
      setArtifactFailed(false);
      setArtifactNote("");
    },
    refreshingResponses,
    responsesError,
    refreshResponses,
    resetResponses,
    clearResponsesError: () => setResponsesError(""),
  };
}

export type MeetingGoogleSync = ReturnType<typeof useMeetingGoogleSync>;
