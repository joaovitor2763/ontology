"use client";
import { useRef } from "react";
import { Maximize2, X } from "lucide-react";
import type { ElementType } from "@/modules/knowledge/domain/models";
import { normalized, typeOf } from "@/modules/knowledge/domain/ontology";
import { ConnectionForm } from "@/modules/knowledge/presentation/ConnectionForm";
import { ElementDetails } from "@/modules/knowledge/presentation/ElementDetails";
import { NodeForm } from "@/modules/knowledge/presentation/NodeForm";
import { OntologyGraph } from "@/modules/knowledge/presentation/OntologyGraph";
import { cn } from "@/shared/lib/cn";
import { Drawer } from "@/shared/ui/Drawer";
import { Button, Empty } from "@/shared/ui/primitives";

import {
  KnowledgeOperationFeedback,
} from "./useKnowledgeOperation";
import { useOntologyWorkspace } from "./ontology-workspace/useOntologyWorkspace";
import { EmptyOntology } from "./ontology-workspace/EmptyOntology";
import { WorkspaceToolbar } from "./ontology-workspace/WorkspaceToolbar";
import { WorkspaceFilters } from "./ontology-workspace/WorkspaceFilters";
import { ElementsPanel } from "./ontology-workspace/ElementsPanel";

export function OntologyWorkspace({ slug }: { slug: string }) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const state = useOntologyWorkspace(slug, workspaceRef);
  const {
    ont,
    app_knowledge,
    operation,
    draft,
    view,
    scope,
    q,
    type,
    selectedId,
    setSelected,
    editing,
    setEditing,
    connection,
    setConnection,
    connecting,
    connectionFrom,
    deleting,
    setDeleting,
    notice,
    mobileInspector,
    detailOpen,
    setDetailOpen,
    expanded,
    setExpanded,
    record,
    undo,
    redo,
    clearFilters,
    setNotice,
    setScope,
    setConnecting,
    setConnectionFrom,
  } = state;

  if (!ont) return null;
  if (!ont.nodes.length)
    return <EmptyOntology slug={slug} ont={ont} state={state} />;

  const selected = ont.nodes.find((n) => n.id === selectedId) ?? null;
  const query = normalized(q);
  const typed = ont.nodes.filter((n) => !type || typeOf(n) === type);
  const filtered = typed.filter(
    (n) =>
      !query ||
      normalized(
        `${n.label} ${n.description} ${n.state ?? ""} ${n.source ?? ""} ${n.properties.join(" ")}`,
      ).includes(query),
  );
  const adjacentIds = new Set(
    ont.edges
      .filter((e) => e.from === scope || e.to === scope)
      .flatMap((e) => [e.from, e.to]),
  );
  // On the map, a search highlights matches and keeps the context around them.
  const mapNodes =
    query || type || scope === "all"
      ? typed
      : scope === "structure"
        ? typed.filter((n) => ["company", "area", "person"].includes(typeOf(n)))
        : typed.filter((n) => n.id === scope || adjacentIds.has(n.id));
  const visible = view === "map" ? mapNodes : filtered;
  const highlight =
    view === "map" && query ? new Set(filtered.map((n) => n.id)) : undefined;
  const ids = new Set(visible.map((n) => n.id));
  const edges = ont.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const filteredEdges = ont.edges.filter(
    (e) =>
      !query ||
      normalized(
        `${ont.nodes.find((n) => n.id === e.from)?.label} ${e.label} ${ont.nodes.find((n) => n.id === e.to)?.label}`,
      ).includes(query),
  );
  const count = (t: ElementType) =>
    ont.nodes.filter((n) => typeOf(n) === t).length;
  function beginConnect(id: string) {
    if (connectionFrom && connectionFrom !== id) {
      setConnection({ from: connectionFrom, to: id });
      setConnecting(false);
      setConnectionFrom(null);
    } else {
      setSelected(null);
      setConnecting(true);
      setConnectionFrom(id);
    }
  }
  const details = selected && (
    <ElementDetails
      node={selected}
      ontology={ont}
      onEdit={() => setEditing({ node: selected })}
      onConnect={() => setConnection({ from: selected.id })}
      onCreate={() => setEditing({ node: null, from: selected.id })}
      onSelect={setSelected}
      onEdge={(edge) => setConnection({ edge })}
      onDelete={() => setDeleting(selected)}
    />
  );

  return (
    <div
      ref={workspaceRef}
      data-expanded-workspace={expanded || undefined}
      role="region"
      tabIndex={-1}
      aria-label="Área de trabalho da ontologia"
      className={cn(
        "flex min-h-0 flex-col bg-surface",
        expanded ? "fixed inset-0 z-[60] h-dvh" : "h-full",
      )}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if (
          e.defaultPrevented ||
          editing ||
          connection ||
          deleting ||
          target.closest("input,textarea,select,dialog")
        )
          return;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        }
        if (e.key === "Escape") {
          if (!selectedId && !connecting && expanded) {
            setExpanded(false);
            expandButtonRef.current?.focus();
          }
          setConnecting(false);
          setConnectionFrom(null);
          setSelected(null);
        }
      }}
    >
      {!editing && !connection && !deleting && (
        <KnowledgeOperationFeedback operation={operation} />
      )}
      <WorkspaceToolbar
        slug={slug}
        ont={ont}
        state={state}
        count={count}
        expandButtonRef={expandButtonRef}
      />
      <WorkspaceFilters
        ont={ont}
        state={state}
        count={count}
        highlight={highlight}
        mapNodes={mapNodes}
        query={query}
      />
      {connecting && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line-strong bg-soft px-5 py-3 text-[12px]">
          <span>
            {connectionFrom ? (
              <>
                Conectando{" "}
                <strong>
                  {ont.nodes.find((n) => n.id === connectionFrom)?.label}
                </strong>
                . Selecione o destino no mapa.
              </>
            ) : (
              "Selecione o primeiro elemento no mapa."
            )}
          </span>
          <button
            onClick={() => {
              setConnecting(false);
              setConnectionFrom(null);
            }}
            className="shrink-0 text-blue"
          >
            Cancelar
          </button>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1">
          {view === "map" ? (
            visible.length ? (
              <OntologyGraph
                nodes={visible}
                edges={edges}
                selectedId={selectedId}
                connecting={connecting}
                connectionFrom={connectionFrom}
                onSelect={setSelected}
                onInspect={(id) => {
                  setSelected(id);
                  setDetailOpen(true);
                }}
                onConnect={beginConnect}
                onEdge={(edge) => setConnection({ edge })}
                onFocus={(id) => {
                  setScope(id);
                  setSelected(null);
                  clearFilters();
                }}
                onMove={(id, position) =>
                  !operation.pending &&
                  operation.run(
                    "knowledge.layout.update",
                    {
                      company: slug,
                      positions: [{ nodeId: id, networkPosition: position }],
                    },
                    () =>
                      app_knowledge.patchOntologyNode(slug, id, {
                        networkPosition: position,
                      }),
                    undefined,
                    "layout",
                  )
                }
                highlightIds={highlight}
                onArrange={() =>
                  operation.run(
                    "knowledge.layout.reset",
                    { company: slug, nodeIds: visible.map((n) => n.id) },
                    () =>
                      record("Mapa organizado.", () => {
                        const next = structuredClone(draft);
                        for (const n of visible)
                          next.nodePatches[n.id] = {
                            ...next.nodePatches[n.id],
                            position: undefined,
                            networkPosition: undefined,
                          };
                        next.extraNodes = next.extraNodes.map((n) =>
                          ids.has(n.id)
                            ? {
                                ...n,
                                position: undefined,
                                networkPosition: undefined,
                              }
                            : n,
                        );
                        app_knowledge.restoreOntologyDraft(slug, next);
                      }),
                    () => setNotice("Mapa organizado."),
                  )
                }
              />
            ) : (
              <div className="p-6">
                <Empty
                  title="Nenhum elemento encontrado"
                  hint="Tente outro nome ou tipo de elemento."
                />
                <Button className="mt-4" variant="ghost" onClick={clearFilters}>
                  Limpar filtros
                </Button>
                <Button
                  className="ml-2 mt-4"
                  onClick={() => setEditing({ node: null })}
                >
                  Criar elemento
                </Button>
              </div>
            )
          ) : (
            <ElementsPanel
              ont={ont}
              state={state}
              filtered={filtered}
              filteredEdges={filteredEdges}
            />
          )}
        </div>
        {selected && !mobileInspector && !detailOpen && (
          <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-line bg-surface p-5">
            <div className="mb-4 flex justify-between text-[11px] text-muted">
              <span>DETALHES DO ELEMENTO</span>
              <div className="flex items-center gap-3">
                <button
                  aria-label="Ampliar detalhes do elemento"
                  title="Ver ficha completa"
                  onClick={() => setDetailOpen(true)}
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
                <button
                  aria-label="Fechar detalhes"
                  onClick={() => setSelected(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {details}
          </aside>
        )}
        {notice && (
          <div
            role="status"
            className="absolute bottom-16 left-4 right-4 z-10 mx-auto max-w-sm rounded-xl border border-line-strong bg-surface px-4 py-3 text-center text-[12px] text-blue shadow-md"
          >
            {notice}
          </div>
        )}
      </div>
      {selected &&
        (mobileInspector || detailOpen) &&
        !editing &&
        !connection &&
        !deleting && (
          <Drawer
            open
            onClose={() => {
              setDetailOpen(false);
              if (mobileInspector) setSelected(null);
              requestAnimationFrame(() => workspaceRef.current?.focus());
            }}
            kicker="Detalhes do elemento"
            title={selected.label}
          >
            {details}
          </Drawer>
        )}
      {editing && (
        <NodeForm
          pending={operation.pending}
          busy={operation.busy}
          feedback={<KnowledgeOperationFeedback operation={operation} />}
          key={editing.node?.id ?? "new"}
          ontology={ont}
          node={editing.node}
          initialType={editing.type}
          connectFrom={editing.from}
          onClose={() => {
            if (!operation.busy) {
              operation.reset();
              setEditing(null);
            }
          }}
          onSave={(node, edge) => {
            operation.run(
              "knowledge.elements.save",
              { company: slug, node, ...(edge ? { edge } : {}) },
              () =>
                record("Elemento salvo.", () =>
                  app_knowledge.saveOntologyElement(slug, node, edge),
                ),
              () => {
                setEditing(null);
                setSelected(node.id);
                clearFilters();
                setScope(node.id);
                setNotice("Elemento salvo.");
              },
            );
          }}
        />
      )}
      {connection && (
        <ConnectionForm
          pending={operation.pending}
          busy={operation.busy}
          feedback={<KnowledgeOperationFeedback operation={operation} />}
          ontology={ont}
          edge={connection.edge}
          fromId={connection.from}
          toId={connection.to}
          onClose={() => {
            if (!operation.busy) {
              operation.reset();
              setConnection(null);
            }
          }}
          onSave={(edge) => {
            operation.run(
              "knowledge.connections.save",
              { company: slug, edge },
              () =>
                record("Conexão salva.", () =>
                  connection.edge
                    ? app_knowledge.patchOntologyEdge(slug, edge.id, edge)
                    : app_knowledge.addOntologyEdge(slug, edge),
                ),
              () => {
                setConnection(null);
                setNotice("Conexão salva.");
              },
            );
          }}
          onDelete={(edge) => {
            operation.run(
              "knowledge.connections.remove",
              { company: slug, edgeId: edge.id },
              () =>
                record("Conexão removida.", () =>
                  app_knowledge.removeOntologyEdge(slug, edge.id),
                ),
              () => {
                setConnection(null);
                setNotice("Conexão removida. Você pode desfazer.");
              },
            );
          }}
        />
      )}
      {deleting && (
        <Drawer
          open
          onClose={() => {
            if (!operation.busy) {
              operation.reset();
              setDeleting(null);
            }
          }}
          kicker="Remover do mapa"
          title={`Remover ${deleting.label}?`}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                disabled={operation.busy}
                onClick={() => {
                  operation.run(
                    "knowledge.elements.remove",
                    { company: slug, nodeId: deleting.id },
                    () =>
                      record("Elemento removido.", () =>
                        app_knowledge.removeOntologyNode(slug, deleting.id),
                      ),
                    () => {
                      setDeleting(null);
                      setScope("structure");
                      setSelected(null);
                      setNotice("Elemento removido. Você pode desfazer.");
                    },
                  );
                }}
              >
                {operation.busy ? "Removendo…" : "Remover elemento"}
              </Button>
            </div>
          }
        >
          <KnowledgeOperationFeedback operation={operation} />
          <p className="text-[14px] leading-relaxed text-muted">
            Este elemento e suas{" "}
            {
              ont.edges.filter(
                (e) => e.from === deleting.id || e.to === deleting.id,
              ).length
            }{" "}
            conexões serão removidos. Os demais elementos permanecem. Use
            Desfazer para recuperar esta alteração.
          </p>
        </Drawer>
      )}
    </div>
  );
}
