/**
 * Lado do navegador das réplicas de leitura do D1 (`src/server/d1-replicas.ts`).
 *
 * Só age quando o servidor manda `x-d1-bookmark` (flag `D1_READ_REPLICAS=1`):
 * guarda no cookie `g4_d1_bookmark` o **maior** bookmark visto, que vai em toda
 * requisição seguinte, inclusive na carga antecipada de outra página e em outra
 * aba. Assim uma leitura nunca começa numa réplica mais velha do que a última
 * escrita confirmada desta pessoa neste navegador. Uma escrita que voltou sem
 * bookmark (rota fora do invólucro) liga `g4_d1_primary` por 30 s: as leituras
 * desse intervalo vão ao primário. Com a flag desligada nenhum cabeçalho chega
 * e nada aqui grava cookie.
 */
export const BOOKMARK_COOKIE = "g4_d1_bookmark";
export const PRIMARY_COOKIE = "g4_d1_primary";

const BOOKMARK = /^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{1,128}$/i;

/** O mais novo dos dois (bookmarks do D1 se comparam como texto). */
export function newerBookmark(current: string | null, next: string | null): string | null {
  const a = current && BOOKMARK.test(current) ? current : null;
  const b = next && BOOKMARK.test(next) ? next : null;
  if (!a) return b;
  if (!b) return a;
  return b > a ? b : a;
}

type CookieJar = { get(): string; set(value: string): void };

function readCookie(jar: CookieJar, name: string) {
  const part = jar.get().split(";").map(p => p.trim()).find(p => p.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}

/**
 * Aplica uma resposta de `/api` ao cookie. Exportada para teste; o navegador a
 * chama pelo `fetch` envolvido em `installD1BookmarkTracking`.
 */
export function noteApiResponse(jar: CookieJar, method: string, bookmark: string | null, secure: boolean) {
  const flags = `; Path=/; SameSite=Lax; Max-Age=86400${secure ? "; Secure" : ""}`;
  if (bookmark) {
    const current = readCookie(jar, BOOKMARK_COOKIE);
    const next = newerBookmark(current, bookmark);
    if (next && next !== current) jar.set(`${BOOKMARK_COOKIE}=${encodeURIComponent(next)}${flags}`);
    return;
  }
  const write = !["GET", "HEAD"].includes(method.toUpperCase());
  if (write && readCookie(jar, BOOKMARK_COOKIE))
    jar.set(`${PRIMARY_COOKIE}=1; Path=/; SameSite=Lax; Max-Age=30${secure ? "; Secure" : ""}`);
}

let installed = false;

/** Envolve `fetch` uma vez para observar as respostas de `/api` da própria origem. */
export function installD1BookmarkTracking() {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;
  const original = window.fetch.bind(window);
  const jar: CookieJar = { get: () => document.cookie, set: (value) => { document.cookie = value; } };
  window.fetch = async (input, init) => {
    const response = await original(input, init);
    try {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        window.location.href);
      if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
        const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
        noteApiResponse(jar, method, response.headers.get("x-d1-bookmark"), window.location.protocol === "https:");
      }
    } catch {
      // Só uma otimização de consistência; a resposta segue intacta.
    }
    return response;
  };
}
