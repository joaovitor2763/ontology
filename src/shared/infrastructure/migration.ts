import { clearableTaskFields, type TaskOverride } from "../../modules/delivery/domain/task-overrides.ts";
import { compactHistory } from "../../modules/delivery/domain/history.ts";
import { normalizeInteractionTags } from "../../modules/engagement/domain/interaction-tags.ts";
import { workspaceDate } from "../lib/format.ts";
import {
  normalizeAllocationRoles,
  normalizeMemberRoles,
} from "../../modules/workspace/domain/models.ts";
import {
  normalizeContactPoints,
  type ContactPointOwner,
} from "../lib/contact-points.ts";
/** New relationships start empty; a product list is not evidence of a dated purchase. */
export function migrateClientEnrollments<T extends object>(state: T): T & {
  enrollments: import("../../modules/clients/domain/product-enrollments.ts").ProductEnrollment[];
  participations: import("../../modules/clients/domain/product-stakeholders.ts").ProductStakeholderParticipation[];
} {
  const existing = state as T & { enrollments?: import("../../modules/clients/domain/product-enrollments.ts").ProductEnrollment[]; participations?: import("../../modules/clients/domain/product-stakeholders.ts").ProductStakeholderParticipation[] };
  return {
    ...state,
    enrollments: (existing.enrollments ?? []).map((enrollment) => ({
      ...enrollment,
      milestoneHistory: enrollment.milestoneHistory ?? [],
      lifecycleHistory: enrollment.lifecycleHistory ?? [],
    })),
    participations: existing.participations ?? [],
  };
}

/** Missing scope is the historical, client-wide allocation. Empty strings are normalized away. */
export function migrateAllocationScopes<T extends { allocations?: import("../../modules/clients/domain/allocation.ts").Allocation[] }>(state: T): T {
  if (!state.allocations?.some(allocation => allocation.enrollmentId === "")) return state;
  return {
    ...state,
    allocations: state.allocations.map(allocation => {
      if (allocation.enrollmentId !== "") return allocation;
      const next = { ...allocation };
      delete next.enrollmentId;
      return next;
    }),
  };
}
/** Copies only fields owned by the target repository. Legacy records remain untouched. */
export function mergeLegacy<T extends object>(
  initial: T,
  sources: unknown[],
): T {
  const next = { ...initial };
  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source))
      continue;
    for (const key of Object.keys(initial) as (keyof T)[]) {
      const value = (source as T)[key];
      const fallback = initial[key];
      const valid = Array.isArray(fallback)
        ? Array.isArray(value)
        : value !== null &&
          typeof value === typeof fallback &&
          !Array.isArray(value);
      if (valid) next[key] = value;
    }
  }
  return next;
}
export function migrateLegacy<T extends object>(initial: T, keys: string[]): T {
  return mergeLegacy(
    initial,
    keys.map((key) => {
      const raw = localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    }),
  );
}

/** Missing clear markers are legacy overrides; explicit clears survive JSON reloads. */
export function migrateTaskClears<T extends { taskPatches: Record<string, TaskOverride> }>(state: T): T {
  let changed = false;
  const taskPatches = Object.fromEntries(Object.entries(state.taskPatches).map(([id, patch]) => {
    const clearedFields = (patch.clearedFields ?? []).filter(field => clearableTaskFields.includes(field) && patch[field] === undefined);
    const next = { ...patch };
    if (clearedFields.length) next.clearedFields = clearedFields;
    else delete next.clearedFields;
    if (JSON.stringify(patch) === JSON.stringify(next)) return [id, patch];
    changed = true; return [id, next];
  }));
  return changed ? { ...state, taskPatches } : state;
}

/** Legacy deliveries had only a deadline. Adopt the containing cycle's start lazily. */
export function migrateDeliveryDates<
  T extends {
    extraTasks: { id: string; startsAt?: string; dueAt: string }[];
    extraCycles: { taskIds: string[]; startsAt: string }[];
    taskPatches: Record<string, { startsAt?: string; dueAt?: string }>;
  },
>(state: T): T {
  let changed = false;
  const extraTasks = state.extraTasks.map((task) => {
    if (task.startsAt || state.taskPatches[task.id]?.startsAt || (state.taskPatches[task.id] as TaskOverride | undefined)?.clearedFields?.includes("startsAt")) return task;
    const due = state.taskPatches[task.id]?.dueAt ?? task.dueAt;
    // A Backlog task has no deadline to adopt; it stays without start too.
    if (!due) return task;
    changed = true;
    const start =
      state.extraCycles.find((c) => c.taskIds.includes(task.id))?.startsAt ??
      due;
    return { ...task, startsAt: start < due ? start : due };
  });
  return changed ? { ...state, extraTasks } : state;
}

function sameValues(left: string[] | undefined, right: string[]) {
  return Boolean(left && left.length === right.length && left.every((value, index) => value === right[index]));
}

