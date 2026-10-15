import type { CycleTemplate, Product } from "@/modules/catalog/domain/products";
import type {
  JourneyMilestone,
  JourneyTemplate,
  ReferenceTask,
  TaskSchedule,
} from "@/modules/catalog/domain/models";

/** Twelve-month program. Onboarding checklists retain the previous system's wording;
 * implementation and sustaining deliverables restore its full program, using the
 * four execution cycles and monthly cadence specified by the team. */
export const G4_OS_PLAN_ID = "g4-os-founding-companies";
export const G4_OS_PRODUCT_ID = "g4-os-founding-companies";

type Row = {
  title: string;
  role: "Equipe de operações" | "Customer Success" | "AI Master";
  checklist?: string[];
  description?: string;
  hours?: number;
  schedule?: TaskSchedule;
};

const task = (id: string, row: Row): ReferenceTask => ({
  id,
  title: row.title,
  description: row.description ?? "",
  hours: row.hours ?? 2,
  completion: "checklist",
  ownerRole: row.role,
  party: "equipe",
  checklistItems: row.checklist,
  requiresEvidence: false,
  approvalRequired: false,
  schedule: row.schedule,
});

/* ---------- milestone 1 · Pré-onboarding ---------- */
const m1: Row[] = [
  { title: "Definição e alocação do AI Master", role: "Equipe de operações" },
  {
    title: "Criação da sessão da companhia no projeto do plataforma de IA",
    role: "Customer Success",
  },
];

/* ---------- milestone 2 · Onboarding ---------- */
const m2: Row[] = [
  {
    title: "Estabelecer canal de comunicação com o cliente",
    role: "Customer Success",
    checklist: ["Apresentação do CS e do AI Master"],
  },
  {
    title: "Criar grupo no WhatsApp",
    role: "Customer Success",
    description: "SLA de 3 dias úteis a partir do início da execução.",
    schedule: { mode: "date", base: "inicio", offsetDays: 3 },
  },
  {
    title: "Alinhamento inicial",
    role: "Customer Success",
    checklist: [
      "Definição do responsável executivo (founder, CEO ou diretor)",
      "Definição do responsável operacional (AI Master da companhia)",
      "Alinhar expectativas sobre cronograma, roadmap e entregas",
      "Enviar questionário do G4 Process AI",
      "Alinhar reunião presencial: data, custos e reembolsos",
      "Marcar próxima reunião",
      "Subir transcrição no Customer Delivery",
    ],
  },
  {
    title: "Configuração do plataforma de IA",
    role: "Customer Success",
    checklist: [
      "Configurar a plataforma",
      "Cadastrar usuários",
      "Garantir o download por todos os usuários",
      "Garantir o login de todos os usuários",
      "Configurar limites",
      "Conectar as fontes",
      "Reforçar o preenchimento do questionário do G4 Process AI",
    ],
  },
];

/* ---------- milestone 3 · Diagnóstico · Mapeamento de oportunidades ---------- */
const m3: Row[] = [
  {
    title: "Garantir a finalização do questionário",
    role: "AI Master",
    checklist: [
      "Garantir quantidade mínima de respostas e as respostas obrigatórias do responsável executivo e do responsável operacional",
    ],
  },
  {
    title: "Estudar os playbooks do G4 Process AI",
    role: "AI Master",
    checklist: ["Subir o playbook no Customer Delivery"],
  },
  {
    title: "Definir oportunidades a serem perseguidas",
    role: "AI Master",
    checklist: [
      "Realizar reuniões para discussão do playbook do G4 Process AI",
      "Entrar em acordo com o cliente sobre as prioridades",
      "Subir transcrição no Customer Delivery",
      "Marcar próxima reunião",
    ],
  },
];

/* ---------- milestone 4 · Diagnóstico · Mapeamento de soluções ---------- */
const m4: Row[] = [
  {
    title: "Criação de hipóteses de solução",
    role: "AI Master",
    checklist: [
      "Validar pré-requisitos para implementação da solução",
      "Gerar one-pager das soluções",
      "Criar protótipo",
    ],
  },
  {
    title: "Validação de hipóteses",
    role: "AI Master",
    checklist: [
      "Realizar reunião de apresentação de hipóteses",
      "Refinar hipóteses",
    ],
  },
  { title: "Definição do roadmap", role: "AI Master" },
];

const tasksOf = (n: number, rows: Row[]) =>
  rows.map((row, i) => task(`g4os-${n}-t${i + 1}`, row));

const legacyTasks = [
  tasksOf(1, m1),
  tasksOf(2, m2),
  tasksOf(3, m3),
  tasksOf(4, m4),
].flat();
const programTask = (
  id: string,
  title: string,
  month: number,
  checklistItems: string[],
  ownerRole = "AI Master",
  endMonth = month,
): ReferenceTask => ({
  id,
  title,
  description: "",
  hours: 2,
  completion: "checklist",
  ownerRole,
  party: "equipe",
  checklistItems,
  requiresEvidence: false,
  approvalRequired: false,
  period: { startMonth: month, endMonth },
});
const monthly = (month: number) =>
  programTask(
    `g4os-monthly-${month}`,
    `Reunião mensal de acompanhamento · mês ${month}`,
    month,
    [
      "Revisar projetos, adoção e resultados do período",
      "Atualizar indicadores, bloqueios, responsáveis e próximo passo",
      "Registrar decisões e transcrição da reunião",
      "Agendar o próximo acompanhamento",
    ],
  );
