"use client";
import {
  Check,
  Download,
  Link2,
  List,
  Maximize2,
  Minimize2,
  Network,
  Plus,
  Redo2,
  Undo2,
} from "lucide-react";
import { typeOf } from "@/modules/knowledge/domain/ontology";
import type { ElementType } from "@/modules/knowledge/domain/models";
import { cn } from "@/shared/lib/cn";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { Button } from "@/shared/ui/primitives";
import type { RefObject } from "react";
import type { LiveOntology, OntologyWorkspaceState } from "./types";

export function WorkspaceToolbar({
  slug,
  ont,
  state,
  count,
  expandButtonRef,
}: {
  slug: string;
  ont: LiveOntology;
  state: OntologyWorkspaceState;
  count: (t: ElementType) => number;
  expandButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const { view, expanded, operation, app_knowledge } = state;
  return (
    <div className="shrink-0 border-b border-line px-5 py-4 lg:px-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight">
            {view === "map"
              ? expanded
                ? `Mapa · ${ont.nodes.find((n) => typeOf(n) === "company")?.label ?? slug}`
                : "Mapa da empresa"
              : view === "elements"
                ? "Elementos da empresa"
                : "Conexões da empresa"}
          </h2>
          <p
            className={cn(
              "mt-1.5 text-[12px] leading-relaxed text-muted",
              expanded && "hidden sm:block",
            )}
          >
            {count("area")} áreas <span className="mx-1.5">·</span>
            {count("person")} pessoas <span className="mx-1.5">·</span>
            {ont.nodes.length} elementos · {ont.edges.length} conexões
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            ref={expandButtonRef}
            type="button"
            aria-pressed={expanded}
            onClick={() => state.setExpanded(!expanded)}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[12px] hover:bg-soft"
          >
            {expanded ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
            {expanded ? "Voltar à página" : "Página inteira"}
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => state.setConnection({})}
          >
            <Link2 className="h-3.5 w-3.5" />
            <span className={expanded ? "sr-only sm:not-sr-only" : undefined}>
              Conectar
            </span>
          </Button>
          <Button size="sm" onClick={() => state.setEditing({ node: null })}>
            <Plus className="h-3.5 w-3.5" />
            <span className={expanded ? "sr-only sm:not-sr-only" : undefined}>
              Novo elemento
            </span>
          </Button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Visualização"
          value={view}
          onChange={(next) => {
            state.setView(next);
            state.setConnecting(false);
            state.setConnectionFrom(null);
            state.clearFilters();
            state.setSelected(null);
          }}
          options={[
            {
              value: "map",
              label: "Mapa",
              icon: <Network className="hidden h-3.5 w-3.5 sm:block" />,
            },
            {
              value: "elements",
              label: "Elementos",
              icon: <List className="hidden h-3.5 w-3.5 sm:block" />,
            },
            {
              value: "connections",
              label: "Conexões",
              icon: <Link2 className="hidden h-3.5 w-3.5 sm:block" />,
            },
          ]}
        />
        <div className="flex items-center gap-1">
          <button
            className="map-control"
            aria-label="Desfazer alteração"
            title="Desfazer · ⌘Z"
            disabled={state.undoDisabled}
            onClick={state.undo}
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            className="map-control"
            aria-label="Refazer alteração"
            title="Refazer · ⇧⌘Z"
            disabled={state.redoDisabled}
            onClick={state.redo}
          >
            <Redo2 className="h-4 w-4" />
          </button>
          <span className="mx-2 h-4 border-l border-line" />
          <button
            aria-label="Exportar ontologia"
            title="Exportar JSON"
            className="map-control"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob(
                  [
                    JSON.stringify(
                      {
                        version: 2,
                        exportedAt: new Date().toISOString(),
                        ...ont,
                      },
                      null,
                      2,
                    ),
                  ],
                  { type: "application/json" },
                ),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = `${slug}-ontologia.json`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              state.setNotice("Ontologia exportada.");
            }}
          >
            <Download className="h-4 w-4" />
          </button>
          <span className="ml-2 hidden items-center gap-1.5 text-[10px] text-muted sm:flex">
            <Check className="h-3 w-3 text-blue" />
            {operation.busy
              ? "Salvando…"
              : operation.pending
              ? "Alteração não confirmada"
              : operation.remote
                ? "Salvo no servidor"
                : app_knowledge.storageError
                  ? "Salvo apenas nesta sessão"
                  : "Salvo neste navegador"}
          </span>
        </div>
      </div>
    </div>
  );
}
