"use client";
import { Suspense } from "react";
import { CyclesWorkspace } from "@/modules/delivery/presentation/CyclesWorkspace";
import { Kanban } from "@/modules/delivery/presentation/Kanban";
import { RemoteKanban } from "@/modules/delivery/presentation/RemoteKanban";
import { RemoteCyclesWorkspace } from "@/modules/delivery/presentation/RemoteCyclesWorkspace";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import {
  executionViewLabel,
  paths,
  type ExecutionView,
} from "@/shared/lib/routes";
import { PageHeading } from "@/shared/ui/PageHeading";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { CalendarDays, ClipboardList, Repeat2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

const views: ExecutionView[] = ["entregas", "ciclos", "cronograma"];
const icons = {
  entregas: <ClipboardList className="h-3.5 w-3.5" />,
  ciclos: <Repeat2 className="h-3.5 w-3.5" />,
  cronograma: <CalendarDays className="h-3.5 w-3.5" />,
};
const descriptions: Record<ExecutionView, string> = {
  entregas:
    "Todo o trabalho em andamento nos clientes. Abra uma tarefa para ajustar status, prazo e responsável.",
  ciclos:
    "Resultados contratados por período, com tarefas vinculadas e aceite do cliente.",
  cronograma:
    "Ciclos no tempo, com prazos e encontros para coordenar o trabalho de cada cliente.",
};

/** Entregas, ciclos e cronograma são visões do mesmo trabalho; o filtro de cliente acompanha a troca. */
function ExecucaoScreenContent() {
  const { mode, resolved } = useSyncStatus();
  const params = useSearchParams();
  const router = useRouter();
  const requested = params.get("visao") as ExecutionView | null;
  const view = requested && views.includes(requested) ? requested : "entregas";
  const client = params.get("cliente") ?? undefined;
  const switcher = (
    <SegmentedControl
      label="Visão da execução"
      value={view}
      onChange={(next) => router.replace(paths.execution(next, client))}
      options={views.map((v) => ({
        value: v,
        label: executionViewLabel[v],
        icon: icons[v],
      }))}
    />
  );
  return (
    <div className="page-inset flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mb-6 shrink-0">
        <PageHeading
          sticky={false}
          breadcrumb={false}
          title="Execução"
          description={descriptions[view]}
          actions={switcher}
        />
      </div>
      {view === "entregas" ? (
        !resolved ? <p className="text-sm text-muted">Carregando tarefas…</p> :
          mode === 'remote'
            ? <RemoteKanban initialClients={client ? [client] : undefined} />
            : <Kanban initialClients={client ? [client] : undefined} />
      ) : !resolved ? <p className="text-sm text-muted">Carregando ciclos…</p> :
        mode === 'remote'
          ? <RemoteCyclesWorkspace schedule={view === "cronograma"}
              initialClients={client ? [client] : undefined} />
          : <CyclesWorkspace embedded schedule={view === "cronograma"}
              initialClients={client ? [client] : undefined} />}
    </div>
  );
}

/** Suspense dentro do módulo cliente, não em `page.tsx`: ver `docs/navegacao-e-visualizacoes.md`. */
export default function ExecucaoScreen() {
  return (
    <Suspense>
      <ExecucaoScreenContent />
    </Suspense>
  );
}
