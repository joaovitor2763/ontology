// Conteúdo demonstrativo inteiramente sintético; nomes e narrativas não representam pessoas, clientes, documentos ou operações reais.
import { g4OsMessages } from "./g4-os-messages.ts";
import type {
  Hypothesis,
  CommunicationTemplate,
  Pain,
  Solution,
  Meeting,
  ProgramEvent,
  Thread,
} from "@/modules/engagement/domain/models";
export const meetings: Meeting[] = [
  {
    id: "m-sc-alta",
    company: "santa-clara",
    title: "Oficina fictícia de modelagem de fluxo assistencial",
    kind: "workshop",
    startsAt: "2026-09-09T10:00:00",
    durationMin: 90,
    attendeeIds: ["helena", "camila", "marina", "thiago"],
    summary:
      "Cenário sintético: o fluxo demonstrativo passa por elaboração, revisão e aprovação; um domínio opcional ficou fora desta versão.",
    notes:
      "Exemplo inteiramente fictício: a equipe revisa o rascunho antes de concluir. A demonstração usa apenas registros sintéticos. O grupo mapeou etapas e protocolos; um domínio opcional ficou para uma sessão futura.",
    decisions: [
      "Copiloto só sugere; enfermagem confirma antes de gravar no PEP.",
      "Demonstração restrita a unidades fictícias do cenário de teste.",
      "Demonstração com dois casos inteiramente sintéticos.",
    ],
    actions: [
      {
        text: "Subir rascunho v0.3 com o visto da enfermagem no fluxo",
        ownerId: "beatriz",
        dueAt: "2026-09-16",
      },
      {
        text: "Agendar farmacêutico clínico para o workshop de farmácia",
        ownerId: "helena",
        dueAt: "2026-09-18",
      },
      {
        text: "Preparar dois exemplos sintéticos para a demonstração",
        ownerId: "camila",
        dueAt: "2026-09-17",
      },
    ],
    relatedNodeIds: [
      "sc-alta",
      "sc-internacao",
      "sc-protocolo",
      "sc-prescricao",
    ],
  },
  {
    id: "m-sc-steer",
    company: "santa-clara",
    title: "Steering quinzenal",
    kind: "steering",
    startsAt: "2026-09-04T16:00:00",
    durationMin: 45,
    attendeeIds: ["helena", "marina", "beatriz"],
    summary:
      "LGPD ainda trava o PEP. Alex vai pessoalmente no jurídico na segunda.",
    notes:
      "Sem acesso de leitura, o piloto fica no CSV manual que a Bia exporta. Não escala e não é o teste que queremos. Alex assumiu o desbloqueio.",
    decisions: [
      "Manter a data da demo. Se o PEP não sair, demo no export manual, com ressalva.",
    ],
    actions: [
      {
        text: "Reunião com jurídico + DPO",
        ownerId: "helena",
        dueAt: "2026-09-15",
      },
      {
        text: "Plano B: parser do export da Bia",
        ownerId: "beatriz",
        dueAt: "2026-09-16",
      },
    ],
    relatedNodeIds: ["sc-prontuario"],
  },
  {
    id: "m-bl-pol",
    company: "banco-litoral",
    title: "Revisão da política de crédito v4.2",
    kind: "alinhamento",
    startsAt: "2026-09-10T11:00:00",
    durationMin: 60,
    attendeeIds: ["rafael", "marina", "thiago"],
    summary:
      "Rafael validou 11 das 14 regras. Três de garantia rural voltam na sexta.",
    notes:
      "A regra de veículo como garantia muda se o ano for anterior a 2018. Thiago vai reescrever. Score interno e bureau não podem ser somados — são evidências paralelas.",
    decisions: [
      "Score interno e bureau entram como evidências distintas.",
      "Garantia rural fora desta sprint.",
    ],
    actions: [
      {
        text: "Reescrever regra de veículo < 2018",
        ownerId: "thiago",
        dueAt: "2026-09-12",
      },
      {
        text: "Enviar os três casos rurais por escrito",
        ownerId: "rafael",
        dueAt: "2026-09-12",
      },
    ],
    relatedNodeIds: ["bl-proposta", "bl-score", "bl-garantia"],
  },
  {
    id: "m-ls-kick",
    company: "logisul",
    title: "Kickoff (reagendado)",
    kind: "kickoff",
    startsAt: "2026-09-02T09:00:00",
    durationMin: 60,
    attendeeIds: ["paulo", "omar", "marina"],
    summary:
      "Paulo saiu no meio para o aeroporto. Combinamos o workshop de rotas no dia 15, com o coordenador de despacho.",
    notes:
      "Sem o coordenador de despacho não conseguimos validar o processo. Paulo prometeu o termo de dados até sexta — ainda não chegou. Risco de o diagnóstico virar entrevista sem sistema.",
    decisions: [
      "Workshop de rotas em 15/09 com despacho presente.",
      "Termo de dados até 12/09.",
    ],
    actions: [
      {
        text: "Cobrar termo de dados no WhatsApp",
        ownerId: "omar",
        dueAt: "2026-09-12",
      },
      {
        text: "Confirmar presença do coordenador de despacho",
        ownerId: "paulo",
        dueAt: "2026-09-12",
      },
    ],
  },
  {
    id: "m-cv-casos",
    company: "campo-verde",
    title: "Diagnóstico da rotina de qualidade",
    kind: "workshop",
    startsAt: "2026-09-08T14:00:00",
    durationMin: 120,
    attendeeIds: ["luiza", "thiago", "marina"],
    summary:
      "Três melhorias priorizadas a partir de cinco oportunidades. Qualidade de grãos concentra as perdas operacionais.",
    notes:
      "Luiza propôs começar pela ocupação dos silos. Thiago apresentou os atrasos entre coleta e laudo de qualidade. O plano e a matriz de responsabilidades serão validados no dia 19, com o gerente industrial.",
    decisions: [
      "Validar o plano de melhoria antes de iniciar a próxima etapa.",
    ],
    actions: [
      {
        text: "Consolidar ações, indicadores e responsáveis no plano",
        ownerId: "thiago",
        dueAt: "2026-09-17",
      },
      {
        text: "Trazer o gerente industrial",
        ownerId: "luiza",
        dueAt: "2026-09-19",
      },
    ],
    relatedNodeIds: ["cv-silo", "cv-grao", "cv-talhao"],
  },
  {
    id: "m-vs-q3",
    company: "vertice-seguros",
    title: "Prévia da revisão Q3",
    kind: "steering",
    startsAt: "2026-09-11T09:30:00",
    durationMin: 30,
    attendeeIds: ["andre", "beatriz", "omar"],
    summary:
      "Aceite do rascunho em 71% no auto, 64% no residencial. Sul puxa para baixo.",
    notes:
      "André quer o número da regional Sul separado no deck. Dois reguladores recusam por hábito, não por qualidade. Omar faz sombra de mesa na terça.",
    decisions: [
      "Deck Q3 com corte por regional.",
      "Sem fork da ontologia para vida neste trimestre.",
    ],
    actions: [
      {
        text: "Sombra de mesa com os dois reguladores",
        ownerId: "omar",
        dueAt: "2026-09-16",
      },
      {
        text: "Cortar métricas por regional no deck",
        ownerId: "beatriz",
        dueAt: "2026-09-22",
      },
    ],
    relatedNodeIds: ["vs-sinistro", "vs-regulador"],
  },
];