export const g4OsMilestones: JourneyMilestone[] = [
  {
    n: 1,
    name: "Kickoff",
    stage: "Mês 1",
    owner: "Customer Success",
    cycleTemplateId: "g4os-onboarding",
    period: { startMonth: 1, endMonth: 1 },
    durationWeeks: 4,
    goal: "Preparar o cliente, concluir o diagnóstico e alinhar o roadmap de implementação.",
    exitCriteria: [
      "Equipe e acessos preparados",
      "Diagnóstico e prioridades validados",
      "Roadmap acordado",
    ],
    tasks: legacyTasks.map((t) => ({
      ...t,
      legacyBaseDeliveryIds: [
        t.id.startsWith("g4os-1-")
          ? `g4os-pre-onboarding-d${t.id.split("-t")[1]}`
          : t.id.startsWith("g4os-2-")
            ? `g4os-onboarding-d${t.id.split("-t")[1]}`
            : `g4os-diagnostico-d${Number(t.id.split("-t")[1]) + (t.id.startsWith("g4os-4-") ? 3 : 0)}`,
      ],
      period: { startMonth: 1, endMonth: 1 },
    })),
  },
  {
    n: 2,
    name: "Implementação",
    stage: "Meses 2 e 3",
    owner: "AI Master",
    cycleTemplateId: "g4os-implementation",
    period: { startMonth: 2, endMonth: 3 },
    durationWeeks: 9,
    goal: "Implementar o piloto, testar com usuários e estabilizar a operação.",
    exitCriteria: [
      "Piloto implementado e testado",
      "Resultados e adoção medidos",
      "Continuidade acordada com o cliente",
    ],
    tasks: [
      programTask("g4os-poc-build", "Construir POCs e narrativa executiva", 2, [
        "Construir as POCs priorizadas com escopo controlado",
        "Preparar narrativa de problema, solução, impacto e limitações",
      ]),
      programTask("g4os-poc-test", "Testar POCs e recomendar escolha", 2, [
        "Apresentar e testar as POCs com o cliente",
        "Coletar feedback e escolher a POC que seguirá para implementação",
      ]),
      programTask("g4os-charter", "Aprovar charter do piloto", 2, [
        "Aprovar Project Charter, indicador, linha de base e responsáveis",
      ]),
      programTask(
        "g4os-visit-2-prep",
        "Preparar visita presencial · mês 2",
        2,
        [
          "Confirmar viagem, custos, agenda e participantes da imersão",
          "Garantir dados, acessos, ferramentas e usuários necessários",
        ],
        "Customer Success",
      ),
      programTask(
        "g4os-visit-2",
        "Visita presencial de implementação · mês 2",
        2,
        [
          "Definir objetivo e agenda de execução dos três dias",
          "Executar os três dias presenciais de implementação",
          "Construir, configurar e testar o piloto com usuários reais",
          "Treinar usuários e definir rotina inicial de uso",
          "Registrar resultados iniciais, pendências e plano de continuidade",
          "Obter aceite do cliente",
        ],
      ),
      programTask(
        "g4os-stabilize-1",
        "Primeiro acompanhamento quinzenal de estabilização",
        3,
        [
          "Ajustar o piloto com base nos testes e feedbacks",
          "Documentar operação, suporte e responsabilidades",
        ],
      ),
      programTask(
        "g4os-stabilize-2",
        "Segundo acompanhamento quinzenal de estabilização",
        3,
        [
          "Medir resultado antes e depois e acompanhar adoção",
          "Apresentar resultado e decidir entre escalar, ajustar ou encerrar",
        ],
      ),
    ],
  },
  {
    n: 3,
    name: "Handover",
    stage: "Mês 4",
    owner: "AI Master",
    cycleTemplateId: "g4os-handover",
    period: { startMonth: 4, endMonth: 4 },
    durationWeeks: 4,
    goal: "Transferir a operação para o cliente e iniciar a cadência mensal de acompanhamento.",
    exitCriteria: [
      "Operação documentada",
      "Responsáveis treinados",
      "Passagem validada pelo cliente",
    ],
    tasks: [
      programTask("g4os-handover-docs", "Documentar operação e suporte", 4, [
        "Consolidar documentação operacional",
        "Definir responsáveis, suporte e rotina de uso",
      ]),
      programTask(
        "g4os-handover-training",
        "Treinar responsáveis e validar a passagem",
        4,
        [
          "Treinar o time do cliente",
          "Validar autonomia na operação",
          "Registrar aceite da passagem",
        ],
      ),
      programTask(
        "g4os-sprint-prep",
        "Preparar participação no G4 Sprint de AI",
        4,
        [
          "Confirmar participante, datas e logística do G4 Sprint de AI",
          "Enviar orientações e garantir preparação para os três dias",
        ],
        "Customer Success",
      ),
      programTask("g4os-sprint", "G4 Sprint de AI e plano de aplicação", 4, [
        "Participar dos três dias do G4 Sprint de AI",
        "Realizar debrief e conectar aprendizados ao roadmap",
        "Definir plano de aplicação e compartilhamento interno",
      ]),
      monthly(4),
    ],
  },
  {
    n: 4,
    name: "Sustentação",
    stage: "Meses 5 a 12",
    owner: "AI Master",
    cycleTemplateId: "g4os-sustain",
    period: { startMonth: 5, endMonth: 12 },
    durationWeeks: 35,
    goal: "Acompanhar adoção e resultados, revisar o semestre e consolidar o fechamento anual.",
    exitCriteria: [
      "Acompanhamentos mensais registrados",
      "Revisão semestral realizada",
      "Fechamento anual e continuidade definidos",
    ],
    tasks: [
      ...Array.from({ length: 8 }, (_, i) => monthly(i + 5)),
      programTask(
        "g4os-support",
        "Sustentar operação e saúde do cliente",
        5,
        [
          "Prestar suporte contínuo de uso do plataforma de IA",
          "Monitorar saúde, acesso e adoção da plataforma",
          "Escalar pendências sem dono ou sem resposta",
        ],
        "Customer Success",
        12,
      ),
      programTask(
        "g4os-visit-6-prep",
        "Preparar visita presencial · mês 6",
        6,
        ["Confirmar viagem, custos, agenda e participantes da revisão"],
        "Customer Success",
      ),
      programTask("g4os-visit-6", "Visita presencial de revisão · mês 6", 6, [
        "Consolidar adoção, resultados, projetos e bloqueios do semestre",
        "Executar o dia presencial de revisão e desbloqueio",
        "Repriorizar oportunidades e atualizar o roadmap",
        "Definir projetos, responsáveis e indicadores para os meses 7 a 12",
        "Registrar aprovação executiva e próximos passos",
      ]),
      programTask("g4os-annual-report", "Consolidar relatório anual", 12, [
        "Consolidar projetos, resultados, evidências e aprendizados",
        "Comparar indicadores com a linha de base",
      ]),
      programTask(
        "g4os-annual-close",
        "Fechamento executivo e continuidade",
        12,
        [
          "Realizar fechamento executivo",
          "Coletar feedback do patrocinador",
          "Decidir continuidade, expansão ou encerramento",
        ],
      ),
    ],
  },
];

