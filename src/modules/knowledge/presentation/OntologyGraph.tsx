"use client";

import type { GraphEdge, GraphNode } from "@/modules/knowledge/domain/models";
import {
  ELEMENT_TYPES,
  relationName,
  typeMeta,
  typeOf,
} from "@/modules/knowledge/domain/ontology";
import {
  networkLayout,
  type NetworkPoint,
} from "@/modules/knowledge/domain/ontology-layout";
import { cn } from "@/shared/lib/cn";
import {
  Focus,
  Info,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { OntologyNodeSymbol, nodeShapes } from "./OntologyNodeSymbol";
import { GraphSettings } from "./ontology-graph/GraphSettings";
import { GraphControls } from "./ontology-graph/GraphControls";

type Camera = NetworkPoint & { scale: number };
/** Matizes de etiqueta do DS: legíveis sobre bg-surface no claro e no escuro. */
const COLORS = [
  "var(--ds-tag-blue-fg)",
  "var(--ds-tag-purple-fg)",
  "var(--ds-tag-green-fg)",
  "var(--ds-tag-orange-fg)",
  "var(--ds-tag-pink-fg)",
  "var(--ds-tag-yellow-fg)",
];
const pixel = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number) => Math.max(0.25, Math.min(3, n));
type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  connecting: boolean;
  connectionFrom: string | null;
  onSelect: (id: string) => void;
  onInspect: (id: string) => void;
  onConnect: (id: string) => void;
  onEdge: (edge: GraphEdge) => void;
  onMove: (id: string, point: NetworkPoint) => void;
  onFocus: (id: string) => void;
  onArrange: () => void;
  /** Search results: nodes outside this set are dimmed instead of removed. */
  highlightIds?: Set<string>;
};

