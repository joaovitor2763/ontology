"use client";
import { clientEntry } from "@/shared/infrastructure/client-entry";
import { allocationRoleName, memberLoad } from "@/modules/clients/domain/allocation";
import type { Company } from "@/modules/clients/domain/models";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { AllocationManager } from "@/modules/clients/presentation/AllocationManager";
import { usePortfolioSummary } from "@/modules/clients/presentation/usePortfolioSummary";
import type { PortfolioSummary } from "@/modules/clients/domain/portfolio-summary";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { useAlerts } from "@/modules/workspace/presentation/useAlerts";
import { TeamSwitcher } from "@/modules/workspace/presentation/TeamSwitcher";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { cn } from "@/shared/lib/cn";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { paths } from "@/shared/lib/routes";
import {
  DensityControl,
  useCollectionDisplay,
} from "@/shared/ui/DisplayControls";
import { ActionMenu } from "@/shared/ui/Menu";
import { FacetFilter } from "@/shared/ui/FacetFilter";
import { PageHeading } from "@/shared/ui/PageHeading";
import { Avatar, Button, HealthDot, Page } from "@/shared/ui/primitives";
import { useAllClientsHealth } from "@/modules/clients/presentation/useClientHealth";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { TableToolbar } from "@/shared/ui/TableToolbar";
import { DataTable } from "@g4ai/ds";
import { Building2, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { useAlertAcknowledgments } from "@/modules/workspace/presentation/useAlertAcknowledgments";

function AlocacaoScreenContent() {
  const { mode, resolved } = useSyncStatus();
  if (!resolved) return <Page><p className="py-8 text-sm text-muted">Carregando equipe…</p></Page>;
  return mode === "remote" ? <RemoteAlocacaoScreen /> : <LocalAlocacaoScreen />;
}

function RemoteAlocacaoScreen() {
  const { clients } = useClientsState();
  const { hiddenAlerts } = useWorkspaceState();
  // A ciência é por pessoa e não muda documento: a marca relê a contagem de alertas.
  const acknowledged = useAlertAcknowledgments();
  const refreshOn = useMemo(() => [clients, hiddenAlerts, acknowledged], [clients, hiddenAlerts, acknowledged]);
  const { data, error, retry } = usePortfolioSummary(refreshOn);
  if (!data) return <Page><div role={error ? "alert" : "status"} className="py-8 text-sm text-muted">
    {error ?? "Carregando equipe…"}
    {error && <Button className="ml-3" size="sm" variant="ghost" onClick={retry}>Tentar novamente</Button>}
  </div></Page>;
  return <AlocacaoContent summary={data} error={error} retry={retry} />;
}

function LocalAlocacaoScreen() {
  const { cycles } = useDeliveryState();
  const { alerts } = useAlerts();
  const healthOf = useAllClientsHealth();
  const { clients } = useClientsState();
  const summary: PortfolioSummary = Object.fromEntries(clients.map(client => {
    const cycle = cycles.find(row => row.company === client.slug &&
      (row.status === "em-curso" || row.status === "em-aceite"));
    return [client.slug, { planned: 0, done: 0, percent: 0, nextTask: null,
      cycle: cycle ? { id: cycle.id, name: cycle.name } : null,
      health: healthOf[client.slug] ?? null,
      alertCount: alerts.filter(alert => alert.company === client.slug).length,
      primary: null }];
  }));
  return <AlocacaoContent summary={summary} error={null} retry={() => {}} />;
}

function AlocacaoContent({ summary, error, retry }: {
  summary: PortfolioSummary; error: string | null; retry: () => void;
}) {
  const { can } = usePermissions();
  const canAllocate = can("alocacao.editar");
  const { density, setDensity } = useCollectionDisplay("portfolio");
  const {
    clients,
    allocations,
    allocationsFor,
    assigned,
  } = useClientsState();
  const { allocationRoles } = useWorkspaceState();
  const { active, resolve } = useTeam();
  const params = useSearchParams();
  const initialMember = params.get("membro");
  const initialClient = params.get("cliente");
  const [edit, setEdit] = useState<Company | null>(
    () => clients.find((c) => c.slug === initialClient) ?? null,
  );
  const [q, setQ] = useState("");
  const [memberFilter, setMemberFilter] = useState<string[]>(
    initialMember ? [initialMember] : [],
  );

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return clients.filter((c) => {
      const team = allocationsFor(c.slug);
      if (memberFilter.length && !team.some((a) => memberFilter.includes(a.memberId)))
        return false;
      if (!query) return true;
      const names = team.map((a) => resolve(a.memberId).name).join(" ");
      return `${c.name} ${names}`.toLowerCase().includes(query);
    });
  }, [q, memberFilter, clients, allocationsFor, resolve]);

  const load = active.map((p) => ({
    person: p,
    ...memberLoad(allocations, p.id, p.capacityHoursWeek),
  }));

  return (
    <Page density={density} className="max-w-none">
      {error && <div role="alert" className="mb-4 rounded-xl border border-line bg-soft p-3 text-sm">
        {error} Os dados abaixo podem estar desatualizados.
        <Button className="ml-3" size="sm" variant="ghost" onClick={retry}>Tentar novamente</Button>
      </div>}
      <PageHeading
        title="Equipe"
        description="Quem está alocado em cada cliente e quanto da capacidade de cada membro já está comprometida."
        actions={
          <>
            <TeamSwitcher value="alocacao" />
            <DensityControl density={density} onChange={setDensity} />
          </>
        }
      />

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {load.map((row) => (
          <button
            type="button"
            key={row.person.id}
            onClick={() =>
              setMemberFilter((current) =>
                current.includes(row.person.id) ? [] : [row.person.id],
              )
            }
            aria-pressed={memberFilter.includes(row.person.id)}
            className={cn(
              "rounded-xl p-4 text-left ring-1 transition-colors hover:bg-soft/40",
              memberFilter.includes(row.person.id)
                ? "ring-line-strong bg-soft/50"
                : "ring-line",
            )}
          >
            <div className="flex items-center gap-2">
              <Avatar initials={row.person.initials} size="sm" />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium">
                  {row.person.name}
                </div>
                <div className="text-[12px] text-muted">{row.person.role}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-between gap-3 text-[13px] text-ink-soft">
              <span>
                {row.clients} cliente{row.clients === 1 ? "" : "s"}
              </span>
              <span
                className={cn(
                  "tabular-nums",
                  row.over ? "font-medium text-rose" : "",
                )}
              >
                {row.percent}% da capacidade
                {row.hours != null && row.capacity ? ` · ${row.hours}/${row.capacity} h` : ""}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-soft">
              <div
                className={cn(
                  "h-full rounded-full",
                  row.over ? "bg-rose" : row.percent >= 80 ? "bg-amber" : "bg-accent",
                )}
                style={{ width: `${Math.min(100, row.percent)}%` }}
              />
            </div>
          </button>
        ))}
      </div>

      <div className="mt-6">
        <TableToolbar
          query={q}
          onQuery={setQ}
          placeholder="Buscar cliente ou membro"
          shown={rows.length}
          total={clients.length}
          dirty={Boolean(q.trim() || memberFilter.length)}
          onClear={() => {
            setQ("");
            setMemberFilter([]);
          }}
          noun="cliente"
        >
          <FacetFilter
            label="Membro"
            options={active.map((p) => ({ id: p.id, label: p.name }))}
            value={memberFilter}
            onChange={setMemberFilter}
          />
        </TableToolbar>
      </div>

      <DataTable
        className="mt-4"
        label="Alocação por cliente"
        rows={rows}
        rowKey={(c) => c.slug}
        rowLabel={(c) => c.name}
        columns={[
          {
            key: "client",
            header: "Cliente",
            primary: true,
            cell: (c) => (
              <Link
                href={clientEntry(c.slug)}
                className="inline-flex items-center gap-2 font-medium hover:underline"
              >
                <HealthDot flag={summary[c.slug]?.health?.flag ?? "green"} />
                {c.name}
              </Link>
            ),
          },
          {
            key: "cycle",
            header: "Ciclo atual",
            wide: true,
            className: "text-ink-soft",
            cell: (c) => {
              const cycle = summary[c.slug]?.cycle;
              return (
                <Link
                  href={
                    cycle
                      ? paths.clientCycle(c.slug, cycle.id)
                      : paths.clientPlan(c.slug, "ciclos")
                  }
                  className="hover:underline"
                >
                  {cycle?.name ?? "Nenhum ciclo em andamento"}
                </Link>
              );
            },
          },
          {
            key: "lead",
            header: "Responsável",
            cell: (c) => {
              const leadP = resolve(assigned(c).leadId);
              return (
                <span className="inline-flex items-center gap-1.5">
                  <Avatar initials={leadP.initials} size="sm" />
                  {leadP.name.split(" ")[0]}
                </span>
              );
            },
          },
          {
            key: "cs",
            header: "CX",
            cell: (c) => {
              const csP = resolve(assigned(c).csId);
              return (
                <span className="inline-flex items-center gap-1.5">
                  <Avatar initials={csP.initials} size="sm" />
                  {csP.name.split(" ")[0]}
                </span>
              );
            },
          },
          {
            key: "team",
            header: "Equipe alocada",
            wide: true,
            cell: (c) => {
              const team = allocationsFor(c.slug);
              return (
                <span className="flex flex-wrap gap-1.5">
                  {team.map((al) => (
                    <span
                      key={al.id}
                      className="rounded-md bg-soft px-2 py-1 text-[11.5px] text-ink-soft"
                    >
                      {resolve(al.memberId).name.split(" ")[0]} ·{" "}
                      {allocationRoleName(al.role, allocationRoles)} · {al.enrollmentId ? "produto" : "cliente"} · {al.percent}%
                    </span>
                  ))}
                  {!team.length && (
                    <span className="text-[12px] text-muted">
                      Ninguém alocado
                    </span>
                  )}
                </span>
              );
            },
          },
          {
            key: "alerts",
            header: "Alertas",
            className: "tabular-nums text-ink-soft",
            cell: (c) => summary[c.slug]?.alertCount || "—",
          },
          {
            key: "actions",
            header: <span className="sr-only">Ações</span>,
            action: true,
            align: "right",
            cell: (c) => (
                <ActionMenu
                  label={`Ações de ${c.name}`}
                  actions={[
                    {
                      label: "Alocar equipe",
                      icon: <UserRoundPlus />,
                      onSelect: () => setEdit(c),
                      disabled: !canAllocate,
                    },
                    {
                      label: "Abrir cliente",
                      icon: <Building2 />,
                      href: clientEntry(c.slug),
                    },
                  ]}
                />
            ),
          },
        ]}
      />

      {edit && canAllocate && (
        <AllocationManager
          client={edit}
          onClose={() => setEdit(null)}
        />
      )}
    </Page>
  );
}

/** Suspense dentro do módulo cliente, não em `page.tsx`: ver `docs/navegacao-e-visualizacoes.md`. */
export default function AlocacaoScreen() {
  return (
    <Suspense>
      <AlocacaoScreenContent />
    </Suspense>
  );
}
