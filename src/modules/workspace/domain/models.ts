export type AlertSeverity = "critico" | "atencao" | "info";

/** Access levels and the permission matrix live in `permissions.ts`; re-exported for callers. */
export {
  accessHint,
  accessLabel,
  normalizeAccess,
  type AccessLevel,
} from "./permissions.ts";
import type { AccessLevel } from "./permissions.ts";
import {
  contactPointsError,
  type ContactPointOwner,
} from "../../../shared/lib/contact-points.ts";

/** Standard team roles. Existing members retain their previously saved role. */
export const deliveryRoles = [
  "AI Master",
  "AI Success Engineer",
  "Suporte",
  "Gestão",
  "Community Manager",
  "Success Manager",
] as const;

export type NamedRole = { id: string; label: string };

export function normalizeMemberRoles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (typeof item !== "string") return [];
    const label = item.trim();
    const key = label.toLocaleLowerCase("pt-BR");
    if (!label || label.length > 80 || seen.has(key)) return [];
    seen.add(key);
    return [label];
  });
}

export function normalizeAllocationRoles(value: unknown): NamedRole[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const candidate = item as Partial<NamedRole>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const label =
      typeof candidate.label === "string" ? candidate.label.trim() : "";
    if (
      !/^custom-[a-z0-9][a-z0-9-]{0,72}$/.test(id) ||
      !label ||
      label.length > 80 ||
      seen.has(id)
    )
      return [];
    seen.add(id);
    return [{ id, label }];
  });
}

export type Person = {
  /** Primary login/contact alias; mirrors the first item of emails. */
  email?: string;
  /** All contact e-mails. The first item is primary. */
  emails?: string[];
  /** WhatsApp number, including country code when available. */
  phone?: string;
  /** All contact/WhatsApp numbers. The first item is primary. */
  phones?: string[];
  id: string;
  name: string;
  role: string;
  org: "praxis" | "client";
  initials: string;
  access?: AccessLevel;
  capacityHoursWeek?: number;
  createdAt?: string;
  updatedAt?: string;
};

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")
  ).toUpperCase();
}

export function memberError(
  next: Pick<Person, "id" | "name" | "role" | "org" | "email" | "emails" | "phone" | "phones" | "capacityHoursWeek">,
  all: ContactPointOwner[],
) {
  if (!next.name.trim()) return "Informe o nome.";
  if (!next.role.trim()) return "Informe o cargo na equipe.";
  const contactIssue = contactPointsError(next, all);
  if (contactIssue) return contactIssue;
  if (
    next.capacityHoursWeek != null &&
    (!Number.isFinite(next.capacityHoursWeek) ||
      next.capacityHoursWeek < 0 ||
      next.capacityHoursWeek > 80)
  )
    return "A capacidade semanal deve ficar entre 0 e 80 horas.";
  return null;
}

export type AlertSource = "registrado" | "derivado";

export const alertSourceLabel: Record<AlertSource, string> = {
  registrado: "Registrado",
  derivado: "Derivado dos dados",
};

export type Alert = {
  id: string;
  company: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  openedAt: string;
  relatedDeliveryId?: string;
  relatedCycleId?: string;
  /** Registered by a person, or derived from deliveries, cycles and meetings. */
  source?: AlertSource;
  kind?: string;
};

/** Thresholds behind the derived alerts; editable by administrators in Configurações. */
export type AlertRules = {
  /** Days a cycle may wait for the client's acceptance before the queue flags it. */
  acceptanceWaitDays: number;
  /** Days without a meeting before a client counts as silent. */
  silentClientDays: number;
  /** Days overdue after which a late delivery becomes critical. */
  lateDeliveryCriticalDays: number;
  /** Hours before a presentation by which the rehearsal must be logged. */
  presentationRehearsalHours: number;
  /** Days an open hypothesis may go without new evidence. */
  hypothesisStaleDays: number;
};

export const defaultAlertRules: AlertRules = {
  acceptanceWaitDays: 5,
  silentClientDays: 14,
  lateDeliveryCriticalDays: 7,
  presentationRehearsalHours: 48,
  hypothesisStaleDays: 14,
};

export const alertRuleLabel: Record<keyof AlertRules, string> = {
  acceptanceWaitDays: "Dias aguardando aceite do cliente",
  silentClientDays: "Dias sem reunião com o cliente",
  lateDeliveryCriticalDays: "Dias de atraso para a tarefa virar crítica",
  presentationRehearsalHours: "Horas antes da apresentação para o ensaio",
  hypothesisStaleDays: "Dias de hipótese sem evidência nova",
};

export function alertRulesError(rules: Partial<AlertRules>) {
  for (const key of Object.keys(defaultAlertRules) as (keyof AlertRules)[]) {
    const value = rules[key];
    if (value == null) continue;
    if (!Number.isFinite(value) || value < 0 || value > 365)
      return `${alertRuleLabel[key]}: informe um número entre 0 e 365.`;
  }
  return null;
}

export function resolveAlertRules(
  rules?: Partial<AlertRules> | null,
): AlertRules {
  return { ...defaultAlertRules, ...(rules ?? {}) };
}
