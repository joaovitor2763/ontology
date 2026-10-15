import { paths } from "../lib/routes.ts";
import { getSyncStatus } from "./persistence.ts";

/**
 * Endereço de entrada de um cliente: a primeira aba escolhida pela pessoa
 * (preferência `client-tabs`, padrão Tarefas), não `/clientes/<slug>`.
 *
 * Entrar por `/clientes/<slug>` montava a Visão geral do cliente, que só então
 * redirecionava (`router.replace`) para a aba escolhida: uma segunda troca de
 * rota (outro payload do Next) e as leituras da Visão geral jogadas fora. Os
 * links de entrada (lista, carteira, busca, alertas, equipe) apontam direto
 * para a aba. O redirecionamento de `CompanyChrome` continua valendo para quem
 * chega pelo endereço curto e para abas que dependem de módulo do cliente
 * (Ontologia, Uso), que aqui caem no endereço curto. `?aba=geral` não muda.
 */
const SECTIONS = new Set(["plano", "entregas", "solicitacoes", "agenda", "conversas", "documentos", "stakeholders"]);

/** A mesma chave do navegador que `CompanyChrome` usa para a preferência. */
export const clientTabsKey = (owner: string) => `ontology.client-tabs.v1.${owner}`;

/** Endereço para a aba guardada (`null`/desconhecida = Tarefas, como no `CompanyChrome`). */
export function clientEntryPath(slug: string, firstTab: unknown): string {
  const tab = typeof firstTab === "string" ? firstTab : "entregas";
  if (tab === "overview" || tab === "ontologia" || tab === "uso") return paths.client(slug);
  return SECTIONS.has(tab) ? `${paths.client(slug)}/${tab}` : `${paths.client(slug)}/entregas`;
}

/** Preferência guardada neste navegador para a pessoa da sessão; sem sessão remota, `undefined`. */
function storedFirstTab(): unknown {
  const status = getSyncStatus();
  if (!status.resolved || status.mode !== "remote" || !status.user) return undefined;
  try {
    const raw = localStorage.getItem(clientTabsKey(status.user.email.toLowerCase()));
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Link de entrada no cliente. Fora do modo remoto (ou sem sessão), o endereço curto de sempre. */
export function clientEntry(slug: string): string {
  const tab = storedFirstTab();
  return tab === undefined ? paths.client(slug) : clientEntryPath(slug, tab);
}