/** Older member records had only singular contact fields. Preserve every other field. */
export function migrateMemberPhones<
  T extends {
    extraMembers: ContactPointOwner[];
    memberEdits?: Record<string, Partial<ContactPointOwner>>;
  },
>(state: T): T {
  let changed = false;
  const extraMembers = state.extraMembers.map((member) => {
    const next = normalizeContactPoints(member);
    if (member.email !== next.email || member.phone !== next.phone || !sameValues(member.emails, next.emails) || !sameValues(member.phones, next.phones)) changed = true;
    return next;
  });
  const memberEdits = Object.fromEntries(
    Object.entries(state.memberEdits ?? {}).map(([id, edit]) => {
      const next = { ...edit };
      const hasEmail = Object.hasOwn(edit, "email") || Object.hasOwn(edit, "emails");
      const hasPhone = Object.hasOwn(edit, "phone") || Object.hasOwn(edit, "phones");
      if (hasEmail) {
        const emails = normalizeContactPoints({ id, email: edit.email, emails: edit.emails }).emails;
        next.email = emails[0] ?? "";
        next.emails = emails;
      }
      if (hasPhone) {
        const phones = normalizeContactPoints({ id, phone: edit.phone, phones: edit.phones }).phones;
        next.phone = phones[0] ?? "";
        next.phones = phones;
      }
      if ((hasEmail && (!sameValues(edit.emails, next.emails ?? []) || edit.email !== next.email)) || (hasPhone && (!sameValues(edit.phones, next.phones ?? []) || edit.phone !== next.phone))) changed = true;
      return [id, next];
    }),
  );
  if (!changed) return state;
  return {
    ...state,
    extraMembers,
    ...(state.memberEdits ? { memberEdits } : {}),
  };
}

/** Stakeholder documents retain their key and gain canonical arrays lazily. */
export function migrateStakeholderContacts<
  T extends { contacts: ContactPointOwner[] },
>(state: T): T {
  let changed = false;
  const contacts = state.contacts.map((contact) => {
    const next = normalizeContactPoints(contact);
    if (contact.email !== next.email || contact.phone !== next.phone || !sameValues(contact.emails, next.emails) || !sameValues(contact.phones, next.phones)) changed = true;
    return next;
  });
  return changed ? { ...state, contacts } : state;
}

/** Existing workspaces start with only the built-in cargos and allocation roles. */
export function migrateRoleCatalogs<T extends object>(state: T): T & {
  memberRoles: string[];
  allocationRoles: import("../../modules/workspace/domain/models.ts").NamedRole[];
} {
  const current = state as T & {
    memberRoles?: unknown;
    allocationRoles?: unknown;
  };
  return {
    ...state,
    memberRoles: normalizeMemberRoles(current.memberRoles),
    allocationRoles: normalizeAllocationRoles(current.allocationRoles),
  };
}

/** Old product templates become one milestone per cycle without rewriting client execution. */
export function migrateProductMilestones<
  T extends {
    productEdits: Record<
      string,
      import("../../modules/catalog/domain/products").Product
    >;
    extraProducts: import("../../modules/catalog/domain/products").Product[];
  },
>(state: T): T {
  const migrate = (
    product: import("../../modules/catalog/domain/products").Product,
  ) => ({
    ...product,
    cycles: product.cycles.map((c) => ({
      ...c,
      milestones: c.milestones?.length
        ? c.milestones
        : [{ id: "resultado", name: c.name }],
      deliveries: c.deliveries.map((d) => ({
        ...d,
        milestoneId: d.milestoneId ?? c.milestones?.[0]?.id ?? "resultado",
      })),
    })),
  });
  return {
    ...state,
    productEdits: Object.fromEntries(
      Object.entries(state.productEdits).map(([id, p]) => [id, migrate(p)]),
    ),
    extraProducts: state.extraProducts.map(migrate),
  };
}

/** Client-specific product plans live with execution, not in the shared catalogue. */
export function migrateExecutionPlans<
  T extends {
    productPlans?: Record<
      string,
      import("../../modules/catalog/domain/models").JourneyTemplate
    >;
  },
>(state: T) {
  return state.productPlans
    ? (state as T & { productPlans: NonNullable<T["productPlans"]> })
    : { ...state, productPlans: {} };
}

/** Known legacy Google organizers are retained; never guess from participant order. */
export function migrateMeetingOrganizers<T extends {
  extraMeetings: import("../../modules/engagement/domain/models").Meeting[];
  meetingEdits: Record<string, import("../../modules/engagement/domain/models").Meeting>;
}>(state: T): T {
  const migrate = (meeting: T["extraMeetings"][number]) => ({
    ...meeting,
    tags: normalizeInteractionTags(meeting.tags),
    ...(!meeting.organizerEmail && meeting.google?.organizer ? { organizerEmail: meeting.google.organizer } : {}),
  });
  return { ...state, extraMeetings: state.extraMeetings.map(migrate),
    meetingEdits: Object.fromEntries(Object.entries(state.meetingEdits).map(([id, meeting]) => [id, migrate(meeting)])) };
}

