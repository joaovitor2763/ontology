import type {
  HypothesisEvidenceKind,
  MeetingKind,
} from "@/modules/engagement/domain/models";
import { NOW } from "@/shared/lib/format";

export const kinds: { id: MeetingKind; label: string }[] = [
  { id: "kickoff", label: "Kickoff" },
  { id: "workshop", label: "Workshop" },
  { id: "steering", label: "Steering" },
  { id: "demo", label: "Demo" },
  { id: "alinhamento", label: "Alinhamento" },
  { id: "retro", label: "Retrospectiva" },
  { id: "entrevista", label: "Entrevista" },
  { id: "apresentacao", label: "Apresentação" },
];

export const STEPS = [
  "Contexto",
  "Dores",
  "Hipóteses",
  "Soluções",
  "Decisões",
] as const;

export const EVIDENCE_KINDS: HypothesisEvidenceKind[] = [
  "confirma",
  "contradiz",
  "refina",
];

export const uid = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

export const plusDays = (days: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
