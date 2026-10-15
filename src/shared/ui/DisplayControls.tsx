"use client";

import { useLocalStorageState } from "@/shared/infrastructure/useLocalStorageState";
import type { CollectionView, Density } from "@g4ai/ds";

export { DensityControl, DisplayControls, type CollectionView, type Density } from "@g4ai/ds";

/**
 * Visualização e densidade por área. Fica no app (e não no `useCollectionDisplay`
 * do DS) para manter as chaves já gravadas (`ontology.display.*`) e a leitura
 * síncrona do `useLocalStorageState`, sem piscar a visão padrão ao montar.
 */
export function useCollectionDisplay(scope: string, initial: CollectionView = "list") {
  const [view, setView] = useLocalStorageState<CollectionView>(`ontology.display.${scope}.view`, initial);
  const [density, setDensity] = useLocalStorageState<Density>(`ontology.display.${scope}.density`, "comfortable");
  return { view, setView, density, setDensity };
}
