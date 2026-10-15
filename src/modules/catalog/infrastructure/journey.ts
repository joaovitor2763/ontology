import type {
  JourneyMilestone,
  JourneyTemplate,
  ReferenceTask,
} from "@/modules/catalog/domain/models";
import { foundingMilestones } from "./founding-journey.ts";
import { g4OsPlan } from "./g4-os-founding-companies.ts";

const ref = (
  milestoneId: string,
  rows: [string, number, "checklist" | "deliverable", string?][],
): ReferenceTask[] =>
  rows.map(([title, hours, completion, description], i) => ({
    id: `${milestoneId}-t${i + 1}`,
    title,
    description: description ?? "",
    hours,
    completion,
  }));

export const seedJourneys: JourneyTemplate[] = [
  {
    id: "service-delivery",
    name: "Entrega de consultoria",
    description:
      "Do alinhamento do escopo à passagem para a operação. Ajuste os marcos a cada serviço.",
    milestones: [
      {
        n: 1,
        stage: "Alinhamento",
        name: "Escopo, objetivos e responsáveis acordados",
        owner: "Responsável",
        goal: "Fechar o entendimento comum do problema, dos resultados esperados e de quem decide de cada lado.",
        durationWeeks: 1,
        exitCriteria: [
          "Escopo e objetivos aprovados pelo patrocinador",
          "Responsáveis e ritual de acompanhamento definidos",
        ],
        tasks: ref("sd-1", [
          ["Reunião de kickoff realizada", 3, "checklist"],
          ["Termo de escopo e objetivos", 4, "deliverable"],
          ["Acessos e canais de comunicação acordados", 2, "checklist"],
        ]),
      },
      {
        n: 2,
        stage: "Diagnóstico",
        name: "Situação atual e oportunidades mapeadas",
        owner: "Responsável",
        goal: "Entender a operação como ela é hoje e priorizar as oportunidades com quem vive o processo.",
        durationWeeks: 3,
        exitCriteria: [
          "Mapa do processo atual validado pelo ponto focal",
          "Oportunidades priorizadas com a liderança",
        ],
        tasks: ref("sd-2", [
          ["Entrevistas com stakeholders", 8, "checklist"],
          ["Mapa do processo atual", 8, "deliverable"],
          ["Indicadores de referência", 4, "deliverable"],
        ]),
      },
      {
        n: 3,
        stage: "Planejamento",
        name: "Plano de melhoria aprovado",
        owner: "Responsável",
        goal: "Transformar o diagnóstico em um plano com responsáveis, prazos e esforço aprovados.",
        durationWeeks: 2,
        exitCriteria: [
          "Plano de melhoria aprovado pelo patrocinador",
          "Matriz de responsabilidades acordada",
        ],
        tasks: ref("sd-3", [
          ["Plano de melhoria priorizado", 8, "deliverable"],
          ["Matriz de responsabilidades", 3, "deliverable"],
        ]),
      },
      {
        n: 4,
        stage: "Execução",
        name: "Primeiro ciclo de entregas validado",
        owner: "Responsável",
        goal: "Entregar o primeiro conjunto de mudanças e validar com a operação.",
        durationWeeks: 4,
        exitCriteria: ["Entregas do primeiro ciclo aceitas pelo cliente"],
        tasks: ref("sd-4", [
          ["Implantação das primeiras rotinas", 12, "checklist"],
          ["Evidências de resultado do ciclo", 4, "deliverable"],
        ]),
      },
      {
        n: 5,
        stage: "Execução",
        name: "Ajustes e evidências consolidados",
        owner: "Responsável",
        goal: "Corrigir o que não funcionou, consolidar o que funcionou e registrar as evidências.",
        durationWeeks: 4,
        exitCriteria: ["Indicadores revisados e ajustes aprovados"],
        tasks: ref("sd-5", [
          ["Revisão dos indicadores", 4, "checklist"],
          ["Ajustes nas rotinas", 8, "checklist"],
          ["Relatório de evidências", 4, "deliverable"],
        ]),
      },
      {
        n: 6,
        stage: "Transição",
        name: "Equipe preparada e documentação entregue",
        owner: "Responsável",
        goal: "Deixar a equipe do cliente capaz de operar sem a consultoria.",
        durationWeeks: 2,
        exitCriteria: [
          "Treinamento realizado",
          "Documentação entregue e aceita",
        ],
        tasks: ref("sd-6", [
          ["Capacitação da equipe", 6, "checklist"],
          ["Guia de operação", 6, "deliverable"],
        ]),
      },
      {
        n: 7,
        stage: "Encerramento",
        name: "Aceite final e próximos passos registrados",
        owner: "Responsável",
        goal: "Fechar o contrato com aceite formal e recomendações registradas.",
        durationWeeks: 1,
        exitCriteria: ["Aceite final assinado", "Próximos passos registrados"],
        tasks: ref("sd-7", [
          ["Reunião de encerramento", 2, "checklist"],
          ["Relatório final e recomendações", 4, "deliverable"],
        ]),
      },
    ],
  },
  {
    id: "founding-companies",
    name: "Programa de IA · 12 meses",
    description:
      "Da preparação ao encerramento do ciclo anual: sete etapas, doze marcos e as entregas de referência de cada um.",
    milestones: foundingMilestones,
  },
  g4OsPlan,
  {
    id: "diagnostico-90",
    name: "Diagnóstico 90 dias",
    description: "Ciclo curto de descoberta até o primeiro piloto.",
    milestones: [
      {
        n: 1,
        stage: "Entrada",
        name: "Kickoff e acessos",
        owner: "CS",
        goal: "Começar com acessos liberados, canal aberto e expectativas alinhadas.",
        durationWeeks: 2,
        exitCriteria: ["Kickoff realizado", "Acessos liberados"],
        tasks: ref("d90-1", [
          ["Kickoff com o patrocinador", 2, "checklist"],
          ["Checklist de acessos e dados", 2, "checklist"],
        ]),
      },
      {
        n: 2,
        stage: "Mapa",
        name: "Processos e dados mapeados",
        owner: "Responsável",
        goal: "Mapear processos e fontes de dados relevantes para os casos candidatos.",
        durationWeeks: 4,
        exitCriteria: ["Mapa de processos e dados validado"],
        tasks: ref("d90-2", [
          ["Mapa de processos", 8, "deliverable"],
          ["Inventário de dados", 6, "deliverable"],
        ]),
      },
      {
        n: 3,
        stage: "Casos",
        name: "Três casos priorizados",
        owner: "Responsável",
        goal: "Escolher três casos com valor claro e viabilidade confirmada.",
        durationWeeks: 3,
        exitCriteria: ["Casos priorizados aprovados"],
        tasks: ref("d90-3", [
          ["Avaliação de oportunidade por caso", 6, "deliverable"],
          ["Workshop de priorização", 3, "checklist"],
        ]),
      },
      {
        n: 4,
        stage: "Piloto",
        name: "Piloto desenhado e validado",
        owner: "Responsável",
        goal: "Desenhar o piloto do primeiro caso e validar o desenho com a operação.",
        durationWeeks: 4,
        exitCriteria: ["Desenho do piloto aprovado"],
        tasks: ref("d90-4", [
          ["Desenho do piloto", 8, "deliverable"],
          ["Validação com a operação", 3, "checklist"],
        ]),
      },
    ],
  },
];

