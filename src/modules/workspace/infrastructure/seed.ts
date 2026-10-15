// Conteúdo demonstrativo: todos os nomes, documentos, números e cenários são sintéticos; não representam clientes nem operações reais.
import type { Alert, Person } from "@/modules/workspace/domain/models";
export const people: Person[] = [
  {
    id: "marina",
    name: "Marina Alves",
    role: "Líder de entrega",
    org: "praxis",
    initials: "MA",
    access: "admin",
    capacityHoursWeek: 40,
  },
  {
    id: "thiago",
    name: "Thiago Nunes",
    role: "Consultor de soluções",
    org: "praxis",
    initials: "TN",
    access: "ai_master",
    capacityHoursWeek: 40,
  },
  {
    id: "beatriz",
    name: "Beatriz Lopes",
    role: "Operações",
    org: "praxis",
    initials: "BL",
    access: "ai_master",
    capacityHoursWeek: 40,
  },
  {
    id: "omar",
    name: "Omar Dias",
    role: "CS",
    org: "praxis",
    initials: "OD",
    access: "ai_master",
    capacityHoursWeek: 40,
  },
  {
    id: "helena",
    name: "Alex Exemplo",
    role: "CIO",
    org: "client",
    initials: "HV",
  },
  {
    id: "camila",
    name: "Bia Demonstração",
    role: "Chefe de enfermagem",
    org: "client",
    initials: "CR",
  },
  {
    id: "rafael",
    name: "Rafa Exemplo",
    role: "Head de crédito",
    org: "client",
    initials: "RM",
  },
  {
    id: "paulo",
    name: "Pat Exemplo",
    role: "COO",
    org: "client",
    initials: "PB",
  },
  {
    id: "luiza",
    name: "Lia Exemplo",
    role: "Diretora de operações",
    org: "client",
    initials: "LT",
  },
  {
    id: "andre",
    name: "Ari Exemplo",
    role: "VP de sinistros",
    org: "client",
    initials: "AK",
  },
];

export const alerts: Alert[] = [
  {
    id: "a-sc-pep",
    company: "santa-clara",
    severity: "critico",
    title: "Sistema demonstrativo sem acesso de leitura",
    detail:
      "Exemplo sintético: a demonstração usa um arquivo de teste se a integração fictícia não estiver disponível.",
    openedAt: "2026-09-05T09:00:00",
    relatedDeliveryId: "d-sc-2",
  },
  {
    id: "a-sc-farm",
    company: "santa-clara",
    severity: "atencao",
    title: "Ontologia de farmácia abaixo de 30%",
    detail:
      "Exemplo sintético: uma etapa opcional ficou fora do roteiro de demonstração.",
    openedAt: "2026-09-09T12:30:00",
    relatedDeliveryId: "d-sc-3",
  },
  {
    id: "a-ls-sponsor",
    company: "logisul",
    severity: "critico",
    title: "Sponsor silencioso · termo de dados",
    detail:
      "Exemplo sintético: a pessoa responsável está indisponível e o sistema fictício não pode ser consultado.",
    openedAt: "2026-09-06T14:00:00",
    relatedDeliveryId: "d-ls-3",
  },
  {
    id: "a-ls-kick",
    company: "logisul",
    severity: "atencao",
    title: "Kickoff incompleto",
    detail:
      "Cenário demonstrativo: sessão curta e participação ainda não confirmada.",
    openedAt: "2026-09-02T10:30:00",
  },
  {
    id: "a-cv-lab",
    company: "campo-verde",
    severity: "info",
    title: "Responsabilidade do laboratório pendente",
    detail:
      "Falta acordar quem acompanha o prazo entre coleta e liberação do laudo na matriz de responsabilidades.",
    openedAt: "2026-09-08T16:00:00",
  },
  {
    id: "a-vs-sul",
    company: "vertice-seguros",
    severity: "atencao",
    title: "Adoção baixa na regional Sul",
    detail:
      "Exemplo sintético de variação de adoção entre equipes.",
    openedAt: "2026-09-11T10:15:00",
    relatedDeliveryId: "d-vs-2",
  },
];

export const currentUserId = "marina";

export const nowIso = "2026-09-11T15:00:00";
