import type { MeetingKind } from "@/modules/engagement/domain/models";
import { NOW } from "@/shared/lib/format";

export const kinds: { id: MeetingKind; label: string; hint?: string }[] = [
  { id: "kickoff", label: "Kickoff" },
  { id: "workshop", label: "Workshop" },
  { id: "steering", label: "Steering" },
  { id: "demo", label: "Demo" },
  { id: "alinhamento", label: "Alinhamento" },
  { id: "suporte", label: "Suporte" },
  { id: "retro", label: "Retrospectiva" },
  {
    id: "entrevista",
    label: "Entrevista",
    hint: "Conversa 1:1 para testar hipóteses",
  },
  {
    id: "apresentacao",
    label: "Apresentação",
    hint: "Recomendações ao cliente, com pré-leitura e ensaio",
  },
];

export const prepKinds: MeetingKind[] = ["entrevista", "apresentacao"];

export const plusDays = (days: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Ids are minted outside the component so the render stays pure. */
export function newMeetingId() {
  return "m-" + Math.random().toString(36).slice(2, 8);
}
