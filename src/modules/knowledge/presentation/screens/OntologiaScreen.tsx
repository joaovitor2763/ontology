"use client";
import { useKnowledgeState } from "@/modules/knowledge/infrastructure/state";

import { OntologyPreview } from "@/modules/knowledge/presentation/OntologyPreview";
import {
  DisplayControls,
  useCollectionDisplay,
} from "@/shared/ui/DisplayControls";
import { PageHeading } from "@/shared/ui/PageHeading";
import { DataTable, SearchInput } from "@g4ai/ds";

import { useClientsState } from "@/modules/clients/infrastructure/state";
import {
  mergeOntology,
  ontologyFor,
} from "@/modules/knowledge/infrastructure/queries";
import {
  ArrowUpRight,
  Building2,
  Network,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { paths } from "@/shared/lib/routes";
import { useState } from "react";

import {
  elementChecks,
  normalized,
  typeOf,
} from "@/modules/knowledge/domain/ontology";
import { Empty, Metric, Page } from "@/shared/ui/primitives";

export default function OntologiasIndex() {
  const { view, setView, density, setDensity } = useCollectionDisplay(
    "ontologies",
    "cards",
  );
  const { clients: companies, configFor } = useClientsState();
  const { ontologyDrafts } = useKnowledgeState();
  const [q, setQ] = useState("");
  const rows = companies
    .filter((c) => configFor(c.slug).modules.ontology)
    .map((company) => {
      const ont = mergeOntology(
        ontologyFor(company.slug),
        ontologyDrafts[company.slug],
      )!;
      return {
        company,
        ont,
        areas: ont.nodes.filter((n) => typeOf(n) === "area"),
        people: ont.nodes.filter((n) => typeOf(n) === "person"),
        isolated: ont.nodes.filter(
          (n) => !ont.edges.some((e) => e.from === n.id || e.to === n.id),
        ),
        documented: ont.nodes.filter((n) =>
          elementChecks(n, ont).every((c) => c.done),
        ).length,
      };
    });
  const filtered = rows.filter(({ company, ont }) =>
    normalized(
      `${company.name} ${company.sector} ${ont.nodes.map((n) => n.label).join(" ")}`,
    ).includes(normalized(q)),
  );
  const emptyResult = (
    <Empty
      title="Nenhum mapa encontrado"
      hint="Busque pelo nome da empresa, área, pessoa ou elemento."
    />
  );
  return (
    <Page density={density}>
      <PageHeading
        actions={
          <DisplayControls
            view={view}
            onView={setView}
            density={density}
            onDensity={setDensity}
          />
        }
        title="Ontologias"
        description="Explore como cada empresa funciona. Conecte áreas, pessoas, processos e sistemas em um mesmo mapa."
      />
      <div className="compact-metrics mt-6 grid grid-cols-3 gap-3">
        <Metric
          label="Empresas mapeadas"
          value={String(rows.length)}
          icon={<Building2 className="h-4 w-4" />}
        />
        <Metric
          label="Elementos no workspace"
          value={String(rows.reduce((s, r) => s + r.ont.nodes.length, 0))}
          icon={<Network className="h-4 w-4" />}
        />
        <Metric
          label="Pessoas nos mapas"
          value={String(rows.reduce((s, r) => s + r.people.length, 0))}
          icon={<UsersRound className="h-4 w-4" />}
        />
      </div>
      <div className="mt-8 mb-5 flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-[16px] font-medium">Mapas dos clientes</h2>
        <SearchInput
          className="w-full sm:max-w-[330px]"
          placeholder="Buscar empresa ou elemento…"
          value={q}
          onChange={setQ}
        />
      </div>
      {view === "list" ? (
        <DataTable
          label="Mapas dos clientes"
          density={density}
          rows={filtered}
          rowKey={(r) => r.company.slug}
          rowLabel={(r) => r.company.name}
          empty={emptyResult}
          columns={[
            {
              key: "company",
              header: "Empresa",
              primary: true,
              cell: ({ company }) => (
                <>
                  <Link
                    href={paths.clientOntology(company.slug)}
                    className="font-medium hover:underline"
                  >
                    {company.name}
                  </Link>
                  <span className="mt-1 block text-[12px] text-muted">
                    {company.sector}
                  </span>
                </>
              ),
            },
            { key: "areas", header: "Áreas", className: "tabular-nums", cell: ({ areas }) => areas.length },
            { key: "people", header: "Pessoas", className: "tabular-nums", cell: ({ people }) => people.length },
            { key: "nodes", header: "Elementos", className: "tabular-nums", cell: ({ ont }) => ont.nodes.length },
            {
              key: "documented",
              header: "Documentação",
              cell: ({ ont, documented }) =>
                ont.nodes.length
                  ? `${documented}/${ont.nodes.length} completos`
                  : "Mapa ainda não iniciado",
            },
          ]}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {filtered.map(
            ({ company, ont, areas, people, isolated, documented }) => (
              <Link
                key={company.slug}
                href={paths.clientOntology(company.slug)}
                className="surface-card surface-interactive group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-colors hover:border-line-strong"
              >
                <div className="flex items-start justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                      style={{
                        background: `${company.tint}12`,
                        color: company.tint,
                      }}
                    >
                      <Building2 className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="text-[15px] font-medium">
                        {company.name}
                      </h3>
                      <p className="mt-1 text-[12px] text-muted">
                        {company.sector} · {company.city}
                      </p>
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted group-hover:text-blue" />
                </div>
                <div
                  data-collection-secondary=""
                  className="mx-4 overflow-hidden rounded-xl border border-line bg-soft/30"
                >
                  <OntologyPreview
                    nodes={ont.nodes}
                    edges={ont.edges}
                    tint={company.tint}
                  />
                </div>
                <p className="px-4 pt-3 text-[12px] leading-relaxed text-ink-soft">
                  {areas
                    .slice(0, 3)
                    .map((a) => a.label)
                    .join(" · ") || "Adicione a primeira área no mapa"}
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 pt-2 text-[12px] text-muted">
                  <span>{areas.length} áreas</span>
                  <span>{people.length} pessoas</span>
                  <span>{ont.nodes.length} elementos</span>
                  <span>{ont.edges.length} conexões</span>
                </div>
                <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 text-[11px]">
                  <span className="text-muted">
                    {isolated.length
                      ? `${isolated.length} elementos ainda sem conexão`
                      : `${documented} de ${ont.nodes.length} elementos com os 5 campos documentados`}
                  </span>
                  <span className="font-medium text-blue">
                    {ont.nodes.length ? "Abrir mapa →" : "Começar mapa →"}
                  </span>
                </div>
              </Link>
            ),
          )}
        </div>
      )}
      {view !== "list" && !filtered.length && emptyResult}
      <p className="mt-6 text-[12px] leading-relaxed text-muted">
        Os mapas demonstrativos podem ser editados. As alterações ficam salvas
        neste navegador e podem ser exportadas dentro de cada mapa.
      </p>
    </Page>
  );
}
