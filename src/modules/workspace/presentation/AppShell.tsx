"use client";

import { DeliveryCompletionHost } from "@/modules/delivery/presentation/DeliveryCompletionModal";
import { ClientExecutionProvider } from '@/modules/delivery/infrastructure/ClientExecutionProvider';
import { paths } from "@/shared/lib/routes";
import { EntrarScreen } from "./screens/EntrarScreen";
import { resolvePersistenceMode } from "@/shared/infrastructure/persistence";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { useNavigationWarmup } from "@/shared/infrastructure/useNavigationWarmup";
import { ApprovalGate } from "@/modules/workspace/presentation/PendingApproval";
import { MeetSync } from "@/modules/engagement/presentation/MeetSync";
import { SessionBoot } from "@/modules/workspace/presentation/SessionBoot";
import { Sidebar } from "@/modules/workspace/presentation/Sidebar";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { useStorageHealth } from "@/shared/infrastructure/useLocalStorageState";
import { refreshNow } from "@/shared/lib/format";
import { AppShell as DsAppShell, ShellBanner } from "@g4ai/ds";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

function ShellInner({ children, scopedCompany }: { children: ReactNode; scopedCompany?: string }) {
  const { user } = useSyncStatus();
  useEffect(() => {
    if (user?.authMode !== "google") return;
    let lastAttempt = 0;
    let pending = false;
    const renew = async () => {
      if (document.visibilityState !== "visible" || pending || Date.now() - lastAttempt < 60 * 60 * 1000) return;
      lastAttempt = Date.now();
      pending = true;
      try {
        const response = await fetch("/api/me", { method: "POST", cache: "no-store" });
        if (!response.ok) lastAttempt = Date.now() - 55 * 60 * 1000;
      } catch {
        lastAttempt = Date.now() - 55 * 60 * 1000;
      } finally { pending = false; }
    };
    void renew();
    window.addEventListener("focus", renew);
    window.addEventListener("pointerdown", renew);
    window.addEventListener("keydown", renew);
    document.addEventListener("visibilitychange", renew);
    return () => {
      window.removeEventListener("focus", renew);
      window.removeEventListener("pointerdown", renew);
      window.removeEventListener("keydown", renew);
      document.removeEventListener("visibilitychange", renew);
    };
  }, [user?.authMode]);
  // Gesto de ir a outra tela já busca os dados dela, junto com a troca de rota.
  useNavigationWarmup();
  const storageError = useStorageHealth();
  const { workspaceName } = useWorkspaceState();
  const pathname = usePathname();
  useEffect(() => {
    refreshNow();
  }, [pathname]);
  useEffect(() => {
    const onFocus = () => refreshNow();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  const content = (
    <>
      {children}
      <DeliveryCompletionHost />
    </>
  );
  return (
    <DsAppShell
      product="Ontology"
      workspace={workspaceName}
      currentPath={pathname}
      banner={storageError ? <ShellBanner>{storageError}</ShellBanner> : undefined}
      sidebar={({ mobileOpen, close }) => (
        <Sidebar mobileOpen={mobileOpen} onNavigate={close} />
      )}
    >
      {scopedCompany ? (
        <ClientExecutionProvider key={scopedCompany} company={scopedCompany}>
          {content}
        </ClientExecutionProvider>
      ) : (
        content
      )}
      <SessionBoot />
      <MeetSync />
    </DsAppShell>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  // The client-component bundle is a separate module instance from the server
  // layout's, so its clock must be re-read on every server render too;
  // otherwise SSR uses the time the process started and hydration mismatches.
  if (typeof window === "undefined") refreshNow();
  return <SessionGate>{children}</SessionGate>;
}

/** `/entrar` is the door: no sidebar, no session boot. */
function ShellOrPlain({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { mode } = useSyncStatus();
  if (pathname === paths.signIn) return <>{children}</>;
  const clientRoute = /^\/clientes\/([^/]+)(?:\/|$)/.exec(pathname);
  return <ShellInner scopedCompany={mode === 'remote' && clientRoute
    ? decodeURIComponent(clientRoute[1]) : undefined}>{children}</ShellInner>;
}

/** Never mount workspace screens against an anonymous remote session. */
function SessionGate({ children }: { children: ReactNode }) {
  const { mode, resolved, user } = useSyncStatus();
  useEffect(() => {
    void resolvePersistenceMode();
  }, []);
  if (!resolved)
    return (
      <div className="flex min-h-dvh items-center justify-center bg-page text-sm text-muted">
        Verificando a sessão…
      </div>
    );
  if (mode === "remote" && !user) return <EntrarScreen />;
  return (
    <ApprovalGate>
      <ShellOrPlain>{children}</ShellOrPlain>
    </ApprovalGate>
  );
}