export const threads: Thread[] = [
  {
    id: "t-sc-wa",
    company: "santa-clara",
    channel: "whatsapp",
    kind: "group",
    bot: true,
    title: "Grupo de demonstração · fluxo assistencial",
    counterpart: "Bia Demonstração + 4",
    participants: [
      "Bia Demonstração",
      "Alex Exemplo",
      "Marina Alves",
      "Thiago Nunes",
      "Equipe demonstrativa",
    ],
    lastAt: "2026-09-10T19:51:00",
    unread: 0,
    preview:
      "A equipe compartilhou exemplos sintéticos. Participação da equipe demonstrativa confirmada.",
    messages: [
      {
        at: "2026-09-10T16:05:00",
        from: "Marina Alves",
        source: "bot",
        text: "Para a demonstração, precisamos de dois exemplos sintéticos do cenário de teste. Pode compartilhar no grupo?",
      },
      {
        at: "2026-09-10T16:18:00",
        from: "Thiago Nunes",
        source: "bot",
        text: "Se puder, um com alta limpa e outro com prescrição pendente. É o buraco da ontologia.",
      },
      {
        at: "2026-09-10T16:22:00",
        from: "Bia Demonstração",
        source: "bot",
        text: "Sim. Vou usar dados inventados, sem identificadores ou registros de pessoas.",
      },
      {
        at: "2026-09-10T19:42:00",
        from: "Bia Demonstração",
        source: "bot",
        text: "Compartilhei os dois exemplos sintéticos no espaço de demonstração.",
        attachments: ["Dados clínicos sintéticos para demonstração.zip"],
      },
      {
        at: "2026-09-10T19:51:00",
        from: "Alex Exemplo",
        source: "bot",
        text: "Ok daqui. Só não colocar na sala sem a revisão da equipe demonstrativa.",
      },
      {
        at: "2026-09-11T08:10:00",
        from: "Thiago Nunes",
        kind: "note",
        text: "Bot capturou o grupo. Os exemplos sintéticos servem. Eu não respondo no WPP — deixo a Bia no ritmo do plantão.",
      },
    ],
  },
  {
    id: "t-sc-call",
    company: "santa-clara",
    channel: "call",
    kind: "call",
    title: "Alinhamento · leitura do PEP",
    counterpart: "Alex Exemplo",
    participants: ["Alex Exemplo", "Marina Alves", "Thiago Nunes"],
    durationMin: 32,
    lastAt: "2026-09-11T11:20:00",
    unread: 1,
    preview:
      "Exemplo fictício: a equipe aguarda validação de um documento demonstrativo.",
    messages: [
      {
        at: "2026-09-11T10:48:00",
        from: "Marina Alves",
        kind: "call",
        text: "Reunião fictícia de 32 min. O cenário de demonstração prevê acesso apenas de leitura a dados sintéticos e validação prévia de privacidade; não há conexão com prontuários ou sistemas reais.",
        attachments: ["Exemplo fictício - acordo de dados.pdf", "Escopo fictício de integração.pdf"],
      },
      {
        at: "2026-09-11T11:20:00",
        from: "Thiago Nunes",
        kind: "note",
        text: "Exemplo fictício: a validação documental precede qualquer integração demonstrativa.",
      },
    ],
  },
  {
    id: "t-sc-notes",
    company: "santa-clara",
    channel: "note",
    kind: "notes",
    title: "Notas da conta",
    counterpart: "Marina Alves, Thiago Nunes",
    participants: ["Marina Alves", "Thiago Nunes"],
    lastAt: "2026-09-11T14:08:00",
    unread: 0,
    preview:
      "Thiago tira farmácia do roteiro da demo. Marina confirma: só alta + leito.",
    messages: [
      {
        at: "2026-09-11T09:22:00",
        from: "Marina Alves",
        kind: "note",
        text: "O mapa de unidades foi revisado. Que elemento falta na ontologia demonstrativa?",
      },
      {
        at: "2026-09-11T09:31:00",
        from: "Thiago Nunes",
        kind: "note",
        text: "Faltam relações no domínio de registros sintéticos; demais elementos estão cobertos para a demonstração.",
      },
      {
        at: "2026-09-11T14:08:00",
        from: "Thiago Nunes",
        kind: "note",
        text: "O domínio opcional ainda está incompleto; vou removê-lo do roteiro demonstrativo por enquanto.",
      },
      {
        at: "2026-09-11T14:16:00",
        from: "Marina Alves",
        kind: "note",
        text: "Combinado. A demonstração cobre apenas o fluxo fictício de alta e unidades.",
      },
    ],
  },
  {
    id: "t-bl-call",
    company: "banco-litoral",
    channel: "call",
    kind: "call",
    title: "Homologação API de restrição",
    counterpart: "Rafa Exemplo",
    participants: ["Rafa Exemplo", "Marina Alves", "Beatriz Lopes"],
    durationMin: 28,
    lastAt: "2026-09-10T11:40:00",
    unread: 0,
    preview:
      "Ambiente com CPF mascarado sobe na quarta. Regra do veículo rural ainda não está na v4.2.",
    messages: [
      {
        at: "2026-09-10T11:12:00",
        from: "Beatriz Lopes",
        kind: "call",
        text: "Call de 28 min com Rafael. Ambiente com CPF mascarado sobe na quarta. Contrato da API está com a Beatriz. A regra de veículo < 2018 rural ainda não está escrita na v4.2 — Rafael mandou três casos por fora.",
        attachments: [
          "Contrato API restrição.pdf",
          "Política de crédito v4.2.pdf",
        ],
      },
    ],
  },
  {
    id: "t-ls-wa",
    company: "logisul",
    channel: "whatsapp",
    kind: "direct",
    bot: true,
    title: "Pat Exemplo",
    counterpart: "Pat Exemplo",
    participants: ["Pat Exemplo", "Omar Dias"],
    lastAt: "2026-09-08T21:03:00",
    unread: 2,
    preview: "Paulo no Chile até quinta. Termo fica para a volta.",
    messages: [
      {
        at: "2026-09-06T13:10:00",
        from: "Omar Dias",
        source: "bot",
        text: "Paulo, sem o termo a gente não entra no TMS. Consegue assinar hoje?",
      },
      {
        at: "2026-09-08T21:03:00",
        from: "Pat Exemplo",
        source: "bot",
        text: "Estou no Chile até quinta. O termo fica para a volta. Despacho está avisado do dia 15.",
      },
      {
        at: "2026-09-09T09:04:00",
        from: "Omar Dias",
        kind: "note",
        text: "Não cobro no WPP enquanto ele está fora. Workshop do dia 15 segue; termo na volta.",
      },
    ],
  },
  {
    id: "t-cv-wa",
    company: "campo-verde",
    channel: "whatsapp",
    kind: "direct",
    bot: true,
    title: "Luiza · comitê dia 19",
    counterpart: "Lia Exemplo",
    participants: ["Lia Exemplo", "Thiago Nunes"],
    lastAt: "2026-09-11T07:55:00",
    unread: 1,
    preview: "Rico Exemplo leu o plano. Ele quer começar pela rotina dos silos.",
    messages: [
      {
        at: "2026-09-10T18:10:00",
        from: "Thiago Nunes",
        source: "bot",
        text: "Luiza, mandei o plano com as três melhorias, os indicadores e os responsáveis propostos.",
        attachments: ["Plano de melhoria da qualidade.pdf"],
      },
      {
        at: "2026-09-11T07:55:00",
        from: "Lia Exemplo",
        source: "bot",
        text: "Rico Exemplo leu o plano. Ele quer começar pela rotina dos silos. Confirma se o fluxo do laboratório entra agora ou na segunda etapa.",
      },
    ],
  },
  {
    id: "t-vs-call",
    company: "vertice-seguros",
    channel: "call",
    kind: "call",
    title: "Revisão Q3 · regional Sul",
    counterpart: "Ari Exemplo",
    participants: ["Ari Exemplo", "Beatriz Lopes"],
    durationMin: 40,
    lastAt: "2026-09-11T10:02:00",
    unread: 0,
    preview: "Separar o Sul no deck. Vida fora deste trimestre.",
    messages: [
      {
        at: "2026-09-11T10:02:00",
        from: "Beatriz Lopes",
        kind: "call",
        text: "Call de 40 min. André quer o Sul separado no deck Q3 — ver se é gente ou mix de produto. Vida continua fora deste trimestre.",
      },
    ],
  },
];

