"use client";
import { useCatalogState } from "@/modules/catalog/infrastructure/state";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
/** Composes the catalog, purchased scope and execution for service screens. */
export function useServices() {
  const {
    products,
    saveProduct,
    storageError: catalogError,
  } = useCatalogState();
  const {
    configFor,
    saveConfig,
    storageError: clientError,
  } = useClientsState();
  const { cycles, saveCycle, companyJourney, storageError: deliveryError } = useDeliveryState();
  return {
    products,
    saveProduct,
    configFor,
    saveConfig,
    cycles,
    saveCycle,
    companyJourney,
    storageError: catalogError ?? clientError ?? deliveryError,
  };
}
