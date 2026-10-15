import type {
  GraphEdge,
  GraphNode,
  OntologyDraft,
} from "@/modules/knowledge/domain/models";
import {
  emptyOntologyDraft,
  mergeOntology,
  ontologyFor,
} from "@/modules/knowledge/infrastructure/queries";
import { migrateLegacy } from "@/shared/infrastructure/migration";
import { useLocalStorageState } from "@/shared/infrastructure/useLocalStorageState";
import { type SetStateAction } from "react";
export type StoredState = { ontologyDrafts: Record<string, OntologyDraft> };
const INITIAL: StoredState = { ontologyDrafts: {} };
const migrate = () => migrateLegacy(INITIAL, ["ontology.praxis.v1"]);
type API = {
  storageError: string | null;
  ontologyDrafts: Record<string, OntologyDraft>;
  patchOntologyNode: (
    slug: string,
    id: string,
    patch: Partial<GraphNode>,
  ) => void;
  addOntologyNode: (slug: string, node: GraphNode) => void;
  saveOntologyElement: (
    slug: string,
    node: GraphNode,
    edge?: GraphEdge,
  ) => void;
  patchOntologyEdge: (
    slug: string,
    id: string,
    patch: Partial<GraphEdge>,
  ) => void;
  restoreOntologyDraft: (slug: string, draft: OntologyDraft) => void;
  removeOntologyNode: (slug: string, id: string) => void;
  addOntologyEdge: (slug: string, edge: GraphEdge) => void;
  removeOntologyEdge: (slug: string, id: string) => void;
  addOntologyDomain: (
    slug: string,
    domain: { id: string; label: string; color: string },
  ) => void;
};
export function useKnowledgeState(): API {
  const [stored, setStored, storageError] = useLocalStorageState(
    "ontology.knowledge.v2",
    INITIAL,
    migrate,
  );
  const { ontologyDrafts } = stored;
  function field<K extends keyof StoredState>(key: K) {
    return (action: SetStateAction<StoredState[K]>) =>
      setStored((previous) => ({
        ...previous,
        [key]:
          typeof action === "function"
            ? (action as (value: StoredState[K]) => StoredState[K])(
                previous[key],
              )
            : action,
      }));
  }
  const setOntologyDrafts = field("ontologyDrafts");
  const value: API = {
    storageError,
    ontologyDrafts,
    restoreOntologyDraft: (slug, draft) =>
      setOntologyDrafts((m) => ({ ...m, [slug]: draft })),
    patchOntologyEdge: (slug, id, patch) =>
      setOntologyDrafts((m) => {
        const d = m[slug] ?? emptyOntologyDraft();
        return {
          ...m,
          [slug]: {
            ...d,
            edgePatches: {
              ...d.edgePatches,
              [id]: { ...d.edgePatches?.[id], ...patch },
            },
          },
        };
      }),
    saveOntologyElement: (slug, node, edge) =>
      setOntologyDrafts((m) => {
        const d = m[slug] ?? emptyOntologyDraft();
        const exists = ontologyFor(slug)?.nodes.some((n) => n.id === node.id);
        return {
          ...m,
          [slug]: {
            ...d,
            extraNodes: exists
              ? d.extraNodes
              : [...d.extraNodes.filter((n) => n.id !== node.id), node],
            nodePatches: { ...d.nodePatches, [node.id]: node },
            extraEdges: edge ? [...d.extraEdges, edge] : d.extraEdges,
          },
        };
      }),
    patchOntologyNode: (slug, id, patch) =>
      setOntologyDrafts((m) => {
        const d = m[slug] ?? emptyOntologyDraft();
        const extra = d.extraNodes.map((n) =>
          n.id === id ? { ...n, ...patch } : n,
        );
        return {
          ...m,
          [slug]: {
            ...d,
            extraNodes: extra,
            nodePatches: {
              ...d.nodePatches,
              [id]: { ...d.nodePatches[id], ...patch },
            },
          },
        };
      }),
    addOntologyNode: (slug, node) =>
      setOntologyDrafts((m) => {
        const d = m[slug] ?? emptyOntologyDraft();
        return {
          ...m,
          [slug]: {
            ...d,
            extraNodes: [node, ...d.extraNodes.filter((n) => n.id !== node.id)],
          },
        };
      }),
    removeOntologyNode: (slug, id) =>
      setOntologyDrafts((m) => {
        const d = m[slug] ?? emptyOntologyDraft();
        const nodePatches = { ...d.nodePatches };
        for (const node of mergeOntology(ontologyFor(slug), d)?.nodes ?? []) {
          if (node.ownerId === id)
            nodePatches[node.id] = { ...nodePatches[node.id], ownerId: "" };
        }
        return {
          ...m,
          [slug]: {
            ...d,
            nodePatches,
            extraNodes: d.extraNodes
              .filter((n) => n.id !== id)
              .map((n) => (n.ownerId === id ? { ...n, ownerId: "" } : n)),
            removedNodes: d.removedNodes.includes(id)
              ? d.removedNodes
              : [...d.removedNodes, id],
            extraEdges: d.extraEdges.filter(
              (e) => e.from !== id && e.to !== id,
            ),
          },
        };
      }),
    addOntologyEdge: (slug, edge) =>
      setOntologyDrafts((m) => {
        const d = m[slug] ?? emptyOntologyDraft();
        return {
          ...m,
          [slug]: {
            ...d,
            extraEdges: [edge, ...d.extraEdges.filter((e) => e.id !== edge.id)],
          },
        };
      }),
    removeOntologyEdge: (slug, id) =>
      setOntologyDrafts((m) => {
        const d = m[slug] ?? emptyOntologyDraft();
        return {
          ...m,
          [slug]: {
            ...d,
            extraEdges: d.extraEdges.filter((e) => e.id !== id),
            removedEdges: d.removedEdges.includes(id)
              ? d.removedEdges
              : [...d.removedEdges, id],
          },
        };
      }),
    addOntologyDomain: (slug, domain) =>
      setOntologyDrafts((m) => {
        const d = m[slug] ?? emptyOntologyDraft();
        if (d.extraDomains.some((x) => x.id === domain.id)) return m;
        return {
          ...m,
          [slug]: { ...d, extraDomains: [...d.extraDomains, domain] },
        };
      }),
  };
  return value;
}
export function useLiveOntology(slug: string) {
  const { ontologyDrafts } = useKnowledgeState();
  return mergeOntology(ontologyFor(slug), ontologyDrafts[slug]);
}