export const events: ProgramEvent[] = [
  {
    id: "e-sc-demo",
    company: "santa-clara",
    title: "Demo copiloto de alta",
    kind: "Demo",
    startsAt: "2026-09-18T14:00:00",
    place: "Unidade fictícia · sala de demonstração",
    detail:
      "Exemplos inteiramente sintéticos; equipe demonstrativa participará da sessão.",
  },
  {
    id: "e-sc-treino",
    company: "santa-clara",
    title: "Treinamento enfermagem · turma 1",
    kind: "Treinamento",
    startsAt: "2026-09-22T08:00:00",
    place: "Centro de simulação",
    detail: "Sessão demonstrativa de 90 minutos com participantes fictícios.",
  },
  {
    id: "e-bl-homo",
    company: "banco-litoral",
    title: "Homologação API de restrição",
    kind: "Integração",
    startsAt: "2026-09-16T11:00:00",
    place: "Remoto · core bancário",
    detail:
      "Beatriz com o time de APIs. Precisa do ambiente com CPF mascarado.",
  },
  {
    id: "e-ls-ws",
    company: "logisul",
    title: "Workshop do fluxo de despacho",
    kind: "Workshop",
    startsAt: "2026-09-15T09:00:00",
    place: "Sede Curitiba · sala de despacho",
    detail:
      "Primeira passagem. Sem o coordenador de despacho a sessão não vale.",
  },
  {
    id: "e-cv-prio",
    company: "campo-verde",
    title: "Validação do plano de qualidade",
    kind: "Comitê",
    startsAt: "2026-09-19T10:00:00",
    place: "Unidade Ribeirão · sala da diretoria",
    detail:
      "Luiza, Rico Exemplo (industrial) e Thiago. Aprovação das ações, prazos e responsabilidades.",
  },
  {
    id: "e-vs-q3",
    company: "vertice-seguros",
    title: "Revisão trimestral de sinistros",
    kind: "Comitê",
    startsAt: "2026-09-25T16:00:00",
    place: "Porto Alegre · 12º andar",
    detail: "Deck com corte por regional. Decisão sobre vida fica para Q4.",
  },
];

