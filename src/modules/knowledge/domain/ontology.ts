// g4os-ds-disable-file hex-color -- cores de tipo/área da ontologia são DADO de domínio (ELEMENT_TYPES e Ontology.domains[].color, persistido no documento); o mapa as usa como identidade de categoria. Trocar por tokens exigiria migração do documento.
import type { Company } from "../../clients/domain/models.ts";
import type { Person } from "../../workspace/domain/models.ts";
import type { ElementType, GraphEdge, GraphNode, Ontology } from "./models.ts";

export const ELEMENT_TYPES: {
  id: ElementType;
  label: string;
  plural: string;
  color: string;
  hint: string;
}[] = [
  {
    id: "company",
    label: "Empresa",
    plural: "Empresas",
    color: "#316E63",
    hint: "A organização que o mapa representa.",
  },
  {
    id: "area",
    label: "Área",
    plural: "Áreas",
    color: "#5B7FB4",
    hint: "Departamento, time ou unidade de negócio.",
  },
  {
    id: "person",
    label: "Pessoa",
    plural: "Pessoas",
    color: "#AD7D40",
    hint: "Quem participa, decide ou é responsável.",
  },
  {
    id: "object",
    label: "Objeto de negócio",
    plural: "Objetos",
    color: "#9373AF",
    hint: "Cliente, contrato, produto, ativo ou documento.",
  },
  {
    id: "process",
    label: "Processo",
    plural: "Processos",
    color: "#52978F",
    hint: "Como o trabalho acontece e muda de estado.",
  },
  {
    id: "system",
    label: "Sistema",
    plural: "Sistemas",
    color: "#6683A1",
    hint: "Onde a informação é registrada ou utilizada.",
  },
  {
    id: "rule",
    label: "Regra",
    plural: "Regras",
    color: "#BC7772",
    hint: "Condição, política ou restrição do negócio.",
  },
  {
    id: "metric",
    label: "Indicador",
    plural: "Indicadores",
    color: "#8B9460",
    hint: "O que medir, com sua unidade e origem.",
  },
  {
    id: "action",
    label: "Ação",
    plural: "Ações",
    color: "#AF7B98",
    hint: "Uma mudança possível, com responsável e permissão.",
  },
];
export const typeOf = (node: GraphNode): ElementType =>
  node.elementType ?? "object";
export const typeMeta = (type: ElementType) =>
  ELEMENT_TYPES.find((t) => t.id === type)!;
export const relationName = (label: string) => label.replace(/_/g, " ");
export const normalized = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
export const RELATIONS = [
  "tem área",
  "inclui",
  "atua em",
  "lidera",
  "responsável por",
  "usa",
  "depende de",
  "registra",
  "orienta",
  "aprova",
  "mede",
  "é um tipo de",
  "instância de",
];

const classifications: Partial<Record<ElementType, string[]>> = {
  person: ["sc-camila"],
  process: [
    "sc-internacao",
    "sc-alta",
    "bl-proposta",
    "ls-viagem",
    "ls-coleta",
    "cv-safra",
    "vs-regulacao",
    "vs-indenizacao",
  ],
  system: ["sc-prontuario"],
  rule: ["sc-protocolo", "sc-manchester", "bl-restricao"],
  metric: ["bl-score", "cv-umidade"],
};

// Curated organizational examples extend the existing demo without changing its IDs.
// Business domains remain vocabulary groupings; they are not assumed to be departments.
const AREA_SEEDS: Record<string, { label: string; domains: string[] }[]> = {
  "santa-clara": [
    { label: "Assistência clínica", domains: ["assistencia", "pessoas"] },
    { label: "Operações hospitalares", domains: ["estrutura"] },
    { label: "Qualidade e segurança", domains: ["protocolos"] },
  ],
  "banco-litoral": [
    { label: "Crédito", domains: ["credito", "cliente"] },
    { label: "Risco e compliance", domains: ["risco"] },
    { label: "Rede de agências", domains: ["rede"] },
  ],
  logisul: [
    { label: "Operações", domains: ["operacao"] },
    { label: "Gestão de frota", domains: ["frota"] },
    { label: "Relacionamento comercial", domains: ["rede"] },
  ],
  "campo-verde": [
    { label: "Operações agrícolas", domains: ["campo"] },
    { label: "Indústria", domains: ["industria"] },
    { label: "Qualidade", domains: ["qualidade"] },
  ],
  "vertice-seguros": [
    { label: "Produtos e apólices", domains: ["apolice"] },
    { label: "Sinistros", domains: ["sinistro"] },
    { label: "Operações regionais", domains: ["pessoas"] },
  ],
};

