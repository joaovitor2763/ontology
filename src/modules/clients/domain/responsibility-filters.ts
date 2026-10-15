import type { Allocation } from './allocation.ts';
import { currentAllocations } from './allocation-relations.ts';
import { enrollmentIsCurrent, type ProductEnrollment } from './product-enrollments.ts';

export const NO_RESPONSIBLE = '__none__';
export function matchesResponsible(ids: string[], selected: string[]) {
  return !selected.length || selected.some(id => id === NO_RESPONSIBLE ? !ids.length || ids.includes(id) : ids.includes(id));
}

/** Exact roles at each level. General responsibility never fills an unassigned purchase. */
export function responsibilityIndex(context: { clients: { slug: string }[]; allocations: Allocation[]; enrollments: ProductEnrollment[] }, today: string, productId?: string) {
  const current = currentAllocations(context, today).filter(row => row.role === 'responsavel');
  const client = new Map<string, string[]>(), product = new Map<string, string[]>();
  for (const row of current) if (!row.enrollmentId) client.set(row.company, [row.memberId]);
  for (const enrollment of context.enrollments.filter(row => enrollmentIsCurrent(row) && (!productId || row.productId === productId))) {
    const ids = current.filter(row => row.company === enrollment.company && row.enrollmentId === enrollment.id).map(row => row.memberId);
    product.set(enrollment.company, [...new Set([...(product.get(enrollment.company) ?? []), ...(ids.length ? ids : [NO_RESPONSIBLE])])]);
  }
  return { client, product };
}
