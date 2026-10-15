import type { Meeting } from "../../engagement/domain/models.ts";
import type { Person } from "../../workspace/domain/models.ts";
import {
  contactPointsError,
  type ContactPointOwner,
} from "../../../shared/lib/contact-points.ts";
export const stakeholderRoles = {
  patrocinador: "Patrocinador",
  decisor: "Decisor",
  "ponto-focal": "Ponto focal",
  tecnico: "Responsável técnico",
  usuario: "Usuário-chave",
  outro: "Outro",
} as const;
export const stakeholderStances = {
  apoiador: "Apoiador",
  neutro: "Neutro",
  cetico: "Cético",
  desconhecido: "Não avaliado",
} as const;
export type StakeholderStance = keyof typeof stakeholderStances;
export const influenceLevels = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
} as const;
export type InfluenceLevel = keyof typeof influenceLevels;
export type Stakeholder = Person & {
  company: string;
  org: "client";
  area: string;
  email: string;
  emails: string[];
  phone: string;
  phones: string[];
  accountRole: keyof typeof stakeholderRoles;
  primary: boolean;
  active: boolean;
  notes: string;
  /** Relationship notes (MCAS interview summary: ally or skeptic, how they like to be communicated with). */
  stance?: StakeholderStance;
  influence?: InfluenceLevel;
  /** Format, length and formality this person prefers. */
  communicationPreference?: string;
  /** What we offered in return; no relationship starts without offering help. */
  helpOffered?: string;
};
/** Primary is unique inside one client; inactive contacts retain their history. */
export function upsertStakeholder(
  all: Stakeholder[],
  next: Stakeholder,
): Stakeholder[] {
  const saved = { ...next, primary: next.active && next.primary };
  return [
    ...all
      .filter((s) => s.id !== saved.id || s.company !== saved.company)
      .map((s) =>
        saved.primary && s.company === saved.company
          ? { ...s, primary: false }
          : s,
      ),
    saved,
  ];
}
export function stakeholderError(next: Stakeholder, all: ContactPointOwner[]) {
  if (!next.name.trim() || !next.role.trim())
    return "Informe o nome e o cargo do stakeholder.";
  return contactPointsError(next, all);
}

/** Roles that decide or sponsor the work; their silence is a risk even at low stated influence. */
const keyRoles: ReadonlySet<Stakeholder["accountRole"]> = new Set([
  "patrocinador",
  "decisor",
]);

/** Default influence when nobody has assessed the person yet. */
export function defaultInfluence(role: Stakeholder["accountRole"]): InfluenceLevel {
  if (keyRoles.has(role)) return "alta";
  if (role === "ponto-focal" || role === "tecnico") return "media";
  return "baixa";
}

const DAY = 86_400_000;
function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to.slice(0, 10)}T00:00:00`) -
      Date.parse(`${from.slice(0, 10)}T00:00:00`)) /
      DAY,
  );
}

/** Start of the last past meeting the person attended, or null when they were never in one. */
export function lastInteractionOf(
  stakeholderId: string,
  meetings: Pick<Meeting, "attendeeIds" | "startsAt">[],
  today: string,
): string | null {
  return (
    meetings
      .filter(
        (m) => m.startsAt <= today && m.attendeeIds.includes(stakeholderId),
      )
      .map((m) => m.startsAt)
      .sort()
      .at(-1) ?? null
  );
}

export type StakeholderCoverage = {
  stakeholder: Stakeholder;
  lastAt: string | null;
  /** Days since the last interaction; null when never met. */
  gapDays: number | null;
  neverMet: boolean;
  /** Decides or sponsors (or has high influence) and was never heard: a support gap. */
  keyButUnmet: boolean;
};

/**
 * How well the team has covered the client's people (MCAS: interviews build
 * the support that recommendations need later). Only active contacts count.
 */
export function stakeholderCoverage(
  stakeholders: Stakeholder[],
  meetings: Pick<Meeting, "attendeeIds" | "startsAt">[],
  today: string,
): StakeholderCoverage[] {
  return stakeholders
    .filter((s) => s.active)
    .map((s) => {
      const lastAt = lastInteractionOf(s.id, meetings, today);
      const influence = s.influence ?? defaultInfluence(s.accountRole);
      const neverMet = lastAt === null;
      return {
        stakeholder: s,
        lastAt,
        gapDays: lastAt ? daysBetween(lastAt, today) : null,
        neverMet,
        keyButUnmet:
          neverMet && (influence === "alta" || keyRoles.has(s.accountRole)),
      };
    });
}
