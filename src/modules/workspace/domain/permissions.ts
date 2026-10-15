/**
 * Who can do what. Four levels of access, one matrix, one `can` function used
 * by the interface (to show or hide) and by the server (to refuse writes).
 *
 * - Admin da plataforma: everything, including team, approvals and settings.
 * - Gestor de IA: everything about clients, catalog and allocation; not the
 *   team roster nor the workspace settings.
 * - AI Master: sees every client; edits only the clients where they are
 *   allocated (responsible, CS or team member of that client).
 * - Visualização: reads everything, changes nothing.
 */
export type AccessLevel = "admin" | "gestor" | "ai_master" | "leitor";

export const accessLabel: Record<AccessLevel, string> = {
  admin: "Admin da plataforma",
  gestor: "Gestor de IA",
  ai_master: "AI Master",
  leitor: "Visualização",
};

export const accessHint: Record<AccessLevel, string> = {
  admin:
    "Vê e faz tudo: equipe, aprovações, catálogo, clientes e configurações.",
  gestor:
    "Vê tudo; edita clientes, catálogo e alocação. Não gerencia a equipe nem as configurações.",
  ai_master: "Vê todos os clientes; edita só os clientes onde está alocado.",
  leitor: "Consulta tudo, sem editar.",
};

/** Older records stored "membro"; anything unknown is treated as read-only. */
export function normalizeAccess(value?: string | null): AccessLevel {
  if (
    value === "admin" ||
    value === "gestor" ||
    value === "ai_master" ||
    value === "leitor"
  )
    return value;
  if (value === "membro") return "ai_master";
  return "leitor";
}

export type Action =
  | "api-keys.gerenciar"
  | "auditoria.ver"
  | "alertas.ciencia"
  | "clientes.ver"
  | "clientes.criar"
  | "cliente.configurar"
  | "cliente.arquivar"
  | "plano.editar"
  | "ciclos.editar"
  | "entregas.editar"
  | "entregas.remover"
  | "ontologia.editar"
  | "interacoes.registrar"
  | "reunioes.agendar"
  | "documentos.enviar"
  | "stakeholders.editar"
  | "catalogo.editar"
  | "cliente.responsaveis"
  | "alocacao.editar"
  | "equipe.gerenciar"
  | "configuracoes.editar"
  | "google.conectar"
  | "ia.analisar"
  | "ia.revisar"
  | "whatsapp.sincronizar"
  | "ver-como";

/** Actions that happen inside one client and, for an AI Master, require being allocated there. */
const CLIENT_SCOPED: Action[] = [
  "alertas.ciencia",
  "ia.analisar",
  "ia.revisar",
  "whatsapp.sincronizar",
  "cliente.configurar",
  "cliente.responsaveis",
  "plano.editar",
  "ciclos.editar",
  "entregas.editar",
  "entregas.remover",
  "ontologia.editar",
  "interacoes.registrar",
  "reunioes.agendar",
  "documentos.enviar",
  "stakeholders.editar",
];

const GESTOR_DENIED: Action[] = [
  "auditoria.ver",
  "equipe.gerenciar",
  "configuracoes.editar",
  "ver-como",
];

export type Actor = { access: AccessLevel; memberId: string };
export type Scope = {
  /** Members allocated to the client in question (responsible, CS and team). */
  responsibleIds?: string[];
};

export function can(actor: Actor, action: Action, scope: Scope = {}): boolean {
  const access = normalizeAccess(actor.access);
  if (action === "clientes.ver" || action === "api-keys.gerenciar") return true;
  if (access === "leitor") return false;
  if (action === "google.conectar") return true;
  if (access === "admin") return true;
  if (access === "gestor") return !GESTOR_DENIED.includes(action);
  // ai_master
  if (CLIENT_SCOPED.includes(action))
    return (scope.responsibleIds ?? []).includes(actor.memberId);
  return false;
}