/** Diagnosis captured in seeded meetings. Fictional, like the rest of the demo. */
export const pains: Pain[] = [
  {
    id: "pain-sc-1",
    company: "santa-clara",
    meetingId: "m-sc-alta",
    title: "Prescrição de alta sem conciliação com a farmácia",
    description:
      "Exemplo sintético: registros de demonstração chegam à revisão com possíveis duplicidades, exigindo conferência manual.",
    area: "Assistência clínica",
    severity: "alta",
    frequency: "diaria",
    impact: "Pode aumentar o tempo de revisão no cenário de demonstração.",
    confidence: 85,
    status: "validada",
    evidence: "Cenário inteiramente fictício; sem dados ou amostras de pacientes.",
    createdAt: "2026-09-09T11:30:00",
  },
  {
    id: "pain-sc-2",
    company: "santa-clara",
    meetingId: "m-sc-alta",
    title: "Leito só é liberado depois da alta administrativa",
    description:
      "No cenário fictício, a unidade só é liberada após o registro administrativo do encerramento.",
    area: "Operações hospitalares",
    severity: "media",
    frequency: "diaria",
    impact: "Fila de internação e giro de leito abaixo da meta.",
    confidence: 70,
    status: "aberta",
    createdAt: "2026-09-09T11:40:00",
  },
  {
    id: "pain-ls-1",
    company: "logisul",
    meetingId: "m-ls-kick",
    title: "Decisão de despacho depende de uma pessoa",
    description:
      "As rotas do dia são fechadas por um coordenador com base em experiência; sem ele, o despacho atrasa.",
    area: "Operação",
    severity: "alta",
    frequency: "diaria",
    impact: "Atraso médio de 40 minutos na saída da frota quando o coordenador não está.",
    confidence: 60,
    status: "aberta",
    createdAt: "2026-09-02T10:00:00",
  },
];

