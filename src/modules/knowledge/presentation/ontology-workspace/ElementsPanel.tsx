"use client";
import { ArrowRight, LayoutGrid, List } from "lucide-react";
import {
  elementChecks,
  relationName,
  typeMeta,
  typeOf,
} from "@/modules/knowledge/domain/ontology";
import type { GraphEdge, GraphNode } from "@/modules/knowledge/domain/models";
import { cn } from "@/shared/lib/cn";
import { Empty } from "@/shared/ui/primitives";
import { ElementIcon } from "../ElementIcon";
import type { LiveOntology, OntologyWorkspaceState } from "./types";

export function ElementsPanel({
  ont,
  state,
  filtered,
  filteredEdges,
}: {
  ont: LiveOntology;
  state: OntologyWorkspaceState;
  filtered: GraphNode[];
  filteredEdges: GraphEdge[];
}) {
  const { view, elementLayout, selectedId } = state;
  return (
    <div className="h-full overflow-y-auto px-5 py-4 lg:px-7">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-muted">
          {view === "elements"
            ? `${filtered.length} elementos · selecione para inspecionar`
            : `${filteredEdges.length} conexões · da origem para o destino`}
        </p>
        {view === "elements" && (
          <div className="flex flex-wrap items-center gap-4">
            <div
              role="group"
              aria-label="Visualização dos elementos"
              className="flex gap-1 rounded-lg border border-line p-1"
            >
              {(
                [
                  ["list", "Lista", List],
                  ["cards", "Cartões", LayoutGrid],
                ] as const
              ).map(([layout, label, Icon]) => (
                <button
                  key={layout}
                  aria-pressed={elementLayout === layout}
                  onClick={() => state.setElementLayout(layout)}
                  className={cn(
                    "flex min-h-8 items-center gap-1.5 rounded-md px-3 text-[12px] transition-colors",
                    elementLayout === layout
                      ? "bg-soft text-ink"
                      : "text-muted hover:bg-soft/60",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => state.setEditing({ node: null, type: "area" })}
              className="shrink-0 text-[12px] text-blue"
            >
              + Nova área
            </button>
          </div>
        )}
      </div>
      {view === "elements" ? (
        elementLayout === "list" ? (
          <div className="@container" data-element-list>
            <div
              className="hidden grid-cols-[minmax(0,1fr)_140px_80px_110px] gap-5 border-b border-line px-4 pb-3 text-[11px] text-muted @min-[680px]:grid"
              aria-hidden="true"
            >
              <span>Elemento</span>
              <span>Tipo</span>
              <span>Conexões</span>
              <span>Documentação</span>
            </div>
            <ul className="divide-y divide-line">
              {filtered.map((n) => {
                const meta = typeMeta(typeOf(n));
                const completed = elementChecks(n, ont).filter(
                  (c) => c.done,
                ).length;
                const connections = ont.edges.filter(
                  (e) => e.from === n.id || e.to === n.id,
                ).length;
                return (
                  <li key={n.id}>
                    <button
                      aria-label={`Inspecionar ${n.label}`}
                      aria-pressed={selectedId === n.id}
                      onClick={() => state.setSelected(n.id)}
                      className={cn(
                        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-soft/60 @min-[680px]:grid-cols-[minmax(0,1fr)_140px_80px_110px]",
                        selectedId === n.id && "bg-soft",
                      )}
                    >
                      <span className="col-span-2 flex min-w-0 items-start gap-3 @min-[680px]:col-span-1">
                        <span
                          className="mt-0.5 shrink-0"
                          style={{ color: meta.color }}
                        >
                          <ElementIcon type={meta.id} />
                        </span>
                        <span className="min-w-0">
                          <span className="block break-words text-[13px] font-medium leading-5">
                            {n.label}
                          </span>
                          <span className="mt-1 line-clamp-2 break-words text-[12px] leading-[18px] text-muted">
                            {n.description || "Sem definição."}
                          </span>
                        </span>
                      </span>
                      <span
                        className="col-span-2 text-[11px] @min-[680px]:col-span-1"
                        style={{ color: meta.color }}
                      >
                        {meta.label}
                      </span>
                      <span className="text-[11px] text-muted">
                        {connections}
                        <span className="@min-[680px]:hidden"> conexões</span>
                      </span>
                      <span className="text-[11px] text-muted">
                        {completed}/5
                        <span className="@min-[680px]:hidden"> documentado</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {filtered.map((n) => {
              const meta = typeMeta(typeOf(n));
              const checks = elementChecks(n, ont);
              return (
                <button
                  key={n.id}
                  onClick={() => state.setSelected(n.id)}
                  className={cn(
                    "group min-w-0 rounded-xl border px-4 py-3 text-left transition-colors hover:border-line-strong",
                    selectedId === n.id
                      ? "border-line-strong bg-soft"
                      : "border-line bg-surface",
                  )}
                >
                  <div
                    className="mb-2 flex items-center gap-2 text-[11px]"
                    style={{ color: meta.color }}
                  >
                    <ElementIcon type={meta.id} />
                    {meta.label}
                  </div>
                  <h3 className="break-words text-[14px] font-medium leading-snug">
                    {n.label}
                  </h3>
                  <p className="mt-1 line-clamp-2 min-h-[38px] text-[12px] leading-[19px] text-muted">
                    {n.description ||
                      "Adicione uma definição para este elemento."}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-[10px] text-muted">
                    <span>
                      {
                        ont.edges.filter(
                          (e) => e.from === n.id || e.to === n.id,
                        ).length
                      }{" "}
                      conexões
                    </span>
                    <span>
                      {checks.filter((c) => c.done).length}/5 documentado
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : (
        <div className="space-y-2">
          {filteredEdges.map((edge) => (
            <button
              key={edge.id}
              onClick={() => state.setConnection({ edge })}
              className="grid w-full gap-2 rounded-xl border border-line px-4 py-3 text-left hover:border-line-strong sm:grid-cols-[1fr_150px_1fr]"
            >
              <span className="text-[13px] font-medium">
                {ont.nodes.find((n) => n.id === edge.from)?.label}
              </span>
              <span className="flex items-center gap-2 text-[11px] text-blue">
                <span>{relationName(edge.label)}</span>
                <ArrowRight className="h-3 w-3 shrink-0" />
              </span>
              <span className="text-[13px]">
                {ont.nodes.find((n) => n.id === edge.to)?.label}
              </span>
            </button>
          ))}
        </div>
      )}
      {!(view === "elements" ? filtered.length : filteredEdges.length) && (
        <Empty
          title="Nenhum resultado"
          hint="Ajuste a busca ou crie um novo registro."
        />
      )}
    </div>
  );
}
