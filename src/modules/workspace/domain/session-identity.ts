import { mergeContactPoints, type ContactPointOwner } from "../../../shared/lib/contact-points.ts";
import { normalizeAccess } from "./permissions.ts";

/**
 * Quem é o membro atual. Publicado (modo remoto), é sempre a pessoa da sessão:
 * o membro cujo e-mail principal é o do login, a mesma regra do servidor
 * (`memberOfRoster`). O `currentUserId` gravado no documento compartilhado do
 * workspace é só o "ver como" do modo navegador; publicado ele é ignorado e
 * nunca regravado, porque o documento é de todos.
 */
type MemberLike = { id: string; email?: string; access?: string };

/**
 * Equipe vista pela interface: membros criados e membros de exemplo da equipe
 * interna, cada um com as suas edições. Uma lista só para `useTeam` e para o
 * membro atual de `useWorkspaceState`, para as duas nunca divergirem.
 */
export function rosterMembers<M extends ContactPointOwner>(
  extraMembers: readonly M[],
  memberEdits: Record<string, Partial<M>>,
  seeds: readonly M[],
): M[] {
  return [...extraMembers, ...seeds.filter((p) => p.org === "praxis")].map(
    (p) => mergeContactPoints(p, memberEdits[p.id]) as M,
  );
}

export function sessionMemberOf<M extends MemberLike>(
  members: readonly M[],
  email: string | null | undefined,
): M | undefined {
  if (!email) return undefined;
  const wanted = email.toLowerCase();
  return members.find((p) => p.email?.toLowerCase() === wanted);
}

/**
 * Identidade usada como autor (histórico, comentários, checklist, revisão) e
 * para as permissões da interface. Publicado, sem membro da sessão (roster
 * ainda chegando ou pessoa fora do cadastro) devolve `""`: nunca o membro que
 * carregou a página por último, nem o membro de exemplo com acesso de admin.
 */
export function effectiveCurrentUserId(input: {
  mode: "local" | "remote";
  sessionEmail: string | null | undefined;
  members: readonly MemberLike[];
  storedId: string;
  fallbackId: string;
}): string {
  if (input.mode === "remote")
    return sessionMemberOf(input.members, input.sessionEmail)?.id ?? "";
  return input.storedId || input.fallbackId;
}

/**
 * O que o primeiro acesso publicado grava no roster. Só duas situações escrevem:
 * o workspace sem admin (o membro da sessão se promove, e o servidor só aceita
 * isso enquanto não há admin) e o workspace vazio (a pessoa cria o próprio
 * cadastro de admin; o servidor só aceita de `AUTH_BOOTSTRAP_EMAIL`). Abrir a
 * página como membro já cadastrado num workspace com admin não grava nada.
 */
export type SessionBootStep<M> =
  | { kind: "none" }
  | { kind: "promote"; member: M }
  | { kind: "create"; id: string };

export function sessionBootStep<M extends MemberLike>(
  members: readonly M[],
  email: string,
): SessionBootStep<M> {
  const existing = sessionMemberOf(members, email);
  if (existing) {
    const hasAdmin = members.some((p) => normalizeAccess(p.access) === "admin");
    return hasAdmin ? { kind: "none" } : { kind: "promote", member: existing };
  }
  // Alguém já no cadastro? Então quem chega espera a aprovação de um admin (Equipe).
  if (members.some((p) => p.email)) return { kind: "none" };
  return { kind: "create", id: `member-${email.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` };
}
