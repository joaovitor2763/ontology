import { assignedFrom, type Allocation } from "../domain/allocation.ts";
import { companies } from "./seed.ts";

/** Seed lookup for contexts without React. Screens use `useClientsState().clientBySlug`. */
export function company(slug: string) {
  return companies.find((c) => c.slug === slug);
}

export function companyName(slug: string) {
  return company(slug)?.name ?? slug;
}

export function assigned(
  c: { slug: string; leadId: string; csId: string },
  allocations?: Allocation[],
) {
  return allocations
    ? assignedFrom(allocations, c.slug, c)
    : { leadId: c.leadId, csId: c.csId };
}
