/**
 * Deliverable templates: Markdown skeletons the team fills in, each with a
 * review checklist shown next to the upload and to the reviewer.
 * Placeholders use `{{empresa}}`, `{{projeto}}`, `{{processo}}`, `{{tarefa}}`.
 */
export type DeliverableTemplate = {
  id: string;
  name: string;
  description: string;
  fileName: string;
  format: "md";
  acceptedMimeTypes: string[];
  reviewChecklist: string[];
  body: string;
};

const DOCS = [
  "application/pdf",
  "text/markdown",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const SHEETS = [
  ...DOCS,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
];
const VISUAL = [...DOCS, "image/png", "image/jpeg", "image/webp"];

export const deliverableTemplates: DeliverableTemplate[] = [
  {
    id: "roadmap_ai",
    name: "Roadmap de IA",
    description:
      "Diagnóstico, backlog de oportunidades priorizado e sequência de execução aprovada pelo patrocinador.",
    fileName: "roadmap-de-ia.md",
    format: "md",
    acceptedMimeTypes: SHEETS,
    reviewChecklist: [
      "Objetivo executivo com resultado esperado em 12 meses e patrocinador nomeado",
      "Cada oportunidade aponta para uma dor do diagnóstico",
      "Impacto e esforço pontuados de 1 a 5 para todas as oportunidades",
      "Sequência de execução com responsável, prazo e métrica de sucesso",
      "Aprovação executiva registrada com data",
    ],
    body: `# Roadmap de IA — {{empresa}}

## 1. Objetivo executivo
- Problema estratégico:
- Resultado esperado em 12 meses:
- Patrocinador:
- Responsável:

## 2. Diagnóstico resumido
| Área | Dor | Evidência | Impacto | Urgência |
|---|---|---|---|---|
| | | | | |

## 3. Backlog de oportunidades
| Oportunidade | Dor relacionada | Impacto (1-5) | Esforço (1-5) | Dados disponíveis | Risco |
|---|---|---:|---:|---|---|
| | | | | | |

## 4. Priorização
- Quick wins:
- Projetos estruturantes:
- O que não será feito agora:

## 5. Sequência de execução
| Ordem | Projeto | Responsável | Início | Prazo | Métrica de sucesso |
|---:|---|---|---|---|---|
| 1 | | | | | |

## 6. Aprovação executiva
- Decisões:
- Ajustes solicitados:
- Aprovado por:
- Data:
`,
  },
  {
    id: "project_charter",
    name: "Charter do projeto",
    description:
      "Contexto, hipótese, métricas, escopo, entregas, riscos e governança de um projeto.",
    fileName: "charter-do-projeto.md",
    format: "md",
    acceptedMimeTypes: DOCS,
    reviewChecklist: [
      "Hipótese escrita no formato “se… esperamos… porque…”",
      "Métricas com linha de base, meta e fonte",
      "Escopo incluído e fora do escopo explícitos",
      "Entregas com responsável, prazo e critério de aceite",
      "Riscos com mitigação e dono; governança com patrocinador e cadência",
    ],
    body: `# Charter do projeto — {{projeto}}

## Contexto e problema
- Empresa:
- Dor que será atacada:
- Evidência:
- Usuários afetados:

## Hipótese
Se implementarmos ___, esperamos ___, porque ___.

## Objetivo e métricas
| Métrica | Linha de base | Meta | Fonte | Frequência |
|---|---:|---:|---|---|
| | | | | |

## Escopo
### Incluído
-
### Fora do escopo
-

## Entregas
| Entrega | Responsável | Prazo | Critério de aceite |
|---|---|---|---|
| | | | |

## Dados, sistemas e acessos
- Fontes de dados:
- Integrações:
- Restrições:

## Riscos
| Risco | Probabilidade | Impacto | Mitigação | Dono |
|---|---|---|---|---|
| | | | | |

## Governança
- Patrocinador:
- Responsável:
- Responsável do cliente:
- Cadência:
`,
  },
  {
    id: "action_plan",
    name: "Plano de ação",
    description:
      "Ações com dono, prazo, dependência, evidência esperada e bloqueios a escalar.",
    fileName: "plano-de-acao.md",
    format: "md",
    acceptedMimeTypes: SHEETS,
    reviewChecklist: [
      "Resultado esperado, prazo final e responsável principal definidos",
      "Toda ação tem dono, prazo e evidência esperada",
      "Bloqueios listados com responsável por remover e data limite",
      "Critério de conclusão e data da próxima revisão registrados",
    ],
    body: `# Plano de ação — {{empresa}}

## Resultado esperado
- Objetivo:
- Prazo final:
- Responsável principal:

## Ações
| # | Ação | Dor/decisão relacionada | Dono | Prazo | Dependência | Status | Evidência esperada |
|---:|---|---|---|---|---|---|---|
| 1 | | | | | | Não iniciada | |

## Bloqueios e escalonamento
| Bloqueio | Impacto | Responsável por remover | Data limite |
|---|---|---|---|
| | | | |

## Critério de conclusão
-

## Próxima revisão
- Data:
- Participantes:
`,
  },
  {
    id: "process_map",
    name: "Mapa de processo",
    description:
      "Fluxo atual por etapa, gargalos com evidência e oportunidades de automação validadas com o dono do processo.",
    fileName: "mapa-de-processo.md",
    format: "md",
    acceptedMimeTypes: VISUAL,
    reviewChecklist: [
      "Objetivo, início, fim, dono, frequência e volume do processo preenchidos",
      "Cada etapa tem ator, entrada, saída e sistema",
      "Gargalos com evidência, frequência e causa raiz provável",
      "Oportunidades ligadas a uma etapa, com benefício e pré-requisito",
      "Validação registrada pelo dono do processo",
    ],
    body: `# Mapa de processo — {{processo}}

## Visão geral
- Objetivo do processo:
- Início e fim:
- Dono:
- Frequência e volume:

## Fluxo atual
| Etapa | Ator | Entrada | Atividade | Sistema | Saída | Tempo | Problema observado |
|---:|---|---|---|---|---|---|---|
| 1 | | | | | | | |

## Gargalos e evidências
| Gargalo | Evidência | Frequência | Impacto | Causa raiz provável |
|---|---|---|---|---|
| | | | | |

## Oportunidades de IA/automação
| Oportunidade | Etapa afetada | Benefício esperado | Risco | Pré-requisito |
|---|---|---|---|---|
| | | | | |

## Validação
- Validado por:
- Ajustes:
- Data:
`,
  },
  {
    id: "opportunity_assessment",
    name: "Avaliação de oportunidade",
    description:
      "Nota de 1 a 5 por critério, com evidência, e recomendação de priorizar, investigar, aguardar ou descartar.",
    fileName: "avaliacao-de-oportunidade.md",
    format: "md",
    acceptedMimeTypes: SHEETS,
    reviewChecklist: [
      "Os sete critérios têm nota e evidência",
      "Decisão explícita: priorizar, investigar, aguardar ou descartar",
      "Justificativa coerente com as notas",
      "Próximo experimento com responsável e prazo",
    ],
    body: `# Avaliação de oportunidade de IA

| Critério | Pergunta | Nota 1-5 | Evidência |
|---|---|---:|---|
| Impacto financeiro | Quanto valor pode gerar ou proteger? | | |
| Impacto operacional | Quanto tempo/retrabalho reduz? | | |
| Frequência | Com que frequência o problema ocorre? | | |
| Dados | Os dados existem e têm qualidade? | | |
| Complexidade | Qual o esforço técnico e organizacional? | | |
| Risco | Há risco jurídico, reputacional ou operacional? | | |
| Aderência | Está alinhada ao roadmap da empresa? | | |

## Recomendação
- Decisão: Priorizar / Investigar / Aguardar / Descartar
- Justificativa:
- Próximo experimento:
- Responsável:
- Prazo:
`,
  },
  {
    id: "meeting_record",
    name: "Ata de reunião",
    description:
      "Resumo executivo, dores com evidência, soluções com hipótese, decisões e próximos passos.",
    fileName: "ata-de-reuniao.md",
    format: "md",
    acceptedMimeTypes: DOCS,
    reviewChecklist: [
      "Data, tipo, participantes e responsável registrados",
      "Toda dor tem evidência, área e severidade",
      "Toda solução aponta para uma dor e tem hipótese e métrica",
      "Decisões separadas dos próximos passos; cada passo com dono e prazo",
    ],
    body: `# Ata de reunião — {{empresa}}

## Contexto
- Data:
- Tipo:
- Participantes:
- Responsável:

## Resumo executivo
-

## Dores e evidências
| Dor | Evidência | Área | Severidade | Impacto |
|---|---|---|---|---|
| | | | | |

## Soluções e hipóteses
| Solução | Dor relacionada | Hipótese | Responsável | Métrica |
|---|---|---|---|---|
| | | | | |

## Decisões
-

## Próximos passos
| Ação | Dono | Prazo |
|---|---|---|
| | | |
`,
  },
  {
    id: "metrics_evidence",
    name: "Evidência de resultado",
    description:
      "Indicadores com linha de base e meta, adoção observada, evidências e a decisão de escalar, ajustar ou encerrar.",
    fileName: "evidencia-de-resultado.md",
    format: "md",
    acceptedMimeTypes: SHEETS,
    reviewChecklist: [
      "Período, objetivo original e responsável definidos",
      "Cada indicador tem linha de base, resultado atual, meta e fonte",
      "Adoção com usuários previstos versus ativos e barreiras",
      "Evidências anexadas ou linkadas",
      "Decisão registrada: escalar, ajustar ou encerrar, com próximo passo",
    ],
    body: `# Evidência de resultado — {{projeto}}

## Resultado analisado
- Período:
- Objetivo original:
- Responsável:

## Indicadores
| Indicador | Linha de base | Resultado atual | Meta | Variação | Fonte |
|---|---:|---:|---:|---:|---|
| | | | | | |

## Adoção
- Usuários previstos:
- Usuários ativos:
- Frequência de uso:
- Principais barreiras:

## Evidências
- Links, prints ou relatórios:
- Depoimentos dos usuários:

## Aprendizados e decisão
- O que funcionou:
- O que precisa ajustar:
- Decisão: Escalar / Ajustar / Encerrar
- Próximo passo:
`,
  },
  {
    id: "enablement_plan",
    name: "Plano de capacitação",
    description:
      "Público, competência esperada, módulos com formato e data, materiais e métricas de adoção.",
    fileName: "plano-de-capacitacao.md",
    format: "md",
    acceptedMimeTypes: DOCS,
    reviewChecklist: [
      "Perfis participantes e competência esperada descritos",
      "Cada módulo tem público, formato, responsável, data e evidência",
      "Materiais de apoio e canal de suporte indicados",
      "Métricas de adoção com linha de base, meta e frequência",
      "Cadência de reforço com responsável e critério de conclusão",
    ],
    body: `# Plano de capacitação e adoção

## Público e objetivo
- Perfis participantes:
- Competência esperada:
- Comportamento esperado após treinamento:

## Plano
| Módulo/ação | Público | Formato | Responsável | Data | Evidência |
|---|---|---|---|---|---|
| | | | | | |

## Materiais
- Guia operacional:
- Vídeo/demo:
- FAQ:
- Canal de suporte:

## Métricas de adoção
| Métrica | Linha de base | Meta | Frequência |
|---|---:|---:|---|
| | | | |

## Reforço
- Cadência de acompanhamento:
- Responsável:
- Critério de conclusão:
`,
  },
  {
    id: "communication_record",
    name: "Registro de comunicação",
    description:
      "Mensagem enviada ao cliente, evidência de entrega, retorno recebido e próximo passo.",
    fileName: "registro-de-comunicacao.md",
    format: "md",
    acceptedMimeTypes: VISUAL,
    reviewChecklist: [
      "Contexto com momento da jornada, objetivo, data e responsável",
      "Texto final da mensagem e destinatários registrados",
      "Evidência de entrega anexada ou linkada",
      "Retorno do cliente e próxima ação com dono e prazo",
    ],
    body: `# Registro de comunicação

## Contexto
- Empresa:
- Momento da jornada:
- Objetivo da mensagem:
- Data e hora:
- Responsável:

## Mensagem enviada
- Variação utilizada:
- Texto final:
- Grupo/destinatários:

## Evidência
- Link ou print:
- Status de entrega:
- Confirmação recebida:

## Retorno e próximo passo
- Resposta do cliente:
- Bloqueio identificado:
- Próxima ação:
- Dono e prazo:
`,
  },
  {
    id: "task_evidence",
    name: "Evidência de entrega",
    description:
      "O que foi realizado, evidências, resultado observado e validação por quem aprovou.",
    fileName: "evidencia-de-entrega.md",
    format: "md",
    acceptedMimeTypes: VISUAL,
    reviewChecklist: [
      "Empresa, responsável, data e resultado esperado preenchidos",
      "Evidências anexadas: arquivos, links, prints ou dados",
      "Critério atendido e resultado observado descritos",
      "Validação com nome, status e comentários",
    ],
    body: `# Evidência de entrega — {{tarefa}}

## Tarefa e objetivo
- Empresa:
- Responsável:
- Data:
- Resultado esperado:

## O que foi realizado
-

## Evidências
- Arquivos/links:
- Prints:
- Dados:

## Resultado
- Critério atendido:
- Resultado observado:
- Pendências:

## Validação
- Validado por:
- Status: Aprovado / Ajustes necessários
- Comentários:
- Próximo passo:
`,
  },
];

export function deliverableTemplateById(id?: string) {
  return id ? deliverableTemplates.find((t) => t.id === id) : undefined;
}

/** Fills the placeholders; unknown ones are left blank so the file stays usable. */
export function renderDeliverableTemplate(
  id: string,
  vars: Record<string, string | undefined> = {},
) {
  const template = deliverableTemplateById(id);
  if (!template) return null;
  const body = template.body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key) => {
    const value = vars[key];
    return value ? value : "";
  });
  return { ...template, body: body.replace(/ — \n/g, "\n") };
}