export const solutions: Solution[] = [
  {
    id: "sol-sc-1",
    company: "santa-clara",
    meetingId: "m-sc-alta",
    title: "Rascunho de alta revisado pela farmácia antes da assinatura",
    description:
      "O resumo fictício passa por uma etapa de revisão antes da aprovação, com conferências demonstrativas.",
    painIds: ["pain-sc-1"],
    hypothesis:
      "Se houver revisão no fluxo demonstrativo, espera-se identificar inconsistências sintéticas antes da aprovação.",
    ownerId: "marina",
    effort: "medio",
    expectedImpact: "Redução de 50% do retrabalho de enfermagem na alta.",
    successMetric: "Altas revisadas pela farmácia / altas totais, por semana.",
    status: "aprovada",
    tradeoffs: { time: "baixo", capital: "baixo", talent: "medio" },
    chosen: true,
    chosenReason:
      "No exemplo fictício, a alternativa pode ser testada pela equipe demonstrativa sem integração com sistemas reais.",
    createdAt: "2026-09-09T12:00:00",
  },
  {
    id: "sol-sc-2",
    company: "santa-clara",
    meetingId: "m-sc-alta",
    title: "Checagem automática em registros sintéticos",
    description:
      "Regras de demonstração verificam possíveis duplicidades em registros sintéticos e mostram um alerta de exemplo.",
    painIds: ["pain-sc-1"],
    hypothesis:
      "Se o alerta for exibido no fluxo demonstrativo, a equipe pode revisar o exemplo antes da aprovação.",
    ownerId: "thiago",
    effort: "alto",
    expectedImpact: "Revisão manual deixa de existir para 80% das altas.",
    successMetric: "Alertas gerados e aceitos na prescrição de alta, por semana.",
    status: "proposta",
    tradeoffs: { time: "alto", capital: "alto", talent: "alto" },
    createdAt: "2026-09-09T12:10:00",
  },
  {
    id: "sol-ls-1",
    company: "logisul",
    meetingId: "m-ls-kick",
    title: "Regras explícitas de fechamento de rota com checklist diário",
    description:
      "Documentar os critérios que o coordenador usa hoje e transformá-los em um checklist que qualquer supervisor consegue seguir.",
    painIds: ["pain-ls-1"],
    hypothesis:
      "Se os critérios ficarem explícitos, esperamos que o despacho saia no horário sem o coordenador porque a decisão deixa de depender de memória.",
    ownerId: "omar",
    effort: "baixo",
    expectedImpact: "Saída da frota no horário mesmo nas ausências do coordenador.",
    successMetric: "Atraso médio de saída nos dias sem o coordenador.",
    status: "proposta",
    tradeoffs: { time: "baixo", capital: "baixo", talent: "baixo" },
    createdAt: "2026-09-02T11:00:00",
  },
];

