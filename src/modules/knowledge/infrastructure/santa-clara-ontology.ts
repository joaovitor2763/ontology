// g4os-ds-disable-file hex-color -- cores de tipo/área da ontologia são DADO de domínio (ELEMENT_TYPES e Ontology.domains[].color, persistido no documento); o mapa as usa como identidade de categoria. Trocar por tokens exigiria migração do documento.
import type {
  ElementType,
  GraphNode,
  Ontology,
} from "@/modules/knowledge/domain/models";

/** Fictional operational model, used to exercise a larger, connected workspace. */
export function enrichSantaClara(ontology: Ontology): Ontology {
  const prefix = "santa-clara";
  const helena = `${prefix}-person-helena`;
  const camila = "sc-camila";
  const root = `${prefix}-company`;
  const areas = [
    `${prefix}-area-0`,
    `${prefix}-area-1`,
    `${prefix}-area-2`,
    "sc-farmacia",
    "sc-diagnostico",
    "sc-ti",
  ];
  // id, label, type, department, description, attributes, accountable person
  const definitions: [
    string,
    string,
    ElementType,
    number,
    string,
    string[],
    string,
  ][] = [
    [
      "sc-farmacia",
      "Farmácia hospitalar",
      "area",
      3,
      "Coordena a dispensação e a conciliação de registros medicamentosos ao longo do episódio.",
      ["Escopo: farmácia central e unidades", "Interface: assistência clínica"],
      "sc-renata",
    ],
    [
      "sc-diagnostico",
      "Diagnóstico e laboratório",
      "area",
      4,
      "Organiza coleta, processamento e disponibilização dos resultados para a equipe assistencial.",
      [
        "Escopo: análises clínicas e imagem",
        "Interface: atendimento e unidades",
      ],
      "sc-felipe",
    ],
    [
      "sc-ti",
      "Tecnologia e dados",
      "area",
      5,
      "Mantém integrações, acessos e rastreabilidade dos sistemas utilizados na operação.",
      ["Escopo: sistemas e dados", "Interface: fornecedores e governança"],
      helena,
    ],
    [
      "sc-renata",
      "Rita Exemplo",
      "person",
      3,
      "Farmacêutica responsável pelo levantamento dos fluxos de dispensação e revisão dos registros.",
      ["Papel: responsável de farmácia", "Participação: validação do fluxo"],
      helena,
    ],
    [
      "sc-felipe",
      "Fábio Exemplo",
      "person",
      4,
      "Coordenador do laboratório e ponto focal para tempos de coleta e liberação de laudos.",
      [
        "Papel: coordenador de diagnóstico",
        "Participação: validação de indicadores",
      ],
      helena,
    ],
    [
      "sc-laura",
      "Lara Exemplo",
      "person",
      2,
      "Analista de qualidade que consolida evidências e acompanha pendências do plano de melhoria.",
      ["Papel: analista de qualidade", "Participação: revisão de evidências"],
      helena,
    ],
    [
      "sc-rodrigo",
      "Rui Exemplo",
      "person",
      1,
      "Coordenador de operações que acompanha disponibilidade de leitos e transição entre unidades.",
      [
        "Papel: coordenador de operações",
        "Participação: revisão do cronograma",
      ],
      helena,
    ],
    [
      "sc-admissao",
      "Admissão hospitalar",
      "process",
      0,
      "Confere o cadastro e abre o episódio de internação, com a unidade de destino registrada.",
      [
        "Entrada: solicitação de internação",
        "Saída: episódio aberto",
        "Responsável: atendimento",
      ],
      camila,
    ],
    [
      "sc-triagem",
      "Registro de triagem",
      "process",
      0,
      "Registra a classificação atribuída pela equipe habilitada e encaminha o atendimento.",
      ["Entrada: chegada do paciente", "Saída: registro de encaminhamento"],
      camila,
    ],
    [
      "sc-passagem",
      "Passagem de turno",
      "process",
      0,
      "Transfere pendências e responsabilidades entre equipes, mantendo o vínculo com o episódio.",
      ["Entrada: término do turno", "Saída: pendências reconhecidas"],
      camila,
    ],
    [
      "sc-planejar-alta",
      "Planejamento da alta",
      "process",
      0,
      "Reúne documentos, pendências e responsáveis necessários para preparar a saída do paciente.",
      ["Entrada: previsão de alta", "Saída: checklist de preparação"],
      camila,
    ],
    [
      "sc-higienizacao",
      "Preparação do leito",
      "process",
      1,
      "Coordena a liberação, limpeza e confirmação operacional do leito após a saída.",
      ["Entrada: leito desocupado", "Saída: disponibilidade confirmada"],
      "sc-rodrigo",
    ],
    [
      "sc-conciliacao",
      "Conciliação de registros",
      "process",
      3,
      "Compara os registros de medicamentos entre admissão e alta e encaminha divergências à equipe responsável.",
      ["Entrada: registros do episódio", "Saída: divergências revisadas"],
      "sc-renata",
    ],
    [
      "sc-coleta",
      "Coleta de amostras",
      "process",
      4,
      "Acompanha identificação, coleta e recebimento de amostras até o laboratório.",
      ["Entrada: solicitação de exame", "Saída: amostra recebida"],
      "sc-felipe",
    ],
    [
      "sc-auditoria",
      "Revisão de evidências",
      "process",
      2,
      "Verifica se os registros e aceites esperados estão presentes antes do fechamento do ciclo de melhoria.",
      ["Entrada: pacote de evidências", "Saída: parecer de revisão"],
      "sc-laura",
    ],
    [
      "sc-lis",
      "LIS · Laboratório",
      "system",
      4,
      "Sistema de referência para solicitações, amostras e resultados laboratoriais.",
      ["Integração: resultados por episódio", "Ambiente: demonstração"],
      "sc-felipe",
    ],
    [
      "sc-pacs",
      "PACS · Imagens",
      "system",
      4,
      "Sistema de referência para o catálogo de exames de imagem e o status dos laudos.",
      ["Integração: identificador do exame", "Ambiente: demonstração"],
      "sc-felipe",
    ],
    [
      "sc-erp",
      "ERP hospitalar",
      "system",
      5,
      "Suporta registros administrativos e movimentações de materiais na operação hospitalar.",
      ["Integração: cadastro e estoque", "Ambiente: demonstração"],
      helena,
    ],
    [
      "sc-integracao",
      "Camada de integração",
      "system",
      5,
      "Relaciona identificadores e registra o processamento de mensagens entre os sistemas da conta.",
      ["Chave: identificador do episódio", "Controle: fila e rastreabilidade"],
      helena,
    ],
    [
      "sc-plano-alta",
      "Plano de alta",
      "object",
      0,
      "Documento que reúne encaminhamentos e pendências validados pela equipe assistencial para a saída.",
      ["Identificador: episodio_id", "Campos: versão, revisor e aprovação"],
      camila,
    ],
    [
      "sc-pendencia",
      "Pendência assistencial",
      "object",
      0,
      "Registro de uma ação ou informação a revisar antes da transição de cuidado.",
      [
        "Campos: descrição, responsável, prazo",
        "Estados: aberta, revisada, resolvida",
      ],
      camila,
    ],
    [
      "sc-medicamento",
      "Item de medicamento",
      "object",
      3,
      "Referência de catálogo utilizada para relacionar registros de prescrição e dispensação.",
      [
        "Campos: código do catálogo e descrição",
        "Controle: versão de cadastro",
      ],
      "sc-renata",
    ],
    [
      "sc-dispensacao",
      "Registro de dispensação",
      "object",
      3,
      "Evento de atendimento de um item pela farmácia, vinculado ao episódio e ao registro de origem.",
      ["Campos: item, episódio, horário", "Estado: conferido ou pendente"],
      "sc-renata",
    ],
    [
      "sc-amostra",
      "Amostra laboratorial",
      "object",
      4,
      "Identifica o material coletado e permite acompanhar sua passagem pelo laboratório.",
      ["Campos: código, coleta e recebimento", "Chave: solicitação do exame"],
      "sc-felipe",
    ],
    [
      "sc-laudo",
      "Laudo de exame",
      "object",
      4,
      "Registro do resultado liberado pela equipe responsável e associado ao exame do episódio.",
      ["Campos: versão, autor e liberação", "Chave: exame_id"],
      "sc-felipe",
    ],
    [
      "sc-log",
      "Registro de acesso",
      "object",
      5,
      "Evidência de quem acessou um recurso, em qual momento e com qual finalidade registrada.",
      ["Campos: usuário, recurso, horário", "Controle: acesso restrito"],
      helena,
    ],
    [
      "sc-incidente",
      "Ocorrência de qualidade",
      "object",
      2,
      "Registro de um desvio de processo, sua análise e as ações de acompanhamento acordadas.",
      [
        "Campos: origem, responsável e ação",
        "Estados: aberta, em análise, encerrada",
      ],
      "sc-laura",
    ],
    [
      "sc-acesso",
      "Acesso por papel",
      "rule",
      5,
      "Restringe os recursos disponíveis ao papel autorizado e à necessidade de trabalho registrada.",
      ["Escopo: recursos integrados", "Evidência: matriz de acesso aprovada"],
      helena,
    ],
    [
      "sc-revisao-humana",
      "Revisão humana da alta",
      "rule",
      2,
      "Exige revisão e aprovação por profissional responsável antes de utilizar um rascunho assistido.",
      [
        "Aplicação: rascunhos de documentos",
        "Evidência: autor e data do aceite",
      ],
      camila,
    ],
    [
      "sc-identificacao",
      "Identificação do episódio",
      "rule",
      2,
      "Exige um identificador de episódio consistente ao relacionar documentos e eventos de sistemas diferentes.",
      ["Aplicação: integrações", "Evidência: rastreabilidade entre registros"],
      "sc-laura",
    ],
    [
      "sc-leito-pronto",
      "Confirmação de leito pronto",
      "rule",
      1,
      "Exige confirmação da equipe de operações antes de marcar um leito como disponível no fluxo.",
      ["Aplicação: transição de leito", "Evidência: registro de confirmação"],
      "sc-rodrigo",
    ],
    [
      "sc-permanencia",
      "Tempo de permanência",
      "metric",
      1,
      "Tempo entre admissão e saída, usado para acompanhar variações operacionais por unidade.",
      [
        "Unidade: horas",
        "Fonte: eventos de admissão e alta",
        "Leitura: mediana por unidade",
      ],
      "sc-rodrigo",
    ],
    [
      "sc-giro",
      "Tempo de preparação do leito",
      "metric",
      1,
      "Intervalo entre saída e confirmação de disponibilidade do leito.",
      [
        "Unidade: minutos",
        "Fonte: eventos de operações",
        "Leitura: mediana por turno",
      ],
      "sc-rodrigo",
    ],
    [
      "sc-tat",
      "Tempo de liberação do laudo",
      "metric",
      4,
      "Intervalo entre recebimento da amostra e liberação do resultado pelo laboratório.",
      [
        "Unidade: minutos",
        "Fonte: eventos do LIS",
        "Leitura: por tipo de exame",
      ],
      "sc-felipe",
    ],
    [
      "sc-completude",
      "Completude do plano de alta",
      "metric",
      2,
      "Proporção de planos com os campos e revisões acordados no checklist do serviço.",
      [
        "Unidade: percentual",
        "Cálculo: completos / revisados",
        "Fonte: revisão amostral",
      ],
      "sc-laura",
    ],
    [
      "sc-integridade",
      "Mensagens conciliadas",
      "metric",
      5,
      "Proporção de mensagens processadas com identificadores reconciliados entre os sistemas.",
      [
        "Unidade: percentual",
        "Cálculo: conciliadas / recebidas",
        "Fonte: log de integração",
      ],
      helena,
    ],
    [
      "sc-validar-alta",
      "Validar plano de alta",
      "action",
      0,
      "Encaminha o plano ao revisor responsável e registra o aceite ou as correções solicitadas.",
      ["Pré-condição: plano preparado", "Resultado: revisão registrada"],
      camila,
    ],
    [
      "sc-liberar-leito",
      "Confirmar disponibilidade",
      "action",
      1,
      "Registra a confirmação da equipe após a preparação do leito.",
      ["Pré-condição: preparação concluída", "Resultado: leito disponível"],
      "sc-rodrigo",
    ],
    [
      "sc-reprocessar",
      "Revisar falha de integração",
      "action",
      5,
      "Direciona mensagens inconsistentes para análise e reprocessamento autorizado.",
      [
        "Pré-condição: falha identificada",
        "Resultado: registro conciliado ou escalado",
      ],
      helena,
    ],
  ];
  const domainIds = [
    "assistencia",
    "estrutura",
    "protocolos",
    "farmacia",
    "diagnostico",
    "tecnologia",
  ];
  const nodes: GraphNode[] = definitions.map(
    (
      [id, label, elementType, area, description, properties, ownerId],
      index,
    ) => ({
      id,
      label,
      elementType,
      domain: domainIds[area],
      description,
      properties,
      ownerId,
      kind: ["person", "area", "system"].includes(elementType)
        ? "instance"
        : "class",
      x: 0,
      y: 0,
      coverage: 65 + ((index * 7) % 31),
      coverageAssessed: true,
      source:
        "Oficinas e registros fictícios · demonstração fictícia Aurora · set/2026",
      state: elementType === "rule" ? "Em validação" : "Mapeado",
    }),
  );
  const edges = [...ontology.edges];
  function edge(from: string, to: string, label: string) {
    edges.push({
      id: `sc-expanded-${edges.length}`,
      from,
      to,
      label,
      cardinality: "one-many",
    });
  }
  definitions.forEach(([id, , type, area, , , owner]) => {
    edge(
      type === "area" ? root : areas[area],
      id,
      type === "area" ? "tem área" : type === "person" ? "inclui" : "acompanha",
    );
    if (type !== "person" && type !== "area") edge(owner, id, "responde por");
  });
  const relations = [
    ["sc-admissao", "sc-internacao", "abre"],
    ["sc-triagem", "sc-manchester", "registra aplicação de"],
    ["sc-admissao", "sc-paciente", "identifica"],
    ["sc-passagem", "sc-pendencia", "transfere"],
    ["sc-planejar-alta", "sc-plano-alta", "produz"],
    ["sc-plano-alta", "sc-alta", "documenta"],
    ["sc-plano-alta", "sc-pendencia", "reúne"],
    ["sc-conciliacao", "sc-prescricao", "confere registros de"],
    ["sc-prescricao", "sc-medicamento", "referencia"],
    ["sc-dispensacao", "sc-medicamento", "registra item"],
    ["sc-conciliacao", "sc-dispensacao", "compara"],
    ["sc-coleta", "sc-amostra", "identifica"],
    ["sc-amostra", "sc-exame", "atende"],
    ["sc-laudo", "sc-exame", "documenta"],
    ["sc-lis", "sc-laudo", "disponibiliza"],
    ["sc-pacs", "sc-exame", "indexa imagens de"],
    ["sc-integracao", "sc-lis", "conecta"],
    ["sc-integracao", "sc-prontuario", "conecta"],
    ["sc-integracao", "sc-erp", "conecta"],
    ["sc-log", "sc-integracao", "rastreia"],
    ["sc-acesso", "sc-prontuario", "restringe"],
    ["sc-identificacao", "sc-integracao", "valida vínculos de"],
    ["sc-revisao-humana", "sc-validar-alta", "condiciona"],
    ["sc-validar-alta", "sc-plano-alta", "aprova"],
    ["sc-alta", "sc-higienizacao", "aciona preparação de"],
    ["sc-higienizacao", "sc-leito", "prepara"],
    ["sc-leito-pronto", "sc-liberar-leito", "condiciona"],
    ["sc-liberar-leito", "sc-leito", "atualiza estado de"],
    ["sc-permanencia", "sc-internacao", "mede duração de"],
    ["sc-giro", "sc-higienizacao", "mede duração de"],
    ["sc-tat", "sc-laudo", "mede liberação de"],
    ["sc-completude", "sc-plano-alta", "mede registros de"],
    ["sc-integridade", "sc-integracao", "mede consistência de"],
    ["sc-auditoria", "sc-incidente", "acompanha"],
    ["sc-auditoria", "sc-completude", "revisa"],
    ["sc-reprocessar", "sc-log", "consulta"],
    ["sc-reprocessar", "sc-integracao", "corrige pendência de"],
    ["sc-renata", "sc-conciliacao", "valida"],
  ];
  relations.forEach(([from, to, label]) => edge(from, to, label));
  return {
    ...ontology,
    domains: [
      ...ontology.domains,
      { id: "farmacia", label: "Farmácia", color: "#9d7650" },
      { id: "diagnostico", label: "Diagnóstico", color: "#58738d" },
      { id: "tecnologia", label: "Tecnologia e dados", color: "#736692" },
    ],
    nodes: [
      ...ontology.nodes.map((node) => ({
        ...node,
        ownerId:
          node.ownerId ??
          (node.domain === "estrutura"
            ? "sc-rodrigo"
            : node.domain === "protocolos"
              ? "sc-laura"
              : node.elementType === "person" ||
                  node.elementType === "company" ||
                  node.elementType === "system"
                ? helena
                : camila),
        source:
          node.source ??
          (node.id === "sc-prescricao"
            ? undefined
            : "Oficinas fictícias · demonstração fictícia Aurora · set/2026"),
        state: node.state ?? "Mapeado",
      })),
      ...nodes,
    ],
    edges,
  };
}
