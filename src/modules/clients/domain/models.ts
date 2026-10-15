export type HealthFlag = "green" | "yellow" | "red";

export type ClientStatus = "ativo" | "pausado" | "encerrado";

export const clientStatusLabel: Record<ClientStatus, string> = {
  ativo: "Ativo",
  pausado: "Pausado",
  encerrado: "Encerrado",
};

export const healthFlagLabel: Record<HealthFlag, string> = {
  green: "Saudável",
  yellow: "Atenção",
  red: "Crítica",
};

/**
 * The value contract of the engagement: what the client asked for, what the
 * team clarified, what finished looks like and the question the work answers.
 * Constraints are the three tradeoff variables of every recommendation.
 */
export type Charter = {
  objective: string;
  clarifiedObjective?: string;
  finishedLooksLike: string;
  keyQuestion: string;
  constraints?: { time?: string; capital?: string; talent?: string };
  agreedAt?: string;
};

export const charterFieldLabel: Record<
  "objective" | "finishedLooksLike" | "keyQuestion",
  string
> = {
  objective: "Objetivo declarado pelo cliente",
  finishedLooksLike: "Como fica quando termina",
  keyQuestion: "Pergunta-chave do trabalho",
};

/** Fields of the charter still empty; an empty list means the contract is complete. */
export function charterMissing(charter?: Charter | null) {
  return (Object.keys(charterFieldLabel) as (keyof typeof charterFieldLabel)[]).filter(
    (key) => !charter?.[key]?.trim(),
  );
}

/**
 * A client of the workspace. The technical name `Company` is kept for stored
 * records; the product calls it "Cliente".
 */
export type Company = {
  initials?: string;
  /** Small normalized WebP thumbnail, never the original upload. */
  logo?: string;
  slug: string;
  name: string;
  legalName: string;
  sector: string;
  city: string;
  uf: string;
  status?: ClientStatus;
  /** Position in the reference plan; overridden by the execution repository. */
  milestone: number;
  health: number;
  healthFlag: HealthFlag;
  coverage: number;
  /** Seed-only hint used to bootstrap stakeholders. */
  sponsorId: string;
  /** Seed defaults; live values come from allocations. */
  leadId: string;
  csId: string;
  startedAt: string;
  contract: string;
  nextMilestone: string;
  nextMilestoneAt: string;
  summary: string;
  tint: string;
  journeyId: string;
  charter?: Charter;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
};

export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export const clientTints = [
  "#9B3B5A",
  "#1F5C57",
  "#A15C12",
  "#3F6B32",
  "#3D4C7A",
  "#6B3FA0",
  "#8A5A00",
  "#2F6F9F",
];

export function clientError(
  next: Pick<Company, "slug" | "name">,
  all: Pick<Company, "slug" | "name">[],
) {
  if (!next.name.trim()) return "Informe o nome do cliente.";
  if (!next.slug) return "O nome precisa conter letras ou números.";
  if (all.some((c) => c.slug === next.slug))
    return "Já existe um cliente com este nome.";
  return null;
}