/** Reusable messages for moments of the engagement. Copy is original and neutral. */
export const communicationTemplates: CommunicationTemplate[] = [
  ...g4OsMessages,
  {
    id: "tpl-wa-boas-vindas",
    name: "Boas-vindas ao projeto",
    channel: "whatsapp",
    milestone: 1,
    objective:
      "Abrir o canal oficial, apresentar quem conduz o trabalho e pedir a primeira ação do cliente.",
    variables: ["cliente", "contato", "responsavel", "link", "proximo_passo"],
    defaultVariationId: "tpl-wa-boas-vindas-v1",
    pairedTemplateId: "tpl-email-boas-vindas",
    variations: [
      {
        id: "tpl-wa-boas-vindas-v1",
        approach: "Direto e acolhedor",
        headline: "Começamos",
        body: "Olá, {{contato}}. Este é o canal oficial do projeto com a {{cliente}}.\n\nAqui vão ficar combinados, pedidos e próximos passos, para nada se perder em conversas paralelas. Quem conduz do nosso lado é {{responsavel}}.\n\nPrimeiro passo: {{proximo_passo}}. Quando puder, confirme por aqui.",
        cta: "Confirmar leitura no grupo",
        score: 88,
        reasoning:
          "Diz o que é o canal, quem conduz e o que fazer agora. Curto o bastante para ser lido no celular.",
        scoreBreakdown: { canal: 92, clarezaCta: 90, engajamento: 82, gancho: 84 },
      },
      {
        id: "tpl-wa-boas-vindas-v2",
        approach: "Contexto do contrato",
        headline: "Canal oficial da {{cliente}}",
        body: "Bem-vindos ao canal do projeto, {{cliente}}.\n\nVocês estão aqui porque saíram da intenção e entraram na execução. Nosso papel é fazer o trabalho avançar sem ruído: {{responsavel}} coordena os marcos e {{contato}} é a referência de vocês nos alinhamentos.\n\nO ponto de partida está aqui: {{link}}",
        cta: "Abrir o ponto de partida",
        score: 81,
        reasoning:
          "Reforça papéis e dá um link, mas o gancho é menos pessoal que a versão direta.",
        scoreBreakdown: { canal: 86, clarezaCta: 84, engajamento: 78, gancho: 76 },
      },
    ],
  },
  {
    id: "tpl-email-boas-vindas",
    name: "Boas-vindas ao projeto",
    channel: "email",
    milestone: 1,
    objective: "Registrar por e-mail a abertura do projeto e o primeiro passo.",
    variables: ["cliente", "contato", "responsavel", "link", "proximo_passo"],
    defaultVariationId: "tpl-email-boas-vindas-v1",
    pairedTemplateId: "tpl-wa-boas-vindas",
    variations: [
      {
        id: "tpl-email-boas-vindas-v1",
        approach: "Registro formal com próximo passo",
        subject: "Início do projeto com a {{cliente}}",
        preview: "Quem conduz, como vamos trabalhar e o primeiro passo.",
        body: "Olá, {{contato}}.\n\nÉ um prazer iniciar o trabalho com a {{cliente}}. A partir de agora, {{responsavel}} conduz o projeto do nosso lado e centraliza combinados e próximos passos.\n\nComo vamos trabalhar: ciclos curtos com entregas definidas, revisão conjunta ao fim de cada ciclo e aceite registrado por vocês.\n\nPrimeiro passo: {{proximo_passo}}.\nMaterial de referência: {{link}}\n\nQualquer dúvida, responda este e-mail.",
        cta: "Responder confirmando o primeiro passo",
        score: 85,
        reasoning:
          "Formal o suficiente para ser encaminhado internamente, com o método explicado em três linhas.",
        scoreBreakdown: { canal: 88, clarezaCta: 86, engajamento: 80, gancho: 82 },
      },
    ],
  },
  {
    id: "tpl-wa-kickoff",
    name: "Confirmação de kickoff",
    channel: "whatsapp",
    milestone: 2,
    objective: "Confirmar data, pauta e presenças do kickoff.",
    variables: ["cliente", "contato", "data", "hora", "link"],
    defaultVariationId: "tpl-wa-kickoff-v1",
    pairedTemplateId: "tpl-email-kickoff",
    variations: [
      {
        id: "tpl-wa-kickoff-v1",
        approach: "Confirmação objetiva",
        headline: "Kickoff confirmado",
        body: "{{contato}}, kickoff da {{cliente}} confirmado para {{data}} às {{hora}}.\n\nPauta: objetivos do projeto, indicadores de sucesso e o plano dos primeiros ciclos.\n\nLink e materiais: {{link}}\n\nPode confirmar quem participa do lado de vocês?",
        cta: "Confirmar participantes",
        score: 90,
        reasoning: "Data, pauta e pedido claro em quatro linhas.",
        scoreBreakdown: { canal: 94, clarezaCta: 92, engajamento: 84, gancho: 86 },
      },
      {
        id: "tpl-wa-kickoff-v2",
        approach: "Preparação do cliente",
        headline: "Antes do kickoff",
        body: "Para aproveitarmos o kickoff de {{data}}, vale trazer: quem decide sobre o projeto, os três problemas que mais doem hoje e o que seria sucesso em 90 dias.\n\nNão precisa preparar apresentação. É uma conversa de trabalho. Link: {{link}}",
        cta: "Trazer as três respostas",
        score: 83,
        reasoning:
          "Prepara a conversa e reduz kickoffs genéricos, mas exige mais do cliente.",
        scoreBreakdown: { canal: 86, clarezaCta: 80, engajamento: 88, gancho: 80 },
      },
    ],
  },
  {
    id: "tpl-email-kickoff",
    name: "Confirmação de kickoff",
    channel: "email",
    milestone: 2,
    objective: "Registrar a agenda do kickoff com pauta e participantes.",
    variables: ["cliente", "contato", "data", "hora", "link"],
    defaultVariationId: "tpl-email-kickoff-v1",
    pairedTemplateId: "tpl-wa-kickoff",
    variations: [
      {
        id: "tpl-email-kickoff-v1",
        approach: "Convite com pauta",
        subject: "Kickoff · {{cliente}} · {{data}}",
        preview: "Pauta e materiais do encontro inicial.",
        body: "Olá, {{contato}}.\n\nConfirmamos o kickoff para {{data}} às {{hora}}.\n\nPauta:\n1. Objetivos e resultado esperado do projeto\n2. Indicadores de sucesso\n3. Plano dos primeiros ciclos e responsáveis\n4. Rituais e canal de comunicação\n\nMateriais: {{link}}\n\nSe puder, confirme os participantes do lado da {{cliente}}.",
        cta: "Confirmar participantes",
        score: 87,
        reasoning: "Pauta numerada facilita o encaminhamento interno.",
        scoreBreakdown: { canal: 90, clarezaCta: 88, engajamento: 82, gancho: 84 },
      },
    ],
  },
  {
    id: "tpl-wa-documentos",
    name: "Solicitação de documentos",
    channel: "whatsapp",
    milestone: 2,
    objective: "Pedir os documentos e acessos necessários para o diagnóstico.",
    variables: ["cliente", "contato", "documentos", "data", "link"],
    defaultVariationId: "tpl-wa-documentos-v1",
    pairedTemplateId: "tpl-email-documentos",
    variations: [
      {
        id: "tpl-wa-documentos-v1",
        approach: "Lista curta com prazo",
        headline: "Precisamos de três coisas",
        body: "{{contato}}, para começar o diagnóstico da {{cliente}} precisamos de: {{documentos}}.\n\nSe conseguirem enviar até {{data}}, mantemos o cronograma. Pode ser por aqui ou pelo link: {{link}}",
        cta: "Enviar até a data combinada",
        score: 86,
        reasoning: "Pedido concreto com prazo e caminho de envio.",
        scoreBreakdown: { canal: 90, clarezaCta: 90, engajamento: 78, gancho: 82 },
      },
    ],
  },
  {
    id: "tpl-email-documentos",
    name: "Solicitação de documentos",
    channel: "email",
    milestone: 2,
    objective: "Formalizar o pedido de documentos e acessos com prazo.",
    variables: ["cliente", "contato", "documentos", "data", "link"],
    defaultVariationId: "tpl-email-documentos-v1",
    pairedTemplateId: "tpl-wa-documentos",
    variations: [
      {
        id: "tpl-email-documentos-v1",
        approach: "Pedido formal com prazo",
        subject: "Documentos para o diagnóstico · {{cliente}}",
        preview: "O que precisamos receber e até quando.",
        body: "Olá, {{contato}}.\n\nPara iniciar o diagnóstico, precisamos receber até {{data}}:\n{{documentos}}\n\nO envio pode ser feito pelo link: {{link}}\n\nSe algum item não existir ou depender de outra área, nos avise para ajustarmos o plano sem perder o prazo.",
        cta: "Enviar os documentos pelo link",
        score: 84,
        reasoning: "Antecipa a exceção mais comum, a de o documento não existir.",
        scoreBreakdown: { canal: 88, clarezaCta: 86, engajamento: 80, gancho: 78 },
      },
    ],
  },
  {
    id: "tpl-email-resumo-1p",
    name: "Resumo executivo de 1 página",
    channel: "email",
    objective:
      "Enviar antes da reunião o essencial em uma página: situação, complicação, pergunta, resposta e próximos passos.",
    variables: [
      "cliente",
      "contato",
      "situacao",
      "complicacao",
      "pergunta",
      "resposta",
      "proximos_passos",
      "data",
    ],
    defaultVariationId: "tpl-email-resumo-1p-v1",
    variations: [
      {
        id: "tpl-email-resumo-1p-v1",
        approach: "Pirâmide: resposta primeiro",
        subject: "Resumo executivo · {{cliente}} · {{data}}",
        preview: "Uma página para ler antes da reunião.",
        body: "Olá, {{contato}}.\n\nSegue o resumo de uma página para lermos antes do encontro de {{data}}.\n\nSituação\n{{situacao}}\n\nComplicação\n{{complicacao}}\n\nPergunta que estamos respondendo\n{{pergunta}}\n\nResposta\n{{resposta}}\n\nPróximos passos\n{{proximos_passos}}\n\nO detalhe das análises fica no anexo; na reunião vamos direto às conclusões e às alternativas.",
        cta: "Ler antes da reunião e responder com dúvidas",
        score: 90,
        reasoning:
          "A resposta aparece nos primeiros 30 segundos de leitura; contexto e evidência ficam depois e no anexo.",
        scoreBreakdown: { canal: 92, clarezaCta: 88, engajamento: 86, gancho: 90 },
      },
    ],
  },
  {
    id: "tpl-email-atualizacao-3p",
    name: "Atualização semanal em 3 pontos",
    channel: "email",
    objective:
      "Manter o patrocinador informado em três blocos curtos: o que estamos fazendo, quais são os problemas e o que pensamos sobre eles.",
    variables: ["cliente", "contato", "fazendo", "problemas", "avaliacao", "proximo_passo"],
    defaultVariationId: "tpl-email-atualizacao-3p-v1",
    variations: [
      {
        id: "tpl-email-atualizacao-3p-v1",
        approach: "Três blocos, um parágrafo cada",
        subject: "Semana com a {{cliente}} · 3 pontos",
        preview: "O que fizemos, o que trava e o que pensamos.",
        body: "Olá, {{contato}}.\n\n1. O que estamos fazendo\n{{fazendo}}\n\n2. Quais são os problemas\n{{problemas}}\n\n3. O que pensamos sobre eles\n{{avaliacao}}\n\nPróximo passo: {{proximo_passo}}.\n\nSe algum ponto merecer conversa, respondo por aqui ou marcamos 20 minutos.",
        cta: "Responder com ajustes ou aprovar o próximo passo",
        score: 86,
        reasoning:
          "Cabe em uma tela de celular, tem no máximo quatro pontos e termina com uma ação clara.",
        scoreBreakdown: { canal: 88, clarezaCta: 90, engajamento: 82, gancho: 80 },
      },
    ],
  },
];

