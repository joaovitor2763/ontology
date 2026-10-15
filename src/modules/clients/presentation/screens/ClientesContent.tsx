"use client";
import { clientEntry } from "@/shared/infrastructure/client-entry";
import { useClientLifecycle, ClientLifecycleFeedback } from "../useClientLifecycle";
import { ClientMark } from "../ClientMark";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useCatalogState } from "@/modules/catalog/infrastructure/state";
import type { PortfolioSummary } from "../../domain/portfolio-summary";

import { useStakeholders } from "@/modules/clients/infrastructure/stakeholders-state";
import {
  DisplayControls,
  useCollectionDisplay,
} from "@/shared/ui/DisplayControls";
import { PageHeading } from "@/shared/ui/PageHeading";

import { responsibilityIndex, matchesResponsible, NO_RESPONSIBLE } from "../../domain/responsibility-filters";
import { enrollmentIsCurrent } from "../../domain/product-enrollments";
import { ResponsibleMembers } from "../ResponsibleMembers";
import { formatDate, workspaceDate } from "@/shared/lib/format";
import { Modal } from "@/shared/ui/Dialog";
import { ActionMenu } from "@/shared/ui/Menu";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { Archive, ArrowUpRight, Building2, Plus, RotateCcw, Settings2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { clientStatusLabel } from "@/modules/clients/domain/models";
import { serviceModelLabel } from "@/modules/clients/domain/service-config";
import { ClientForm } from "@/modules/clients/presentation/ClientForm";

import { cn } from "@/shared/lib/cn";
import { relativeFrom } from "@/shared/lib/format";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { paths } from "@/shared/lib/routes";
import {
  Avatar,
  Badge,
  Button,
  Empty,
  HealthBadge,
  HealthDot,
  Meter,
  Page,
} from "@/shared/ui/primitives";
import { ClientSortHead, type ClientSort } from "@/modules/clients/presentation/ClientSortHead";
import { SavedViews } from "@/shared/ui/SavedViews";
import { ALL, ClientesFilters, NONE } from "./ClientesFilters";


export function ClientesContent({ summary, summaryError, summaryLoading, retrySummary }: {
  summary: PortfolioSummary | null;
  summaryError: string | null;
  summaryLoading: boolean;
  retrySummary: () => void;
}) {
  const { can } = usePermissions();
  const lifecycle = useClientLifecycle();
  const { view, setView, density, setDensity } =
    useCollectionDisplay("clients");
  const { contacts } = useStakeholders();
  const [productId, setProductId] = useState(ALL);
  const [cycleName, setCycleName] = useState(ALL);
  const [entryFrom, setEntryFrom] = useState("");
  const [entryTo, setEntryTo] = useState("");
  const [sort, setSort] = useState<ClientSort | null>("name-asc");
  const [q, setQ] = useState("");
  const [health, setHealth] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [productLeads, setProductLeads] = useState<string[]>([]);
  const [leads, setLeads] = useState<string[]>([]);
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const { clients, allClients, allocations, enrollments } =
    useClientsState();
  const healthOf = useMemo(() => Object.fromEntries(Object.entries(summary ?? {})
    .filter(([, row]) => row.health).map(([slug, row]) => [slug, row.health!])), [summary]);
  const [archiving, setArchiving] = useState<string | null>(null);
  const { members, active, resolve, me } = useTeam();

  const { configFor } = useClientsState();
  const { products } = useCatalogState();
  const source = useMemo(
    () =>
      archived
        ? allClients.filter((c) => !clients.some((x) => x.slug === c.slug))
        : clients,
    [allClients, archived, clients],
  );
  const today = workspaceDate();
  const { client: responsibleByClient, product: productResponsibleByClient } = useMemo(() => responsibilityIndex(
    { clients: source, allocations, enrollments }, today,
    productId === ALL || productId === NONE ? undefined : productId,
  ), [source, allocations, enrollments, today, productId]);
  const currentCycleByClient = useMemo(() => {
    const result = new Map<string, NonNullable<PortfolioSummary[string]["cycle"]>>();
    for (const client of source) {
      const current = summary?.[client.slug]?.cycle;
      if (current) result.set(client.slug, current);
    }
    return result;
  }, [summary, source]);
  const cycleOptions = useMemo(
    () => [
      { value: ALL, label: "Todos os ciclos" },
      { value: NONE, label: "Sem ciclo atual" },
      ...Array.from(
        new Set(
          Array.from(currentCycleByClient.values()).map((cycle) => cycle.name),
        ),
      )
        .sort((a, b) => a.localeCompare(b, "pt-BR"))
        .map((name) => ({ value: name, label: name })),
    ],
    [currentCycleByClient],
  );
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const result = source.filter((c) => {
      const productIds = enrollments.filter(row => row.company === c.slug && enrollmentIsCurrent(row)).map(row => row.productId);
      const currentCycle = currentCycleByClient.get(c.slug);
      if (productId === NONE && productIds.length) return false;
      if (
        productId !== ALL &&
        productId !== NONE &&
        !productIds.includes(productId)
      )
        return false;
      if (cycleName === NONE && currentCycle) return false;
      if (
        cycleName !== ALL &&
        cycleName !== NONE &&
        currentCycle?.name !== cycleName
      )
        return false;
      const startedAt = c.startedAt.slice(0, 10);
      if (entryFrom && startedAt < entryFrom) return false;
      if (entryTo && startedAt > entryTo) return false;
      if (health.length && !health.includes(healthOf[c.slug]?.flag ?? "green"))
        return false;
      if (models.length && !models.includes(configFor(c.slug).model))
        return false;
      if (!matchesResponsible(responsibleByClient.get(c.slug) ?? [], leads)) return false;
      if (productLeads.length && (!productResponsibleByClient.has(c.slug) || !matchesResponsible(productResponsibleByClient.get(c.slug)!, productLeads))) return false;
      if (!query) return true;
      const responsible = [...(responsibleByClient.get(c.slug) ?? []), ...(productResponsibleByClient.get(c.slug) ?? []).filter(id => id !== NO_RESPONSIBLE)].map(resolve);
      const sponsor = contacts.find(
        (s) => s.company === c.slug && s.active && s.primary,
      ) ?? { name: "Não definido", initials: "—" };
      return `${c.name} ${c.sector} ${c.city} ${responsible.map(person => person.name).join(" ")} ${sponsor.name}`
        .toLowerCase()
        .includes(query);
    });
    if (!sort) return result;
    return result.sort((a, b) => {
      const fallback = a.name.localeCompare(b.name, "pt-BR");
      if (sort === "name-asc") return fallback;
      if (sort === "name-desc") return -fallback;
      if (sort === "entry-desc")
        return b.startedAt.localeCompare(a.startedAt) || fallback;
      if (sort === "entry-asc")
        return a.startedAt.localeCompare(b.startedAt) || fallback;
      const aCycle = currentCycleByClient.get(a.slug)?.name;
      const bCycle = currentCycleByClient.get(b.slug)?.name;
      if (!aCycle && !bCycle) return fallback;
      if (!aCycle) return 1;
      if (!bCycle) return -1;
      const direction = sort === "cycle-desc" ? -1 : 1;
      return direction * aCycle.localeCompare(bCycle, "pt-BR") || fallback;
    });
  }, [
    source,
    productId,
    cycleName,
    entryFrom,
    entryTo,
    sort,
    q,
    health,
    models,
    leads, productLeads, productResponsibleByClient, enrollments,
    responsibleByClient,
    resolve,
    configFor,
    contacts,
    healthOf,
    currentCycleByClient,
  ]);

  const currentView = { q, productId, cycleName, entryFrom, entryTo, sort, health, models, leads, productLeads, archived, view, density };
  const applyView = (saved: typeof currentView) => {
    setQ(typeof saved.q === "string" ? saved.q : "");
    setProductId(typeof saved.productId === "string" ? saved.productId : ALL);
    setCycleName(typeof saved.cycleName === "string" ? saved.cycleName : ALL);
    setEntryFrom(typeof saved.entryFrom === "string" ? saved.entryFrom : "");
    setEntryTo(typeof saved.entryTo === "string" ? saved.entryTo : "");
    setSort(["name-asc", "name-desc", "entry-desc", "entry-asc", "cycle-desc", "cycle-asc"].includes(saved.sort ?? "") ? saved.sort : "name-asc");
    setHealth(Array.isArray(saved.health) ? saved.health : []);
    setModels(Array.isArray(saved.models) ? saved.models : []);
    setProductLeads(saved.productId && saved.productId !== ALL && saved.productId !== NONE && Array.isArray(saved.productLeads) ? saved.productLeads : []);
    setLeads(Array.isArray(saved.leads) ? saved.leads : []);
    setArchived(saved.archived === true);
    setView(saved.view === "cards" ? "cards" : "list");
    setDensity(saved.density === "compact" ? "compact" : "comfortable");
  };

  if (!summary) return (
    <Page>
      <PageHeading title="Clientes" description="Acompanhe os clientes por produto, ciclo e responsáveis." />
      <div className="mt-6 rounded-2xl border border-line p-5 text-sm text-muted">
        <p>{summaryError ?? (summaryLoading ? "Carregando carteira…" : "A carteira não está disponível.")}</p>
        {summaryError && <Button className="mt-3" variant="ghost" onClick={retrySummary}>Tentar novamente</Button>}
      </div>
    </Page>
  );

  return (
    <Page density={density}>
      <PageHeading
        actions={
          <>
            <DisplayControls
              view={view}
              onView={setView}
              density={density}
              onDensity={setDensity}
            />
            {can("clientes.criar") && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                Novo cliente
              </Button>
            )}
          </>
        }
        title="Clientes"
        description="Acompanhe os clientes por produto, ciclo e responsáveis."
      />

      {summaryError && <div role="alert" className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-soft p-3 text-sm">
        <span>{summaryError} Os dados abaixo podem estar desatualizados.</span>
        <Button size="sm" variant="ghost" onClick={retrySummary}>Tentar novamente</Button>
      </div>}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <SavedViews scope="clients" localOwner={me.id} current={currentView} onApply={applyView} />
        <span className="text-xs text-muted">Salvo neste navegador</span>
      </div>
      <ClientesFilters
        className="mt-3"
        filters={{ q, setQ, productId, setProductId, cycleName, setCycleName, entryFrom, setEntryFrom, entryTo, setEntryTo,
          health, setHealth, models, setModels, leads, setLeads, productLeads, setProductLeads, archived, setArchived }}
        products={products}
        cycleOptions={cycleOptions}
        members={members}
        active={active}
        shown={filtered.length}
        total={source.length}
        onClear={() => {
          setQ("");
          setHealth([]);
          setModels([]);
          setLeads([]); setProductLeads([]);
          setProductId(ALL);
          setCycleName(ALL);
          setEntryFrom("");
          setEntryTo("");
          setArchived(false);
        }}
      />

      {view === "cards" ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.length === 0 && (
            <div className="sm:col-span-2 xl:col-span-3">
              <Empty
                title={archived ? "Nenhum cliente arquivado" : "Nenhum cliente encontrado"}
                hint="Tente outro nome, ajuste os filtros ou cadastre um novo cliente."
                action={
                  archived ? undefined : (
                    <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
                      Novo cliente
                    </Button>
                  )
                }
              />
            </div>
          )}
          {filtered.map((c) => {
            const config = configFor(c.slug);
            const p = summary?.[c.slug];
            const cycle = currentCycleByClient.get(c.slug);
            const responsible = (responsibleByClient.get(c.slug) ?? []).map(resolve);
            const primary = summary?.[c.slug]?.primary;
            return (
              <article
                key={c.slug}
                className="linked-card surface-card surface-interactive flex flex-col rounded-2xl border border-line bg-surface p-4 hover:border-line-strong"
              >
                <div className="flex items-start justify-between gap-3">
                  <Link href={clientEntry(c.slug)} className="card-primary-link flex min-w-0 items-center gap-2.5">
                    <ClientMark company={c} className="h-9 w-9" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-input font-medium">
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-muted">
                        {config.name}
                      </span>
                    </span>
                  </Link>
                  <ActionMenu
                    label={`Ações de ${c.name}`}
                    actions={
                      archived
                        ? [{ label: "Reativar", icon: <RotateCcw />, onSelect: () => void lifecycle.run("clients.restore", c.slug) }]
                        : [
                            { label: "Abrir cliente", icon: <Building2 />, href: clientEntry(c.slug) },
                            { label: "Ver plano e ciclos", icon: <ArrowUpRight />, href: paths.clientPlan(c.slug) },
                            {
                              label: "Arquivar",
                              icon: <Archive />,
                              tone: "danger",
                              separator: true,
                              onSelect: () => setArchiving(c.slug),
                            },
                          ]
                    }
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                  {healthOf[c.slug] && (
                    <HealthBadge health={healthOf[c.slug]} compact />
                  )}
                  <Badge tone="neutral">{serviceModelLabel[config.model]}</Badge>
                  {primary && primary.kind !== "sem-reuniao" && (
                    <Badge tone={primary.severity === "critico" ? "bad" : "warn"}>
                      {primary.action}
                    </Badge>
                  )}
                  {archived && (
                    <Badge tone="warn">{clientStatusLabel[c.status ?? "encerrado"]}</Badge>
                  )}
                </div>
                <div className="mt-4 text-[12px] text-muted">Ciclo atual</div>
                <Link
                  href={
                    cycle
                      ? paths.clientCycle(c.slug, cycle.id)
                      : paths.clientPlan(c.slug, "ciclos")
                  }
                  className="mt-0.5 text-[13px] font-medium hover:text-blue"
                >
                  {cycle?.name ?? "Planejar próximo ciclo"}
                </Link>
                {p && !archived && (
                  <div className="mt-3">
                    <div className="flex justify-between text-[12px] text-muted">
                      <span>Tarefas {p.done}/{p.planned}</span>
                      <span className="tabular-nums">{p.percent}%</span>
                    </div>
                    <div className="mt-1.5">
                      <Meter value={p.percent} thick tone="accent" label={`Tarefas de ${c.name}`} />
                    </div>
                  </div>
                )}
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3 text-[12.5px]">
                  <ResponsibleMembers members={responsible} company={c} editable={!archived && can("cliente.responsaveis", c.slug)} />
                  <span className="min-w-0 truncate text-right text-muted">
                    {summary?.[c.slug]?.nextTask?.title || "Sem tarefas abertas"}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
      <div
        data-view={view}
        className="collection-table mt-4 overflow-x-auto rounded-2xl border border-line"
      >
        {/* g4os-ds-disable-next-line raw-table -- colunas somem por largura (md/xl/2xl) e a ordenação é a da visão salva; o DataTable não esconde coluna por breakpoint. Mantém o mesmo responsive-table/collection-table do DS (cards no celular). */}
        <table className="responsive-table w-full text-left text-[13.5px]">
          <thead className="border-b border-line bg-soft/50 text-[12px] text-muted">
            <tr>
              <ClientSortHead kind="name" label="Cliente" sort={sort} onSort={setSort} className="min-w-[220px] px-4" />
              <th className="hidden px-3 py-2.5 font-medium md:table-cell">
                Modelo
              </th>
              <ClientSortHead kind="cycle" label="Ciclo atual" sort={sort} onSort={setSort} className="hidden sm:table-cell" />
              <ClientSortHead kind="entry" label="Entrada" sort={sort} onSort={setSort} className="hidden xl:table-cell" />
              <th className="px-3 py-2.5 font-medium">
                Responsável pelo cliente
              </th>
              <th className="hidden px-3 py-2.5 font-medium 2xl:table-cell">
                Contato principal
              </th>
              <th className="max-w-[380px] px-4 py-2.5 text-right font-medium">
                {archived ? "Situação" : "Próxima tarefa"}
              </th>
              <th className="w-10 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="p-4">
                  <Empty
                    title={
                      archived
                        ? "Nenhum cliente arquivado"
                        : "Nenhum cliente encontrado"
                    }
                    hint={
                      archived
                        ? "Clientes pausados ou encerrados aparecem aqui."
                        : "Tente outro nome, ajuste os filtros ou cadastre um novo cliente."
                    }
                    action={
                      archived ? undefined : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setCreating(true)}
                        >
                          Novo cliente
                        </Button>
                      )
                    }
                  />
                </td>
              </tr>
            )}
            {filtered.map((c) => {
              const sponsor = contacts.find(
                (s) => s.company === c.slug && s.active && s.primary,
              ) ?? { name: "Não definido", initials: "—" };
              const responsible = (responsibleByClient.get(c.slug) ?? []).map(resolve);
              const config = configFor(c.slug);
              const cycle = currentCycleByClient.get(c.slug);
              const primary = summary?.[c.slug]?.primary;
              return (
                <tr
                  key={c.slug}
                  className="border-b border-line last:border-0 hover:bg-soft/40"
                >
                  <td data-primary="" className="px-4 py-3">
                    <Link
                      href={clientEntry(c.slug)}
                      className="flex items-center gap-2.5"
                    >
                      <ClientMark company={c} className="h-7 w-7 text-[11px]" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 whitespace-nowrap font-medium">
                          <HealthDot flag={healthOf[c.slug]?.flag ?? "green"} />
                          {c.name}
                        </span>
                        <span
                          className="mt-0.5 block max-w-[260px] truncate text-[12px] text-muted"
                          title={config.name}
                        >
                          {config.name}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td
                    data-label="Modelo"
                    className="hidden px-3 py-3 md:table-cell"
                  >
                    <Badge tone="neutral">
                      {serviceModelLabel[config.model]}
                    </Badge>
                  </td>
                  <td
                    data-label="Ciclo atual"
                    data-wide=""
                    className="hidden px-3 py-3 text-ink-soft sm:table-cell"
                  >
                    <Link
                      href={
                        cycle
                          ? paths.clientCycle(c.slug, cycle.id)
                          : paths.clientPlan(c.slug, "ciclos")
                      }
                      className="hover:text-blue"
                    >
                      {cycle?.name ?? "Planejar próximo ciclo"}
                    </Link>
                  </td>
                  <td
                    data-label="Entrada"
                    className="hidden min-w-[96px] px-3 py-3 text-ink-soft xl:table-cell"
                  >
                    {formatDate(c.startedAt)}
                  </td>
                  <td
                    data-label="Responsável pelo cliente"
                    className="px-3 py-3"
                  >
                    <ResponsibleMembers members={responsible} company={c} editable={!archived && can("cliente.responsaveis", c.slug)} />
                  </td>
                  <td
                    data-label="Contato principal"
                    className="hidden px-3 py-3 2xl:table-cell"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Avatar
                        initials={sponsor.initials}
                        tint={c.tint}
                        size="sm"
                      />
                      {sponsor.name.split(" ")[0]}
                    </span>
                  </td>
                  <td
                    data-label={archived ? "Situação" : "Próxima tarefa"}
                    className="w-[260px] min-w-[200px] px-4 py-3 text-right text-[12.5px] text-muted"
                  >
                    {archived ? (
                      <span className="inline-flex items-center gap-3">
                        <Badge tone="warn">
                          {clientStatusLabel[c.status ?? "encerrado"]}
                        </Badge>
                        <button
                          type="button"
                          onClick={() => void lifecycle.run("clients.restore", c.slug)}
                          className="text-[13px] text-ink hover:underline"
                        >
                          Reativar
                        </button>
                      </span>
                    ) : (
                      <>
                        {summary?.[c.slug]?.nextTask?.title ? (
                          <span className="block text-ink">
                            {summary[c.slug].nextTask?.title}
                          </span>
                        ) : (
                          <span className="block">Sem próximo passo</span>
                        )}
                        {summary?.[c.slug]?.nextTask?.dueAt && (
                          <span>{relativeFrom(summary[c.slug].nextTask!.dueAt!)}</span>
                        )}
                        {primary && primary.kind !== "sem-reuniao" && (
                          <span
                            className={cn(
                              "mt-1 line-clamp-2 text-[11.5px]",
                              primary.severity === "critico" ? "text-rose" : "text-amber",
                            )}
                            title={primary.title}
                          >
                            {primary.action} · {primary.title}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td data-action="" className="px-2 py-3 text-right">
                    <ActionMenu
                      label={`Ações de ${c.name}`}
                      actions={
                        archived
                          ? [
                              {
                                label: "Reativar",
                                icon: <RotateCcw />,
                                onSelect: () => void lifecycle.run("clients.restore", c.slug),
                              },
                            ]
                          : [
                              {
                                label: "Abrir cliente",
                                icon: <Building2 />,
                                href: clientEntry(c.slug),
                              },
                              {
                                label: "Ver plano e ciclos",
                                icon: <ArrowUpRight />,
                                href: paths.clientPlan(c.slug),
                              },
                              {
                                label: "Configurar cliente",
                                icon: <Settings2 />,
                                href: clientEntry(c.slug),
                              },
                              {
                                label: "Arquivar",
                                icon: <Archive />,
                                tone: "danger",
                                separator: true,
                                onSelect: () => setArchiving(c.slug),
                              },
                            ]
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      {creating && <ClientForm onClose={() => setCreating(false)} />}
      {!archiving && <ClientLifecycleFeedback operation={lifecycle} />}
      <Modal
        open={archiving !== null}
        onClose={() => { if (!lifecycle.isBusy()) setArchiving(null); }}
        title="Arquivar cliente?"
        description={`${allClients.find((c) => c.slug === archiving)?.name ?? "O cliente"} sai das listas e da visão geral. Plano, ciclos, tarefas e documentos são preservados e você pode reativar depois.`}
        footer={<Button disabled={lifecycle.busy || Boolean(lifecycle.error)} variant="danger" onClick={() => { if (archiving) void lifecycle.run("clients.archive", archiving, () => setArchiving(null)); }}>{lifecycle.busy ? "Arquivando…" : "Arquivar"}</Button>}
      ><ClientLifecycleFeedback operation={lifecycle} /></Modal>
    </Page>
  );
}
