"use client";
import {
  accessHint,
  accessLabel,
  type AccessLevel,
} from "@/modules/workspace/domain/permissions";
import { initialsOf } from "@/modules/workspace/domain/models";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { formatDateTime } from "@/shared/lib/format";
import { Select } from "@/shared/ui/Select";
import { Avatar, Button } from "@/shared/ui/primitives";
import { UserRoundCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { MemberOperationFeedback, useMemberOperation } from "./useMemberOperation";

type SignedIn = { email: string; name: string; lastSeenAt: string | null };

/** People who signed in but are not members yet; an admin approves them with a level. */
export function PendingSignIns() {
  const operation = useMemberOperation();
  const { mode, hydrated } = useSyncStatus();
  const { can } = usePermissions();
  const { members } = useTeam();
  const { addMember } = useWorkspaceState();
  const [users, setUsers] = useState<SignedIn[]>([]);
  const [levels, setLevels] = useState<Record<string, AccessLevel>>({});
  // Uma leitura por tela, depois de o roster hidratar: antes disso `members`
  // ainda é o padrão e a lista de pendentes sairia errada e seria refeita.
  useEffect(() => {
    if (mode !== "remote" || !hydrated) return;
    let alive = true;
    fetch("/api/users", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ users: SignedIn[] }>) : { users: [] }))
      .then((body) => {
        if (alive) setUsers(Array.isArray(body.users)?body.users:[]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mode, hydrated]);
  if (mode !== "remote" || !can("equipe.gerenciar")) return null;
  const pending = users.filter(
    (u) => !members.some((m) => m.email?.toLowerCase() === u.email.toLowerCase()),
  );
  if (!pending.length && !operation.pending) return null;
  function approve(u: SignedIn) {
    const access = levels[u.email] ?? "ai_master";
    void operation.run("members.approve",{email:u.email,access},()=>addMember({
      id: `member-${u.email.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: u.name || u.email,
      email: u.email,
      role: access === "leitor" ? "Visualização" : access === "gestor" ? "Gestão" : "AI Master",
      org: "praxis",
      initials: initialsOf(u.name || u.email),
      access,
      capacityHoursWeek: 40,
    }),()=>setUsers(users=>users.filter(user=>user.email!==u.email)));
  }
  return (
    <section
      aria-label="Aguardando aprovação"
      className="mb-6 rounded-2xl border border-amber/30 bg-amber-soft/30 p-4"
    >
      <p className="inline-flex items-center gap-2 text-[13px] font-medium text-amber">
        <UserRoundCheck className="h-3.5 w-3.5" />
        Aguardando aprovação · {pending.length}
      </p>
      <p className="mt-1 text-[12.5px] text-muted">
        Entraram com a conta da empresa e ainda não têm nível de acesso. Escolha o
        nível e aprove; a pessoa passa a ver o workspace na hora.
      </p>
      <MemberOperationFeedback operation={operation}/>
      <fieldset disabled={operation.pending}>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
        {pending.map((u) => (
          <li key={u.email} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Avatar initials={initialsOf(u.name || u.email)} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">{u.name || u.email}</span>
              <span className="block truncate text-[12px] text-muted">
                {u.email}
                {u.lastSeenAt ? ` · entrou ${formatDateTime(u.lastSeenAt)}` : ""}
              </span>
            </span>
            <Select
              label={`Nível de ${u.email}`}
              size="compact"
              value={levels[u.email] ?? "ai_master"}
              onValueChange={(value) => setLevels((l) => ({ ...l, [u.email]: value as AccessLevel }))}
              options={(Object.keys(accessLabel) as AccessLevel[]).map((level) => ({
                value: level,
                label: accessLabel[level],
                description: accessHint[level],
              }))}
            />
            <Button size="sm" disabled={operation.busy} onClick={() => approve(u)}>
              {operation.busy ? "Aprovando…" : "Aprovar"}
            </Button>
          </li>
        ))}
      </ul>
      </fieldset>
    </section>
  );
}
