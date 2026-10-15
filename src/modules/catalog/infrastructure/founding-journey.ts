import type {
  JourneyMilestone,
  ReferenceTask,
  TaskSchedule,
} from "@/modules/catalog/domain/models";

/**
 * "Programa de IA · 12 meses": twelve milestones in seven stages with every
 * reference task, ported from the previous delivery playbook. Only structure and
 * generic task titles were kept; product and people names were neutralized.
 */
type Row = [
  title: string,
  completion: "checklist" | "deliverable",
  extra?: {
    hours?: number;
    template?: string;
    role?: string;
    party?: "equipe" | "cliente" | "terceiro";
    checklist?: string[];
    schedule?: TaskSchedule;
    description?: string;
  },
];

const TEMPLATE_BY_KEYWORD: [RegExp, string][] = [
  [/roadmap/i, "roadmap_ai"],
  [/oportunidade|impacto|esforço|matriz|priorid/i, "opportunity_assessment"],
  [/indicador|medir|resultado|linha de base|adoção/i, "metrics_evidence"],
  [/processo|mapear|documentar|gargalo|dependências/i, "process_map"],
  [/piloto|projeto|solução/i, "project_charter"],
  [/plano|ações|continuidade|rotina/i, "action_plan"],
  [/treinar|aprendizad|debrief|capacita|compartilhamento/i, "enablement_plan"],
  [/entrevista|reunião|briefing|kickoff|apresenta|feedback|decis/i, "meeting_record"],
  [/enviar|convite|mensagem|comunica/i, "communication_record"],
  [/evidência|registrar/i, "task_evidence"],
];

const templateFor = (title: string) =>
  TEMPLATE_BY_KEYWORD.find(([pattern]) => pattern.test(title))?.[1] ??
  "task_evidence";

function build(
  n: number,
  defaultRole: string,
  rows: Row[],
): ReferenceTask[] {
  return rows.map(([title, completion, extra], index) => {
    const role = extra?.role ?? defaultRole;
    const deliverable = completion === "deliverable";
    return {
      id: `fc-${n}-t${index + 1}`,
      title,
      description: extra?.description ?? "",
      hours: extra?.hours ?? (deliverable ? 6 : 2),
      completion,
      ownerRole: role,
      party:
        extra?.party ??
        (role === "Cliente" ? "cliente" : role === "Terceiro" ? "terceiro" : "equipe"),
      checklistItems: extra?.checklist,
      requiresEvidence: deliverable,
      approvalRequired: deliverable,
      deliverableTemplateId: deliverable
        ? (extra?.template ?? templateFor(title))
        : undefined,
      schedule: extra?.schedule,
    };
  });
}

const afterStart = (offsetDays: number): TaskSchedule => ({
  mode: "date",
  base: "inicio",
  offsetDays,
});
const afterSale = (offsetDays: number): TaskSchedule => ({
  mode: "date",
  base: "venda",
  offsetDays,
});
const after = (predecessorId: string, offsetDays: number): TaskSchedule => ({
  mode: "task",
  predecessorId,
  offsetDays,
});

