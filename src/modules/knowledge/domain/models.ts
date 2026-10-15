export type NodeKind = "class" | "instance";

export type ElementType =
  | "company"
  | "area"
  | "person"
  | "object"
  | "process"
  | "system"
  | "rule"
  | "metric"
  | "action";

export type GraphNode = {
  elementType?: ElementType;
  coverageAssessed?: boolean;
  ownerId?: string;
  state?: string;
  source?: string;
  identity?: string;
  policy?: string;
  permission?: string;
  position?: { x: number; y: number };
  networkPosition?: { x: number; y: number };
  id: string;
  label: string;
  kind: NodeKind;
  domain: string;
  x: number;
  y: number;
  coverage: number;
  description: string;
  properties: string[];
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  description?: string;
  cardinality?: "one-one" | "one-many" | "many-many";
};

export type Ontology = {
  company: string;
  domains: { id: string; label: string; color: string }[];
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type OntologyDraft = {
  extraNodes: GraphNode[];
  extraEdges: GraphEdge[];
  extraDomains: Ontology["domains"];
  nodePatches: Record<string, Partial<GraphNode>>;
  edgePatches?: Record<string, Partial<GraphEdge>>;
  removedNodes: string[];
  removedEdges: string[];
};
