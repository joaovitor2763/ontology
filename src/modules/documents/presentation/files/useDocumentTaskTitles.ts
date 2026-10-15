"use client";

import { useDocumentsState } from "@/modules/documents/infrastructure/state";
import { documentsFor } from "@/modules/documents/infrastructure/queries";
import { loadDocumentTaskTitles } from "@/modules/documents/infrastructure/task-titles";
import { useEffect, useMemo, useRef, useState } from "react";

type Titles = { key: string; values: Record<string, string>; version: string; error: string };

/** Only the labels linked by documents travel to the global panel. */
export function useDocumentTaskTitles() {
  const { extraDocs, removedDocs, docEdits } = useDocumentsState();
  const key = useMemo(() => JSON.stringify([...new Set(documentsFor(undefined,
    extraDocs, removedDocs, docEdits).flatMap(doc => doc.relatedTaskId ? [doc.relatedTaskId] : []))].sort()),
  [extraDocs, removedDocs, docEdits]);
  const [result, setResult] = useState<Titles>({ key: "", values: {}, version: "", error: "" });
  const latest = useRef(result);
  useEffect(() => {
    const ids = JSON.parse(key) as string[];
    if (!ids.length) return;
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const previous = latest.current.key === key && latest.current.version
          ? latest.current : undefined;
        const loaded = await loadDocumentTaskTitles(ids, { signal: controller.signal,
          ...(previous ? { previous } : {}) });
        if (!controller.signal.aborted) {
          const next = { key, values: loaded.values, version: loaded.version, error: "" };
          latest.current = next;
          setResult(next);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const prior = latest.current;
          const next = { key, values: prior.key === key ? prior.values : {},
            version: prior.key === key ? prior.version : "",
            error: error instanceof Error ? error.message : "Não foi possível carregar os vínculos." };
          latest.current = next;
          setResult(next);
        }
      } finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("ontology:execution-committed", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("ontology:execution-committed", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [key]);
  return result.key === key ? result : { key, values: {}, version: "", error: "" };
}
