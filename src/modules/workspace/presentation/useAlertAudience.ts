"use client";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useMemo } from "react";
import { usePermissions } from "./usePermissions";

/**
 * Os clientes que entram na fila global de alertas de quem está usando a tela
 * (`null` = todos). É o recorte que o servidor aplica em `/api/alerts` e no
 * contador; no modo navegador a lista e o contador o aplicam aqui.
 */
export function useAlertAudience(): Set<string> | null {
  const { clients } = useClientsState();
  const { seesAllAlerts, isAllocated } = usePermissions();
  const key = seesAllAlerts ? "" : clients.filter((c) => isAllocated(c.slug)).map((c) => c.slug).join("\u0000");
  return useMemo(() => (seesAllAlerts ? null : new Set(key ? key.split("\u0000") : [])),
    [seesAllAlerts, key]);
}
