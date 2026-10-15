import type { GraphEdge, GraphNode } from "./models.ts";

export type NetworkPoint = { x: number; y: number };

/** Deterministic spring layout: only real entities and real relationships. */
export function networkLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  spacing = 110,
) {
  const areas = nodes.filter((n) => n.elementType === "area");
  const areaIds = new Set(areas.map((n) => n.id));
  const groups = new Map<string, string>();
  for (const node of nodes) {
    if (node.elementType === "company") {
      groups.set(node.id, "");
      continue;
    }
    const edge =
      edges.find((e) => e.to === node.id && areaIds.has(e.from)) ??
      edges.find((e) => e.from === node.id && areaIds.has(e.to));
    groups.set(
      node.id,
      areaIds.has(node.id)
        ? node.id
        : edge
          ? areaIds.has(edge.from)
            ? edge.from
            : edge.to
          : "",
    );
  }
  const centers = new Map(
    areas.map((n, i) => {
      const angle =
        -Math.PI / 2 + (i * Math.PI * 2) / Math.max(3, areas.length);
      return [
        n.id,
        {
          x: Math.cos(angle) * spacing * 1.8,
          y: Math.sin(angle) * spacing * 1.6,
        },
      ] as const;
    }),
  );
  const points = nodes.map((node, i) => {
    const anchor = centers.get(groups.get(node.id) ?? "") ?? { x: 0, y: 0 };
    const angle = i * 2.3999632297;
    const radius =
      node.elementType === "company"
        ? 0
        : node.elementType === "area"
          ? 8
          : spacing * (0.7 + (i % 4) * 0.16);
    return {
      id: node.id,
      x: node.networkPosition?.x ?? anchor.x + Math.cos(angle) * radius,
      y: node.networkPosition?.y ?? anchor.y + Math.sin(angle) * radius,
      anchor,
      fixed: Boolean(node.networkPosition),
      company: node.elementType === "company",
      area: node.elementType === "area",
    };
  });
  const index = new Map(points.map((p, i) => [p.id, i]));
  const links = edges.filter((e) => index.has(e.from) && index.has(e.to));
  const iterations = Math.max(
    45,
    Math.min(220, Math.floor(18000 / Math.max(1, nodes.length))),
  );
  for (let step = 0; step < iterations; step++) {
    const forces = points.map((p) => ({
      x: (p.anchor.x - p.x) * (p.company ? 0.04 : p.area ? 0.025 : 0.008),
      y: (p.anchor.y - p.y) * (p.company ? 0.04 : p.area ? 0.025 : 0.008),
    }));
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[i].x - points[j].x || 0.1;
        const dy = points[i].y - points[j].y || 0.1;
        const distance = Math.max(4, Math.hypot(dx, dy));
        const strength = (spacing * spacing * 1.6) / (distance * distance);
        const fx = (dx / distance) * strength,
          fy = (dy / distance) * strength;
        forces[i].x += fx;
        forces[i].y += fy;
        forces[j].x -= fx;
        forces[j].y -= fy;
      }
    for (const edge of links) {
      const i = index.get(edge.from)!,
        j = index.get(edge.to)!;
      const dx = points[j].x - points[i].x,
        dy = points[j].y - points[i].y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const strength = (distance - spacing) * 0.025;
      const fx = (dx / distance) * strength,
        fy = (dy / distance) * strength;
      forces[i].x += fx;
      forces[i].y += fy;
      forces[j].x -= fx;
      forces[j].y -= fy;
    }
    const cooling = 0.85 - (step / iterations) * 0.6;
    points.forEach((p, i) => {
      if (!p.fixed) {
        p.x += Math.max(-12, Math.min(12, forces[i].x)) * cooling;
        p.y += Math.max(-12, Math.min(12, forces[i].y)) * cooling;
      }
    });
  }
  return {
    // Normalize engine-specific floating point differences before SSR rendering.
    positions: new Map(
      points.map((p) => [
        p.id,
        {
          x: Math.round(p.x * 1000) / 1000,
          y: Math.round(p.y * 1000) / 1000,
        },
      ]),
    ),
    groups,
  };
}
