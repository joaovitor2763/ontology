import type { ElementType } from "../domain/models";

// Shared by the graph and its legend; shape always represents type, even when colors represent areas.
export const nodeShapes: Record<ElementType, { name: string; path: string }> = {
  company: { name: "Hexágono", path: "M-8-14H8L16 0 8 14H-8L-16 0Z" },
  area: {
    name: "Quadrado arredondado",
    path: "M-8-12H8Q12-12 12-8V8Q12 12 8 12H-8Q-12 12-12 8V-8Q-12-12-8-12Z",
  },
  person: { name: "Círculo", path: "M16 0A16 16 0 1 1-16 0A16 16 0 1 1 16 0Z" },
  object: { name: "Losango", path: "M0-16 16 0 0 16-16 0Z" },
  process: { name: "Cápsula", path: "M-7-9H7A9 9 0 0 1 7 9H-7A9 9 0 0 1-7-9Z" },
  system: { name: "Retângulo", path: "M-14-10H14V10H-14Z" },
  rule: { name: "Escudo", path: "M0-16 13-11V0Q13 9 0 16Q-13 9-13 0V-11Z" },
  metric: { name: "Triângulo", path: "M0-16 14 10H-14Z" },
  action: { name: "Seta", path: "M-13-10H3L16 0 3 10H-13L-6 0Z" },
};

export function OntologyNodeSymbol({
  type,
  size = 18,
  color = "currentColor",
  highlighted = false,
}: {
  type: ElementType;
  size?: number;
  color?: string;
  highlighted?: boolean;
}) {
  const shape = nodeShapes[type];
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="-18 -18 36 36"
      className="pointer-events-none shrink-0 overflow-visible"
      data-node-shape={type}
    >
      {highlighted && (
        <path
          d={shape.path}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinejoin="round"
          opacity="0.18"
        />
      )}
      <path
        d={shape.path}
        fill={color}
        stroke="var(--ds-surface)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {type === "system" && (
        <path
          d="M-9 5H9"
          fill="none"
          stroke="var(--ds-surface)"
          strokeWidth="1.5"
          opacity="0.8"
        />
      )}
    </svg>
  );
}
