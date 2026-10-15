"use client";
import { Kanban } from "@/modules/delivery/presentation/Kanban";
import { paths } from "@/shared/lib/routes";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function ClientEntregasScreenContent() {
  const { slug } = useParams<{ slug: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const legacyRequests = params.get("tipo") === "solicitacoes";
  const marco = params.get("marco");
  useEffect(() => {
    if (legacyRequests) router.replace(paths.clientRequests(slug));
  }, [legacyRequests, router, slug]);
  if (legacyRequests) return null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="mb-4 shrink-0 text-input text-muted">
        Acompanhe as tarefas do projeto. Use o filtro para incluir tickets e solicitações.
      </p>
      <Kanban key={marco ?? "all"} company={slug} initialMilestones={marco ? [marco] : undefined} />
    </div>
  );
}

/** Suspense dentro do módulo cliente, não em `page.tsx`: ver `docs/navegacao-e-visualizacoes.md`. */
export default function ClientEntregasScreen() {
  return (
    <Suspense>
      <ClientEntregasScreenContent />
    </Suspense>
  );
}
