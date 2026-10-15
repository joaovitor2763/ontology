import type { Allocation } from './allocation.ts';
import { enrollmentIsCurrent, type ProductEnrollment } from './product-enrollments.ts';

type Clients = {
  clients: { slug: string }[];
  enrollments: ProductEnrollment[];
  allocations: Allocation[];
};
const singularRoles = new Set(['responsavel', 'cs']);

export function currentAllocations(clients: Clients, today: string): Allocation[] {
  const activeClients = new Set(clients.clients.map(client => client.slug));
  const currentEnrollments = new Set(clients.enrollments
    .filter(enrollmentIsCurrent)
    .map(enrollment => enrollment.id));
  return clients.allocations.filter(allocation => activeClients.has(allocation.company)
    && (!allocation.from || allocation.from <= today)
    && (!allocation.to || allocation.to >= today)
    && (!allocation.enrollmentId || currentEnrollments.has(allocation.enrollmentId)));
}

/** A specific responsibility replaces the general one only for its enrollment. */
export function allocationsForEnrollment(rows: Allocation[], company: string, enrollmentId: string): Allocation[] {
  const inCompany = rows.filter(row => row.company === company);
  const overridden = new Set(inCompany
    .filter(row => row.enrollmentId === enrollmentId && singularRoles.has(row.role))
    .map(row => row.role));
  return inCompany.filter(row => row.enrollmentId === enrollmentId
    || (!row.enrollmentId && !overridden.has(row.role)));
}

/** Omit a general singular role when every current enrollment overrides it. */
export function effectiveClientAllocations(clients: Clients, rows: Allocation[]): Allocation[] {
  const enrollmentsByCompany = new Map<string, string[]>();
  for (const enrollment of clients.enrollments) {
    if (!enrollmentIsCurrent(enrollment)) continue;
    enrollmentsByCompany.set(enrollment.company, [...(enrollmentsByCompany.get(enrollment.company) ?? []), enrollment.id]);
  }
  const scoped = new Set(rows.filter(row => row.enrollmentId && singularRoles.has(row.role))
    .map(row => `${row.company}\u0000${row.enrollmentId}\u0000${row.role}`));
  return rows.filter(row => {
    if (row.enrollmentId || !singularRoles.has(row.role)) return true;
    const enrollments = enrollmentsByCompany.get(row.company) ?? [];
    return !enrollments.length || enrollments.some(id => !scoped.has(`${row.company}\u0000${id}\u0000${row.role}`));
  });
}