/** Diagnosis hypotheses of the demo clients (root causes being proved or disproved). */
export const hypotheses: Hypothesis[] = [
  {
    id: "hyp-sc-1",
    company: "santa-clara",
    statement:
      "A alta atrasa porque a prescrição chega à farmácia sem revisão, não por falta de leitos.",
    rootCause: "Ausência de conciliação medicamentosa antes da assinatura da alta.",
    status: "confirmada",
    painIds: ["pain-sc-1"],
    ownerId: "marina",
    evidence: [
      {
        id: "ev-sc-1a",
        at: "2026-09-04T16:30:00",
        kind: "confirma",
        note: "Chefia de enfermagem relatou retrabalho diário na alta por interações não checadas.",
        meetingId: "m-sc-steer",
        source: "entrevista",
        by: "marina",
      },
      {
        id: "ev-sc-1b",
        at: "2026-09-09T11:00:00",
        kind: "confirma",
        note: "Métrica fictícia para demonstração, sem amostra ou registros de pacientes.",
        meetingId: "m-sc-alta",
        source: "dados",
        by: "thiago",
      },
    ],
    createdAt: "2026-09-03T10:00:00",
    updatedAt: "2026-09-09T11:00:00",
  },
  {
    id: "hyp-sc-2",
    company: "santa-clara",
    statement:
      "O giro de leito é baixo porque a alta administrativa depende de um único setor.",
    rootCause: "Fluxo administrativo centralizado na recepção.",
    status: "refinada",
    painIds: ["pain-sc-2"],
    ownerId: "marina",
    evidence: [
      {
        id: "ev-sc-2a",
        at: "2026-09-09T11:30:00",
        kind: "refina",
        note: "Exemplo sintético: a recepção conclui rapidamente; o ponto de espera está na aprovação administrativa.",
        meetingId: "m-sc-alta",
        source: "entrevista",
        by: "marina",
      },
    ],
    createdAt: "2026-09-03T10:10:00",
    updatedAt: "2026-09-09T11:30:00",
  },
  {
    id: "hyp-sc-3",
    company: "santa-clara",
    statement:
      "Exemplo fictício: a liberação aguarda uma aprovação administrativa no fluxo.",
    rootCause: "Aprovação administrativa vinculada à etapa de revisão no fluxo sintético.",
    status: "em-teste",
    painIds: ["pain-sc-2"],
    parentId: "hyp-sc-2",
    ownerId: "marina",
    evidence: [],
    createdAt: "2026-09-09T11:35:00",
  },
  {
    id: "hyp-ls-1",
    company: "logisul",
    statement:
      "O despacho atrasa sem o coordenador porque os critérios de fechamento de rota não estão escritos em lugar nenhum.",
    rootCause: "Conhecimento tácito de uma pessoa.",
    status: "em-teste",
    painIds: ["pain-ls-1"],
    ownerId: "omar",
    evidence: [
      {
        id: "ev-ls-1a",
        at: "2026-09-02T10:30:00",
        kind: "confirma",
        note: "COO confirmou que não existe procedimento escrito; o coordenador fecha as rotas “de cabeça”.",
        meetingId: "m-ls-kick",
        source: "entrevista",
        by: "omar",
      },
    ],
    createdAt: "2026-09-01T09:00:00",
    updatedAt: "2026-09-02T10:30:00",
  },
  {
    id: "hyp-ls-2",
    company: "logisul",
    statement:
      "O atraso na saída da frota vem da falta de motoristas escalados, não da decisão de rota.",
    rootCause: "Escala de motoristas insuficiente nos picos.",
    status: "refutada",
    painIds: ["pain-ls-1"],
    ownerId: "omar",
    evidence: [
      {
        id: "ev-ls-2a",
        at: "2026-09-02T10:45:00",
        kind: "contradiz",
        note: "Nos dias com o coordenador presente a frota sai no horário com a mesma escala; o atraso só aparece nas ausências dele.",
        meetingId: "m-ls-kick",
        source: "dados",
        by: "omar",
      },
    ],
    createdAt: "2026-09-01T09:05:00",
    updatedAt: "2026-09-02T10:45:00",
  },
  {
    id: "hyp-cv-1",
    company: "campo-verde",
    statement:
      "As perdas operacionais se concentram na rotina dos silos, não no laboratório.",
    rootCause: "Rotina de inspeção dos silos sem responsável e sem frequência definida.",
    status: "aberta",
    painIds: [],
    ownerId: "thiago",
    evidence: [],
    createdAt: "2026-09-08T15:00:00",
  },
];
