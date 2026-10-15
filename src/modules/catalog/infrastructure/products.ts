import type { CycleTemplate, Product } from "@/modules/catalog/domain/products";
import { g4OsProduct } from "./g4-os-founding-companies.ts";
const template = (
  id: string,
  name: string,
  goal: string,
  durationDays: number,
  titles: string[],
): CycleTemplate => ({
  id,
  name,
  goal,
  durationDays,
  deliveries: titles.map((title, i) => ({
    id: `${id}-d${i + 1}`,
    title,
    description: "",
    day: Math.ceil((durationDays * (i + 1)) / titles.length),
    hours: 4,
  })),
  acceptance: [
    "Entregas revisadas com o cliente",
    "Aprovação do responsável registrada",
  ],
});
export const seedProducts: Product[] = [
  {
    id: "implementacao",
    name: "Implementação de soluções",
    description: "Do diagnóstico à operação de uma solução com o cliente.",
    serviceModel: "implementacao",
    cycles: [
      template(
        "impl-diagnostico",
        "Diagnóstico e recorte",
        "Definir o problema, o escopo e os critérios de sucesso.",
        14,
        [
          "Diagnóstico do processo",
          "Mapa de requisitos e acessos",
          "Escopo e critérios de sucesso",
        ],
      ),
      template(
        "impl-piloto",
        "Piloto e homologação",
        "Validar a solução em cenários reais antes da operação.",
        14,
        [
          "Configuração do piloto",
          "Testes e evidências",
          "Homologação com o cliente",
        ],
      ),
      template(
        "impl-operacao",
        "Capacitação e operação assistida",
        "Preparar as pessoas e acompanhar a entrada em operação.",
        14,
        [
          "Guia de operação",
          "Capacitação da equipe",
          "Plano de acompanhamento",
        ],
      ),
    ],
  },
  {
    id: "consultoria",
    name: "Consultoria operacional",
    description:
      "Diagnóstico, plano de melhoria e implantação de novas rotinas.",
    serviceModel: "consultoria",
    cycles: [
      template(
        "cons-imersao",
        "Imersão na operação",
        "Entender os gargalos e estabelecer a referência de indicadores.",
        14,
        [
          "Entrevistas com stakeholders",
          "Mapa do processo atual",
          "Indicadores de referência",
        ],
      ),
      template(
        "cons-plano",
        "Plano de melhoria",
        "Priorizar melhorias com responsáveis e prazos acordados.",
        21,
        [
          "Diagnóstico de oportunidades",
          "Plano de ação priorizado",
          "Matriz de responsabilidades",
        ],
      ),
      template(
        "cons-rotina",
        "Validação da rotina",
        "Testar as melhorias e consolidar o novo procedimento.",
        21,
        [
          "Procedimento revisado",
          "Validação com a operação",
          "Indicadores de acompanhamento",
        ],
      ),
    ],
  },
  {
    id: "recorrente",
    name: "Melhoria contínua",
    description:
      "Revisões recorrentes de resultados e expansão das práticas validadas.",
    serviceModel: "recorrente",
    cycles: [
      template(
        "rec-resultados",
        "Revisão de resultados",
        "Revisar indicadores e definir os ajustes do próximo período.",
        28,
        [
          "Relatório de indicadores",
          "Revisão com stakeholders",
          "Plano de ação do período",
        ],
      ),
      template(
        "rec-expansao",
        "Expansão das rotinas",
        "Levar as práticas validadas a novas equipes ou unidades.",
        28,
        [
          "Plano de expansão",
          "Capacitação dos responsáveis",
          "Validação da nova unidade",
        ],
      ),
    ],
  },
  g4OsProduct,
];
export const initialProducts: Record<string, string[]> = {
  "santa-clara": ["implementacao"],
  "banco-litoral": ["implementacao"],
  logisul: ["consultoria"],
  "campo-verde": ["consultoria"],
  "vertice-seguros": ["recorrente"],
};
export const initialCycleTemplates: Record<string, string> = {
  "sc-c01": "impl-diagnostico",
  "sc-c02": "impl-piloto",
  "sc-c03": "impl-operacao",
  "bl-c01": "impl-piloto",
  "bl-c02": "impl-operacao",
  "ls-c01": "cons-imersao",
  "ls-c02": "cons-plano",
  "cv-c01": "cons-plano",
  "cv-c02": "cons-rotina",
  "vs-c01": "rec-resultados",
  "vs-c02": "rec-expansao",
};
