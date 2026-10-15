import type { GraphEdge, GraphNode } from "@/modules/knowledge/domain/models";
import { networkLayout } from "@/modules/knowledge/domain/ontology-layout";

/** Coordenadas do SVG com duas casas (não é texto exibido). */
const round2 = (n: number) => Math.round(n * 100) / 100;

export function OntologyPreview({
  nodes,
  edges,
  tint,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  tint: string;
}) {
  const { positions } = networkLayout(nodes, edges);
  const points = [...positions.values()];
  const minX = Math.min(0, ...points.map((p) => p.x));
  const minY = Math.min(0, ...points.map((p) => p.y));
  const width = Math.max(1, ...points.map((p) => p.x)) - minX;
  const height = Math.max(1, ...points.map((p) => p.y)) - minY;
  const scale = Math.min(280 / width, 110 / height);
  const point = (id: string) => {
    const p = positions.get(id)!;
    return {
      x: round2(160 + (p.x - minX - width / 2) * scale),
      y: round2(70 + (p.y - minY - height / 2) * scale),
    };
  };
  return (
    <svg viewBox="0 0 320 140" className="h-[110px] w-full" aria-hidden="true">
      {edges
        .filter((e) => positions.has(e.from) && positions.has(e.to))
        .map((edge) => {
          const a = point(edge.from),
            b = point(edge.to);
          return (
            <line
              key={edge.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--ds-line-strong)"
              strokeWidth=".8"
            />
          );
        })}
      {nodes.map((node) => {
        const p = point(node.id);
        return (
          <circle
            key={node.id}
            cx={p.x}
            cy={p.y}
            r={
              node.elementType === "company"
                ? 5
                : node.elementType === "area"
                  ? 3.8
                  : 2.2
            }
            fill={
              node.elementType === "company" || node.elementType === "area"
                ? tint
                : "var(--ds-muted)"
            }
            stroke="var(--ds-surface)"
            strokeWidth="1"
          />
        );
      })}
    </svg>
  );
}
