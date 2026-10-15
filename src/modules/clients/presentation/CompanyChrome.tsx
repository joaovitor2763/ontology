"use client";
import { ClientPlanProductMenu } from "./ClientPlanProductMenu";
import { ChangeResponsibleButton } from "./ChangeResponsible";
import { workspaceDate } from "@/shared/lib/format";
import { ClientMark } from "./ClientMark";
import { Combobox } from "@/shared/ui/Combobox";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";

import { allocationRoleName } from "@/modules/clients/domain/allocation";
import {
  clientStatusLabel,
  type Company,
} from "@/modules/clients/domain/models";
import { useClientHealth } from "@/modules/clients/presentation/useClientHealth";
import { useStakeholders } from "@/modules/clients/infrastructure/stakeholders-state";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";
import { useLiveThreads } from "@/modules/engagement/infrastructure/relationship-state";
import { useAlerts } from "@/modules/workspace/presentation/useAlerts";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { Drawer } from "@/shared/ui/Drawer";
import { ActionMenu } from "@/shared/ui/Menu";
import { usePersonalPreference } from "@/shared/infrastructure/usePersonalPreference";
import { clientTabsKey } from "@/shared/infrastructure/client-entry";
import { StickyHeader } from "@/shared/ui/StickyHeader";
import {
  ArrowUpRight,
  Bell,
  ChevronRight,
  Compass,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { serviceModelLabel } from "@/modules/clients/domain/service-config";

import { ServiceSettings } from "@/modules/delivery/presentation/ServiceSettings";
import { ContextBar, useCrumbs } from "@/modules/workspace/presentation/Crumbs";
import { cn } from "@/shared/lib/cn";
import {
  clientSectionLabel,
  paths,
  type ClientSection,
} from "@/shared/lib/routes";
import { Avatar, AvatarGroup, Badge, HealthBadge } from "@/shared/ui/primitives";

/** The people around a client: lead, allocated team and the main contact. */
function usePeople(company: Company) {
  const { allocationsFor } = useClientsState();
  const { resolve } = useTeam();
  const { forCompany } = useStakeholders();
  const today = workspaceDate();
  const allocations = allocationsFor(company.slug).filter(row => (!row.from || row.from <= today) && (!row.to || row.to >= today));
  const owner = allocations.find(row => row.role === "responsavel" && !row.enrollmentId);
  const lead = owner ? resolve(owner.memberId) : { id: "", name: "Sem responsável pelo cliente", initials: "—" };
  const team = allocations
    .filter((a) => a.memberId !== lead.id)
    .map((a) => ({ ...a, person: resolve(a.memberId) }));
  const sponsor = forCompany(company.slug).find(
    (s) => s.active && s.primary,
  ) ?? { name: "Não definido", initials: "—" };
  return { lead, team, sponsor };
}

function PeopleDrawer({
  company,
  open,
  onClose,
}: {
  company: Company;
  open: boolean;
  onClose: () => void;
}) {
  const { lead, team, sponsor } = usePeople(company);
  const { allocationRoles } = useWorkspaceState();
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Pessoas do cliente"
      kicker={company.name}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] font-medium text-blue">
          <Link
            href={paths.teamAllocation()}
            onClick={onClose}
            className="inline-flex items-center gap-2"
          >
            Ver alocação da equipe
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            href={paths.clientStakeholders(company.slug)}
            onClick={onClose}
            className="inline-flex items-center gap-2"
          >
            Gerenciar stakeholders
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-4 rounded-xl border border-line p-4">
          <Avatar initials={lead.initials} name={lead.name} />
          <div>
            <p className="text-[12px] text-muted">Responsável pelo cliente</p>
            <p className="mt-1 text-[14px] font-medium">{lead.name}</p>
          </div>
        </div>
        {team.length > 0 && (
          <div className="rounded-xl border border-line">
            <p className="border-b border-line px-4 py-2.5 text-[12px] text-muted">
              Equipe alocada · {team.length}
            </p>
            <ul className="divide-y divide-line">
              {team.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar
                    initials={a.person.initials}
                    name={a.person.name}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium">{a.person.name}</p>
                    <p className="text-[12px] text-muted">
                      {allocationRoleName(a.role, allocationRoles)} · {a.enrollmentId ? "Produto específico" : "Cliente inteiro"} · {a.percent}% da semana
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex items-center gap-4 rounded-xl border border-line p-4">
          <Avatar
            initials={sponsor.initials}
            name={sponsor.name}
            tint={company.tint}
          />
          <div>
            <p className="text-[12px] text-muted">Contato principal</p>
            <p className="mt-1 text-[14px] font-medium">{sponsor.name}</p>
          </div>
        </div>
      </div>
    </Drawer>
  );
}


export function CompanyChrome({
  company,
  children,
}: {
  company: Company;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const search = useSearchParams().toString();
  const router = useRouter();
  const { me } = useTeam();
  const [firstTab, setFirstTab, owner] = usePersonalPreference("client-tabs", clientTabsKey, "entregas", me.id);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { configFor } = useClientsState();
  const health = useClientHealth(company.slug);
  const config = configFor(company.slug);
  const section = path.split("/")[3] as ClientSection | undefined;
  const disabledModule = section === "ontologia" && !config.modules.ontology;
  const tabList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = tabList.current;
    const active = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (list && active) {
      const rect = active.getBoundingClientRect();
      const bounds = list.getBoundingClientRect();
      if (rect.left < bounds.left || rect.right > bounds.right) {
        list.scrollLeft += rect.left - bounds.left - 16;
      }
    }
  }, [path]);
  const { lead, team, sponsor } = usePeople(company);
  const { allocationRoles } = useWorkspaceState();
  const { statusMap, extraTasks, taskPatches } = useDeliveryState();
  const alertN = useAlerts(company.slug).count;
  const unread = useLiveThreads(company.slug).reduce((s, t) => s + t.unread, 0);
  const blockedN = deliveriesFor(
    company.slug,
    statusMap,
    extraTasks,
    taskPatches,
  ).filter((d) => d.status === "bloqueado").length;
  const flush = section === "ontologia" || section === "conversas";
  const locked =
    section === "ontologia" ||
    section === "conversas" ||
    section === "entregas";
  const archived = company.status === "encerrado" || company.status === "pausado";
  const { can } = usePermissions();
  const canConfigure = can("cliente.configurar", company.slug);

  /** Counts on tabs only when they ask for action: unread threads, blocked deliveries. */
  const count = (label: string, n: number) => (n ? `${label} (${n})` : label);
  const tabs: { href: string; label: string; exact: boolean }[] = [
    // Com outra primeira aba, a Visão geral leva `?aba=geral` para não ser redirecionada.
    { href: firstTab === "overview" ? paths.client(company.slug) : `${paths.client(company.slug)}?aba=geral`, label: "Visão geral", exact: true },
    {
      href: paths.clientPlan(company.slug),
      label: clientSectionLabel.plano,
      exact: false,
    },
    {
      href: paths.clientDeliveries(company.slug),
      label: count(clientSectionLabel.entregas, blockedN),
      exact: false,
    },
    {
      href: paths.clientRequests(company.slug),
      label: clientSectionLabel.solicitacoes,
      exact: false,
    },
    {
      href: paths.clientAgenda(company.slug),
      label: clientSectionLabel.agenda,
      exact: false,
    },
    {
      href: paths.clientConversations(company.slug),
      label: count(clientSectionLabel.conversas, unread),
      exact: false,
    },
    {
      href: paths.clientDocuments(company.slug),
      label: clientSectionLabel.documentos,
      exact: false,
    },
    {
      href: paths.clientStakeholders(company.slug),
      label: clientSectionLabel.stakeholders,
      exact: false,
    },
    ...(config.modules.ontology
      ? [
          {
            href: paths.clientOntology(company.slug),
            label: clientSectionLabel.ontologia,
            exact: false,
          },
        ]
      : []),
  ];
  const tabKey = (tab: { href: string; exact: boolean }) => tab.exact ? "overview" : tab.href.split("/").at(-1) ?? "overview";
  const favorite = tabs.find((tab) => tabKey(tab) === firstTab) ?? tabs.find((tab) => tabKey(tab) === "entregas");
  if (favorite) {
    tabs.splice(tabs.indexOf(favorite), 1);
    tabs.unshift(favorite);
  }
  // Entrar no cliente (lista, busca, links) abre a primeira aba escolhida pela pessoa.
  const opensFavorite = Boolean(owner && favorite && tabKey(favorite) !== "overview" &&
    path === paths.client(company.slug) && !new URLSearchParams(search).has("aba"));
  const favoriteHref = favorite?.href;
  useEffect(() => {
    if (opensFavorite && favoriteHref) router.replace(favoriteHref);
  }, [opensFavorite, favoriteHref, router]);
  const isOn = (t: { href: string; exact: boolean }) => {
    const base = t.href.split("?")[0];
    return t.exact ? path === base : path.startsWith(base);
  };
  const people = [
    { name: `${lead.name} · Responsável`, initials: lead.initials },
    ...team.map((a) => ({
      name: `${a.person.name} · ${allocationRoleName(a.role, allocationRoles)}`,
      initials: a.person.initials,
    })),
    {
      name: `${sponsor.name} · Contato principal`,
      initials: sponsor.initials,
      tint: company.tint,
    },
  ];

  return (
    <div className="company-shell flex h-full min-h-0 flex-col overflow-y-auto bg-page lg:overflow-hidden">
      <StickyHeader
        className="company-header page-gutter shrink-0 border-b border-line bg-surface pt-4 lg:pt-5"
        scroller=".company-content"
        scrollerKey={path}
      >
        <div className="company-title-row flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="company-identity flex min-w-0 flex-1 basis-full flex-wrap items-center gap-x-2.5 gap-y-2 sm:basis-0">
            <Link
              href={paths.clients}
              className="company-crumb inline-flex basis-full items-center gap-1 text-[13px] text-muted hover:text-ink sm:basis-auto"
            >
              Clientes
              <ChevronRight aria-hidden className="h-3.5 w-3.5 text-line-strong" />
            </Link>
            <ClientMark company={company} />
            {section === "plano" ? <div className="flex min-w-0 flex-1 items-center gap-2">
              <h1 title={company.name} style={{textWrap:"nowrap"}} className="min-w-0 truncate text-[20px] font-semibold tracking-tight">{company.name}</h1>
              <ClientPlanProductMenu company={company}/>
            </div> : <>
              <h1 className="text-[20px] font-semibold tracking-tight">{company.name}</h1>
              <Badge tone="neutral">{serviceModelLabel[config.model]}</Badge>
            </>}
            {archived && (
              <Badge tone="warn">
                {clientStatusLabel[company.status ?? "ativo"]}
              </Badge>
            )}
            <span
              className={cn(
                "company-description basis-full text-[12px] leading-relaxed text-muted",
                (section === "ontologia" || section === "plano") &&
                  "hidden sm:block",
              )}
            >
              {config.name}
              {company.contract ? ` · ${company.contract}` : ""}
            </span>
          </div>
          <div className="company-actions flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setPeopleOpen(true)}
              aria-label="Pessoas do cliente"
              title={people.map((p) => p.name).join("\n")}
              className="company-people hidden h-9 items-center rounded-lg px-1.5 hover:bg-soft sm:inline-flex"
            >
              <AvatarGroup people={people} max={4} />
            </button>
            <HealthBadge health={health} />
            {alertN > 0 && (
              <Link
                href={paths.alerts(company.slug, `${path}${search ? `?${search}` : ""}`)}
                className="hidden h-9 items-center gap-1.5 rounded-lg border border-amber/30 bg-amber-soft/40 px-2.5 text-[12px] font-medium text-amber hover:bg-amber-soft sm:inline-flex"
              >
                <Bell className="h-3.5 w-3.5" />
                {alertN}
              </Link>
            )}
            {can("cliente.responsaveis", company.slug) && <ChangeResponsibleButton company={company} />}
            {canConfigure && (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="hidden h-9 items-center gap-2 rounded-lg border border-line px-3 text-[12px] font-medium text-ink hover:bg-soft sm:inline-flex"
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span className="company-configure-label">Configurar cliente</span>
              </button>
            )}
          </div>
          <div
            ref={tabList}
            className="company-tabs order-last mt-1 hidden basis-full flex-wrap items-center gap-1 sm:flex"
            aria-label="Seções do cliente"
          >
            {tabs.map((t) => {
              const on = isOn(t);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "company-tab shrink-0 rounded-t-lg border-b-2 px-2.5 pb-2.5 pt-2 text-[12px]",
                    on
                      ? "border-ink font-medium text-ink"
                      : "border-transparent text-muted hover:text-ink",
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
            {owner && <ActionMenu label="Personalizar primeira aba" trigger={<><Settings2 className="h-3.5 w-3.5" /> Primeira aba</>}
              actions={tabs.map((tab) => ({ label: `${tabKey(tab) === firstTab ? "✓ " : ""}${tab.label}`,
                onSelect: () => setFirstTab(tabKey(tab)) }))} />}
          </div>
        </div>

        <div className="my-4 flex items-center gap-2 sm:hidden">
          <label htmlFor="company-section" className="sr-only">
            Seção do cliente
          </label>
          <Combobox
            label="Seção do cliente"
            id="company-section"
            className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[13px]"
            value={String(tabs.find(isOn)?.href ?? tabs[0].href)}
            onValueChange={(value) => router.push(value)}
            options={tabs.map((tab) => ({ value: tab.href, label: tab.label }))}
          />
          {owner && <ActionMenu label="Personalizar primeira aba" trigger={<Settings2 className="h-4 w-4" />}
            className="h-10 w-10 shrink-0 border border-line"
            actions={tabs.map((tab) => ({ label: `${tabKey(tab) === firstTab ? "✓ " : ""}${tab.label}`,
              onSelect: () => setFirstTab(tabKey(tab)) }))} />}
          <button
            type="button"
            aria-label="Configurar cliente"
            onClick={() => setSettingsOpen(true)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line text-muted"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setPeopleOpen(true)}
            aria-label="Pessoas do cliente"
            className="flex h-10 shrink-0 items-center rounded-lg border border-line px-1.5"
          >
            <AvatarGroup people={people} max={2} />
          </button>
        </div>
      </StickyHeader>

      <div
        key={path}
        className={cn(
          "company-content company-content-enter shrink-0 lg:min-h-0 lg:flex-1",
          flush
            ? section === "ontologia"
              ? "h-[880px] overflow-hidden lg:h-auto"
              : "h-[720px] overflow-hidden lg:h-auto"
            : locked
              ? "page-inset overflow-visible lg:overflow-hidden"
              : "page-inset overflow-visible lg:overflow-y-auto",
          section === "entregas" && "h-[740px] lg:h-auto",
        )}
      >
        {disabledModule ? (
          <div className="mx-auto max-w-lg px-6 py-16">
            <h2 className="text-[22px] font-semibold">
              Recurso fora do escopo deste cliente
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">
              Este serviço é acompanhado por plano, ciclos, tarefas, agenda e
              documentos. Você pode ativar{" "}
              ontologia quando esse recurso
              fizer parte do trabalho.
            </p>
            <button
              onClick={() => setSettingsOpen(true)}
              className="mt-6 rounded-lg bg-ink px-4 py-2.5 text-[13px] text-on-ink"
            >
              Configurar cliente
            </button>
          </div>
        ) : opensFavorite ? null : (
          children
        )}
      </div>
      {settingsOpen && (
        <ServiceSettings
          company={company.slug}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <PeopleDrawer
        company={company}
        open={peopleOpen}
        onClose={() => setPeopleOpen(false)}
      />
    </div>
  );
}

/**
 * Shell for a record inside a client (cycle, delivery): one line of context
 * with the client and the parents as links, then the record's own header.
 * The client's tabs, team and settings stay on the client, one click away.
 */
export function CompanyRecordChrome({
  company,
  children,
}: {
  company: Company;
  children: React.ReactNode;
}) {
  const items = useCrumbs().slice(1);
  const path = usePathname();
  const search = useSearchParams().toString();
  const alertN = useAlerts(company.slug).count;
  return (
    <div className="company-shell record-shell flex h-full min-h-0 flex-col overflow-y-auto bg-page">
      <ContextBar
        className="page-gutter shrink-0"
        leading={<ClientMark company={company} className="mr-0.5 h-6 w-6 rounded-[7px] text-[11px]" />}
        items={items}
        trailing={
          alertN > 0 ? (
            <Link
              href={paths.alerts(company.slug, `${path}${search ? `?${search}` : ""}`)}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-amber hover:bg-amber-soft/60"
              title="Alertas do cliente"
            >
              <Bell className="h-3.5 w-3.5" />
              {alertN}
            </Link>
          ) : undefined
        }
      />
      <div className="page-inset record-content shrink-0">{children}</div>
    </div>
  );
}

export function NextStep({
  title,
  body,
  href,
  cta,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-accent/20 bg-accent-soft/25 p-[3px]">
      <div className="flex items-center gap-2 px-3 py-2 text-[12px] font-medium text-blue">
        <Compass className="h-3.5 w-3.5" />
        Próximo passo
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface px-5 py-4">
        <div className="min-w-0 flex-1 basis-[280px]">
          <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">
            {body}
          </p>
        </div>
        <Link
          href={href}
          className="ui-button inline-flex shrink-0 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12px] font-medium hover:bg-soft"
        >
          {cta}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
