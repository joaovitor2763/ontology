"use client";
import { Suspense } from "react";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { FilesPanel } from "@/modules/documents/presentation/FilesPanel";
import { ClientExecutionProvider } from "@/modules/delivery/infrastructure/ClientExecutionProvider";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { paths } from "@/shared/lib/routes";
import { Combobox } from "@/shared/ui/Combobox";
import { PageHeading } from "@/shared/ui/PageHeading";
import { Page } from "@/shared/ui/primitives";
import { useRouter, useSearchParams } from "next/navigation";
function DocumentosScreenContent() {
  const router = useRouter();
  const company = useSearchParams().get("cliente") ?? "";
  const { clients } = useClientsState();
  const { mode } = useSyncStatus();
  return (
    <Page>
      <PageHeading
        title="Documentos"
        description="Contratos, planos, atas e evidências das tarefas, reunidos por cliente."
      />
      <div className="my-6 flex items-center gap-3">
        <label htmlFor="document-company" className="text-[13px] text-muted">
          Cliente
        </label>
        <Combobox
          label="Filtrar cliente"
          id="document-company"
          value={company}
          onValueChange={(value) =>
            router.replace(paths.documents(value || undefined))
          }
          className="h-10 min-w-0 rounded-lg border border-line bg-surface px-3 text-[13px]"
          options={[
            { value: "", label: "Todos os clientes" },
            ...clients.map((c) => ({ value: c.slug, label: c.name })),
          ]}
        />
      </div>
      {mode === "remote" && company ? (
        <ClientExecutionProvider key={company} company={company}>
          <FilesPanel company={company} />
        </ClientExecutionProvider>
      ) : <FilesPanel key={company} company={company || undefined} />}
    </Page>
  );
}

/** Suspense dentro do módulo cliente, não em `page.tsx`: ver `docs/navegacao-e-visualizacoes.md`. */
export default function DocumentosScreen() {
  return (
    <Suspense>
      <DocumentosScreenContent />
    </Suspense>
  );
}
