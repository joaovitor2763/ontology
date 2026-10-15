"use client";
import { useSearchParams } from "next/navigation";
import { paths } from "@/shared/lib/routes";
import { normalizeAccess, accessLabel } from "@/modules/workspace/domain/permissions";
import { ProductMark, TextField } from "@g4ai/ds";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { Avatar, Button } from "@/shared/ui/primitives";
import { LogIn, LogOut } from "lucide-react";
import { useState, Suspense } from "react";

/**
 * Google sign-in for the published app; local development can select a member.
 */
export function EntrarScreen() {
  const { user, mode, resolved, authMode, error: syncError } = useSyncStatus();
  const { members, deactivated } = useTeam();
  const dev = mode === "remote" ? user?.authMode === "dev" : false;
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function enter(asEmail: string, asName = "") {
    setBusy(true);
    setError("");
    const response = await fetch("/api/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: asEmail, name: asName }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Não foi possível entrar.");
      setBusy(false);
      return;
    }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload re-reads the session
    globalThis.location.assign(`${globalThis.location.origin}/`);
  }
  async function leave() {
    if (dev) await fetch("/api/dev-login", { method: "DELETE" });
    else if (authMode === "google") {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) { setError("Não foi possível sair. Tente novamente."); return; }
    }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload re-reads the session
    globalThis.location.assign(`${globalThis.location.origin}${dev || authMode === "google" ? paths.signIn : "/cdn-cgi/access/logout"}`);
  }
  const withEmail = members.filter((m) => m.email && !deactivated.has(m.id));
  return (
    <div className="flex min-h-dvh items-center justify-center bg-page px-5 py-10">
      <div className="w-full max-w-[520px]">
        <div className="flex items-center gap-3">
          <ProductMark />
          <div>
            <p className="text-[15px] font-semibold">Ontology</p>
            <p className="text-[12px] text-muted">Gestão de serviços</p>
          </div>
        </div>
        <div className="mt-6 rounded-2xl border border-line bg-surface p-6">
          {!resolved ? (
            <p className="text-[13px] text-muted">Verificando a sessão…</p>
          ) : syncError && !user ? (
            <>
              <p role="alert" className="text-sm text-rose">{syncError}</p>
              <Button className="mt-5" onClick={() => window.location.reload()}>Tentar novamente</Button>
            </>
          ) : mode !== "remote" ? (
            <>
              <h1 className="text-[18px] font-semibold tracking-tight">Modo local, sem login</h1>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
                Sem banco ligado, o app roda só no navegador e usa o membro escolhido
                em Configurações › Ver como. Para testar login e níveis de acesso,
                rode com <code className="rounded bg-soft px-1">.dev.vars</code> e o D1 local.
              </p>
              <Button className="mt-5" href="/">Abrir o workspace</Button>
            </>
          ) : dev ? (
            <>
              <h1 className="text-[18px] font-semibold tracking-tight">Entrar como</h1>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
                Desenvolvimento local: escolha quem você é para testar cada nível de
                acesso. Publicado, o login é protegido pelo Cloudflare Access ou pela conta Google da empresa.
              </p>
              {user && (
                <p className="mt-3 rounded-lg bg-soft px-3 py-2 text-[12.5px]">
                  Agora: <span className="font-medium">{user.email}</span>
                </p>
              )}
              {withEmail.length > 0 && (
                <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
                  {withEmail.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => enter(m.email!, m.name)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-soft disabled:opacity-50"
                      >
                        <Avatar initials={m.initials} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">{m.name}</span>
                          <span className="block truncate text-[12px] text-muted">
                            {m.email} · {accessLabel[normalizeAccess(m.access)]}
                          </span>
                        </span>
                        <LogIn className="h-3.5 w-3.5 text-muted" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void enter(email, name);
                }}
                className="mt-4 space-y-2"
              >
                <p className="text-[12px] text-muted">
                  Ou entre com outro e-mail (uma pessoa nova cai em &ldquo;aguardando aprovação&rdquo;).
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <TextField
                    label="E-mail"
                    type="email"
                    required
                    value={email}
                    onChange={setEmail}
                    placeholder="pessoa@empresa.com"
                    className="min-w-[200px] flex-1"
                  />
                  <TextField
                    label="Nome"
                    optional
                    value={name}
                    onChange={setName}
                    className="w-[160px]"
                  />
                  <Button type="submit" disabled={busy}>
                    Entrar
                  </Button>
                </div>
                {error && <p className="text-[12.5px] text-rose">{error}</p>}
              </form>
            </>
          ) : (
            <>
              <h1 className="text-[18px] font-semibold tracking-tight">Entrar com a conta da empresa</h1>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
                Use o e-mail autorizado pela sua empresa. Novos acessos precisam da aprovação de um admin da plataforma.
              </p>
              {user ? (
                <p className="mt-3 rounded-lg bg-soft px-3 py-2 text-[12.5px]">
                  Você está como <span className="font-medium">{user.email}</span>.
                </p>
              ) : null}
              <Button className="mt-5" href={user ? paths.home : authMode === "google" ? paths.googleLogin : paths.home}>
                <LogIn className="h-4 w-4" />
                {user ? "Abrir a plataforma" : authMode === "access" ? "Entrar com Cloudflare Access" : "Entrar com Google"}
              </Button>
            </>
          )}
          {error && !dev && <p role="alert" className="mt-3 text-sm text-rose">{error}</p>}
          <Suspense><LoginError /></Suspense>
          {resolved && mode === "remote" && user && (
            <div className="mt-4 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => void leave()}
                className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LoginError() {
  const params = useSearchParams();
  if (params.get("erro") !== "login") return null;
  const messages: Record<string, string> = {
    expirado: "Esta tentativa de login expirou ou já foi usada. Clique em Entrar com Google para iniciar uma nova.",
    cancelado: "O login foi cancelado no Google. Você pode tentar novamente.",
    temporario: "O serviço de login não respondeu como esperado. Tente novamente em alguns instantes.",
    validacao: "Não foi possível validar este login. Inicie uma nova tentativa com sua conta Google da G4.",
  };
  const reason = params.get("motivo") ?? "";
  const message = Object.hasOwn(messages, reason) ? messages[reason] : "Não foi possível concluir o login. Clique em Entrar com Google para tentar novamente.";
  return <p role="alert" className="mt-3 text-sm text-rose">{message}</p>;
}
