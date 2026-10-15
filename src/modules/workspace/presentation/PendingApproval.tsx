"use client";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { usePathname } from "next/navigation";
import { paths } from "@/shared/lib/routes";
import { Button } from "@/shared/ui/primitives";
import { Clock } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Behind the API, a person who signed in but is not on the roster sees only
 * this. An admin approves them in Equipe; until then nothing else loads.
 */
export function ApprovalGate({ children }: { children: ReactNode }) {
  const { mode, resolved, hydrated, user } = useSyncStatus();
  const { members } = useTeam();
  const pathname = usePathname();
  const pending =
    mode === "remote" &&
    resolved &&
    Boolean(user) &&
    (user?.approved === false || (hydrated && user?.approved === undefined && members.some((p) => p.email) &&
    !members.some((p) => p.email?.toLowerCase() === user!.email.toLowerCase())));
  if (pathname === paths.signIn) return <>{children}</>;
  if (!pending) return <>{children}</>;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-page px-5">
      <div className="w-full max-w-[460px] rounded-2xl border border-line bg-surface p-6 text-center">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-soft text-amber">
          <Clock className="h-4 w-4" />
        </span>
        <h1 className="mt-4 text-[18px] font-semibold tracking-tight">Aguardando aprovação</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          Você entrou como <span className="text-ink">{user?.email}</span>. Um
          admin da plataforma precisa aprovar seu acesso e definir seu nível antes
          de você ver os clientes.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>
            Verificar de novo
          </Button>
          <Button size="sm" variant="ghost" href="/entrar">
            Trocar de conta
          </Button>
        </div>
      </div>
    </div>
  );
}