export const DEFAULT_JOURNEY_ID = "founding-companies";

export const journeyMilestones = foundingMilestones;

export function milestoneByN(
  n: number,
  journey?: JourneyTemplate,
): JourneyMilestone {
  const list = journey?.milestones ?? foundingMilestones;
  return list.find((m) => m.n === n) ?? list[0];
}

export function mergeJourneys(
  extras: JourneyTemplate[],
  edits: Record<string, JourneyTemplate>,
  removed: string[],
) {
  const gone = new Set(removed);
  const seed = seedJourneys
    .filter((j) => !gone.has(j.id))
    .map((j) => edits[j.id] ?? j);
  return [
    ...seed,
    ...extras.filter(
      (j) => !gone.has(j.id) && !seed.some((s) => s.id === j.id),
    ),
  ];
}

/** Ids are stable for stored deliveries; names use consulting vocabulary. */
export const deliverableTemplates = [
  { id: "roadmap_ai", name: "Roadmap" },
  { id: "project_charter", name: "Charter do projeto" },
  { id: "action_plan", name: "Plano de ação" },
  { id: "process_map", name: "Mapa de processo" },
  { id: "opportunity_assessment", name: "Avaliação de oportunidade" },
  { id: "meeting_record", name: "Ata de reunião" },
  { id: "metrics_evidence", name: "Evidência de métricas" },
  { id: "enablement_plan", name: "Plano de capacitação" },
  { id: "communication_record", name: "Registro de comunicação" },
  { id: "task_evidence", name: "Evidência da entrega" },
] as const;