export function OntologyGraph({
  nodes,
  edges,
  selectedId,
  connecting,
  connectionFrom,
  onSelect,
  onInspect,
  onConnect,
  onEdge,
  onMove,
  onFocus,
  onArrange,
  highlightIds,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 550 });
  const [storedCamera, setCamera] = useState<{
    key: string;
    value: Camera;
  } | null>(null);
  const [moving, setMoving] = useState<{
    id: string;
    point: NetworkPoint;
  } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [names, setNames] = useState(true);
  const [arrows, setArrows] = useState(false);
  const [spacing, setSpacing] = useState(110);
  const [colorBy, setColorBy] = useState("area");
  const drag = useRef<{
    id?: string;
    pointer: NetworkPoint;
    origin: NetworkPoint;
    camera: Camera;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const layout = useMemo(
    () => networkLayout(nodes, edges, spacing),
    [nodes, edges, spacing],
  );
  const areas = nodes.filter((n) => typeOf(n) === "area");
  const degrees = new Map(
    nodes.map((n) => [
      n.id,
      edges.filter((e) => e.from === n.id || e.to === n.id).length,
    ]),
  );
  const activeId = connectionFrom ?? hovered ?? selectedId;
  const neighbors = new Set(
    edges
      .filter((e) => e.from === activeId || e.to === activeId)
      .flatMap((e) => [e.from, e.to]),
  );
  if (activeId) neighbors.add(activeId);
  const cameraKey = `${nodes.map((n) => n.id).join("|")}-${size.width}-${size.height}-${spacing}`;
  const points = [...layout.positions.values()];
  const minX = Math.min(0, ...points.map((p) => p.x)) - 85;
  const minY = Math.min(0, ...points.map((p) => p.y)) - 50;
  const maxX = Math.max(0, ...points.map((p) => p.x)) + 85;
  const maxY = Math.max(0, ...points.map((p) => p.y)) + 65;
  const scale = Math.max(
    0.25,
    Math.min(
      1.35,
      (size.width - 50) / (maxX - minX),
      (size.height - 105) / (maxY - minY),
    ),
  );
  const fitted: Camera = {
    scale,
    x: (size.width - (maxX - minX) * scale) / 2 - minX * scale,
    y: (size.height - 105 - (maxY - minY) * scale) / 2 - minY * scale + 20,
  };
  const camera = storedCamera?.key === cameraKey ? storedCamera.value : fitted;
  const set = (value: Camera) => setCamera({ key: cameraKey, value });
  const position = (id: string) =>
    moving?.id === id ? moving.point : layout.positions.get(id)!;
  const screen = (id: string) => {
    const p = position(id);
    return {
      x: pixel(p.x * camera.scale + camera.x),
      y: pixel(p.y * camera.scale + camera.y),
    };
  };
  const radius = (node: GraphNode) =>
    pixel(
      Math.max(
        8,
        (typeOf(node) === "company"
          ? 17
          : typeOf(node) === "area"
            ? 14
            : 5 + Math.min(7, (degrees.get(node.id) ?? 0) * 0.7)) *
          Math.max(0.65, camera.scale),
      ),
    );
  const color = (node: GraphNode) => {
    if (colorBy === "type") return typeMeta(typeOf(node)).color;
    const area = areas.findIndex((a) => a.id === layout.groups.get(node.id));
    return area >= 0
      ? COLORS[area % COLORS.length]
      : typeOf(node) === "company"
        ? "var(--ds-ink-soft)"
        : "var(--ds-muted)";
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Plain scrolling keeps moving the page; zoom needs a modifier so the map
    // never traps the wheel.
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const b = el.getBoundingClientRect(),
        x = e.clientX - b.left,
        y = e.clientY - b.top;
      const scale = clamp(camera.scale * (e.deltaY > 0 ? 0.93 : 1.07)),
        ratio = scale / camera.scale;
      setCamera({
        key: cameraKey,
        value: {
          scale,
          x: x - (x - camera.x) * ratio,
          y: y - (y - camera.y) * ratio,
        },
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [camera, cameraKey]);

  function zoom(factor: number) {
    const scale = clamp(camera.scale * factor),
      ratio = scale / camera.scale;
    set({
      scale,
      x: size.width / 2 - (size.width / 2 - camera.x) * ratio,
      y: size.height / 2 - (size.height / 2 - camera.y) * ratio,
    });
  }
  function start(e: PointerEvent<HTMLElement>, id?: string) {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    suppressClick.current = false;
    drag.current = {
      id,
      pointer: { x: e.clientX, y: e.clientY },
      origin: id ? position(id) : camera,
      camera,
      moved: false,
    };
  }

  // Place labels in screen space: names stay legible at any zoom without colliding.
  const occupied: { x: number; y: number; w: number; h: number }[] = nodes.map(
    (n) => {
      const p = screen(n.id),
        r = radius(n) + 6;
      return { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 };
    },
  );
  const labels = new Map<string, { x: number; y: number; w: number }>();
  const ordered = [...nodes].sort(
    (a, b) =>
      Number(b.id === activeId) - Number(a.id === activeId) ||
      Number(["company", "area"].includes(typeOf(b))) -
        Number(["company", "area"].includes(typeOf(a))) ||
      (degrees.get(b.id) ?? 0) - (degrees.get(a.id) ?? 0),
  );
  for (const node of ordered) {
    if (!names && node.id !== activeId) continue;
    if (
      size.width < 600 &&
      camera.scale < 0.7 &&
      !["company", "area"].includes(typeOf(node)) &&
      node.id !== activeId
    )
      continue;
    const p = screen(node.id),
      r = radius(node),
      w = Math.min(158, Math.max(55, node.label.length * 5.7 + 12)),
      h = node.label.length > 25 ? 30 : 16;
    const candidates = [16, 28, 44, 60].flatMap((gap) => [
      { x: p.x - w / 2, y: p.y + r + gap },
      { x: p.x - w / 2, y: p.y - r - h - gap },
      { x: p.x + r + gap, y: p.y - h / 2 },
      { x: p.x - r - w - gap, y: p.y - h / 2 },
    ]);
    const chosen = candidates.find(
      (b) =>
        b.x >= 10 &&
        b.x + w <= size.width - 10 &&
        b.y >= 40 &&
        b.y + h < size.height - 75 &&
        !occupied.some(
          (a) =>
            b.x < a.x + a.w + 4 &&
            b.x + w + 4 > a.x &&
            b.y < a.y + a.h + 3 &&
            b.y + h + 3 > a.y,
        ),
    );
    if (chosen) {
      labels.set(node.id, { ...chosen, w });
      occupied.push({ ...chosen, w, h });
    }
  }
  const visibleTypes = ELEMENT_TYPES.filter((type) =>
    nodes.some((node) => typeOf(node) === type.id),
  );
  const typeLegend = (
    <div
      className="flex flex-wrap gap-x-3 gap-y-2"
      aria-label="Formas por tipo de elemento"
    >
      {visibleTypes.map((type) => (
        <span
          key={type.id}
          title={`${type.label}: ${nodeShapes[type.id].name.toLowerCase()}`}
          className="inline-flex items-center gap-1.5 text-[10px] text-muted"
        >
          <OntologyNodeSymbol
            type={type.id}
            size={16}
            color={colorBy === "type" ? type.color : "var(--ds-muted)"}
          />
          {type.label}
        </span>
      ))}
    </div>
  );
  const active = nodes.find((n) => n.id === activeId);

  return (
    <div
      className="relative h-full min-h-0 overflow-hidden bg-surface"
      data-ontology-map
    >
      <div
        ref={ref}
        role="region"
        tabIndex={0}
        aria-label="Rede da ontologia. Arraste os nós para organizar, ou o fundo para navegar."
        className={cn(
          "absolute inset-0 touch-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
          connecting
            ? "cursor-crosshair"
            : "cursor-grab active:cursor-grabbing",
        )}
        onPointerDown={(e) => start(e)}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.pointer.x,
            dy = e.clientY - d.pointer.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
          if (d.id && !connecting)
            setMoving({
              id: d.id,
              point: {
                x: d.origin.x + dx / d.camera.scale,
                y: d.origin.y + dy / d.camera.scale,
              },
            });
          else if (!d.id)
            set({ ...d.camera, x: d.origin.x + dx, y: d.origin.y + dy });
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (d?.id && d.moved && !connecting)
            onMove(d.id, {
              x: d.origin.x + (e.clientX - d.pointer.x) / d.camera.scale,
              y: d.origin.y + (e.clientY - d.pointer.y) / d.camera.scale,
            });
          suppressClick.current = Boolean(d?.moved);
          drag.current = null;
          setMoving(null);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setMoving(null);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (["+", "=", "-", "0"].includes(e.key)) e.preventDefault();
          if (e.key === "+" || e.key === "=") zoom(1.2);
          if (e.key === "-") zoom(1 / 1.2);
          if (e.key === "0") set(fitted);
        }}
      >
        <svg
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-label="Conexões entre os elementos"
        >
          <defs>
            <marker
              id="network-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto"
            >
              <path d="M0 0 L10 5 L0 10z" fill="var(--ds-line-strong)" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const a = screen(edge.from),
              b = screen(edge.to);
            const to = nodes.find((n) => n.id === edge.to)!;
            const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
            const end = {
              x: pixel(b.x - ((b.x - a.x) / distance) * (radius(to) + 2)),
              y: pixel(b.y - ((b.y - a.y) / distance) * (radius(to) + 2)),
            };
            const highlighted =
              edge.from === activeId ||
              edge.to === activeId ||
              hoveredEdge === edge.id;
            const outsideSearch =
              highlightIds &&
              !highlightIds.has(edge.from) &&
              !highlightIds.has(edge.to);
            return (
              <g key={edge.id}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={highlighted ? "var(--ds-muted)" : "var(--ds-line-strong)"}
                  strokeWidth={highlighted ? 1.5 : 0.8}
                  opacity={
                    outsideSearch
                      ? 0.1
                      : activeId && !highlighted
                        ? 0.16
                        : highlighted
                          ? 0.9
                          : 0.55
                  }
                  markerEnd={arrows ? "url(#network-arrow)" : undefined}
                />
                <line
                  role="button"
                  tabIndex={0}
                  aria-label={`Editar conexão: ${nodes.find((n) => n.id === edge.from)?.label} ${relationName(edge.label)} ${to.label}`}
                  x1={a.x}
                  y1={a.y}
                  x2={end.x}
                  y2={end.y}
                  stroke="transparent"
                  strokeWidth="12"
                  className="cursor-pointer focus:stroke-accent/20"
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseEnter={() => setHoveredEdge(edge.id)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  onClick={() => onEdge(edge)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onEdge(edge);
                    }
                  }}
                />
                {hoveredEdge === edge.id && (
                  <g className="pointer-events-none">
                    <rect
                      x={(a.x + b.x) / 2 - 64}
                      y={(a.y + b.y) / 2 - 12}
                      width="128"
                      height="24"
                      rx="6"
                      fill="var(--ds-popover)"
                      stroke="var(--ds-line)"
                    />
                    <text
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 + 4}
                      textAnchor="middle"
                      fontSize="11"
                      fill="var(--ds-ink-soft)"
                    >
                      {relationName(edge.label).slice(0, 24)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
        {nodes.map((node) => {
          const p = screen(node.id),
            r = radius(node),
            c = color(node);
          const focused = node.id === activeId;
          const dim =
            (activeId && !neighbors.has(node.id)) ||
            (highlightIds && !highlightIds.has(node.id));
          const label = labels.get(node.id);
          return (
            <div key={node.id} data-node-id={node.id}>
              <button
                type="button"
                aria-label={`Selecionar ${node.label}`}
                aria-pressed={selectedId === node.id}
                title={`${node.label} · ${typeMeta(typeOf(node)).label} · ${nodeShapes[typeOf(node)].name} · ${degrees.get(node.id)} conexões`}
                className="absolute z-[2] flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:cursor-grabbing"
                style={{ left: p.x, top: p.y, opacity: dim ? 0.24 : 1 }}
                onMouseEnter={() => {
                  if (!drag.current) setHovered(node.id);
                }}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(node.id)}
                onBlur={() => setHovered(null)}
                onPointerDown={(e) => start(e, node.id)}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  if (connecting) onConnect(node.id);
                  else onSelect(node.id);
                }}
                onKeyDown={(e) => {
                  if (e.key.startsWith("Arrow")) {
                    e.preventDefault();
                    e.stopPropagation();
                    const p = position(node.id);
                    onMove(node.id, {
                      x:
                        p.x +
                        (e.key === "ArrowRight"
                          ? 15
                          : e.key === "ArrowLeft"
                            ? -15
                            : 0),
                      y:
                        p.y +
                        (e.key === "ArrowDown"
                          ? 15
                          : e.key === "ArrowUp"
                            ? -15
                            : 0),
                    });
                  }
                }}
              >
                <OntologyNodeSymbol
                  type={typeOf(node)}
                  size={pixel(r * 2)}
                  color={c}
                  highlighted={focused}
                />
              </button>
              {label && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() =>
                    connecting ? onConnect(node.id) : onSelect(node.id)
                  }
                  className={cn(
                    "absolute z-[3] line-clamp-2 text-center text-[11px] leading-[15px]",
                    focused || typeOf(node) === "company"
                      ? "font-medium text-ink"
                      : "text-ink-soft",
                  )}
                  style={{
                    left: pixel(label.x),
                    top: pixel(label.y),
                    width: pixel(label.w),
                    opacity: dim ? 0.3 : 1,
                  }}
                  tabIndex={-1}
                >
                  {node.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none absolute left-5 top-4 right-16 flex items-center gap-2 text-[11px] text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-accent/60" />
        {nodes.length} elementos<span className="text-line-strong">/</span>
        {edges.length} conexões
      </div>
      <button
        className={cn(
          "absolute right-4 top-3 flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-muted shadow-sm hover:text-ink",
          settings && "text-blue",
        )}
        aria-label="Ajustes do grafo"
        aria-expanded={settings}
        onClick={() => setSettings(!settings)}
      >
        <SlidersHorizontal className="h-4 w-4" />
      </button>
      {settings && (
        <GraphSettings
          names={names}
          setNames={setNames}
          arrows={arrows}
          setArrows={setArrows}
          colorBy={colorBy}
          setColorBy={setColorBy}
          spacing={spacing}
          setSpacing={setSpacing}
          typeLegend={typeLegend}
          onClose={() => setSettings(false)}
        />
      )}
      {active && !settings && (
        <div className="absolute bottom-16 sm:bottom-28 left-1/2 z-10 flex max-w-[calc(100%-32px)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm">
          <span className="max-w-[130px] truncate text-[11px] text-muted">
            {active.label}
          </span>
          <button
            aria-label={`Ver detalhes de ${active.label}`}
            onClick={() => onInspect(active.id)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-ink hover:bg-soft"
          >
            <Info className="h-3.5 w-3.5" />
            Ver detalhes
          </button>
          <button
            aria-label={`Conectar ${active.label}`}
            onClick={() => onConnect(active.id)}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-blue hover:bg-soft"
          >
            <Plus className="h-3 w-3" />
            Conectar
          </button>
          {typeOf(active) === "area" && (
            <button
              aria-label={`Explorar ${active.label}`}
              onClick={() => onFocus(active.id)}
              className="map-control"
            >
              <Focus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      <GraphControls
        typeLegend={typeLegend}
        colorBy={colorBy}
        areas={areas}
        colors={COLORS}
        scalePercent={Math.round(camera.scale * 100)}
        onArrange={() => {
          onArrange();
          setCamera(null);
        }}
        onZoom={zoom}
        onFit={() => set(fitted)}
      />
    </div>
  );
}
