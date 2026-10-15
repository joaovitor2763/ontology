import {
  authorizeStateRead,
  authorizeStateWrite,
  normalizeAccess,
  WORKSPACE_GUARDED_FIELDS,
} from "../modules/workspace/domain/permissions.ts";
import { getDoc } from "./db.ts";
import { workspaceDocument } from "./operations/request-context.ts";

/**
 * The roster lives in the workspace document (members created in the app,
 * with their edits and deactivations). The server reads it to know who the
 * signed-in e-mail is and what they may change. Seeded demo members have no
 * e-mail, so they never match a real session.
 */
type Roster = {
  extraMembers?: { id: string; email?: string; access?: string }[];
  memberEdits?: Record<string, { email?: string; access?: string }>;
  deactivatedIds?: string[];
};

export type ResolvedMember = { id: string; access?: string; active: boolean };

export async function resolveMember(
  db: D1Database,
  workspace: string,
  email: string,
): Promise<{ member: ResolvedMember | null; bootstrap: boolean }> {
  return memberOfRoster((await workspaceDocument(db, workspace)).doc?.value, email);
}

/** Decide sobre o roster já lido, sem tocar no banco. */
export function memberOfRoster(
  value: unknown,
  email: string,
): { member: ResolvedMember | null; bootstrap: boolean } {
  const roster = (value ?? {}) as Roster;
  const members = (roster.extraMembers ?? []).map((m) => ({
    ...m,
    ...(roster.memberEdits?.[m.id] ?? {}),
  }));
  // Bootstrap lasts until the roster has an admin: the first real person promotes themselves.
  const bootstrap = !members.some((m) => normalizeAccess(m.access) === "admin");
  const wanted = email.toLowerCase();
  const found = members.find((m) => (m.email ?? "").toLowerCase() === wanted);
  if (!found) return { member: null, bootstrap };
  return {
    member: {
      id: found.id,
      access: found.access,
      active: !(roster.deactivatedIds ?? []).includes(found.id),
    },
    bootstrap,
  };
}

function guardedSlice(value: unknown) {
  const doc = (value ?? {}) as Record<string, unknown>;
  return JSON.stringify(WORKSPACE_GUARDED_FIELDS.map((field) => doc[field] ?? null));
}

export async function canReadState(db: D1Database, workspace: string, email: string, key: string) {
  const { member, bootstrap } = await resolveMember(db, workspace, email);
  return authorizeStateRead({ member, bootstrap, key });
}

export async function canWriteState(
  db: D1Database,
  workspace: string,
  email: string,
  key: string,
  next: unknown,
) {
  const { member, bootstrap } = await resolveMember(db, workspace, email);
  let guardedChanged = false;
  if (key.startsWith("ontology.workspace.")) {
    const current = await getDoc(db, workspace, key);
    guardedChanged = guardedSlice(current?.value) !== guardedSlice(next);
  }
  return authorizeStateWrite({ member, bootstrap, key, guardedChanged });
}
