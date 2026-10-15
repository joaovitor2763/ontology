import type {
  CommunicationTemplate,
  CommunicationVariation,
} from "@/modules/engagement/domain/models";

/**
 * WhatsApp message models of the G4 OS Founding Companies program, ported
 * verbatim from the previous delivery system (journey "Founding Companies").
 * Variables were mapped to this platform's names: {{empresa}} → {{cliente}},
 * {{ai_master}} → {{responsavel}}. All of them belong to milestone 1
 * ("Estabelecer canal de comunicação com o cliente"), as in the source.
 */
const SCORES = [
  { score: 84, breakdown: { canal: 88, clarezaCta: 86, engajamento: 80, gancho: 82 } },
  { score: 79, breakdown: { canal: 84, clarezaCta: 80, engajamento: 78, gancho: 76 } },
  { score: 75, breakdown: { canal: 80, clarezaCta: 76, engajamento: 74, gancho: 72 } },
];

function variation(
  id: string,
  approach: string,
  headline: string,
  body: string,
  cta: string,
  rank: 0 | 1 | 2,
): CommunicationVariation {
  const { score, breakdown } = SCORES[rank];
  return {
    id,
    approach,
    headline,
    body: body.replace(/\{\{empresa\}\}/g, "{{cliente}}").replace(/\{\{ai_master\}\}/g, "{{responsavel}}"),
    cta,
    score,
    reasoning:
      "Variação original do programa G4 OS Founding Companies; a pontuação é a ordem editorial de referência, não uma medição.",
    scoreBreakdown: breakdown,
  };
}

function template(
  id: string,
  name: string,
  objective: string,
  variables: string[],
  variations: CommunicationVariation[],
): CommunicationTemplate {
  return {
    id,
    name,
    channel: "whatsapp",
    milestone: 1,
    objective,
    variables: variables.map((v) => (v === "empresa" ? "cliente" : v === "ai_master" ? "responsavel" : v)),
    variations,
    defaultVariationId: variations[0].id,
  };
}

