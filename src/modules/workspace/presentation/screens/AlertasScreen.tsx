"use client";
import { Suspense } from "react";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { AlertList } from "@/modules/workspace/presentation/AlertList";
import { alertReturnPath, paths } from "@/shared/lib/routes";
import { ArrowLeft } from "lucide-react";
import { PageHeading } from "@/shared/ui/PageHeading";
import { Button, Page } from "@/shared/ui/primitives";
import { useSearchParams } from "next/navigation";

function AlertasScreenContent() {
  const search = useSearchParams();
  const client = search.get("cliente") ?? undefined;
  const { clientBySlug } = useClientsState();
  const name = client ? clientBySlug(client)?.name : undefined;
  return (
    <Page>
      <PageHeading
        title={name ? `Alertas · ${name}` : "Alertas"}
        description={
          name
            ? `Pendências de ${name}. Revise e abra o contexto para resolver cada uma.`
            : "Revise o que precisa de atenção e abra o contexto para resolver cada pendência."
        }
        actions={
          name && client ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button href={alertReturnPath(client, search.get("origem"))} variant="ghost" size="sm">
                <ArrowLeft className="h-3.5 w-3.5" />
                Voltar para {name}
              </Button>
              <Button href={paths.alerts()} variant="ghost" size="sm">
                Todos os alertas
              </Button>
            </div>
          ) : undefined
        }
      />
      <div className="mt-6">
        <AlertList company={client} />
      </div>
    </Page>
  );
}

/** Suspense dentro do módulo cliente, não em `page.tsx`: ver `docs/navegacao-e-visualizacoes.md`. */
export default function AlertasScreen() {
  return (
    <Suspense>
      <AlertasScreenContent />
    </Suspense>
  );
}
