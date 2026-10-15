import { upsertAllocation, type Allocation } from './allocation.ts';
import { enrollmentIsCurrent, type ProductEnrollment } from './product-enrollments.ts';

/** Client and purchase responsibilities are independent; task owners are never changed. */
export function setClientResponsible(
  allocations: Allocation[],
  enrollments: ProductEnrollment[],
  input: { company: string; memberId: string | null; enrollmentId?: string },
  at: string,
  today: string,
): Allocation[] {
  if (input.enrollmentId && !enrollments.some(row => row.id === input.enrollmentId
    && row.company === input.company && enrollmentIsCurrent(row)))
    throw new Error('Escolha uma contratação atual deste cliente.');
  const inScope = (row: Allocation) => row.company === input.company && row.role === 'responsavel'
    && row.enrollmentId === input.enrollmentId;
  if (input.memberId === null) return allocations.filter(row => !inScope(row));
  const old = allocations.find(inScope);
  const active = old && (!old.from || old.from <= today) && (!old.to || old.to >= today);
  if (old?.memberId === input.memberId && active) return allocations;
  return upsertAllocation(allocations, {
    id: old?.id ?? `alloc-responsavel-${crypto.randomUUID()}`,
    company: input.company, memberId: input.memberId, role: 'responsavel',
    ...(input.enrollmentId ? { enrollmentId: input.enrollmentId } : {}),
    percent: old?.percent ?? 30, from: today, createdAt: old?.createdAt ?? at, updatedAt: at,
  });
}
