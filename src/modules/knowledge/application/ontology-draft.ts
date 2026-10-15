// g4os-ds-disable-file hex-color -- cores de tipo/área da ontologia são DADO de domínio (ELEMENT_TYPES e Ontology.domains[].color, persistido no documento); o mapa as usa como identidade de categoria. Trocar por tokens exigiria migração do documento.
import type { Ontology, OntologyDraft } from "../domain/models.ts";

export function emptyOntology(company: string): Ontology {
  return {
    company,
    domains: [{ id: "organizacao", label: "Organização", color: "#64748b" }],
    nodes: [],
    edges: [],
  };
}

export function emptyOntologyDraft(): OntologyDraft {
  return {
    extraNodes: [],
    extraEdges: [],
    extraDomains: [],
    nodePatches: {},
    removedNodes: [],
    removedEdges: [],
  };
}

export function mergeOntology(
  ont: Ontology | undefined,
  draft?: OntologyDraft | null,
): Ontology | undefined {
  if (!ont) return undefined;
  if (!draft) return ont;
  const nodes = [...ont.nodes, ...draft.extraNodes]
    .filter((n) => !draft.removedNodes.includes(n.id))
    .map((n) =>
      draft.nodePatches[n.id] ? { ...n, ...draft.nodePatches[n.id] } : n,
    );
  const edges = [...ont.edges, ...draft.extraEdges]
    .map((e) => ({ ...e, ...draft.edgePatches?.[e.id] }))
    .filter(
      (e) =>
        !draft.removedEdges.includes(e.id) &&
        nodes.some((n) => n.id === e.from) &&
        nodes.some((n) => n.id === e.to),
    );
  const domains = [
    ...ont.domains.map(domain => draft.extraDomains.find(extra => extra.id === domain.id) ?? domain),
    ...draft.extraDomains.filter(
      (d) => !ont.domains.some((x) => x.id === d.id),
    ),
  ];
  return { ...ont, nodes, edges, domains };
}