/** Prose deadlines of the original program, kept for reference next to each milestone. */
export const g4OsMilestoneDeadlines: Record<number, string> = {
  1: "Mês 1",
  2: "Meses 2 e 3",
  3: "Mês 4",
  4: "Meses 5 a 12",
};

export const g4OsPlan: JourneyTemplate = {
  id: G4_OS_PLAN_ID,
  name: "Programa de implementação de IA",
  description:
    "Programa completo de 12 meses: kickoff, implementação, handover e sustentação, com visitas presenciais e acompanhamentos mensais.",
  milestones: g4OsMilestones,
  autoCreateCycles: true,
  productId: G4_OS_PRODUCT_ID,
};

/* ---------- product: one cycle model per stage, deliveries copied from the reference tasks ---------- */

function cycle(
  id: string,
  name: string,
  goal: string,
  durationDays: number,
  milestones: JourneyMilestone[],
): CycleTemplate {
  const tasks = milestones.flatMap((m) => m.tasks ?? []);
  return {
    id,
    name,
    goal,
    durationDays,
    deliveries: tasks.map((t, i) => ({
      id: `${id}-d${i + 1}`,
      title: t.title,
      description: t.description,
      day:
        t.schedule?.mode === "date"
          ? Math.max(1, t.schedule.offsetDays)
          : Math.ceil((durationDays * (i + 1)) / tasks.length),
      hours: t.hours,
      completion: "checklist",
      checklistItems: t.checklistItems,
      requiresEvidence: false,
      approvalRequired: false,
      responsibleRole: t.ownerRole,
      party: "equipe",
    })),
    acceptance: milestones.flatMap((m) => m.exitCriteria ?? []),
  };
}

export const g4OsProduct: Product = {
  id: G4_OS_PRODUCT_ID,
  name: "Programa de implementação de IA",
  description:
    "Programa de implementação e onboarding das empresas participantes do plataforma de IA.",
  serviceModel: "implementacao",
  autoAllocateLead: true,
  cycles: g4OsMilestones.map((m) =>
    cycle(
      m.cycleTemplateId!,
      `${m.name} · ${m.stage}`,
      m.goal!,
      (m.period!.endMonth - m.period!.startMonth + 1) * 30,
      [m],
    ),
  ),
};
