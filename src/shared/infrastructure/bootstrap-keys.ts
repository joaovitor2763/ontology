/**
 * Documentos que cada endereço assina ao montar. O bootstrap da página
 * (`GET /api/state?with=session,google,alerts`) sai antes de qualquer tela
 * montar — a casca só monta o conteúdo depois de conhecer a sessão — então a
 * lista precisa ser conhecida pelo endereço, não pelas assinaturas.
 *
 * A lista foi medida tela a tela (`docs/plano-de-otimizacao-desempenho-2.md`,
 * fase B). Errar para menos custa uma segunda chamada, que a hidratação faz
 * sozinha; errar para mais custa bytes de um documento que ninguém lê. Nada
 * aqui decide permissão: o servidor continua negando chave a chave.
 */
const K = {
  workspace: "ontology.workspace.v3",
  clients: "ontology.clients.v3",
  catalog: "ontology.catalog.v2",
  delivery: "ontology.delivery.v2",
  documents: "ontology.documents.v3",
  engagement: "ontology.engagement.v2",
  knowledge: "ontology.knowledge.v2",
  relationship: "ontology.relationship.v1",
  stakeholders: "ontology.stakeholders.v1",
} as const;

const PORTFOLIO = [K.workspace, K.clients, K.engagement, K.delivery, K.documents, K.catalog, K.stakeholders];
const CLIENT = [K.workspace, K.clients, K.catalog, K.delivery, K.documents, K.stakeholders, K.engagement, K.relationship];
const CLIENT_TASKS = CLIENT.filter(key => key !== K.delivery);
const CATALOG = [K.workspace, K.clients, K.catalog, K.delivery, K.documents];

/**
 * Visão geral e Clientes leem a carteira de `/api/portfolio`; o que montam do
 * estado foi medido na tela (sonda em `hydrate`, 06/10/2026): a Visão geral usa
 * equipe, cadastro e reuniões (agenda); Clientes usa equipe, cadastro, contatos
 * e catálogo (produtos do filtro). Documentos e o resto ficavam no bootstrap sem
 * ninguém ler (~330–380 KB por carga em produção).
 */
const HOME = [K.workspace, K.clients, K.engagement];
const CLIENTS = [K.workspace, K.clients, K.stakeholders, K.catalog];

const ROUTES: [RegExp, readonly string[]][] = [
  [/^\/$/, HOME],
  [/^\/clientes$/, CLIENTS],
  [/^\/clientes\/[^/]+$/, [...CLIENT_TASKS, K.knowledge]],
  [/^\/clientes\/[^/]+\/entregas\/[^/]+$/, [...CLIENT_TASKS, K.knowledge]],
  [/^\/clientes\/[^/]+\/entregas$/, CLIENT_TASKS],
  [/^\/clientes\/[^/]+\//, CLIENT_TASKS],
  [/^\/execucao/, [K.workspace, K.clients, K.delivery, K.documents, K.catalog, K.engagement, K.relationship]],
  [/^\/agenda/, [K.workspace, K.clients, K.engagement]],
  [/^\/alertas/, PORTFOLIO.filter(key => key !== K.delivery)],
  [/^\/conversas/, CLIENT_TASKS],
  [/^\/documentos/, [K.workspace, K.clients, K.documents, K.engagement, K.catalog]],
  [/^\/reunioes\/[^/]+$/, [K.workspace, K.clients, K.engagement, K.stakeholders, K.catalog, K.documents, K.knowledge]],
  [/^\/reunioes/, [K.workspace, K.clients, K.engagement, K.stakeholders]],
  [/^\/catalogo\/(?:produtos|planos)$/, CATALOG.filter(key => key !== K.delivery)],
  [/^\/catalogo/, CATALOG],
  [/^\/configuracoes/, CATALOG.filter(key => key !== K.delivery)],
  [/^\/equipe\/membros$/, [K.workspace, K.clients]],
  [/^\/equipe\/membros\/[^/]+$/, PORTFOLIO.filter(key => key !== K.delivery)],
  [/^\/equipe\/alocacao$/, PORTFOLIO.filter(key => key !== K.delivery)],
  [/^\/equipe/, PORTFOLIO],
  [/^\/perfil/, PORTFOLIO.filter(key => key !== K.delivery)],
  [/^\/ontologia/, [...CATALOG.filter(key => key !== K.delivery), K.knowledge]],
];

/**
 * A mesma tabela em forma serializável: o script inline da carga antecipada
 * (`early-boot.ts`) a recebe como JSON e escolhe as chaves antes do JavaScript
 * da aplicação chegar. A ordem importa: vale a primeira expressão que casar.
 */
export const BOOTSTRAP_TABLE: { routes: [string, readonly string[]][]; fallback: readonly string[] } = {
  routes: [
    ["^/execucao$", [K.workspace, K.clients, K.documents, K.catalog, K.engagement, K.relationship]],
    ...ROUTES.map(([pattern, keys]): [string, readonly string[]] => [pattern.source, keys]),
  ],
  fallback: [K.workspace, K.clients],
};

/** Caminho sem consulta e sem barra final, como a tabela espera. */
export function bootstrapPath(pathname: string): string {
  const [rawPath] = pathname.split("?");
  return rawPath.replace(/\/+$/, "") || "/";
}

/** Chaves a levar no bootstrap para o endereço; toda tela usa o workspace e o cadastro de clientes. */
export function bootstrapKeysFor(pathname: string): readonly string[] {
  const path = bootstrapPath(pathname);
  return BOOTSTRAP_TABLE.routes.find(([pattern]) => new RegExp(pattern).test(path))?.[1] ??
    BOOTSTRAP_TABLE.fallback;
}

/** Pages whose remote execution view comes from client slices or a compact summary. */
export function skipsGlobalDeliveryRead(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/" || path === "/clientes" || path === "/alertas" || path === "/agenda" || path === "/reunioes" || path === "/equipe/alocacao" ||
    path === "/configuracoes" || path === "/ontologia" || path === "/catalogo/produtos" || path === "/catalogo/planos" || path === "/documentos" || path === "/conversas" || /^\/reunioes\/[^/]+$/.test(path) ||
    path === "/perfil" || /^\/equipe\/membros\/[^/]+$/.test(path) ||
    /^\/clientes\/[^/]+(?:\/|$)/.test(path);
}
