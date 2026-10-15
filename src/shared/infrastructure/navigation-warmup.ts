import { BOOTSTRAP_TABLE, bootstrapKeysFor } from "./bootstrap-keys.ts";
import { earlyBootPlan, warmEarlyFetch } from "./early-boot.ts";
import { remoteOperationsSettled, warmDocuments } from "./persistence.ts";
import { keysToHydrate } from "./useLocalStorageState.ts";

/**
 * Navegação dentro do app sem cascata: antes, a troca de rota buscava o payload
 * do Next (RSC) e só depois a tela montava e pedia os dados. Aqui o **gesto**
 * de ir — mouse parado sobre o link, toque, foco pelo teclado — já dispara as
 * leituras que a tela de destino fará ao montar (as mesmas de `earlyBootPlan`),
 * e os documentos que esta aba ainda não tem. A tela pega a resposta pronta
 * (`earlyFetch`, `fetchDocuments`) uma única vez, dentro de 10 s; qualquer
 * gravação descarta o que foi adiantado. Nada muda na autorização: são as
 * mesmas requisições, com o mesmo cookie, só que mais cedo.
 */

/** Leituras de tela que podem ser adiantadas (as que os carregadores consomem sem cabeçalho condicional). */
const WARM_DATA = /^\/api\/(?:portfolio$|alerts(?:\?|$)|v1\/clients\/[^/?]+\/execution-snapshot$|v1\/(?:tasks|cycles)\?)/;
/** Documento global da execução: reconstruí-lo por um gesto que talvez não vire navegação custa caro. */
const NEVER_WARM = new Set(["ontology.delivery.v2"]);

/** O que adiantar para ir de `current` a `href` (`null` se não for uma tela do app). */
export function warmupPlan(href: string, current: { pathname: string; search: string; origin: string },
  legacyExecution = false): { data: string[]; keys: string[] } | null {
  let url: URL;
  try { url = new URL(href, current.origin); } catch { return null; }
  if (url.origin !== current.origin || url.pathname.startsWith("/api/") || url.pathname === "/entrar") return null;
  if (url.pathname === current.pathname && url.search === current.search) return null;
  const plan = earlyBootPlan(url.pathname, url.search, BOOTSTRAP_TABLE, legacyExecution);
  return {
    data: plan.data.filter(path => WARM_DATA.test(path)),
    keys: bootstrapKeysFor(url.pathname).filter(key => !NEVER_WARM.has(key)),
  };
}

function legacyExecution() {
  try { return localStorage.getItem("g4.execution-mode") === "legacy"; } catch { return false; }
}

export function warmNavigation(href: string) {
  if (!remoteOperationsSettled()) return;
  const plan = warmupPlan(href, window.location, legacyExecution());
  if (!plan) return;
  for (const path of plan.data) warmEarlyFetch(path);
  warmDocuments(keysToHydrate(plan.keys));
}
