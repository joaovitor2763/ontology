import type {
  HypothesisEvidenceKind,
  HypothesisStatus,
} from "@/modules/engagement/domain/models";

export const HYPOTHESIS_STATUS: HypothesisStatus[] = [
  "aberta",
  "em-teste",
  "confirmada",
  "refutada",
  "refinada",
];

export const EVIDENCE_KINDS: HypothesisEvidenceKind[] = [
  "confirma",
  "contradiz",
  "refina",
];

export const uid = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
