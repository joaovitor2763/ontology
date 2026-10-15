/**
 * Single source of truth for URLs and the product glossary applied to them.
 * Screens never build paths by hand; redirects for legacy addresses live in next.config.ts.
 */
export type ClientSection =
  | "plano"
  | "solicitacoes"
  | "entregas"
  | "agenda"
  | "conversas"
  | "documentos"
  | "stakeholders"
  | "ontologia";

export type ExecutionView = "entregas" | "ciclos" | "cronograma";
export type PlanView = "plano" | "ciclos" | "cronograma";
export type DeliveriesView = "entregas" | "solicitacoes";

const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const paths = {
  home: "/",
  signIn: "/entrar",
  googleLogin: "/api/auth/google",
  clients: "/clientes",
  client: (slug: string) => `/clientes/${slug}`,
  clientSection: (slug: string, section: ClientSection) =>
    `/clientes/${slug}/${section}`,
  clientPlan: (slug: string, view?: PlanView, marco?: number) =>
    `/clientes/${slug}/plano${query({ visao: view === "plano" ? undefined : view, marco: marco ? String(marco) : undefined })}`,
  clientDeliveries: (slug: string, view?: DeliveriesView, marco?: number) =>
    view === "solicitacoes" ? `/clientes/${slug}/solicitacoes` : `/clientes/${slug}/entregas${query({ marco: marco ? String(marco) : undefined })}`,
  clientRequests: (slug: string) => `/clientes/${slug}/solicitacoes`,
  clientCycle: (slug: string, id: string) => `/clientes/${slug}/ciclos/${id}`,
  clientDelivery: (slug: string, id: string) =>
    `/clientes/${slug}/entregas/${id}`,
  clientAgenda: (slug: string) => `/clientes/${slug}/agenda`,
  clientConversations: (slug: string, thread?: string) =>
    `/clientes/${slug}/conversas${query({ conversa: thread })}`,
  clientDocuments: (slug: string) => `/clientes/${slug}/documentos`,
  clientStakeholders: (slug: string) => `/clientes/${slug}/stakeholders`,
  clientOntology: (slug: string, node?: string) =>
    `/clientes/${slug}/ontologia${query({ elemento: node })}`,
  execution: (view?: ExecutionView, client?: string) =>
    `/execucao${query({ visao: view === "entregas" ? undefined : view, cliente: client })}`,
  agenda: "/agenda",
  meetings: "/reunioes",
  meeting: (id: string) => `/reunioes/${id}`,
  conversations: (thread?: string) =>
    `/conversas${query({ conversa: thread })}`,
  documents: (client?: string) => `/documentos${query({ cliente: client })}`,
  alerts: (client?: string, from?: string) => `/alertas${query({ cliente: client, origem: from })}`,
  catalogProducts: (productId?: string) =>
    `/catalogo/produtos${query({ produto: productId })}`,
  catalogPlans: (planId?: string) =>
    `/catalogo/planos${query({ plano: planId })}`,
  teamMembers: "/equipe/membros",
  teamMember: (id: string) => `/equipe/membros/${id}`,
  teamAllocation: (memberId?: string) =>
    `/equipe/alocacao${query({ membro: memberId })}`,
  settings: "/configuracoes",
  profile: "/perfil",
  ontologies: "/ontologia",
} as const;

/** Return only to this client's own pages, with its original view filters. */
export function alertReturnPath(client: string, from: string | null): string {
  const fallback = paths.client(client);
  if (!from?.startsWith("/")) return fallback;
  try {
    const url = new URL(from, "https://delivery.local");
    if (url.origin !== "https://delivery.local" ||
      (url.pathname !== fallback && !url.pathname.startsWith(`${fallback}/`))) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** Product vocabulary. Every visible label for these concepts comes from here. */
export const glossary = {
  client: "Cliente",
  clients: "Clientes",
  product: "Produto",
  products: "Produtos",
  plan: "Plano",
  plans: "Planos",
  milestone: "Marco",
  milestones: "Marcos",
  cycle: "Ciclo",
  cycles: "Ciclos",
  delivery: "Tarefa",
  deliveries: "Tarefas",
  request: "Solicitação",
  requests: "Solicitações",
  acceptance: "Aceite",
  meeting: "Reunião",
  meetings: "Reuniões",
  agenda: "Agenda",
  conversation: "Conversa",
  conversations: "Conversas",
  document: "Documento",
  documents: "Documentos",
  team: "Equipe",
  member: "Membro",
  members: "Membros",
  allocation: "Alocação",
  execution: "Execução",
  schedule: "Cronograma",
  catalog: "Catálogo",
  settings: "Configurações",
  alerts: "Alertas",
  stakeholders: "Stakeholders",
  ontology: "Ontologia",
  ontologies: "Ontologias",
  overview: "Visão geral",
  profile: "Perfil",
} as const;

export const clientSectionLabel: Record<ClientSection, string> = {
  plano: "Plano e ciclos",
  solicitacoes: "Tickets",
  entregas: glossary.deliveries,
  agenda: glossary.agenda,
  conversas: "Interações",
  documentos: glossary.documents,
  stakeholders: glossary.stakeholders,
  ontologia: glossary.ontology,
};

export const executionViewLabel: Record<ExecutionView, string> = {
  entregas: glossary.deliveries,
  ciclos: glossary.cycles,
  cronograma: glossary.schedule,
};

export const planViewLabel: Record<PlanView, string> = {
  plano: glossary.plan,
  ciclos: glossary.cycles,
  cronograma: glossary.schedule,
};
