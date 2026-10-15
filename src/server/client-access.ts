import { projectClients, type ClientsSnapshot } from '../modules/clients/infrastructure/snapshot.ts';
import { requestScratch } from './operations/request-context.ts';

type AccessAllocation = { memberId: string; from?: string; to?: string };

/** Exact authorization inputs, grouped by client without carrying the client document. */
export function clientAccessRows(raw: unknown): Map<string, string> {
  const clients = projectClients((raw ?? {}) as Partial<ClientsSnapshot>);
  const rows = new Map<string, AccessAllocation[]>();
  for (const client of clients.allClients) rows.set(client.slug, []);
  for (const allocation of clients.allocations) {
    const entries = rows.get(allocation.company) ?? [];
    entries.push({ memberId: allocation.memberId,
      ...(allocation.from ? { from: allocation.from } : {}),
      ...(allocation.to ? { to: allocation.to } : {}) });
    rows.set(allocation.company, entries);
  }
  return new Map([...rows].map(([company, entries]) => [company, JSON.stringify(entries)]));
}

/** Null means the projection is unavailable or behind the authoritative document. */
export function readClientAccess(
  db: D1Database, workspace: string, company: string | undefined, today: string,
): Promise<{ responsibleIds: string[]; version: number } | null> {
  // Uma leitura por requisição e por cliente: a pré-carga (`prefetchClientAccess`)
  // e a autorização que vem depois compartilham a mesma ida.
  const scratch = requestScratch(db), key = `client-access ${workspace}\u0000${company ?? ''}\u0000${today}`;
  const running = scratch?.get(key) as ReturnType<typeof readClientAccess> | undefined;
  if (running) return running;
  const work = queryClientAccess(db, workspace, company, today);
  scratch?.set(key, work);
  return work;
}

/**
 * Adianta a leitura da projeção de acesso que `authorizeOperation` fará, em
 * paralelo com a sessão e o roster. Não decide nada: a autorização continua
 * depois, com a mesma linha.
 */
export function prefetchClientAccess(db: D1Database, workspace: string, company?: string) {
  if (!requestScratch(db)) return;
  readClientAccess(db, workspace, company, accessDay()).catch(() => undefined);
}

/** A data de São Paulo que a autorização usa para alocações vigentes. */
export function accessDay(at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

async function queryClientAccess(
  db: D1Database, workspace: string, company: string | undefined, today: string,
): Promise<{ responsibleIds: string[]; version: number } | null> {
  const row = await db.prepare(`SELECT m.source_clients_version,a.body
    FROM client_access_meta m
    JOIN state_documents d ON d.workspace_id=m.workspace_id
      AND d.key='ontology.clients.v3' AND d.version=m.source_clients_version
    LEFT JOIN client_access_allocations a ON a.workspace_id=m.workspace_id
      AND a.generation=m.generation AND a.company=?
    WHERE m.workspace_id=?`).bind(company ?? null, workspace)
    .first<{ source_clients_version: number; body: string | null }>();
  if (!row) return null;
  let allocations: AccessAllocation[];
  try {
    const parsed: unknown = row.body ? JSON.parse(row.body) : [];
    if (!Array.isArray(parsed) || parsed.some(a => !a || typeof a !== 'object' ||
      typeof a.memberId !== 'string' || (a.from !== undefined && typeof a.from !== 'string') ||
      (a.to !== undefined && typeof a.to !== 'string'))) return null;
    allocations = parsed as AccessAllocation[];
  } catch { return null; }
  return { version: row.source_clients_version,
    responsibleIds: allocations.filter(a => (!a.from || a.from <= today) && (!a.to || a.to >= today))
      .map(a => a.memberId) };
}
