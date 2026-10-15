"use client";
import { disconnectGoogle, useGoogleStatus } from "@/shared/infrastructure/google";
import { Button } from "@/shared/ui/primitives";
import { CalendarDays } from "lucide-react";
import { useState } from "react";

/** The member's own Google connection: meetings go to their calendar with Meet links and invitations. */
export function GoogleAccountCard() {
  const google = useGoogleStatus();
  const [busy, setBusy] = useState(false);
  if (!google.enabled) return null;
  const state = google.connected
    ? `Conectada · ${google.accountEmail}`
    : google.status === "expired"
      ? "A conexão expirou · conecte de novo"
      : "Não conectada";
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-soft text-ink">
        <CalendarDays className="h-3.5 w-3.5" />
      </span>
      <h2 className="mt-3 text-[15px] font-medium">Minha conta Google</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Com a conta conectada, as reuniões que você agenda aqui nascem na sua
        agenda do Google com link do Meet e convites, e a gravação e a
        transcrição das suas reuniões são anexadas à ficha depois.
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
        <dt className="text-muted">Estado</dt>
        <dd>{state}</dd>
      </dl>
      {google.connected && !google.canConfigureMeet && (
        <p className="mt-3 text-[13px] text-muted">Falta autorizar a configuração de gravação automática das novas reuniões.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {google.connected && !google.canConfigureMeet && (
          <Button size="sm" href="/api/google/auth">Autorizar gravação automática</Button>
        )}
        {google.connected ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await disconnectGoogle();
              } finally {
                setBusy(false);
                google.refresh();
              }
            }}
          >
            Desconectar
          </Button>
        ) : (
          <Button size="sm" href="/api/google/auth">
            Conectar minha conta Google
          </Button>
        )}
      </div>
    </section>
  );
}