export const foundingMilestones: JourneyMilestone[] = [
  {
    n: 1,
    stage: "Preparação",
    name: "Handoff comercial concluído",
    owner: "CS",
    goal: "Ficha do cliente completa e aceita pela operação no dia da venda.",
    durationWeeks: 1,
    exitCriteria: ["Ficha do cliente completa e aceita pela operação"],
    tasks: build(1, "CS", [
      ["Criar cadastro do cliente", "checklist", { checklist: ["Razão social", "CNPJ", "Praça"], schedule: afterSale(0) }],
      ["Registrar patrocinador executivo", "deliverable", { template: "meeting_record", schedule: afterSale(0) }],
      ["Registrar ponto focal operacional", "checklist", { schedule: afterSale(0) }],
      ["Registrar lista inicial de usuários", "checklist", { schedule: afterSale(1) }],
      ["Registrar contexto, dores e objetivos apresentados na venda", "checklist", { schedule: afterSale(1) }],
      ["Registrar promessas e particularidades comerciais", "checklist", { schedule: afterSale(1) }],
      ["Anexar proposta e contrato", "checklist", { hours: 1, schedule: afterSale(1) }],
      ["Confirmar data de início", "checklist", { hours: 1, schedule: afterSale(2) }],
    ]),
  },
  {
    n: 2,
    stage: "Preparação",
    name: "Operação interna preparada",
    owner: "Operações",
    goal: "Time, ambiente, acessos e agenda inicial preparados antes de ativar o cliente.",
    durationWeeks: 1,
    exitCriteria: ["Time, ambiente, acessos e agenda inicial preparados"],
    tasks: build(2, "Operações", [
      ["Definir responsável principal", "checklist", { schedule: afterStart(1) }],
      ["Definir responsável substituto", "checklist", { schedule: afterStart(1) }],
      ["Definir patrocinador interno", "checklist", { schedule: afterStart(1) }],
      ["Realizar briefing entre Comercial, CS e responsável", "deliverable", { template: "meeting_record", schedule: afterStart(2) }],
      ["Criar registro central do cliente", "checklist", { schedule: afterStart(1) }],
      ["Criar espaço de arquivos do cliente", "checklist", { hours: 1 }],
      ["Criar projeto de diagnóstico", "checklist"],
      ["Preparar os acessos à plataforma", "checklist"],
      ["Sugerir datas para o kickoff", "checklist", { role: "CS" }],
      ["Sugerir agenda das quatro reuniões semanais iniciais", "checklist", { role: "CS" }],
    ]),
  },
  {
    n: 3,
    stage: "Ativação",
    name: "Cliente ativado",
    owner: "CS",
    goal: "Cliente no canal oficial, acesso enviado, kickoff confirmado e próximo passo comunicado.",
    durationWeeks: 1,
    exitCriteria: [
      "Cliente no canal oficial com acesso liberado",
      "Kickoff confirmado e próximo passo comunicado",
    ],
    tasks: build(3, "CS", [
      ["Criar canal oficial com o cliente", "checklist", { schedule: afterStart(2) }],
      ["Adicionar patrocinador e ponto focal do cliente ao canal", "checklist", { schedule: after("fc-3-t1", 0) }],
      ["Adicionar responsável e liderança da consultoria ao canal", "checklist", { schedule: after("fc-3-t1", 0) }],
      ["Enviar mensagem de boas-vindas", "checklist", { schedule: after("fc-3-t2", 0) }],
      ["Liberar os acessos à plataforma", "checklist"],
      ["Enviar instruções para o primeiro acesso", "checklist"],
      ["Confirmar data e horário do kickoff", "checklist"],
      ["Enviar convite de calendário", "checklist", { hours: 1 }],
      ["Solicitar participantes do diagnóstico", "checklist"],
      ["Solicitar documentos prévios necessários", "checklist"],
      ["Enviar confirmação do kickoff", "checklist", { hours: 1 }],
      ["Enviar solicitação de documentos e participantes", "checklist", { hours: 1 }],
    ]),
  },
  {
    n: 4,
    stage: "Ativação",
    name: "Kickoff realizado",
    owner: "Responsável",
    goal: "Objetivos, responsáveis, indicadores e cronograma do diagnóstico validados pelo cliente.",
    durationWeeks: 1,
    exitCriteria: ["Objetivos, responsáveis, indicadores e cronograma validados pelo cliente"],
    tasks: build(4, "Responsável", [
      ["Preparar apresentação de kickoff", "deliverable", { template: "meeting_record" }],
      ["Revisar objetivos e expectativas do cliente", "checklist"],
      ["Apresentar papéis e responsabilidades", "checklist"],
      ["Apresentar a jornada dos 12 meses", "checklist"],
      ["Demonstrar a plataforma", "checklist"],
      ["Alinhar escopo e limites da entrega", "checklist"],
      ["Definir indicadores iniciais de sucesso", "deliverable", { template: "metrics_evidence" }],
      ["Confirmar participantes das entrevistas", "checklist", { party: "cliente", role: "Cliente" }],
      ["Confirmar cadência das reuniões", "checklist"],
      ["Registrar decisões, entregas, donos e prazos", "deliverable", { template: "meeting_record" }],
      ["Agendar a próxima reunião", "checklist", { hours: 1 }],
      ["Enviar resumo pós-kickoff e próximos passos", "checklist", { hours: 1, schedule: after("fc-4-t10", 1) }],
    ]),
  },
  {
    n: 5,
    stage: "Diagnóstico",
    name: "Processos mapeados",
    owner: "Responsável",
    goal: "Processos prioritários documentados e validados pelos respectivos responsáveis.",
    durationWeeks: 3,
    exitCriteria: ["Processos prioritários documentados e validados pelos donos"],
    tasks: build(5, "Responsável", [
      ["Mapear áreas prioritárias", "deliverable", { template: "process_map" }],
      ["Identificar donos dos processos", "checklist"],
      ["Agendar entrevistas", "checklist"],
      ["Realizar entrevistas com stakeholders", "deliverable", { template: "meeting_record", hours: 8, schedule: after("fc-5-t3", 3) }],
      ["Documentar processos atuais", "deliverable", { template: "process_map", hours: 8 }],
      ["Registrar frequência, volume, tempo e ferramentas de cada processo", "deliverable", { template: "process_map" }],
      ["Identificar gargalos, retrabalho e atividades repetitivas", "deliverable", { template: "process_map" }],
      ["Identificar dependências de dados e sistemas", "deliverable", { template: "process_map" }],
      ["Validar os mapas com os donos dos processos", "deliverable", { template: "meeting_record" }],
      ["Enviar convite para entrevistas de diagnóstico", "checklist", { hours: 1, role: "CS" }],
    ]),
  },
  {
    n: 6,
    stage: "Diagnóstico",
    name: "Roadmap de IA aprovado",
    owner: "Responsável",
    goal: "Patrocinador aprova o roadmap e autoriza o primeiro projeto.",
    durationWeeks: 2,
    exitCriteria: ["Roadmap aprovado pelo patrocinador", "Primeiro projeto autorizado"],
    tasks: build(6, "Responsável", [
      ["Criar backlog de oportunidades de IA", "deliverable", { template: "opportunity_assessment" }],
      ["Avaliar impacto de cada oportunidade", "deliverable", { template: "opportunity_assessment" }],
      ["Avaliar esforço e complexidade", "deliverable", { template: "opportunity_assessment" }],
      ["Avaliar dados disponíveis e riscos", "deliverable", { template: "opportunity_assessment" }],
      ["Montar matriz impacto × esforço", "deliverable", { template: "opportunity_assessment" }],
      ["Selecionar três a cinco prioridades", "deliverable", { template: "roadmap_ai" }],
      ["Definir o primeiro projeto", "deliverable", { template: "project_charter" }],
      ["Definir indicadores e linha de base", "deliverable", { template: "metrics_evidence" }],
      ["Elaborar roadmap preliminar de 12 meses", "deliverable", { template: "roadmap_ai", hours: 10 }],
      ["Apresentar prioridades ao patrocinador", "deliverable", { template: "meeting_record" }],
      ["Registrar aprovação e ajustes", "deliverable", { template: "meeting_record", hours: 2 }],
      ["Enviar roadmap para validação executiva", "checklist", { hours: 1 }],
    ]),
  },
  {
    n: 7,
    stage: "Primeira implementação",
    name: "Imersão presencial de implementação realizada",
    owner: "Responsável",
    goal: "Piloto ou primeira versão entregue, com plano de continuidade, responsáveis e indicador definidos.",
    durationWeeks: 4,
    exitCriteria: ["Piloto entregue com plano de continuidade, responsáveis e indicador"],
    tasks: build(7, "Responsável", [
      ["Confirmar datas dos três dias", "checklist"],
      ["Confirmar participantes e responsáveis do cliente", "checklist", { party: "cliente", role: "Cliente" }],
      ["Definir objetivo e agenda de cada dia", "deliverable", { template: "action_plan" }],
      ["Garantir acessos, dados e ferramentas necessários", "checklist"],
      ["Detalhar o processo priorizado", "deliverable", { template: "process_map" }],
      ["Desenhar a solução inicial", "deliverable", { template: "project_charter", hours: 8 }],
      ["Construir ou configurar o primeiro piloto", "deliverable", { template: "project_charter", hours: 16 }],
      ["Testar com usuários reais", "deliverable", { template: "task_evidence" }],
      ["Registrar decisões e pendências", "deliverable", { template: "meeting_record", hours: 2 }],
      ["Definir plano de continuidade após a imersão", "deliverable", { template: "action_plan" }],
      ["Registrar evidências e resultados iniciais", "deliverable", { template: "metrics_evidence" }],
      ["Enviar preparação para a imersão presencial", "checklist", { hours: 1, role: "CS" }],
    ]),
  },
  {
    n: 8,
    stage: "Primeira implementação",
    name: "Primeiro projeto validado",
    owner: "Responsável + cliente",
    goal: "Solução validada com usuários reais e resultado documentado.",
    durationWeeks: 6,
    exitCriteria: ["Solução validada com usuários reais", "Resultado antes e depois documentado"],
    tasks: build(8, "Responsável", [
      ["Ajustar o piloto após os primeiros testes", "deliverable", { template: "project_charter", hours: 8 }],
      ["Criar documentação operacional", "deliverable", { template: "action_plan" }],
      ["Treinar os usuários envolvidos", "deliverable", { template: "enablement_plan" }],
      ["Definir rotina de uso e suporte", "deliverable", { template: "action_plan" }],
      ["Acompanhar adoção", "deliverable", { template: "metrics_evidence" }],
      ["Medir resultado antes e depois", "deliverable", { template: "metrics_evidence" }],
      ["Corrigir falhas ou riscos encontrados", "deliverable", { template: "task_evidence" }],
      ["Apresentar resultados ao patrocinador", "deliverable", { template: "meeting_record" }],
      ["Decidir entre escalar, ajustar ou encerrar", "deliverable", { template: "meeting_record", hours: 2 }],
      ["Enviar atualização do piloto para validação", "checklist", { hours: 1, role: "CS" }],
    ]),
  },
  {
    n: 9,
    stage: "Capacitação",
    name: "Sprint de capacitação concluído",
    owner: "Operações",
    goal: "Participante concluiu a imersão e existe um plano de aplicação dos aprendizados no cliente.",
    durationWeeks: 2,
    exitCriteria: ["Participante concluiu a imersão", "Plano de aplicação dos aprendizados registrado"],
    tasks: build(9, "Operações", [
      ["Definir o participante enviado pelo cliente", "checklist", { party: "cliente", role: "Cliente" }],
      ["Confirmar datas e disponibilidade", "checklist"],
      ["Alinhar objetivo individual do participante", "checklist", { role: "Responsável" }],
      ["Enviar orientações de preparação", "checklist", { hours: 1 }],
      ["Garantir presença nos três dias", "checklist", { party: "cliente", role: "Cliente" }],
      ["Registrar aprendizados e materiais produzidos", "deliverable", { template: "enablement_plan" }],
      ["Fazer debrief com o responsável", "deliverable", { template: "meeting_record", role: "Responsável" }],
      ["Definir como os aprendizados serão aplicados no cliente", "deliverable", { template: "enablement_plan", role: "Responsável" }],
      ["Criar plano de compartilhamento interno", "deliverable", { template: "enablement_plan" }],
      ["Enviar preparação para o sprint de capacitação", "checklist", { hours: 1, role: "CS" }],
    ]),
  },
  {
    n: 10,
    stage: "Consolidação",
    name: "Revisão presencial e desbloqueio realizados",
    owner: "Responsável",
    goal: "Roadmap do segundo semestre aprovado e bloqueios críticos endereçados.",
    durationWeeks: 2,
    exitCriteria: ["Roadmap do segundo semestre aprovado", "Bloqueios críticos endereçados"],
    tasks: build(10, "Responsável", [
      ["Confirmar data e participantes", "checklist"],
      ["Revisar adoção e resultados dos projetos", "deliverable", { template: "metrics_evidence" }],
      ["Identificar bloqueios técnicos e organizacionais", "deliverable", { template: "task_evidence" }],
      ["Revisar o roadmap de IA", "deliverable", { template: "roadmap_ai" }],
      ["Repriorizar oportunidades", "deliverable", { template: "opportunity_assessment" }],
      ["Definir ações para os próximos seis meses", "deliverable", { template: "action_plan" }],
      ["Atualizar indicadores e responsáveis", "deliverable", { template: "metrics_evidence" }],
      ["Registrar decisões executivas", "deliverable", { template: "meeting_record", hours: 2 }],
      ["Enviar convite para a revisão semestral", "checklist", { hours: 1, role: "CS" }],
    ]),
  },
  {
    n: 11,
    stage: "Consolidação",
    name: "Operação de IA consolidada",
    owner: "Responsável",
    goal: "Projetos e adoção evoluem com cadência, indicadores atualizados e sem bloqueios críticos ignorados.",
    durationWeeks: 20,
    exitCriteria: ["Cadência mensal mantida com indicadores atualizados", "Nenhum bloqueio crítico ignorado"],
    tasks: build(11, "Responsável", [
      ["Realizar reunião mensal de acompanhamento", "deliverable", { template: "meeting_record", hours: 3 }],
      ["Revisar resultados desde o encontro anterior", "deliverable", { template: "metrics_evidence" }],
      ["Revisar projetos ativos", "deliverable", { template: "project_charter" }],
      ["Registrar bloqueios e decisões", "deliverable", { template: "meeting_record", hours: 2 }],
      ["Atualizar indicadores de adoção e impacto", "deliverable", { template: "metrics_evidence" }],
      ["Revisar prioridades do roadmap", "deliverable", { template: "roadmap_ai" }],
      ["Atualizar entregas, donos e prazos", "checklist"],
      ["Garantir que todo cliente tenha próximo passo com data", "checklist", { role: "CS" }],
      ["Escalar riscos para o patrocinador interno quando necessário", "checklist"],
      ["Enviar check-in mensal e próximos passos", "checklist", { hours: 1, role: "CS" }],
    ]),
  },
  {
    n: 12,
    stage: "Encerramento",
    name: "Ciclo anual concluído",
    owner: "Responsável + CS",
    goal: "Relatório anual apresentado e decisão sobre o próximo ciclo registrada.",
    durationWeeks: 2,
    exitCriteria: ["Relatório anual apresentado", "Decisão sobre o próximo ciclo registrada"],
    tasks: build(12, "Responsável", [
      ["Consolidar processos mapeados", "deliverable", { template: "process_map" }],
      ["Consolidar projetos executados", "deliverable", { template: "project_charter" }],
      ["Consolidar resultados e evidências", "deliverable", { template: "metrics_evidence" }],
      ["Comparar indicadores com a linha de base", "deliverable", { template: "metrics_evidence" }],
      ["Registrar aprendizados da jornada", "deliverable", { template: "enablement_plan" }],
      ["Levantar oportunidades ainda não executadas", "deliverable", { template: "opportunity_assessment" }],
      ["Realizar reunião executiva de fechamento", "deliverable", { template: "meeting_record", hours: 3 }],
      ["Apresentar roadmap recomendado para o próximo ciclo", "deliverable", { template: "roadmap_ai" }],
      ["Coletar feedback do patrocinador", "deliverable", { template: "meeting_record", hours: 2, role: "CS" }],
      ["Definir continuidade, expansão ou encerramento", "deliverable", { template: "meeting_record", hours: 2 }],
      ["Enviar fechamento anual e pedido de feedback", "checklist", { hours: 1, role: "CS" }],
    ]),
  },
];
