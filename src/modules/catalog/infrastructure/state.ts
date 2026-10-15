import {
  versionProduct,
  type ProductVersion,
} from "../domain/product-versions";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { migrateProductVersions } from "@/shared/infrastructure/migration";
import type { JourneyTemplate } from "@/modules/catalog/domain/models";
import type { Product } from "@/modules/catalog/domain/products";
import {
  publishSnapshot,
  type JourneyVersion,
} from "@/modules/catalog/domain/publication";
import { seedJourneys } from "@/modules/catalog/infrastructure/journey";
import { seedProducts } from "@/modules/catalog/infrastructure/products";
import {
  migrateLegacy,
} from "@/shared/infrastructure/migration";
import { useLocalStorageState } from "@/shared/infrastructure/useLocalStorageState";
import { notify } from "@/shared/ui/Feedback";
import { useMemo, type SetStateAction } from "react";
import { CATALOG_INITIAL as INITIAL, normalizeCatalogSnapshot, projectCatalog, type CatalogSnapshot as StoredState } from "./snapshot";
export type { CatalogSnapshot as StoredState } from "./snapshot";
const migrate = () =>
  migrateLegacy(INITIAL, ["ontology.praxis.v1", "ontology.services.v1"]);
type API = {
  productVersions: Record<string, ProductVersion[]>;
  products: Product[];
  saveProduct: (product: Product) => void;
  storageError: string | null;
  extraJourneys: JourneyTemplate[];
  journeyEdits: Record<string, JourneyTemplate>;
  removedJourneys: string[];
  journeyVersions: Record<string, JourneyVersion[]>;
  saveJourney: (j: JourneyTemplate) => void;
  removeJourney: (id: string) => void;
  /** Freezes the current head as a new version; returns its number. */
  publishJourney: (head: JourneyTemplate, by: string) => number;
};
export function useCatalogState(): API {
  const [rawStored, setStored, storageError] = useLocalStorageState(
    "ontology.catalog.v2",
    INITIAL,
    migrate,
  );
  const stored = useMemo(() => normalizeCatalogSnapshot(rawStored), [rawStored]);
  const { currentUserId } = useWorkspaceState();
  const { extraJourneys, journeyEdits, removedJourneys, journeyVersions } =
    stored;
  function field<K extends keyof StoredState>(key: K) {
    return (action: SetStateAction<StoredState[K]>) =>
      setStored((previous) => ({
        ...previous,
        [key]:
          typeof action === "function"
            ? (action as (value: StoredState[K]) => StoredState[K])(
                previous[key],
              )
            : action,
      }));
  }
  const setExtraJourneys = field("extraJourneys");
  const setJourneyEdits = field("journeyEdits");
  const setRemovedJourneys = field("removedJourneys");
  const value: API = {
    productVersions: stored.productVersions,
    products: projectCatalog(stored).products,
    saveProduct(product) {
      setStored((raw) => {
        const s = migrateProductVersions(raw);
        const previous =
          s.productEdits[product.id] ??
          s.extraProducts.find((p) => p.id === product.id) ??
          seedProducts.find((p) => p.id === product.id);
        const saved = versionProduct(
          previous,
          product,
          s.productVersions[product.id] ?? [],
          currentUserId,
          new Date().toISOString(),
        );
        return {
          ...s,
          productVersions: {
            ...s.productVersions,
            [product.id]: saved.versions,
          },
          ...(seedProducts.some((p) => p.id === product.id)
            ? {
                productEdits: {
                  ...s.productEdits,
                  [product.id]: saved.product,
                },
              }
            : {
                extraProducts: [
                  ...s.extraProducts.filter((p) => p.id !== product.id),
                  saved.product,
                ],
              }),
        };
      });
      notify(
        "Nova versão salva para novos clientes. Revise o impacto para atualizar os atuais.",
      );
    },
    storageError,
    extraJourneys,
    journeyEdits,
    removedJourneys,
    journeyVersions,
    saveJourney: (input) => {
      const now = new Date().toISOString();
      const j = {
        ...input,
        createdAt: input.createdAt ?? now,
        updatedAt: now,
        draftUpdatedAt: now,
      };
      const isSeed = seedJourneys.some((seed) => seed.id === j.id);
      if (isSeed) setJourneyEdits((e) => ({ ...e, [j.id]: j }));
      else {
        setExtraJourneys((xs) => {
          const i = xs.findIndex((x) => x.id === j.id);
          if (i >= 0) {
            const next = xs.slice();
            next[i] = j;
            return next;
          }
          return [...xs, j];
        });
      }
    },
    removeJourney: (id) => {
      if (id === "founding-companies") return;
      setRemovedJourneys((ids) => (ids.includes(id) ? ids : [...ids, id]));
      setExtraJourneys((xs) => xs.filter((j) => j.id !== id));
    },
    publishJourney: (head, by) => {
      const at = new Date().toISOString();
      const published = publishSnapshot(head, journeyVersions[head.id], by, at);
      const isSeed = seedJourneys.some((seed) => seed.id === head.id);
      setStored((s) => ({
        ...s,
        journeyVersions: {
          ...s.journeyVersions,
          [head.id]: [...(s.journeyVersions[head.id] ?? []), published.version],
        },
        ...(isSeed
          ? { journeyEdits: { ...s.journeyEdits, [head.id]: published.head } }
          : {
              extraJourneys: s.extraJourneys.some((j) => j.id === head.id)
                ? s.extraJourneys.map((j) =>
                    j.id === head.id ? published.head : j,
                  )
                : [...s.extraJourneys, published.head],
            }),
      }));
      notify(`Plano publicado como v${published.version.version}`);
      return published.version.version;
    },
  };
  return value;
}
