/**
 * Carga antecipada da página.
 *
 * Sem ela, a primeira leitura só saía depois de o HTML chegar, o JavaScript da
 * aplicação baixar e executar, o React hidratar e o `SessionGate` montar; e a
 * leitura de dados da tela (quadro, carteira, alertas, fatia do cliente) só
 * saía depois de o bootstrap voltar. Três viagens em série antes do conteúdo.
 *
 * O layout raiz põe no `<head>` um script inline que dispara, enquanto o HTML
 * ainda é lido, o bootstrap (`/api/state?…&with=session,google,alerts`) e as
 * leituras que a tela do endereço vai fazer ao montar. As respostas ficam em
 * `window.__g4boot`; quem pediria o mesmo endereço pega a resposta pronta uma
 * única vez (`takeEarlyResponse`, `earlyFetch`), dentro de 10 segundos. Nada
 * muda na autorização: são as mesmas requisições, com o mesmo cookie, só que
 * mais cedo. Sem sessão, as respostas 401 simplesmente não são consumidas.
 *
 * `earlyBootPlan` é a única fonte dos endereços: o script inline é o texto da
 * própria função, então ela precisa ser autocontida (sem importações nem
 * variáveis de fora) e usar só sintaxe que o navegador lê sem transformação.
 */

export type EarlyBootTable = { routes: [string, readonly string[]][]; fallback: readonly string[] };
export type EarlyBootPlan = { bootstrap: string; data: string[] };

/** Endereços que a carga da página vai pedir. Autocontida: vira script inline. */
export function earlyBootPlan(pathname: string, search: string, table: EarlyBootTable, legacyExecution = false): EarlyBootPlan {
  const path = pathname.replace(/\/+$/, "") || "/";
  let keys = table.fallback;
  for (let i = 0; i < table.routes.length; i++) {
    if (new RegExp(table.routes[i][0]).test(path)) {
      keys = table.routes[i][1];
      break;
    }
  }
  const bootstrap = "/api/state?" + new URLSearchParams({ keys: keys.join(","), with: "session,google,alerts" }).toString();
  const params = new URLSearchParams(search);
  const data: string[] = [];
  const client = /^\/clientes\/([^/]+)(?:\/|$)/.exec(path);
  if (path === "/" || path === "/clientes" || path === "/equipe/alocacao") data.push("/api/portfolio");
  else if (path === "/alertas") {
    const alertsOf = params.get("cliente");
    data.push("/api/alerts" + (alertsOf ? "?company=" + encodeURIComponent(alertsOf) : ""));
  } else if (path === "/execucao") {
    const view = params.get("visao");
    // O mesmo endereço de `EXECUTION_BOARD_URL` (tarefas em tabela com dicionário).
    data.push(view === "ciclos" || view === "cronograma" ? "/api/execution/cycles" : "/api/execution/board?formato=tabela");
  } else if (client) {
    let company = "";
    try {
      company = decodeURIComponent(client[1]);
    } catch {
      company = "";
    }
    if (company) {
      data.push("/api/v1/clients/" + encodeURIComponent(company) + "/execution-snapshot");
      // In legacy mode the client route reads only the slice answer.
      if (!legacyExecution) {
        data.push("/api/v1/tasks?" + new URLSearchParams({ company: company, limit: "100" }).toString());
        data.push("/api/v1/cycles?" + new URLSearchParams({ company: company, limit: "100" }).toString());
      }
    }
  }
  return { bootstrap: bootstrap, data: data };
}

type EarlyBoot = { at: number; requests: Record<string, Promise<Response>> };
declare global {
  interface Window {
    __g4boot?: EarlyBoot;
  }
}

/** Corpo do script inline. Autocontido pelo mesmo motivo de `earlyBootPlan`. */
function startEarlyBoot(table: EarlyBootTable, plan: typeof earlyBootPlan) {
  try {
    if (location.pathname === "/entrar" || typeof fetch !== "function") return;
    let legacy = false;
    try {
      legacy = localStorage.getItem("g4.execution-mode") === "legacy";
    } catch {
      legacy = false;
    }
    const planned = plan(location.pathname, location.search, table, legacy);
    const urls = [planned.bootstrap].concat(planned.data);
    const requests: Record<string, Promise<Response>> = {};
    for (let i = 0; i < urls.length; i++) {
      const request = fetch(urls[i], { headers: { accept: "application/json" }, cache: "no-store" });
      request.catch(function () {});
      requests[urls[i]] = request;
    }
    window.__g4boot = { at: Date.now(), requests: requests };
  } catch {
    // A carga normal segue sozinha.
  }
}

/** O script que o layout raiz põe no `<head>`. */
export function earlyBootScript(table: EarlyBootTable): string {
  const json = JSON.stringify(table).replace(/</g, "\\u003c");
  return `(${startEarlyBoot.toString()})(${json},${earlyBootPlan.toString()});`;
}

const EARLY_TTL = 10_000;

/**
 * Leituras adiantadas na navegação dentro do app (`navigation-warmup.ts`): o
 * gesto de ir a uma tela (passar o mouse, tocar, focar o link) dispara a mesma
 * leitura que a tela fará ao montar, em paralelo com a troca de rota do Next.
 * Cada entrada tem o próprio relógio e vale uma vez, como a carga antecipada.
 */
const warmed = new Map<string, { at: number; request: Promise<Response> }>();

/** Dispara a leitura `url` agora, se não houver uma recente esperando. */
export function warmEarlyFetch(url: string, now = Date.now()) {
  if (typeof window === "undefined") return;
  for (const [key, entry] of warmed) if (now - entry.at > EARLY_TTL) warmed.delete(key);
  const known = warmed.get(url);
  if (known && now - known.at <= EARLY_TTL) return;
  const boot = window.__g4boot;
  if (boot?.requests[url] && now - boot.at <= EARLY_TTL) return;
  const request = fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  request.catch(() => undefined);
  warmed.set(url, { at: now, request });
}

/** Descarta as leituras adiantadas: depois de uma gravação elas podem estar velhas. */
export function dropWarmResponses() {
  warmed.clear();
}

/** A resposta antecipada daquele endereço, uma única vez e só enquanto é recente. */
export function takeEarlyResponse(url: string): Promise<Response> | null {
  if (typeof window === "undefined") return null;
  const warm = warmed.get(url);
  if (warm) {
    warmed.delete(url);
    if (Date.now() - warm.at <= EARLY_TTL) return warm.request;
  }
  const boot = window.__g4boot;
  const request = boot?.requests[url];
  if (!boot || !request) return null;
  delete boot.requests[url];
  return Date.now() - boot.at > EARLY_TTL ? null : request;
}

/**
 * `fetch` que aproveita a resposta antecipada de uma leitura simples: GET sem
 * cabeçalhos condicionais. Falha da antecipação refaz a chamada normal.
 */
export const earlyFetch: typeof fetch = (input, init) => {
  if (typeof input === "string" && (init?.method ?? "GET") === "GET" && !init?.headers &&
      !init?.signal?.aborted) {
    const early = takeEarlyResponse(input);
    if (early) return early.catch(() => fetch(input, init));
  }
  return fetch(input, init);
};
