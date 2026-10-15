import { can, type Actor } from "./permissions.ts";

/**
 * De quem é a fila global de alertas. Admin da plataforma e Gestor de IA
 * respondem por todos os clientes e veem a fila inteira; AI Master e
 * Visualização veem só os alertas dos clientes em que estão alocados
 * (responsável, CS ou equipe). A regra sai da matriz: quem pode dar ciência
 * sem estar alocado vê tudo. A visão de um cliente (navegação explícita)
 * continua mostrando os alertas daquele cliente para todos.
 */
export function seesAllAlerts(actor: Actor): boolean {
  return can(actor, "alertas.ciencia", { responsibleIds: [] });
}

export type AllocationWindow = { company: string; memberId: string; from?: string; to?: string };

/** Clientes em que o membro está alocado hoje; mesma janela da autorização do servidor. */
export function allocatedCompanies(memberId: string, allocations: readonly AllocationWindow[],
  today: string): Set<string> {
  return new Set(allocations.filter(a => a.memberId === memberId &&
    (!a.from || a.from <= today) && (!a.to || a.to >= today)).map(a => a.company));
}

/** `null` quando a pessoa vê a fila inteira; senão, os clientes que entram na fila dela. */
export function alertQueueCompanies(actor: Actor, allocations: readonly AllocationWindow[],
  today: string): Set<string> | null {
  return seesAllAlerts(actor) ? null : allocatedCompanies(actor.memberId, allocations, today);
}