/** Notes created before optional interaction tags remain unclassified. */
export function migrateInteractionTags<T extends { notes: Record<string, import("../../modules/engagement/domain/models").ThreadMessage[]> }>(state: T): T {
  return { ...state, notes: Object.fromEntries(Object.entries(state.notes).map(([id, notes]) =>
    [id, notes.map((note) => ({ ...note, tags: normalizeInteractionTags(note.tags) }))])) };
}

/** Version history starts at adoption; never invent historical execution versions. */
export function migrateProductVersions<T extends object>(
  state: T,
): T & {
  productVersions: Record<
    string,
    import("../../modules/catalog/domain/product-versions").ProductVersion[]
  >;
} {
  return {
    ...state,
    productVersions:
      (
        state as T & {
          productVersions?: Record<
            string,
            import("../../modules/catalog/domain/product-versions").ProductVersion[]
          >;
        }
      ).productVersions ?? {},
  };
}

/** Existing execution dates stay fixed until a user explicitly selects a dependency. */
export function migrateTaskDeadlines<T extends { extraTasks: import("../../modules/delivery/domain/models").Delivery[] }>(state: T): T {
  if (state.extraTasks.every(t => t.deadline)) return state;
  return { ...state, extraTasks: state.extraTasks.map(t => t.deadline ? t : { ...t, deadline: { mode: "fixed" as const } }) };
}

/** Existing clients use automatic initials and no image until customized. */
export function migrateClientIdentity<T extends {
  extraClients: { initials?: string; logo?: string }[];
  clientEdits: Record<string, { initials?: string; logo?: string }>;
}>(state: T): T {
  const normalize = <C extends { initials?: string; logo?: string }>(client: C): C =>
    ({ ...client, initials: client.initials ?? "", logo: client.logo ?? "" });
  return {
    ...state,
    extraClients: state.extraClients.map(normalize),
    clientEdits: Object.fromEntries(Object.entries(state.clientEdits).map(([id, client]) => [id, normalize(client)])),
  };
}

/**
 * Histórico antigo de tarefa vira uma linha contada.
 *
 * O documento de execução é lido em toda requisição, regravado inteiro em toda
 * gravação e historizado em 50 versões; o histórico por tarefa era a única parte
 * dele que crescia a cada gesto sem nunca parar. A compactação é preguiçosa:
 * acontece na normalização, então o documento encolhe na primeira gravação
 * seguinte e nenhuma migração de banco precisa reescrever nada.
 */
export function migrateTaskHistory<
  T extends {
    extraTasks: import("../../modules/delivery/domain/models").Delivery[];
    taskPatches: Record<string, TaskOverride>;
  },
>(state: T): T {
  let changed = false;
  const compact = <R extends { history?: import("../../modules/delivery/domain/models").DeliveryHistoryEntry[] }>(record: R): R => {
    if (!record.history) return record;
    const history = compactHistory(record.history);
    if (history === record.history) return record;
    changed = true;
    return { ...record, history };
  };
  const extraTasks = state.extraTasks.map(compact);
  const taskPatches = Object.fromEntries(
    Object.entries(state.taskPatches).map(([id, patch]) => [id, compact(patch)]),
  );
  return changed ? { ...state, extraTasks, taskPatches } : state;
}

/**
 * Before effective completion dates existed, the status-history timestamp was
 * the only trustworthy completion date. Preserve that date for old records;
 * its timestamp still remains the moment the platform recorded the action.
 */
export function migrateTaskCompletionDates<
  T extends {
    extraTasks: import("../../modules/delivery/domain/models").Delivery[];
    taskPatches: Record<string, TaskOverride>;
  },
>(state: T): T {
  let changed = false;
  const migrate = <R extends {
    status?: import("../../modules/delivery/domain/models").DeliveryStatus;
    completedAt?: string;
    clearedFields?: readonly string[];
    history?: import("../../modules/delivery/domain/models").DeliveryHistoryEntry[];
  }>(record: R): R => {
    if (record.status !== "entregue" || record.completedAt || record.clearedFields?.includes("completedAt")) return record;
    const completion = [...(record.history ?? [])]
      .reverse()
      .find(entry => entry.field === "status" && entry.to === "entregue" && !Number.isNaN(Date.parse(entry.at)));
    if (!completion) return record;
    changed = true;
    return { ...record, completedAt: workspaceDate(completion.at) };
  };
  const extraTasks = state.extraTasks.map(migrate);
  const taskPatches = Object.fromEntries(Object.entries(state.taskPatches).map(([id, patch]) => [id, migrate(patch)]));
  return changed ? { ...state, extraTasks, taskPatches } : state;
}
