import type { DeliveryStatus } from "@/modules/delivery/domain/models";
import type { ServiceCycle } from "@/modules/delivery/domain/services";

export const OUTCOMES: Record<number, string> = {
  1: "Alinhar o contexto da venda, os compromissos e as pessoas que vão conduzir o cliente.",
  2: "Preparar a equipe, os acessos e a cadência para começar com clareza de responsabilidades.",
  3: "Garantir que o cliente tenha acesso, canal de comunicação e um kickoff agendado.",
  4: "Alinhar objetivos, indicadores de sucesso e o plano de trabalho com o cliente.",
  5: "Entender os processos e validar os gargalos com quem opera o negócio.",
  6: "Priorizar as oportunidades e aprovar o primeiro projeto com o patrocinador.",
  7: "Colocar o primeiro piloto nas mãos de usuários reais e registrar o que precisa evoluir.",
  8: "Validar a adoção e os resultados do piloto para decidir os próximos passos.",
  9: "Preparar o time do cliente para aplicar e compartilhar o aprendizado em IA.",
  10: "Revisar os resultados, remover bloqueios e atualizar as prioridades do roadmap.",
  11: "Consolidar a rotina de acompanhamento, os indicadores e a continuidade da operação.",
  12: "Reunir as evidências do ciclo e pactuar as recomendações para o próximo plano.",
};

export type Filter = "all" | "pending" | "blocked" | "done";

export const cycleTone = (status: ServiceCycle["status"]) =>
  status === "concluido" ? "ok" : status === "em-aceite" ? "warn" : "neutral";

export const statusDot: Record<DeliveryStatus, string> = {
  fila: "bg-line-strong",
  "em-curso": "bg-blue",
  revisao: "bg-amber",
  entregue: "bg-ok",
  bloqueado: "bg-rose",
};

export function scrollParentOf(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el) {
    const { overflowY } = getComputedStyle(el);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight
    )
      return el;
    el = el.parentElement;
  }
  return null;
}
