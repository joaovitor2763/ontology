"use client";
import { useCatalogOperations, CatalogOperationFeedback } from "../useCatalogOperations";
import { usePlanActivation } from "@/modules/delivery/presentation/usePlanActivation";
import { Combobox } from "@/shared/ui/Combobox";
import { useCatalogState } from "@/modules/catalog/infrastructure/state";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";

import { useLocalStorageState } from "@/shared/infrastructure/useLocalStorageState";
import {
  DensityControl,
  useCollectionDisplay,
} from "@/shared/ui/DisplayControls";
import { PageHeading } from "@/shared/ui/PageHeading";

import { milestoneProgress } from "@/modules/catalog/domain/journey-progress";
import {
  diffJourneys,
  fingerprint,
  hasUnpublishedChanges,
  latestVersion,
  type PublishScope,
} from "@/modules/catalog/domain/publication";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { formatDateTime } from "@/shared/lib/format";
import { useCatalog } from "@/modules/catalog/presentation/catalog";
import { CatalogSwitcher } from "@/modules/catalog/presentation/CatalogSwitcher";
import { JourneyGantt } from "@/modules/catalog/presentation/JourneyGantt";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";
import { NOW, padMilestone } from "@/shared/lib/format";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { paths } from "@/shared/lib/routes";
import { Badge, Button, HealthDot, Page } from "@/shared/ui/primitives";
import { ArrowRight, CalendarDays, List, Network } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, useRef } from "react";
import { usesRemoteOperations } from "@/shared/infrastructure/operations";

import type { JourneyTemplate } from "@/modules/catalog/domain/models";
import { JourneyEditor } from "@/modules/catalog/presentation/JourneyEditor";
import { PublishModal } from "./planos/PublishModal";
import { cn } from "@/shared/lib/cn";
import { Drawer, FieldBlock, fieldClass } from "@/shared/ui/Drawer";

