import { zApiGroup } from "./z-api.ts";
import { projectClients, type ClientsSnapshot } from "../modules/clients/infrastructure/snapshot.ts";
import { getDoc } from "./db.ts";
import { resolveMember } from "./authz.ts";
import {
  can,
  normalizeAccess,
  type Action,
} from "../modules/workspace/domain/permissions.ts";
import {
  whatsappGroupOf,
  type ServiceConfig,
} from "../modules/clients/domain/service-config.ts";
export type ClientContext = {
  configs?: Record<string, ServiceConfig>;
  archivedClients?: string[];
  enrollments?: {
    company: string;
    startsAt?: string;
    status?: string;
    archivedAt?: string;
  }[];
  allocations?: {
    company: string;
    memberId: string;
    from?: string;
    to?: string;
  }[];
};
export async function clientsContext(db: D1Database, workspace: string) {
  return ((await getDoc(db, workspace, "ontology.clients.v3"))?.value ??
    {}) as ClientContext;
}
export async function insightPermission(
  db: D1Database,
  workspace: string,
  email: string,
  company: string,
  action: Action,
) {
  const { member, bootstrap } = await resolveMember(db, workspace, email);
  if (bootstrap) return true; // authenticate already restricts Google bootstrap to its designated email.
  if (!member?.active) return false;
  const clients = await clientsContext(db, workspace);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const responsibleIds = projectClients(clients as Partial<ClientsSnapshot>).allocations
    .filter(
      (a) =>
        a.company === company &&
        (!a.from || a.from <= today) &&
        (!a.to || a.to >= today),
    )
    .map((a) => a.memberId);
  return can(
    { access: normalizeAccess(member.access), memberId: member.id },
    action,
    { responsibleIds },
  );
}
export async function configuredGroup(
  db: D1Database,
  workspace: string,
  company: string,
): Promise<{id?:string;name?:string}|null> {
  const clients = await clientsContext(db, workspace);
  if (clients.archivedClients?.includes(company)) return null;
  return await zApiGroup(db, workspace, company) ?? whatsappGroupOf(clients.configs?.[company] ?? {});
}
export function groupKey(group: { id?: string; name?: string }) {
  return group.id ? `id:${group.id}` : `name:${group.name}`;
}