export const g4OsMessages: CommunicationTemplate[] = [
  template(
    "g4os-convite-grupo",
    "Convite para o grupo de onboarding",
    "Convidar o contato do cliente para o grupo oficial de onboarding, com o link de entrada.",
    ["empresa", "link"],
    [
      variation(
        "g4os-convite-grupo-v1",
        "Convite direto com link",
        "Grupo oficial de onboarding",
        `Olá! Tudo bem? Criamos o grupo oficial de onboarding da {{empresa}} no G4 OS Founding Companies. Para entrar, é só acessar:
{{link}}

Assim que você entrar, enviaremos por lá as orientações e os próximos passos.`,
        "ENTRAR NO GRUPO",
        0,
      ),
    ],
  ),
  template(
    "g4os-welcome",
    "Boas-vindas à ativação",
    "Recepcionar a Founding Company, apresentar o canal oficial da ativação e orientar a primeira ação operacional.",
    ["empresa", "contato", "ai_master", "link"],
    [
      variation("g4os-welcome-v1", "Bate-papo + clareza operacional", "Bem-vindos à ativação do G4 OS 👋", `*Bem-vindos, {{empresa}}.* Este será o canal oficial da nossa ativação do G4 OS. 👋

Por aqui, {{ai_master}} vai centralizar orientações, combinados e próximos passos — sem informação perdida em conversas paralelas.

Para começar, pedimos que {{contato}} confira o ponto de partida da jornada: {{link}}

👉 Depois, responda *CONFIRMADO* neste grupo.

_A ativação começa bem quando todo mundo sabe onde olhar e qual é o próximo passo._`, "CONFIRMAR LEITURA NO GRUPO", 0),
      variation("g4os-welcome-v2", "Exclusividade construída + definição de papéis", "{{cliente}} agora é uma Founding Company", `🏆 *{{empresa}}, este grupo marca o início da sua jornada como G4 OS Founding Company.*

Você está aqui porque já saiu da intenção e entrou na execução. Agora, o foco é fazer a ativação avançar sem ruído.

{{ai_master}} conduzirá os marcos da jornada, e {{contato}} será nossa referência para os alinhamentos do projeto.

👉 O primeiro passo está aqui: {{link}}

_Contrato assinado abre a porta. Execução coordenada coloca o sistema para rodar._`, "ACESSAR O PRIMEIRO PASSO", 1),
      variation("g4os-welcome-v3", "Consequência de não alinhar + ponto único de verdade", "Um canal. Um responsável. Um próximo passo.", `*Ativação sem dono vira uma sequência de pendências.* Aqui, vamos fazer diferente. 🧠

Este grupo será o ponto único de verdade da ativação de {{empresa}}: decisões, responsáveis e próximos passos ficam registrados aqui.

{{ai_master}} lidera a jornada com vocês, e {{contato}} nos ajuda a manter o fluxo avançando.

👉 Salve este grupo e consulte o início da jornada: {{link}}

_Clareza hoje evita retrabalho amanhã._`, "CONSULTAR O INÍCIO DA JORNADA", 2),
    ],
  ),
  template(
    "g4os-access",
    "Instruções para o primeiro acesso",
    "Orientar o primeiro acesso ao G4 OS e obter confirmação de que o cliente entrou na plataforma.",
    ["empresa", "contato", "ai_master", "link"],
    [
      variation("g4os-access-v1", "Passo a passo + redução de atrito", "🔓 Primeiro acesso liberado", `*O acesso de {{empresa}} ao G4 OS está pronto.*

Para entrar sem ruído:
1. Acesse {{link}}
2. Entre com seu e-mail corporativo
3. Conclua a configuração inicial

Se algo travar, sinalize aqui e marque {{ai_master}}.

👉 {{contato}}, quando concluir, responda *ACESSO OK*.

_Primeiro acesso concluído. Primeira barreira removida._`, "CONFIRMAR ACESSO NO GRUPO", 0),
      variation("g4os-access-v2", "Quebra de objeção + suporte imediato", "Seu primeiro acesso leva poucos passos", `*Hora de colocar o G4 OS nas mãos de {{empresa}}.* 🧠

E eu sei que sua cabeça pode ir para senha, permissão ou configuração. *Mas não é para você resolver isso sozinho.*

Acesse {{link}} com seu e-mail corporativo e siga a configuração inicial. Se houver qualquer bloqueio, {{ai_master}} resolve com vocês por aqui.

👉 Ao entrar, responda *ESTOU DENTRO*.

_A tecnologia só começa a gerar valor depois que o acesso deixa de ser pendência._`, "FAZER MEU PRIMEIRO ACESSO", 1),
      variation("g4os-access-v3", "Checklist visual + consequência de não agir", "Acesso pendente trava o próximo marco ⚠️", `*Antes do kickoff, precisamos validar o acesso de {{empresa}}.*

❌ Sem acesso: dúvidas e configuração ficam para a reunião.
✅ Com acesso: o kickoff começa direto no que importa.

{{contato}}, entre por {{link}} e conclua a configuração inicial. {{ai_master}} está neste grupo caso precise de apoio.

👉 Finalizou? Responda *ACESSO VALIDADO*.

_O melhor kickoff começa antes da agenda abrir._`, "VALIDAR MEU ACESSO", 2),
    ],
  ),
  template(
    "g4os-kickoff-confirmation",
    "Confirmação do kickoff",
    "Confirmar data, hora e link do kickoff, garantindo presença e preparação dos participantes.",
    ["empresa", "contato", "ai_master", "data", "hora", "link"],
    [
      variation("g4os-kickoff-confirmation-v1", "Confirmação transacional + agenda objetiva", "Kickoff confirmado ✅", `*Kickoff de {{empresa}} confirmado.*

📅 Data: {{data}}
⏰ Horário: {{hora}}
🔗 Sala: {{link}}

{{ai_master}} vai conduzir o encontro e alinhar objetivo, responsáveis e próximos marcos da ativação.

👉 {{contato}}, responda *CONFIRMADO* após validar a agenda dos participantes.

_Reunião confirmada antes evita agenda vazia na hora de executar._`, "CONFIRMAR PRESENÇA NO GRUPO", 0),
      variation("g4os-kickoff-confirmation-v2", "Preparação antecipada + consequência de não confirmar", "O kickoff começa antes da reunião", `*Agenda reservada para o kickoff de {{empresa}}.* 🧠

{{data}}, às {{hora}}
Acesso: {{link}}

Quando presença e contexto são confirmados antes, a reunião deixa de ser alinhamento básico e vira avanço real.

👉 {{contato}}, valide os participantes e confirme aqui no grupo. {{ai_master}} cuidará da condução.

_Improviso ocupa agenda. Preparação transforma agenda em execução._`, "VALIDAR PARTICIPANTES E CONFIRMAR", 1),
      variation("g4os-kickoff-confirmation-v3", "Checklist de prontidão + decisão binária", "Tudo certo para o kickoff de {{cliente}}", `*Temos dois jeitos de chegar ao kickoff:* revisando logística ou começando a construir. Vamos pelo segundo. 👉

✅ {{data}}
✅ {{hora}}
✅ {{link}}
✅ Condução: {{ai_master}}

Falta apenas {{contato}} confirmar a presença dos participantes neste grupo.

👉 Responda *TIME CONFIRMADO*.

_Com o básico resolvido antes, o encontro começa no próximo nível._`, "CONFIRMAR O TIME", 2),
    ],
  ),
  template(
    "g4os-prework-request",
    "Solicitação de documentos e participantes",
    "Coletar documentos e confirmar participantes antes do kickoff para acelerar o diagnóstico e a execução.",
    ["empresa", "contato", "ai_master", "data", "documentos", "link"],
    [
      variation("g4os-prework-request-v1", "Checklist operacional + prazo contextual", "Pré-work de {{cliente}} 📋", `*Para o kickoff começar no que importa, precisamos fechar o pré-work de {{empresa}}.*

Até {{data}}, envie:
✅ Participantes e funções
✅ {{documentos}}
✅ Contextos relevantes para a ativação

Centralize o envio aqui: {{link}}

👉 {{contato}}, responda *ENVIADO* quando concluir. Em caso de dúvida, marque {{ai_master}}.

_Documento antes da reunião vira decisão durante a reunião._`, "ENVIAR O PRÉ-WORK", 0),
      variation("g4os-prework-request-v2", "Consequência de não agir + explicação do porquê", "Sem contexto, o kickoff vira coleta de informação", `*A gente quer usar o kickoff de {{empresa}} para decidir e avançar — não para procurar informação.* ⚠️

Por isso, até {{data}}, precisamos de {{documentos}} e da relação de participantes com suas funções.

Envie tudo por {{link}}. {{ai_master}} fará a leitura antes do encontro para chegar preparado.

👉 {{contato}}, confirme neste grupo assim que o material estiver completo.

_O que chega antes vira clareza. O que fica para depois vira atraso._`, "CENTRALIZAR DOCUMENTOS E PARTICIPANTES", 1),
      variation("g4os-prework-request-v3", "Quebra de objeção + pedido mínimo viável", "Não precisa montar uma apresentação nova", `*O pré-work de {{empresa}} não precisa virar mais um projeto.*

E eu sei que sua cabeça pode ir para preparar decks e organizar tudo do zero. *Mas não é disso que estamos falando.*

Até {{data}}, basta enviar {{documentos}} e listar quem participará do kickoff. Use este espaço: {{link}}

👉 {{contato}}, se algo não existir, sinalize no grupo e alinhe com {{ai_master}}.

_Melhor um contexto real agora do que uma apresentação perfeita tarde demais._`, "ENVIAR O QUE JÁ EXISTE", 2),
    ],
  ),
  template(
    "g4os-post-kickoff",
    "Resumo pós-kickoff e próximos passos",
    "Registrar os principais combinados do kickoff, indicar materiais e tornar o próximo passo explícito.",
    ["empresa", "contato", "ai_master", "link", "proximo_passo", "data"],
    [
      variation("g4os-post-kickoff-v1", "Síntese executiva + próximo passo único", "Kickoff concluído. Próximo passo definido. ✅", `*Kickoff de {{empresa}} concluído.* Agora, o mais importante é transformar os combinados em movimento.

🧠 Resumo, decisões e responsáveis: {{link}}
👉 Próximo passo: {{proximo_passo}}
📅 Referência: {{data}}

{{ai_master}} acompanhará o avanço por este grupo.

{{contato}}, confirme a leitura com *ALINHADO*.

_Reunião boa gera clareza. Execução boa transforma clareza em entrega._`, "CONFIRMAR LEITURA DOS COMBINADOS", 0),
      variation("g4os-post-kickoff-v2", "Consequência da reunião sem dono + responsabilização", "Kickoff sem próximo passo vira só uma boa conversa", `*A reunião terminou. A ativação de {{empresa}} continua.* 👉

Para nenhum combinado se perder, registramos decisões, responsáveis e materiais aqui: {{link}}

O próximo movimento é objetivo: *{{proximo_passo}}*, com referência em {{data}}.

{{ai_master}} acompanha a execução, e {{contato}} centraliza os alinhamentos de {{empresa}}.

👉 Responda *DE ACORDO* após revisar.

_O valor do kickoff não está no que foi dito, mas no que começa a acontecer depois._`, "REVISAR E CONFIRMAR OS COMBINADOS", 1),
      variation("g4os-post-kickoff-v3", "Checklist de fechamento + fonte única de verdade", "O que ficou decidido no kickoff de {{cliente}}", `*Fechamos o kickoff com três pontos que precisam continuar visíveis:*

✅ Decisões e responsáveis
✅ Materiais de referência
✅ Próximo passo e data

Tudo está consolidado em {{link}}. A ação seguinte é {{proximo_passo}}, com referência em {{data}}.

👉 {{contato}}, revise e sinalize qualquer ajuste para {{ai_master}} neste grupo.

_Um registro claro protege a execução do ruído da rotina._`, "REVISAR O REGISTRO DO KICKOFF", 2),
    ],
  ),
  template(
    "g4os-diagnosis-interviews",
    "Convite para entrevistas de diagnóstico",
    "Agendar entrevistas de diagnóstico com as pessoas-chave da empresa para mapear contexto, prioridades e restrições da implementação.",
    ["empresa", "contato", "ai_master", "data", "hora", "link"],
    [
      variation("g4os-diagnosis-interviews-v1", "Bate-papo + clareza operacional", "Vamos ouvir quem vive a operação", `*{{contato}}, chegou a hora de ouvir quem vive a operação da {{empresa}}.* 🧠

Sem essas conversas, o diagnóstico pode partir de suposições — e isso atrasa as próximas decisões.

E eu sei que sua cabeça pode ir para “mais uma reunião”. *Mas não é disso que estamos falando.*

São conversas objetivas para entender prioridades, restrições e onde a IA pode gerar impacto real.

👉 Reserve os horários das entrevistas para {{data}}, às {{hora}}: {{link}}

_Com contexto certo agora, a execução ganha velocidade depois._`, "RESERVAR HORÁRIOS DAS ENTREVISTAS", 0),
      variation("g4os-diagnosis-interviews-v2", "Consequência de não agir + reframe de reunião", "O risco agora é decidir com informação incompleta", `*O próximo avanço da {{empresa}} depende de um diagnóstico sem atalhos.* ⚠️

Quando as pessoas-chave não entram na conversa, decisões importantes ficam apoiadas em informação incompleta.

E eu sei que sua cabeça pode ir para “isso pode ser resolvido por mensagem”. *Mas não é disso que estamos falando.*

Cada entrevista fecha uma parte do contexto que o roadmap precisa carregar.

👉 Confirme a agenda de {{data}}, às {{hora}}, por aqui: {{link}}

_Uma hora de contexto evita semanas de correção._`, "CONFIRMAR AGENDA DE DIAGNÓSTICO", 1),
      variation("g4os-diagnosis-interviews-v3", "Exclusividade construída + protagonismo do cliente", "Quem precisa estar nessa conversa", `*{{contato}}, você conhece quem enxerga os gargalos reais da {{empresa}}.* 🧠

Sem essas vozes, a implementação corre o risco de resolver o problema certo do jeito errado.

E eu sei que sua cabeça pode ir para “chamar todo mundo”. *Mas não é disso que estamos falando.*

Queremos poucas pessoas, escolhidas pelo contexto que carregam e pelas decisões que ajudam a tomar.

👉 Selecione os participantes e organize os horários em {{link}}. {{ai_master}} acompanha a etapa.

_O melhor diagnóstico não começa com respostas. Começa com as pessoas certas._`, "DEFINIR PARTICIPANTES E HORÁRIOS", 2),
    ],
  ),
  template(
    "g4os-roadmap-approval",
    "Roadmap para validação executiva",
    "Obter validação executiva do roadmap de implementação, consolidando prioridades, responsáveis e próximos passos antes do início da execução.",
    ["empresa", "contato", "ai_master", "link", "documentos", "proximo_passo"],
    [
      variation("g4os-roadmap-approval-v1", "Decisão binária + clareza executiva", "O roadmap da {{cliente}} está pronto para validação", `*{{contato}}, o roadmap da {{empresa}} está pronto.* 🧠

Sem a validação executiva, prioridades e responsáveis podem seguir em direções diferentes.

E eu sei que sua cabeça pode ir para “ajustamos durante a execução”. *Mas não é disso que estamos falando.*

Agora é o momento de confirmar escopo, sequência e critérios antes de mobilizar o time.

👉 Revise {{documentos}} e registre a validação em {{link}}.

_Alinhamento antes da execução custa minutos. Durante a execução, custa semanas._`, "VALIDAR ROADMAP EXECUTIVO", 0),
      variation("g4os-roadmap-approval-v2", "Protagonismo do cliente + contraste visual", "Da intenção para uma sequência executável", `*A {{empresa}} já tem uma direção. Agora vamos transformá-la em compromisso executivo.* 👉

❌ Prioridades implícitas geram disputa de agenda.
✅ Prioridades validadas dão clareza para o time executar.

E eu sei que sua cabeça pode ir para “o documento já está claro”. *Mas não é disso que estamos falando.*

A validação confirma que escopo, donos e sequência refletem a decisão da liderança.

👉 Revise o roadmap em {{link}} e indique qualquer ajuste antes de {{proximo_passo}}.

_Um plano só vira execução quando todos sabem o que foi decidido._`, "REVISAR E VALIDAR O ROADMAP", 1),
      variation("g4os-roadmap-approval-v3", "Bate-papo + validação colaborativa", "Última leitura antes de colocar o roadmap em movimento", `*{{contato}}, fechamos uma primeira versão do caminho da {{empresa}}.*

O que ficar ambíguo agora tende a virar dúvida quando mais pessoas entrarem na execução.

E eu sei que sua cabeça pode ir para “é só um ajuste de documento”. *Mas não é disso que estamos falando.*

É a leitura executiva que transforma diagnóstico em prioridade compartilhada. {{ai_master}} consolidará os retornos.

👉 Deixe sua validação e comentários em {{link}}.

_Clareza não é detalhe do plano. É o que permite que ele avance._`, "REGISTRAR VALIDAÇÃO EXECUTIVA", 2),
    ],
  ),
  template(
    "g4os-immersion-preparation",
    "Preparação para imersão presencial",
    "Preparar os participantes da empresa para a imersão presencial, garantindo presença, materiais e contexto necessários para um encontro produtivo.",
    ["empresa", "contato", "ai_master", "data", "hora", "link", "documentos"],
    [
      variation("g4os-immersion-preparation-v1", "Checklist operacional + consequência de não preparar", "Preparação da imersão da {{cliente}}", `*{{contato}}, a imersão da {{empresa}} começa antes do encontro presencial.* 🧠

Sem participantes e materiais preparados, parte do tempo vira alinhamento básico — e não decisão.

E eu sei que sua cabeça pode ir para “a gente resolve na hora”. *Mas não é disso que estamos falando.*

✅ Confirme os participantes
✅ Revise {{documentos}}
✅ Reserve {{data}}, às {{hora}}

👉 Centralizamos tudo em {{link}}.

_Quanto melhor a preparação, mais longe a conversa consegue chegar._`, "CONFIRMAR PREPARAÇÃO DA IMERSÃO", 0),
      variation("g4os-immersion-preparation-v2", "Reframe de custo de oportunidade + ação única", "O tempo presencial precisa ser usado para decidir", `*Na imersão, o recurso mais caro não é a sala. É o tempo das pessoas certas.* ⚠️

Quando o contexto chega incompleto, decisões importantes ficam para depois.

E eu sei que sua cabeça pode ir para “todo mundo já conhece o projeto”. *Mas não é disso que estamos falando.*

A preparação garante que o encontro comece no ponto em que a {{empresa}} realmente precisa avançar.

👉 Revise {{documentos}} e confirme presença em {{link}} para {{data}}, às {{hora}}.

_Presença ocupa agenda. Preparação transforma agenda em avanço._`, "CONFIRMAR PRESENÇA E PREPARAÇÃO", 1),
      variation("g4os-immersion-preparation-v3", "Contexto compartilhado + protagonismo do time", "Todo mundo precisa chegar na mesma página", `*A imersão da {{empresa}} foi desenhada para construir decisões em conjunto.* 🧠

Se cada pessoa chega com um contexto diferente, o encontro começa tentando recuperar o passado.

E eu sei que sua cabeça pode ir para “o alinhamento acontece naturalmente”. *Mas não é disso que estamos falando.*

{{ai_master}} organizou {{documentos}} para o time chegar preparado e usar o presencial no que mais importa.

👉 Compartilhe os materiais e confirme os participantes em {{link}}.

_Contexto compartilhado não elimina o debate. Ele melhora o debate._`, "ALINHAR PARTICIPANTES E MATERIAIS", 2),
    ],
  ),
  template(
    "g4os-pilot-validation",
    "Atualização do piloto para validação",
    "Compartilhar a atualização do piloto e obter validação do cliente sobre resultados, aprendizados e próximo passo da implementação.",
    ["empresa", "contato", "ai_master", "data", "link", "documentos", "proximo_passo"],
    [
      variation("g4os-pilot-validation-v1", "Evidência antes de escala + clareza operacional", "Atualização do piloto da {{cliente}} pronta para validação", `*{{contato}}, consolidamos a atualização do piloto da {{empresa}}.* 🧠

Sem validar os aprendizados agora, o próximo passo pode ampliar uma premissa que ainda precisa de ajuste.

E eu sei que sua cabeça pode ir para “se funcionou, é só seguir”. *Mas não é disso que estamos falando.*

O piloto existe para separar percepção de evidência antes de avançar.

👉 Revise {{documentos}} e registre sua validação em {{link}}.

_Escalar rápido importa. Escalar o que foi validado importa mais._`, "VALIDAR ATUALIZAÇÃO DO PILOTO", 0),
      variation("g4os-pilot-validation-v2", "Decisão binária + protagonismo executivo", "O piloto chegou ao ponto de decisão", `*Agora existem dois caminhos para o piloto da {{empresa}}.* 👉

Avançar com o que foi comprovado — ou ajustar o que ainda não sustenta {{proximo_passo}}.

E eu sei que sua cabeça pode ir para “o time técnico decide”. *Mas não é disso que estamos falando.*

A leitura executiva confirma se o resultado resolve o problema que motivou o piloto.

👉 Analise a atualização em {{link}} e registre sua decisão.

_Validar não é frear o avanço. É escolher qual avanço faz sentido._`, "REGISTRAR DECISÃO SOBRE O PILOTO", 1),
      variation("g4os-pilot-validation-v3", "Bate-papo + aprendizado compartilhado", "O que o piloto mostrou até aqui", `*{{contato}}, o piloto já trouxe sinais importantes para a {{empresa}}.*

Se os aprendizados não forem registrados, a próxima etapa começa sem aproveitar o que já foi descoberto.

E eu sei que sua cabeça pode ir para “depois documentamos”. *Mas não é disso que estamos falando.*

{{ai_master}} consolidou resultados, pontos de atenção e a recomendação para {{proximo_passo}}.

👉 Revise {{documentos}} e deixe seus comentários em {{link}} até {{data}}.

_Um piloto entrega mais valor quando o aprendizado vira decisão._`, "REVISAR E COMENTAR O PILOTO", 2),
    ],
  ),
  template(
    "g4os-sprint-preparation",
    "Preparação para G4 Sprint de AI",
    "Preparar o cliente para o G4 Sprint de AI com contexto, materiais e agenda alinhados, sem abordagem comercial.",
    ["empresa", "contato", "ai_master", "data", "hora", "link", "documentos"],
    [
      variation("g4os-sprint-preparation-v1", "Bate-papo + prevenção de retrabalho", "O Sprint começa antes do encontro", `*O Sprint começa antes do encontro.* 🧠

Quando os materiais chegam incompletos, o time usa o encontro para buscar contexto — e não para avançar.

E eu sei que sua cabeça vai pra "é só mais uma preparação". Mas não é disso que estamos falando.

Com {{documentos}} organizados, {{ai_master}} consegue chegar ao dia {{data}}, às {{hora}}, direto nas decisões de {{empresa}}.

👉 Revise a preparação aqui: {{link}}

_O tempo antes do Sprint organiza. O tempo no Sprint transforma._`, "REVISAR PREPARAÇÃO DO SPRINT", 0),
      variation("g4os-sprint-preparation-v2", "Exclusividade construída + clareza operacional", "{{cliente}}, seu Sprint já está em preparação", `*{{empresa}}, seu Sprint já está em preparação.* 🏆

Esse alinhamento existe porque o encontro precisa partir da realidade do seu time, não de respostas genéricas.

E eu sei que sua cabeça vai pra "a gente explica tudo na hora". Mas não é disso que estamos falando.

{{ai_master}} vai usar {{documentos}} para preparar o trabalho de {{data}}, às {{hora}}, com antecedência.

👉 Confirme os materiais aqui: {{link}}

_Quanto mais claro o ponto de partida, mais longe o Sprint consegue levar._`, "CONFIRMAR MATERIAIS DO SPRINT", 1),
      variation("g4os-sprint-preparation-v3", "Consequência de não agir + decisão binária", "Duas formas de chegar ao Sprint", `*Duas formas de chegar ao Sprint.* ⚠️

Uma é começar alinhado. A outra é gastar o encontro reconstruindo informações que poderiam estar prontas.

E eu sei que sua cabeça vai pra "depois a gente resolve". Mas não é disso que estamos falando.

Até {{data}}, {{ai_master}} precisa de {{documentos}} para preparar o encontro de {{empresa}} às {{hora}}.

👉 Finalize por aqui: {{link}}

_Preparação não ocupa o Sprint. Preparação devolve o Sprint ao que importa._`, "FINALIZAR PREPARAÇÃO", 2),
    ],
  ),
  template(
    "g4os-semester-review",
    "Convite para revisão semestral",
    "Convidar o cliente para a revisão semestral, consolidar aprendizados e definir prioridades do próximo ciclo.",
    ["empresa", "contato", "ai_master", "data", "hora", "link"],
    [
      variation("g4os-semester-review-v1", "Reframe de pausa estratégica", "Uma pausa pode acelerar o próximo semestre", `*{{contato}}, uma pausa pode acelerar o próximo semestre.* 🧠

Sem revisar o caminho, decisões importantes viram apenas mais itens na rotina.

E eu sei que sua cabeça vai pra "agora não dá para parar". Mas não é disso que estamos falando.

A revisão com {{ai_master}} organiza o que avançou em {{empresa}} e transforma aprendizado em prioridade para o próximo ciclo.

👉 Reserve {{data}}, às {{hora}}: {{link}}

_Revisar não é olhar para trás. É escolher melhor o próximo passo._`, "CONFIRMAR REVISÃO SEMESTRAL", 0),
      variation("g4os-semester-review-v2", "Reconhecimento de progresso", "O semestre de {{cliente}} deixou sinais importantes", `*O semestre de {{empresa}} deixou sinais importantes.* 🏆

No ritmo da execução, avanços e desvios podem passar sem virar aprendizado para o time.

E eu sei que sua cabeça vai pra "já sabemos o que funcionou". Mas não é disso que estamos falando.

{{ai_master}} vai conduzir uma leitura conjunta do ciclo e ajudar a converter os sinais em decisões práticas.

👉 Confirme {{data}}, às {{hora}}: {{link}}

_Resultado observado vira memória. Resultado revisado vira método._`, "CONFIRMAR HORÁRIO DA REVISÃO", 1),
      variation("g4os-semester-review-v3", "Contraste visual + próximos passos", "Fechar o semestre não é só fechar pendências", `*Fechar o semestre não é só fechar pendências.* ⚠️

❌ Acumular aprendizados sem registrar.
✅ Transformar o ciclo em decisões para {{empresa}}.

E eu sei que sua cabeça vai pra "a gente faz isso internamente". Mas não é disso que estamos falando.

A revisão com {{ai_master}} cria uma leitura comum do semestre e dá clareza ao próximo ciclo.

👉 Confirme {{data}}, às {{hora}}: {{link}}

_Sem revisão, o semestre termina. Com revisão, ele continua ensinando._`, "AGENDAR REVISÃO SEMESTRAL", 2),
    ],
  ),
  template(
    "g4os-monthly-checkin",
    "Check-in mensal e próximos passos",
    "Realizar o check-in mensal, remover bloqueios e alinhar próximos passos com o cliente.",
    ["empresa", "contato", "ai_master", "data", "hora", "link", "proximo_passo"],
    [
      variation("g4os-monthly-checkin-v1", "Bate-papo + remoção de bloqueios", "Vamos destravar o próximo passo", `*{{contato}}, vamos destravar o próximo passo.* 👉

Pequenos bloqueios ficam caros quando atravessam o mês sem uma decisão clara.

E eu sei que sua cabeça vai pra "é só um check-in". Mas não é disso que estamos falando.

Com {{ai_master}}, vamos revisar o momento de {{empresa}} e alinhar {{proximo_passo}} para o próximo ciclo.

👉 Confirme {{data}}, às {{hora}}: {{link}}

_Progresso não depende de mais tarefas. Depende do próximo passo certo._`, "CONFIRMAR CHECK-IN MENSAL", 0),
      variation("g4os-monthly-checkin-v2", "Consequência de não agir + cadência", "Um mês sem alinhamento vira dois meses de desvio", `*Um mês sem alinhamento vira dois meses de desvio.* ⚠️

Quando o bloqueio não aparece cedo, ele costuma reaparecer maior no próximo ciclo.

E eu sei que sua cabeça vai pra "a operação está andando". Mas não é disso que estamos falando.

O check-in com {{ai_master}} serve para validar a rota de {{empresa}} e combinar {{proximo_passo}} sem deixar ruído acumular.

👉 Confirme {{data}}, às {{hora}}: {{link}}

_Cadência não é controle. É correção antes do desvio._`, "CONFIRMAR CHECK-IN", 1),
      variation("g4os-monthly-checkin-v3", "Exclusividade construída + foco em continuidade", "O próximo passo de {{cliente}} já está na pauta", `*O próximo passo de {{empresa}} já está na pauta.* 🧠

O check-in mensal existe para que o acompanhamento parta do contexto real do seu time.

E eu sei que sua cabeça vai pra "mandamos uma atualização depois". Mas não é disso que estamos falando.

{{ai_master}} vai usar o encontro para validar {{proximo_passo}} e sair com responsabilidades claras.

👉 Confirme {{data}}, às {{hora}}: {{link}}

_Acompanhamento bom não pergunta apenas onde você está. Ele protege para onde você vai._`, "CONFIRMAR PRÓXIMO CHECK-IN", 2),
    ],
  ),
  template(
    "g4os-annual-closure",
    "Fechamento anual e pedido de feedback",
    "Encerrar o ciclo anual, consolidar aprendizados e coletar feedback do cliente para melhorar a continuidade do trabalho.",
    ["empresa", "contato", "ai_master", "data", "hora", "link", "proximo_passo"],
    [
      variation("g4os-annual-closure-v1", "Reconhecimento + feedback como construção", "O ciclo fecha. O aprendizado de {{cliente}} fica.", `*O ciclo fecha. O aprendizado de {{empresa}} fica.* 🏆

Sem uma conversa final, parte do que funcionou — e do que precisa mudar — se perde na virada do ano.

E eu sei que sua cabeça vai pra "o resultado já fala por si". Mas não é disso que estamos falando.

{{ai_master}} quer ouvir sua leitura do ciclo e registrar o que deve orientar {{proximo_passo}}.

👉 Confirme {{data}}, às {{hora}}: {{link}}

_Fechar bem não é encerrar a história. É preservar o que ela ensinou._`, "CONFIRMAR FECHAMENTO ANUAL", 0),
      variation("g4os-annual-closure-v2", "Bate-papo + pedido direto de feedback", "{{contato}}, queremos fechar o ano ouvindo você", `*{{contato}}, queremos fechar o ano ouvindo você.* 🧠

Na rotina, é fácil registrar entregas e deixar percepções importantes sem espaço.

E eu sei que sua cabeça vai pra "depois eu mando um feedback". Mas não é disso que estamos falando.

A conversa com {{ai_master}} é para entender o que gerou valor em {{empresa}}, o que pode melhorar e qual deve ser {{proximo_passo}}.

👉 Escolha o encontro de {{data}}, às {{hora}}: {{link}}

_Feedback guardado encerra um ciclo. Feedback compartilhado melhora o próximo._`, "CONFIRMAR CONVERSA DE FECHAMENTO", 1),
      variation("g4os-annual-closure-v3", "Decisão binária + continuidade", "Um ano pode terminar de duas formas", `*Um ano pode terminar de duas formas.* ⚠️

Com aprendizados dispersos — ou com uma leitura clara do que {{empresa}} deve levar para o próximo ciclo.

E eu sei que sua cabeça vai pra "a gente já sabe o que aconteceu". Mas não é disso que estamos falando.

Com {{ai_master}}, vamos consolidar sua percepção, registrar ajustes e alinhar {{proximo_passo}}.

👉 Confirme {{data}}, às {{hora}}: {{link}}

_O calendário vira sozinho. A evolução exige reflexão._`, "CONFIRMAR ENCERRAMENTO DO CICLO", 2),
    ],
  ),
];
