"use client";
import { ArrowLeft, Search, X } from "lucide-react";
import {
  ELEMENT_TYPES,
  typeOf,
} from "@/modules/knowledge/domain/ontology";
import type { ElementType, GraphNode } from "@/modules/knowledge/domain/models";
import { Combobox } from "@/shared/ui/Combobox";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import type { LiveOntology, OntologyWorkspaceState } from "./types";

export function WorkspaceFilters({
  ont,
  state,
  count,
  highlight,
  mapNodes,
  query,
}: {
  ont: LiveOntology;
  state: OntologyWorkspaceState;
  count: (t: ElementType) => number;
  highlight?: Set<string>;
  mapNodes: GraphNode[];
  query: string;
}) {
  const { view, q, type, scope } = state;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-5 py-3 lg:px-7">
      <label className="focus-field flex min-w-0 basis-full flex-1 items-center gap-2 rounded-lg border border-line px-3 sm:basis-auto sm:max-w-[290px]">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
        <input
          aria-label={
            view === "connections" ? "Buscar conexão" : "Buscar elemento"
          }
          value={q}
          onChange={(e) => state.setQ(e.target.value)}
          placeholder={
            view === "connections"
              ? "Buscar conexão…"
              : view === "elements"
                ? "Buscar elemento…"
                : "Buscar no mapa…"
          }
          className="h-9 min-w-0 w-full bg-transparent text-[12px] outline-none"
        />
        {q && (
          <button aria-label="Limpar busca" onClick={() => state.setQ("")}>
            <X className="h-3 w-3 text-muted" />
          </button>
        )}
      </label>
      {view !== "connections" && (
        <Combobox
          label="Filtrar tipo de elemento"
          value={type}
          onValueChange={(value) => state.setType(value)}
          className="h-9 min-w-0 max-w-full rounded-lg border border-line bg-surface px-2 text-[12px] text-muted"
          options={[
            { value: "", label: "Todos os tipos" },
            ...ELEMENT_TYPES.map((t) => ({
              value: t.id,
              label: [t.plural, " (", count(t.id), ")"].join(""),
            })),
          ]}
        />
      )}
      {view === "map" && count("area") > 3 && (
        <Combobox
          label="Explorar área"
          className="h-9 min-w-0 max-w-[220px] rounded-lg border border-line bg-surface px-2 text-[12px] text-muted"
          value={String(
            ont.nodes.some((n) => typeOf(n) === "area" && n.id === scope)
              ? scope
              : "",
          )}
          onValueChange={(value) => {
            state.setScope(value || "all");
            state.setQ("");
            state.setType("");
            state.setSelected(null);
          }}
          options={[
            { value: "", label: "Todas as áreas" },
            ...ont.nodes
              .filter((n) => typeOf(n) === "area")
              .map((n) => ({ value: n.id, label: n.label })),
          ]}
        />
      )}
      {highlight && (
        <span className="text-[11px] text-muted" role="status">
          {highlight.size} de {mapNodes.length} em destaque
        </span>
      )}
      {view === "map" && !query && !type && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {scope !== "structure" && scope !== "all" ? (
            <button
              onClick={() => state.setScope("structure")}
              className="flex items-center gap-1.5 text-blue"
            >
              <ArrowLeft className="h-3 w-3" />
              {ont.nodes.find((n) => n.id === scope)?.label ??
                "Voltar à estrutura"}
            </button>
          ) : (
            <SegmentedControl
              label="Tipo de mapa"
              value={scope}
              onChange={state.setScope}
              options={[
                { value: "structure", label: "Estrutura" },
                { value: "all", label: "Mapa completo" },
              ]}
            />
          )}
        </div>
      )}
      {(query || type) && (
        <button
          onClick={state.clearFilters}
          className="text-[11px] text-blue"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
