"use client";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useDocumentsState } from "@/modules/documents/infrastructure/state";

import {
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  CheckCheck,
  ClipboardList,
  FileText,
  Repeat2,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  cycleProgress,
  cycleStatusLabel,
} from "@/modules/delivery/domain/services";
import { ServiceSettings } from "@/modules/delivery/presentation/ServiceSettings";
import { useServices } from "@/modules/delivery/presentation/state";
import { useClientProgress } from "@/modules/delivery/presentation/useClientProgress";
import { documentsFor } from "@/modules/documents/infrastructure/queries";
import { formatDate, padMilestone } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { Meter } from "@/shared/ui/primitives";
import { enrollmentIsCurrent } from "@/modules/clients/domain/product-enrollments";
export function ServiceSummary({ company }: { company: string }) {
  const { configFor, products } = useServices();
  const progress = useClientProgress(company);
  const {enrollments}=useClientsState();
  const allPurchases=enrollments.filter(e=>e.company===company);
  const purchases=allPurchases.filter(enrollmentIsCurrent);
  const productLinks=products.flatMap(product=>{
    const contracts=purchases.filter(e=>e.productId===product.id);
    if(contracts.length)return contracts.map(e=>({id:e.id,name:product.name+(contracts.length>1?` · ${e.startsAt??"Sem data de início"}`:""),href:paths.clientPlan(company)+"?"+new URLSearchParams({contratacao:e.id})}));
    if(allPurchases.some(e=>e.productId===product.id))return [];
    return configFor(company).productIds?.includes(product.id)?[{id:product.id,name:product.name,href:paths.clientPlan(company)+"?"+new URLSearchParams({contratacao:"__legacy__",produto:product.id})}]:[];
  });
  const { extraDocs, removedDocs } = useDocumentsState();
  const [settings, setSettings] = useState(false);
  const config = configFor(company);
  const cycle = progress.currentCycle;
  const cycleState = cycle ? cycleProgress(cycle, progress.all) : null;
  const docs = documentsFor(company, extraDocs, removedDocs);
  return (
    <>
      <section className="rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 text-[12px]">
          <span className="text-muted">Produtos</span>
          {productLinks.map(product=><Link key={product.id} href={product.href} className="inline-flex items-center gap-1 rounded-md bg-soft px-2 py-1 hover:text-blue" title={`Ver plano e ciclos de ${product.name}`}>{product.name}<ArrowUpRight className="h-3 w-3"/></Link>)}
          {!config.productIds?.length && (
            <button onClick={() => setSettings(true)} className="text-blue">
              Vincular produto
            </button>
          )}
          <button
            title="Configurar cliente"
            aria-label="Configurar cliente"
            onClick={() => setSettings(true)}
            className="ml-auto rounded-lg p-1.5 text-muted hover:bg-soft"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 border-b border-line p-4 sm:p-5 xl:grid-cols-4">
          {[
            {
              label: "Tarefas do serviço",
              value: progress.planned.length,
              hint: "Plano e ciclos deste cliente",
              icon: ClipboardList,
            },
            {
              label: "Tarefas concluídas",
              value: progress.done.length,
              hint: `${progress.open.length} ainda em acompanhamento`,
              icon: CheckCheck,
            },
            {
              label: "Progresso das tarefas",
              value: `${progress.percent}%`,
              hint: "Calculado pelas tarefas concluídas",
              icon: ChartNoAxesColumnIncreasing,
            },
            {
              label: "Ciclos abertos",
              value: progress.openCycles.length,
              hint: "Planejamento, execução e aceite",
              icon: Repeat2,
            },
          ].map(({ label, value, hint, icon: Icon }) => (
            <div key={label} className="service-metric">
              <div className="px-3.5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted">{label}</span>
                  <span className="hidden rounded-md p-1.5 text-muted sm:block">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                </div>
                <p className="mt-1 text-[25px] font-semibold tracking-tight tabular-nums">
                  {value}
                </p>
              </div>
              <p className="service-metric-footer hidden sm:block">{hint}</p>
            </div>
          ))}
        </div>
        <div className="grid divide-y divide-line lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
          <div className="p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
                Ciclo em destaque
              </span>
              <Link
                href={paths.clientPlan(company, "ciclos")}
                className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink"
              >
                Ver ciclos
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {cycle && cycleState ? (
              <>
                <h3 className="mt-3 text-[16px] font-medium">
                  <Link
                    href={paths.clientCycle(company, cycle.id)}
                    className="hover:text-blue"
                  >
                    {cycle.name}
                  </Link>
                </h3>
                <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted">
                  {cycle.goal}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px]">
                  <span className="rounded-md bg-soft px-2 py-1">
                    {cycleStatusLabel[cycle.status]}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-muted">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {formatDate(cycle.startsAt)} — {formatDate(cycle.endsAt)}
                  </span>
                  {cycle.milestone ? (
                    <Link
                      href={paths.clientPlan(company)}
                      className="text-muted hover:text-ink"
                    >
                      Marco {padMilestone(cycle.milestone)}
                    </Link>
                  ) : null}
                </div>
                <div className="mt-5 flex justify-between text-[12px]">
                  <span>
                    {cycleState.done}/{cycleState.total} tarefas concluídas
                  </span>
                  <span className="text-muted">
                    {cycle.acceptance.filter((a) => a.done).length}/
                    {cycle.acceptance.length} aceites
                  </span>
                </div>
                <div className="mt-2">
                  <Meter value={cycleState.percent} thick tone="accent" label="Progresso do ciclo" />
                </div>
              </>
            ) : (
              <p className="mt-4 text-[13px] text-muted">
                Defina o próximo ciclo para organizar o objetivo, as tarefas e
                o aceite.
              </p>
            )}
          </div>
          <div className="p-5">
            <div className="flex justify-between gap-3">
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted">
                Documentos · {docs.length}
              </h3>
              <Link
                href={paths.clientDocuments(company)}
                className="text-[12px] text-muted hover:text-ink"
              >
                Ver todos →
              </Link>
            </div>
            <div className="mt-3 divide-y divide-line">
              {docs.slice(0, 3).map((doc) => (
                <Link
                  key={doc.id}
                  href={paths.clientDocuments(company)}
                  className="flex items-center gap-3 py-3 text-[13px] hover:text-blue"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted" />
                  <span className="line-clamp-2">{doc.name}</span>
                </Link>
              ))}
              {!docs.length && (
                <p className="py-3 text-[13px] text-muted">
                  Reúna o contrato, as atas e as evidências do serviço.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
      {settings && (
        <ServiceSettings company={company} onClose={() => setSettings(false)} />
      )}
    </>
  );
}
