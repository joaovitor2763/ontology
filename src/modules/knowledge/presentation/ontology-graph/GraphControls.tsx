"use client";
import { Maximize, Minus, Plus, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import type { GraphNode } from "@/modules/knowledge/domain/models";

/** Legenda por área e os controles de zoom e de organização do mapa. */
export function GraphControls({
  typeLegend,
  colorBy,
  areas,
  colors,
  scalePercent,
  onArrange,
  onZoom,
  onFit,
}: {
  typeLegend: ReactNode;
  colorBy: string;
  areas: GraphNode[];
  colors: string[];
  scalePercent: number;
  onArrange: () => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
}) {
  return (
  <div className="pointer-events-none absolute bottom-4 left-5 right-4 flex items-end justify-between gap-3">
    <div className="hidden max-w-[60%] flex-col gap-2 rounded-lg bg-surface/95 p-1 sm:flex">
      {typeLegend}
      {colorBy === "area" && areas.length > 0 && (
        <div
          className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line/60 pt-2"
          aria-label="Cores por área"
        >
          {areas.map((area, i) => (
            <span
              key={area.id}
              className="inline-flex items-center gap-1.5 text-[10px] text-muted"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: colors[i % colors.length] }}
              />
              {area.label}
            </span>
          ))}
        </div>
      )}
    </div>
    <div className="pointer-events-auto ml-auto flex items-center rounded-xl border border-line bg-surface p-1 shadow-sm">
      <span className="hidden px-2 text-[10px] text-muted md:inline">
        ⌘/Ctrl + rolagem para zoom
      </span>
      <button
        aria-label="Organizar mapa"
        title="Reorganizar rede"
        onClick={onArrange}
        className="map-control"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
      <span className="mx-1 h-4 border-l border-line" />
      <button
        aria-label="Diminuir zoom"
        onClick={() => onZoom(1 / 1.2)}
        className="map-control"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-10 text-center text-[11px] text-muted">
        {scalePercent}%
      </span>
      <button
        aria-label="Aumentar zoom"
        onClick={() => onZoom(1.2)}
        className="map-control"
      >
        <Plus className="h-4 w-4" />
      </button>
      <button
        aria-label="Ajustar mapa à tela"
        onClick={onFit}
        className="map-control"
      >
        <Maximize className="h-4 w-4" />
      </button>
    </div>
  </div>
  );
}
