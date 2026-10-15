"use client";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Select } from "@/shared/ui/Select";
import { Switch } from "@g4ai/ds";

/** Ajustes da visualização do mapa: nomes, setas, cores e distância entre nós. */
export function GraphSettings({
  names,
  setNames,
  arrows,
  setArrows,
  colorBy,
  setColorBy,
  spacing,
  setSpacing,
  typeLegend,
  onClose,
}: {
  names: boolean;
  setNames: (value: boolean) => void;
  arrows: boolean;
  setArrows: (value: boolean) => void;
  colorBy: string;
  setColorBy: (value: string) => void;
  spacing: number;
  setSpacing: (value: number) => void;
  typeLegend: ReactNode;
  onClose: () => void;
}) {
  return (
  <div className="absolute right-4 top-14 z-20 max-h-[calc(100%-140px)] w-[250px] max-w-[calc(100%-32px)] overflow-y-auto rounded-2xl border border-line bg-popover p-5 shadow-lg shadow-black/5">
    <div className="mb-4 flex items-center justify-between">
      <h3 className="text-[13px] font-medium">Visualização</h3>
      <button
        aria-label="Fechar ajustes"
        onClick={onClose}
      >
        <X className="h-3.5 w-3.5 text-muted" />
      </button>
    </div>
    <Switch className="mb-4" label="Exibir nomes" checked={names} onCheckedChange={setNames} />
    <Switch className="mb-4" label="Setas nas conexões" checked={arrows} onCheckedChange={setArrows} />
    <div className="mb-4 text-[12px]">
      Cores por
      <div className="mt-2">
        <Select
          label="Cores por"
          size="compact"
          className="w-full"
          value={colorBy}
          onValueChange={setColorBy}
          options={[
            { value: "area", label: "Área do negócio" },
            { value: "type", label: "Tipo de elemento" },
          ]}
        />
      </div>
    </div>
    <label className="block text-[12px]">
      Distância entre nós
      <input
        aria-label="Distância entre nós"
        type="range"
        min="70"
        max="170"
        value={spacing}
        onChange={(e) => setSpacing(Number(e.target.value))}
        className="mt-3 w-full accent-accent"
      />
    </label>
    <p className="mt-3 text-[11px] leading-relaxed text-muted">
      As formas identificam os tipos de elemento, independentemente das
      cores. O tamanho destaca a estrutura e o número de conexões.
    </p>
    <div className="mt-4 border-t border-line pt-3">{typeLegend}</div>
        </div>
  );
}