/** The matrix as rows, for the documentation and the settings screen. */
export const permissionMatrix: { action: Action; label: string }[] = [
  { action: "cliente.responsaveis", label: "Alterar responsáveis do cliente e dos produtos" },
  { action: "api-keys.gerenciar", label: "Gerenciar as próprias chaves de API" },
  { action: "auditoria.ver", label: "Consultar a auditoria do workspace" },
  {action:"alertas.ciencia",label:"Marcar alertas do cliente como vistos"},
  { action: "ia.analisar", label: "Gerar análises do cliente" },
  { action: "ia.revisar", label: "Validar ou descartar sugestões de IA" },
  {
    action: "whatsapp.sincronizar",
    label: "Atualizar e importar histórico do WhatsApp",
  },
  { action: "clientes.ver", label: "Ver todos os clientes" },
  { action: "clientes.criar", label: "Criar cliente" },
  {
    action: "cliente.configurar",
    label: "Configurar cliente (serviço, plano, módulos)",
  },
  { action: "cliente.arquivar", label: "Arquivar ou encerrar cliente" },
  { action: "plano.editar", label: "Plano e marcos do cliente" },
  { action: "ciclos.editar", label: "Ciclos e aceite" },
  { action: "entregas.editar", label: "Tarefas e solicitações" },
  { action: "entregas.remover", label: "Excluir tarefas" },
  { action: "ontologia.editar", label: "Editar a ontologia do cliente" },
  { action: "interacoes.registrar", label: "Registrar interações e notas" },
  { action: "reunioes.agendar", label: "Agendar e editar reuniões" },
  { action: "documentos.enviar", label: "Enviar e revisar documentos" },
  { action: "stakeholders.editar", label: "Stakeholders do cliente" },
  { action: "catalogo.editar", label: "Catálogo: produtos e planos" },
  {
    action: "alocacao.editar",
    label: "Alocar clientes a AI Masters (carteira)",
  },
  {
    action: "equipe.gerenciar",
    label: "Cadastrar, aprovar e desativar membros",
  },
  {
    action: "configuracoes.editar",
    label: "Configurações e integrações do workspace",
  },
  { action: "google.conectar", label: "Conectar a própria conta Google" },
  { action: "ver-como", label: "Ver como outro membro" },
];

export type CellValue = "tudo" | "alocado" | "nao";

/** What a level can do for one action: everything, only where allocated, or nothing. */
export function matrixCell(access: AccessLevel, action: Action): CellValue {
  if (can({ access, memberId: "x" }, action, { responsibleIds: ["x"] })) {
    return can({ access, memberId: "x" }, action, { responsibleIds: [] })
      ? "tudo"
      : "alocado";
  }
  return "nao";
}

/* ---------- server-side rules for the state documents ---------- */

export type StateKeyContext = "workspace" | "catalog" | "clients" | "other";

export function stateKeyContext(key: string): StateKeyContext {
  const context = key.split(".")[1];
  if (context === "workspace") return "workspace";
  if (context === "catalog") return "catalog";
  if (context === "clients") return "clients";
  return "other";
}

/** Fields of the workspace doc only an admin may change (the roster and the identity). */
export const WORKSPACE_GUARDED_FIELDS = [
  "extraMembers",
  "memberEdits",
  "deactivatedIds",
  "workspaceName",
] as const;

export type WriteDecision =
  { ok: true } | { ok: false; status: 403; reason: string };

/**
 * Whether a signed-in person may save a state doc. `member` is null when
 * the e-mail is not on the roster; `bootstrap` is true while the roster is
 * empty (the first person becomes the admin). `guardedChanged` says whether a
 * workspace write touches the roster fields.
 */
export function authorizeStateWrite(input: {
  member: { access?: string; active: boolean } | null;
  bootstrap: boolean;
  key: string;
  guardedChanged?: boolean;
}): WriteDecision {
  if (input.bootstrap) return { ok: true };
  if (!input.member)
    return {
      ok: false,
      status: 403,
      reason: "Seu acesso ainda não foi aprovado.",
    };
  if (!input.member.active)
    return { ok: false, status: 403, reason: "Seu acesso foi desativado." };
  const access = normalizeAccess(input.member.access);
  if (access === "leitor")
    return {
      ok: false,
      status: 403,
      reason: "Seu nível de acesso é de visualização.",
    };
  const context = stateKeyContext(input.key);
  if (context === "catalog" && access === "ai_master")
    return {
      ok: false,
      status: 403,
      reason: "Só gestores e admins editam o catálogo.",
    };
  if (context === "workspace" && input.guardedChanged && access !== "admin")
    return {
      ok: false,
      status: 403,
      reason: "Só admins alteram a equipe e o workspace.",
    };
  return { ok: true };
}

export function authorizeStateRead(input: {
  member: { active: boolean } | null;
  bootstrap: boolean;
  key: string;
}): WriteDecision {
  if (input.bootstrap) return { ok: true };
  // The roster itself is readable by anyone signed in: the app needs it to say "waiting for approval".
  if (stateKeyContext(input.key) === "workspace") return { ok: true };
  if (!input.member)
    return {
      ok: false,
      status: 403,
      reason: "Seu acesso ainda não foi aprovado.",
    };
  if (!input.member.active)
    return { ok: false, status: 403, reason: "Seu acesso foi desativado." };
  return { ok: true };
}
