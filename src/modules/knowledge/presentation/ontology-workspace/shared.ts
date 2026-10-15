import type {
  ElementType,
  GraphEdge,
  GraphNode,
  OntologyDraft,
} from "@/modules/knowledge/domain/models";

export const subscribeNoop = () => () => {};

export function readHistory(key: string): {
  past: OntologyDraft[];
  future: OntologyDraft[];
} {
  if (typeof sessionStorage === "undefined") return { past: [], future: [] };
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : { past: [], future: [] };
  } catch {
    return { past: [], future: [] };
  }
}

export const subscribeMobile = (callback: () => void) => {
  const media = window.matchMedia("(max-width: 1199px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
};
export const getMobile = () => window.matchMedia("(max-width: 1199px)").matches;

export type Edit = { node: GraphNode | null; type?: ElementType; from?: string };
export type Connection = { edge?: GraphEdge; from?: string; to?: string };
