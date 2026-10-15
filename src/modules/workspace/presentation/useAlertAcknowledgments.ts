"use client";
import { useSyncExternalStore } from "react";
import {
  getAlertAcknowledgments,
  subscribeAlertAcknowledgments,
} from "@/shared/infrastructure/persistence";

/** Muda a cada ciência confirmada nesta aba: entra no `refreshOn` de quem relê a fila do servidor. */
export function useAlertAcknowledgments() {
  return useSyncExternalStore(subscribeAlertAcknowledgments, getAlertAcknowledgments, () => 0);
}