export function businessOntology(
  ontology: Ontology,
  company: Company,
  people: Person[],
): Ontology {
  const rootId = `${company.slug}-company`;
  const base = (
    id: string,
    label: string,
    elementType: ElementType,
    description: string,
  ): GraphNode => ({
    id,
    label,
    elementType,
    description,
    kind: "instance",
    coverageAssessed: false,
    domain: "organizacao",
    x: 0,
    y: 0,
    coverage: 0,
    properties: [],
    source: "Cadastro demonstrativo da conta",
  });
  const root = {
    ...base(rootId, company.name, "company", company.summary),
    identity: company.slug,
    state: "Ativa",
    properties: [
      `Setor: ${company.sector}`,
      `Local: ${company.city} · ${company.uf}`,
    ],
  };
  const areas = (AREA_SEEDS[company.slug] ?? []).map((a, i) => ({
    ...base(
      `${company.slug}-area-${i}`,
      a.label,
      "area",
      `Área de referência para ${a.label.toLowerCase()}. Valide limites e responsabilidades com a equipe.`,
    ),
    state: "A validar",
  }));
  const nodes = ontology.nodes.map((node) => ({
    ...node,
    elementType: (node.elementType ??
      Object.entries(classifications).find(([, ids]) =>
        ids.includes(node.id),
      )?.[0] ??
      "object") as ElementType,
  }));
  const members = [company.sponsorId, company.leadId]
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is Person => Boolean(p));
  const persons = members
    .filter(
      (p) => !nodes.some((n) => normalized(n.label) === normalized(p.name)),
    )
    .map((p) => ({
      ...base(`${company.slug}-person-${p.id}`, p.name, "person", p.role),
      identity: p.id,
      state: "Ativo",
      properties: [
        `Papel: ${p.role}`,
        `Organização: ${p.org === "client" ? company.name : "Equipe de consultoria"}`,
      ],
    }));
  const edges: GraphEdge[] = [...ontology.edges];
  const add = (from: string, to: string, label: string) =>
    edges.push({ id: `org-${from}-${to}`, from, to, label });
  areas.forEach((area) => add(rootId, area.id, "tem área"));
  nodes.forEach((node) => {
    const i = (AREA_SEEDS[company.slug] ?? []).findIndex((a) =>
      a.domains.includes(node.domain),
    );
    if (areas[i])
      add(
        areas[i].id,
        node.id,
        typeOf(node) === "person" ? "inclui" : "mapeia",
      );
  });
  persons.forEach((p) =>
    add(
      p.id,
      rootId,
      p.identity === company.sponsorId ? "sponsor de" : "acompanha",
    ),
  );
  return {
    ...ontology,
    domains: [
      ...ontology.domains,
      { id: "organizacao", label: "Organização", color: "#316E63" },
    ],
    nodes: [root, ...areas, ...persons, ...nodes],
    edges,
  };
}

export function elementChecks(node: GraphNode, ontology: Ontology) {
  return [
    { label: "Definição", done: Boolean(node.description.trim()) },
    {
      label: "Responsável",
      done: Boolean(
        node.ownerId && ontology.nodes.some((n) => n.id === node.ownerId),
      ),
    },
    { label: "Fonte", done: Boolean(node.source?.trim()) },
    { label: "Estado", done: Boolean(node.state?.trim()) },
    {
      label: "Conexões",
      done: ontology.edges.some((e) => e.from === node.id || e.to === node.id),
    },
  ];
}

export function edgeError(edge: GraphEdge, ontology: Ontology): string | null {
  if (!edge.from || !edge.to || !edge.label.trim())
    return "Escolha os dois elementos e descreva a relação.";
  if (edge.from === edge.to) return "Escolha dois elementos diferentes.";
  if (
    ![edge.from, edge.to].every((id) => ontology.nodes.some((n) => n.id === id))
  )
    return "Um dos elementos não está mais disponível.";
  if (
    ontology.edges.some(
      (e) =>
        e.id !== edge.id &&
        e.from === edge.from &&
        e.to === edge.to &&
        normalized(relationName(e.label)) ===
          normalized(relationName(edge.label)),
    )
  )
    return "Esta conexão já existe.";
  return null;
}