export default function PlanosScreen() {
  const { can } = usePermissions();
  const { activate: activatePlan, validate: validatePlan } = usePlanActivation();
  const [assigning, setAssigning] = useState(false);
  const assigningLock = useRef(false);
  const [assignmentError, setAssignmentError] = useState("");
  const { density, setDensity } = useCollectionDisplay("plans");
  const {
    productPlans,
    statusMap,
    extraTasks,
    taskPatches,
    pinCompanyJourneyVersion,
    companyJourneyVersion,
  } = useDeliveryState();
  const { saveJourney, removeJourney, publishJourney } = useCatalogState();
  const operation=useCatalogOperations();
  const { journeys: allJourneys, journeyOf, milestoneOf, versionsOf, versionOf } =
    useCatalog();
  const privatePlanIds=new Set(Object.values(productPlans).map(plan=>plan.id));
  const journeys=allJourneys.filter(plan=>!privatePlanIds.has(plan.id));
  const { clients, configFor, saveConfig } = useClientsState();
  const { me } = useTeam();
  const [publishing, setPublishing] = useState(false);
  const [scope, setScope] = useState<PublishScope>("novos");
  const [impactConfirmed, setImpactConfirmed] = useState(false);
  const initialPlan = useSearchParams().get("plano");
  const [selected, setSelected] = useState(
    initialPlan && journeys.some((j) => j.id === initialPlan)
      ? initialPlan
      : (journeys[0]?.id ?? ""),
  );
  const journey = journeys.find((j) => j.id === selected) ?? journeys[0];
  const [editor, setEditor] = useState<JourneyTemplate | null | undefined>(
    undefined,
  );
  const [assign, setAssign] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [slug, setSlug] = useState(clients[0]?.slug ?? "");
  const [ms, setMs] = useState(1);
  const [view, setView] = useLocalStorageState<
    "clients" | "timeline" | "milestones"
  >("ontology.plans.view", "clients");

  const heading = (
    <PageHeading
      title="Planos"
      description="Roteiros macro dos contratos. Cada marco pode ser executado por um ou mais ciclos."
      actions={
        <>
          <CatalogSwitcher value="planos" />
          {journey && view !== "timeline" && (
            <DensityControl density={density} onChange={setDensity} />
          )}
          {journey && (
            <>
              <Button variant="ghost" size="sm" onClick={() => { setAssignmentError(""); setAssign(true); }}>
                Vincular cliente
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={operation.busy} onClick={() => setEditor(journey)}
              >
                Editar plano
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if(operation.busy)return;
                  setScope("novos");
                  setImpactConfirmed(false);
                  setPublishing(true);
                }}
              >
                Publicar
              </Button>
            </>
          )}
          {can("catalogo.editar") && (
            <Button disabled={operation.busy} size="sm" onClick={() => setEditor(null)}>
              Novo plano
            </Button>
          )}
        </>
      }
    />
  );

  if (!journey) {
    return (
      <Page>
        {heading}
      {editor===undefined && !publishing && <CatalogOperationFeedback operation={operation} />}
        <div className="mt-8 rounded-xl border border-dashed border-line p-8 text-center">
          <p className="text-[14px] font-medium">Nenhum plano cadastrado</p>
          <p className="mt-2 text-[12px] text-muted">
            Crie o primeiro plano com os marcos do contrato.
          </p>
        </div>
        <JourneyEditor
          operation={operation}
          open={editor !== undefined}
          initial={editor}
          onClose={() => {if(!operation.busy)setEditor(undefined);}}
          onSave={(j) => {
            void operation.run("plans.save",{plan:j},()=>saveJourney(j),()=>{setSelected(j.id);setEditor(undefined);},"Rascunho salvo");
          }}
        />
      </Page>
    );
  }

  const onThis = clients.filter((c) => journeyOf(c).id === journey.id);
  const accounts = onThis.map((company) => {
    const { n, def } = milestoneOf(company);
    const tasks = deliveriesFor(
      company.slug,
      statusMap,
      extraTasks,
      taskPatches,
      journey.id,
    );
    return {
      company,
      n,
      def,
      progress: milestoneProgress(tasks, n, NOW.slice(0, 10)),
    };
  });
  const blockedAccounts = accounts.filter(
    (account) => account.progress.blocked.length > 0,
  ).length;
  const readyAccounts = accounts.filter(
    (account) => account.progress.complete,
  ).length;
  const chosen = clients.find((c) => c.slug === slug);
  const changesPlan = chosen ? journeyOf(chosen).id !== journey.id : false;
  const versions = versionsOf(journey.id);
  const latest = latestVersion(versions);
  const pending = hasUnpublishedChanges(journey, versions);
  const diff = diffJourneys(latest?.snapshot, journey);
  const draftFingerprint = fingerprint(journey);
  function publish() {
    void operation.run("plans.publish",{planId:journey.id,scope,fingerprint:draftFingerprint},()=>{
      const version=publishJourney(journey,me.id),pins:Record<string,number|null>={};
      for(const c of onThis){if(scope==="todos")pins[c.slug]=version;else if(companyJourneyVersion[c.slug]==null&&latest)pins[c.slug]=latest.version;}
      if(Object.keys(pins).length)pinCompanyJourneyVersion(pins);
    },()=>setPublishing(false),"Plano publicado");
  }

  return (
    <Page density={density} className="max-w-none">
      {heading}
      {editor===undefined && !publishing && <CatalogOperationFeedback operation={operation} />}

      <div className="mt-6 flex flex-wrap gap-1.5">
        {journeys.map((j) => (
          <button
            key={j.id}
            onClick={() => {
              setSelected(j.id);
              setMs(1);
              setConfirmDelete(false);
            }}
            className={cn(
              "rounded-full px-3 py-1 text-[13px]",
              j.id === journey.id
                ? "bg-ink text-on-ink"
                : "text-ink-soft hover:bg-soft",
            )}
          >
            {j.name}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-muted">
        <span>
          {journey.description} · {journey.milestones.length} marco
          {journey.milestones.length === 1 ? "" : "s"} · {onThis.length} cliente
          {onThis.length === 1 ? "" : "s"} neste plano.
        </span>
        {latest ? (
          <Badge tone="neutral">
            v{latest.version} · publicada em{" "}
            {formatDateTime(latest.publishedAt)}
          </Badge>
        ) : (
          <Badge tone="neutral">
            Nunca publicado · clientes seguem o rascunho
          </Badge>
        )}
        {pending && latest && (
          <Badge tone="warn">Rascunho com alterações não publicadas</Badge>
        )}
        {journey.id !== "founding-companies" &&
          (confirmDelete ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-rose">Excluir mesmo?</span>
              <button
                type="button"
                disabled={operation.busy}
                className="rounded-md bg-rose px-2 py-0.5 text-[12px] text-on-ink"
                onClick={() => {
                  void operation.run("plans.remove",{planId:journey.id},()=>removeJourney(journey.id),()=>{setConfirmDelete(false);setSelected(journeys.find(j=>j.id!==journey.id)?.id??"");},"Plano removido");
                }}
              >
                Excluir plano
              </button>
              <button
                type="button"
                className="text-[12px] hover:underline"
                disabled={operation.busy} onClick={() => setConfirmDelete(false)}
              >
                Manter
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="text-rose hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
              disabled={onThis.length > 0}
              title={
                onThis.length
                  ? `${onThis.length} cliente${onThis.length === 1 ? " usa" : "s usam"} este plano. Mova-os antes de excluir.`
                  : undefined
              }
              onClick={() => setConfirmDelete(true)}
            >
              Excluir
            </button>
          ))}
      </div>

      <div className="mt-7 grid gap-5 border-y border-line py-5 sm:grid-cols-3">
        {[
          [accounts.length, "Clientes neste plano"],
          [blockedAccounts, "Clientes com bloqueios"],
          [readyAccounts, "Clientes com marco pronto"],
        ].map(([value, label]) => (
          <div key={label} className="flex items-baseline gap-3">
            <span className="text-[24px] font-semibold tabular-nums">
              {value}
            </span>
            <span className="text-[12px] text-muted">{label}</span>
          </div>
        ))}
      </div>
      <div
        className="segmented-control mt-6"
        role="group"
        aria-label="Visualização do plano"
      >
        {(
          [
            ["clients", "Clientes", List],
            ["timeline", "Cronograma", CalendarDays],
            ["milestones", "Marcos", Network],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            aria-pressed={view === value}
            onClick={() => setView(value)}
            className={cn("flex items-center gap-2")}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
      {view === "clients" && (
        <section className="@container mt-6" aria-label="Clientes no plano">
          <div
            className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_100px_minmax(0,1.2fr)_20px] gap-6 border-b border-line px-4 pb-3 text-[11px] text-muted @min-[800px]:grid"
            aria-hidden="true"
          >
            <span>Cliente</span>
            <span>Marco atual</span>
            <span>Progresso</span>
            <span>Próxima ação</span>
            <span />
          </div>
          <ul className="divide-y divide-line">
            {accounts.map(({ company, n, def, progress }) => (
              <li key={company.slug}>
                <Link
                  href={paths.clientPlan(company.slug)}
                  className="grid items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-soft/50 @min-[800px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_100px_minmax(0,1.2fr)_20px]"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <HealthDot flag={company.healthFlag} />
                    <span className="text-[14px] font-medium">
                      {company.name}
                    </span>
                    {versionOf(company) && (
                      <span className="rounded-md bg-soft px-1.5 py-0.5 text-[10px] text-muted">
                        v{versionOf(company)}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[10px] text-muted">
                      {padMilestone(n)} · {def.stage}
                    </span>
                    <span className="mt-1 block text-[12px] leading-5">
                      {def.name}
                    </span>
                  </span>
                  <span>
                    <span className="flex items-baseline justify-between gap-3 text-[12px]">
                      {progress.percent}%
                      <span className="text-[10px] text-muted">
                        {progress.done}/{progress.items.length}
                      </span>
                    </span>
                    <span className="mt-2 block h-1 rounded-full bg-soft">
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${progress.percent}%` }}
                      />
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block text-[10px]",
                        progress.blocked.length ? "text-rose" : "text-blue",
                      )}
                    >
                      {progress.blocked.length
                        ? `${progress.blocked.length} bloqueio${progress.blocked.length === 1 ? "" : "s"}`
                        : progress.complete
                          ? "Pronto para revisão"
                          : "Próxima tarefa"}
                    </span>
                    <span className="mt-1 block text-[12px] leading-5">
                      {progress.nextTask?.title ??
                        (progress.complete
                          ? "Revisar conclusão do marco"
                          : "Planejar as primeiras tarefas")}
                    </span>
                  </span>
                  <ArrowRight className="hidden h-4 w-4 text-muted @min-[800px]:block" />
                </Link>
              </li>
            ))}
          </ul>
          {!accounts.length && (
            <div className="rounded-xl border border-dashed border-line p-8 text-center">
              <p className="text-[14px] font-medium">
                Este plano está pronto para receber clientes
              </p>
              <p className="mt-2 text-[12px] text-muted">
                Vincule um cliente e defina o marco de entrada.
              </p>
              <Button
                className="mt-5"
                size="sm"
                onClick={() => { setAssignmentError(""); setAssign(true); }}
              >
                Vincular cliente
              </Button>
            </div>
          )}
        </section>
      )}
      {view === "timeline" && <JourneyGantt journeyId={journey.id} />}

      {view === "milestones" && (
        <>
          <h2 className="mt-8 text-[15px] font-medium">Marcos do plano</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {journey.milestones.map((m) => {
              const here = accounts.filter((a) => a.n === m.n);
              return (
                <div
                  key={m.n}
                  data-collection-card=""
                  className="rounded-xl p-4 ring-1 ring-line"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] tabular-nums text-muted">
                      {padMilestone(m.n)}
                    </span>
                    <span className="text-[12px] text-muted">{m.stage}</span>
                  </div>
                  <div className="mt-1 text-[16px] font-medium tracking-tight">
                    {m.name}
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {m.owner}
                    {m.durationWeeks
                      ? ` · ${m.durationWeeks} semana${m.durationWeeks === 1 ? "" : "s"}`
                      : ""}
                    {m.tasks?.length
                      ? ` · ${m.tasks.length} tarefa${m.tasks.length === 1 ? "" : "s"} de referência`
                      : ""}
                  </div>
                  {m.goal && (
                    <p className="mt-2 text-[12.5px] leading-5 text-ink-soft">
                      {m.goal}
                    </p>
                  )}
                  {m.exitCriteria?.length ? (
                    <ul className="mt-2 space-y-1 text-[12px] text-muted">
                      {m.exitCriteria.map((c) => (
                        <li key={c} className="flex gap-1.5">
                          <span aria-hidden>✓</span>
                          {c}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-3 space-y-1 border-t border-line pt-3">
                    {here.length === 0 && (
                      <p className="text-[13px] text-muted">
                        Nenhum cliente neste marco.
                      </p>
                    )}
                    {here.map(({ company: c, progress }) => (
                      <Link
                        key={c.slug}
                        href={paths.clientPlan(c.slug)}
                        className="flex items-center justify-between gap-3 rounded-lg px-1 py-2 hover:bg-soft"
                      >
                        <span className="inline-flex items-center gap-2 text-[13.5px]">
                          <HealthDot flag={c.healthFlag} />
                          {c.name}
                        </span>
                        <span className="text-[12px] text-muted">
                          {progress.done}/{progress.items.length}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <JourneyEditor
        operation={operation}
        open={editor !== undefined}
        initial={editor}
        onClose={() => {if(!operation.busy)setEditor(undefined);}}
        onSave={(j) => {
          void operation.run("plans.save",{plan:j},()=>saveJourney(j),()=>{setSelected(j.id);setEditor(undefined);},"Rascunho salvo");
        }}
      />

      <PublishModal
        open={publishing}
        onClose={() => {
          if (!operation.busy) setPublishing(false);
        }}
        journey={journey}
        latest={latest}
        diff={diff}
        draftFingerprint={draftFingerprint}
        onThis={onThis}
        scope={scope}
        setScope={setScope}
        impactConfirmed={impactConfirmed}
        setImpactConfirmed={setImpactConfirmed}
        operation={operation}
        publish={publish}
      />

      <Drawer
        open={assign}
        onClose={() => { if(!assigningLock.current) setAssign(false); }}
        title="Vincular cliente ao plano"
        kicker={journey.name}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            {assignmentError && (
              <p role="alert" className="w-full text-sm text-rose">
                {assignmentError}
              </p>
            )}
            <Button variant="ghost" disabled={assigning} onClick={() => setAssign(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!slug || assigning}
              onClick={async () => {
                if (assigningLock.current) return;
                assigningLock.current = true; setAssigning(true); setAssignmentError("");
                try {
                const client = clients.find((c) => c.slug === slug);
                if (client) {
                  const problem = validatePlan(client, journey.id);
                  if (problem) {
                    setAssignmentError(problem);
                    return;
                  }
                  const config = configFor(client.slug);
                  if (journey.productId && !(await usesRemoteOperations()))
                    saveConfig(client.slug, {
                      ...config,
                      productIds: [
                        ...new Set([
                          ...(config.productIds ?? []),
                          journey.productId,
                        ]),
                      ],
                    });
                  await activatePlan(client, journey.id, ms);
                }
                setAssign(false);
                } catch(error) { setAssignmentError(error instanceof Error ? error.message : "Não foi possível salvar."); }
                finally { assigningLock.current = false; setAssigning(false); }
              }}
            >
              Salvar
            </Button>
          </div>
        }
      >
        <FieldBlock label="Cliente">
          <Combobox
            label="Cliente"
            disabled={assigning}
            className={fieldClass}
            value={slug}
            onValueChange={(value) => setSlug(value)}
            options={clients.map((c) => ({
              value: c.slug,
              label: [
                c.name,
                journeyOf(c).id === journey.id
                  ? ""
                  : ` · hoje em ${journeyOf(c).name}`,
              ].join(""),
            }))}
          />
        </FieldBlock>
        <FieldBlock label="Marco de entrada">
          <Combobox
            label="Marco de entrada"
            disabled={assigning}
            className={fieldClass}
            value={String(ms)}
            onValueChange={(value) => setMs(Number(value))}
            options={journey.milestones.map((m) => ({
              value: String(m.n),
              label: [padMilestone(m.n), " · ", m.name].join(""),
            }))}
          />
        </FieldBlock>
        {changesPlan && (
          <p
            role="alert"
            className="rounded-lg border border-amber/30 bg-amber-soft/40 px-3 py-2 text-[12.5px] leading-5 text-amber"
          >
            Trocar o plano reposiciona o cliente no marco escolhido. As tarefas
            já registradas continuam disponíveis, mas o histórico de marcos do
            plano anterior deixa de contar.
          </p>
        )}
      </Drawer>
    </Page>
  );
}
