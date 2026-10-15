"use client";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import {
  can,
  normalizeAccess,
  type AccessLevel,
  type Action,
} from "@/modules/workspace/domain/permissions";
import { seesAllAlerts } from "@/modules/workspace/domain/alert-scope";
import { useTeam } from "@/modules/workspace/presentation/useTeam";

/**
 * `can(action, clientSlug?)` for the signed-in member. Client-scoped actions
 * count the responsible, the CS and everyone allocated to that client.
 */
export function usePermissions() {
  const { me } = useTeam();
  const { clientBySlug, assigned, allocationsFor } = useClientsState();
  const access: AccessLevel = normalizeAccess(me.access);
  function responsibleIds(slug?: string) {
    if (!slug) return [];
    const client = clientBySlug(slug);
    if (!client) return [];
    const { leadId, csId } = assigned(client);
    return [leadId, csId, ...allocationsFor(slug).map((a) => a.memberId)].filter(Boolean);
  }
  return {
    access,
    me,
    can: (action: Action, clientSlug?: string) =>
      can({ access, memberId: me.id }, action, { responsibleIds: responsibleIds(clientSlug) }),
    /** Responsável, CS ou equipe do cliente: a mesma lista que `can` consulta. */
    isAllocated: (clientSlug: string) => responsibleIds(clientSlug).includes(me.id),
    /** Admin e Gestor veem a fila global inteira; os demais, só os clientes alocados. */
    seesAllAlerts: seesAllAlerts({ access, memberId: me.id }),
  };
}
