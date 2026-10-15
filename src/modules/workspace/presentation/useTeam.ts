"use client";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { useMemo } from "react";
import { person } from "../infrastructure/queries";
import { people } from "../infrastructure/seed";
import { useWorkspaceState } from "../infrastructure/state";
import { initialsOf, type Person } from "../domain/models";
import { rosterMembers, sessionMemberOf } from "../domain/session-identity";
/** Internal team: seeded members with their edits plus members created here. */
export function useTeam() {
  const { extraMembers, memberEdits, deactivated, currentUserId } =
    useWorkspaceState();
  const { user } = useSyncStatus();
  const members = useMemo(
    () => rosterMembers(extraMembers, memberEdits, people),
    [extraMembers, memberEdits],
  );
  const resolve = (id: string) => members.find((p) => p.id === id) ?? person(id);
  // Behind the API the signed-in person is the member with the same e-mail.
  const sessionMember = sessionMemberOf(members, user?.email);
  // Publicado e ainda sem membro (roster chegando): a pessoa da sessão, sem
  // acesso de escrita, em vez do último membro gravado no documento.
  const sessionName = user?.name;
  const placeholder = useMemo<Person | null>(
    () =>
      sessionName === undefined
        ? null
        : { id: "", name: sessionName, role: "", org: "praxis", initials: initialsOf(sessionName), access: "leitor" },
    [sessionName],
  );
  const me =
    sessionMember ??
    (currentUserId || !placeholder ? resolve(currentUserId) : placeholder);
  return {
    members,
    active: members.filter((p) => !deactivated.has(p.id)),
    deactivated,
    resolve,
    me,
    session: user,
    isActive: (id: string) => !deactivated.has(id),
  };
}
