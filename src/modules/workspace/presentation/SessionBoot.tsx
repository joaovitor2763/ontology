"use client";
import { initialsOf } from "@/modules/workspace/domain/models";
import { sessionBootStep } from "@/modules/workspace/domain/session-identity";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { useEffect, useRef } from "react";

/**
 * Primeiro acesso publicado: cria o administrador de um workspace vazio ou
 * promove o membro da sessão quando ainda não há admin. Não grava o membro
 * atual: publicado, ele vem da sessão (`useWorkspaceState().currentUserId`), e
 * o documento do workspace é compartilhado por toda a equipe. Roda só atrás
 * da API.
 */
export function SessionBoot() {
  const { mode, resolved, hydrated, user } = useSyncStatus();
  const { members } = useTeam();
  const { addMember, updateMember } = useWorkspaceState();
  const joined = useRef(false);
  useEffect(() => {
    if (mode !== "remote" || !resolved || !hydrated || !user || joined.current)
      return;
    joined.current = true;
    const step = sessionBootStep(members, user.email);
    if (step.kind === "promote") updateMember({ ...step.member, access: "admin" });
    else if (step.kind === "create")
      addMember({
        id: step.id,
        name: user.name,
        email: user.email,
        role: "Admin da plataforma",
        org: "praxis",
        initials: initialsOf(user.name),
        access: "admin",
        capacityHoursWeek: 40,
      });
  }, [mode, resolved, hydrated, user, members, addMember, updateMember]);
  return null;
}
