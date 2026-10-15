"use client";
import { Network, Plus } from "lucide-react";
import { Button } from "@/shared/ui/primitives";
import { NodeForm } from "../NodeForm";
import { KnowledgeOperationFeedback } from "../useKnowledgeOperation";
import type { LiveOntology } from "./types";
import type { OntologyWorkspaceState } from "./types";

export function EmptyOntology({
  slug,
  ont,
  state,
}: {
  slug: string;
  ont: LiveOntology;
  state: OntologyWorkspaceState;
}) {
  const { operation, app_knowledge, editing, setEditing, can } = state;
  return (
    <section className="mx-auto max-w-2xl py-12">
      {!editing && <KnowledgeOperationFeedback operation={operation} />}
      <div className="mb-3 flex gap-2">
        <Button
          variant="ghost"
          disabled={state.undoDisabled}
          onClick={state.undo}
        >
          Desfazer alteração
        </Button>
        <Button
          variant="ghost"
          disabled={state.redoDisabled}
          onClick={state.redo}
        >
          Refazer alteração
        </Button>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <Network className="mb-4 h-7 w-7 text-muted" aria-hidden />
        <h2 className="text-xl font-semibold">Comece o mapa da empresa</h2>
        <p className="mt-3 text-sm leading-6 text-muted">
          Ainda não há elementos nesta ontologia. Cadastre uma área, pessoa ou
          processo e depois conecte os elementos para mostrar como a empresa
          funciona.
        </p>
        {can("ontologia.editar", slug) ? (
          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={() => setEditing({ node: null, type: "area" })}>
              <Plus className="h-4 w-4" />
              Adicionar primeira área
            </Button>
            <Button
              variant="ghost"
              onClick={() => setEditing({ node: null, type: "person" })}
            >
              Adicionar pessoa
            </Button>
            <Button
              variant="ghost"
              onClick={() => setEditing({ node: null, type: "process" })}
            >
              Adicionar processo
            </Button>
          </div>
        ) : (
          <p className="mt-5 text-sm text-muted">
            Uma pessoa com permissão de edição pode começar o mapa deste
            cliente.
          </p>
        )}
        {app_knowledge.storageError && (
          <p role="alert" className="mt-4 text-sm text-rose">
            {app_knowledge.storageError}
          </p>
        )}
      </div>
      {editing && (
        <NodeForm
          pending={operation.pending}
          busy={operation.busy}
          feedback={<KnowledgeOperationFeedback operation={operation} />}
          key={editing.type}
          ontology={ont}
          node={null}
          initialType={editing.type}
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
                state.record("Elemento criado.", () =>
                  app_knowledge.saveOntologyElement(slug, node, edge),
                ),
              () => {
                setEditing(null);
                state.setSelected(node.id);
                state.setScope("all");
                state.setNotice("Elemento criado.");
              },
            );
          }}
        />
      )}
    </section>
  );
}
