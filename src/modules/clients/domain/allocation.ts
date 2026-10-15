/**
 * Allocation links one team member to one client with a role and a dedication.
 * An optional enrollment scopes the work to one contracted product. Access is
 * still decided by the member's workspace level plus their client allocation.
 * "responsavel" and "cs" keep their historical identifiers for compatibility.
 */
export type AllocationRole = string;

export type AllocationRoleDefinition = {
  id: string;
  label: string;
};

export const systemAllocationRoleLabels: Record<string, string> = {
  responsavel: "Responsável",
  cs: "CX",
  gestor: "Gestor",
  consultor: "Consultor",
  analista: "Analista",
};

/** Kept for older call sites and documents that use the built-in role ids. */
export const allocationRoleLabel = systemAllocationRoleLabels;

export const allocationRoles = Object.keys(systemAllocationRoleLabels);

export function allocationRoleOptions(
  custom: AllocationRoleDefinition[] = [],
): AllocationRoleDefinition[] {
  const system = allocationRoles.map((id) => ({
    id,
    label: systemAllocationRoleLabels[id],
  }));
  return [
    ...system,
    ...custom.filter(
      (role, index) =>
        !systemAllocationRoleLabels[role.id] &&
        custom.findIndex((candidate) => candidate.id === role.id) === index,
    ),
  ];
}

export function allocationRoleName(
  role: string,
  custom: AllocationRoleDefinition[] = [],
) {
  return (
    systemAllocationRoleLabels[role] ??
    custom.find((candidate) => candidate.id === role)?.label ??
    role
  );
}

export type Allocation = {
  id: string;
  company: string;
  memberId: string;
  role: AllocationRole;
  /** Missing means that the member acts across the whole client. */
  enrollmentId?: string;
  /** Share of the member's weekly capacity dedicated to this client, 0–100. */
  percent: number;
  from?: string;
  to?: string;
  createdAt?: string;
  updatedAt?: string;
};

export function allocationsFor(all: Allocation[], company: string) {
  return all.filter((a) => a.company === company);
}

/** General client team plus people explicitly allocated to this purchase. */
export function allocationsForEnrollment(
  all: Allocation[],
  company: string,
  enrollmentId: string,
) {
  return all.filter(
    (allocation) =>
      allocation.company === company &&
      (!allocation.enrollmentId || allocation.enrollmentId === enrollmentId),
  );
}

/** One member holds each of the singular roles per client. */
export function assignedFrom(
  all: Allocation[],
  company: string,
  fallback: { leadId: string; csId: string },
) {
  const rows = allocationsFor(all, company).filter((a) => !a.enrollmentId);
  return {
    leadId: rows.find((a) => a.role === "responsavel")?.memberId ?? fallback.leadId,
    csId: rows.find((a) => a.role === "cs")?.memberId ?? fallback.csId,
  };
}

export function upsertAllocation(
  all: Allocation[],
  next: Allocation,
): Allocation[] {
  const singular = next.role === "responsavel" || next.role === "cs";
  const sameScope = (allocation: Allocation) =>
    (allocation.enrollmentId ?? "") === (next.enrollmentId ?? "");
  return [
    ...all.filter(
      (a) =>
        a.id !== next.id &&
        !(
          singular &&
          a.company === next.company &&
          a.role === next.role &&
          sameScope(a)
        ) &&
        !(
          a.company === next.company &&
          a.memberId === next.memberId &&
          a.role === next.role &&
          sameScope(a)
        ),
    ),
    next,
  ];
}

export function removeAllocation(all: Allocation[], id: string) {
  return all.filter((a) => a.id !== id);
}

export function allocationError(next: Allocation) {
  if (!next.memberId) return "Escolha um membro da equipe.";
  if (!next.company) return "Escolha um cliente.";
  if (!next.role.trim()) return "Escolha um papel na equipe.";
  if (
    !Number.isFinite(next.percent) ||
    next.percent < 0 ||
    next.percent > 100
  )
    return "A dedicação deve ficar entre 0% e 100%.";
  if (next.from && next.to && next.to < next.from)
    return "O término precisa ser igual ou posterior ao início.";
  return null;
}

/** Total dedication per member across clients, compared with weekly capacity. */
export function memberLoad(
  all: Allocation[],
  memberId: string,
  capacityHoursWeek?: number,
) {
  const rows = all.filter((a) => a.memberId === memberId);
  const percent = rows.reduce((s, a) => s + a.percent, 0);
  const hours =
    capacityHoursWeek != null
      ? Math.round((capacityHoursWeek * percent) / 100)
      : null;
  return {
    rows,
    clients: new Set(rows.map((a) => a.company)).size,
    percent,
    hours,
    capacity: capacityHoursWeek ?? null,
    over: percent > 100,
  };
}

/** Seed lead/cs pairs and legacy assignment pairs become explicit allocations. */
export function seedAllocations(
  clients: { slug: string; leadId: string; csId: string }[],
  assignments: Record<string, { leadId: string; csId: string }>,
): Allocation[] {
  return clients.flatMap((c) => {
    const pair = assignments[c.slug] ?? { leadId: c.leadId, csId: c.csId };
    const rows: Allocation[] = [
      {
        id: `alloc-${c.slug}-responsavel`,
        company: c.slug,
        memberId: pair.leadId,
        role: "responsavel",
        percent: 30,
      },
    ];
    if (pair.csId && pair.csId !== pair.leadId)
      rows.push({
        id: `alloc-${c.slug}-cs`,
        company: c.slug,
        memberId: pair.csId,
        role: "cs",
        percent: 10,
      });
    return rows;
  });
}
