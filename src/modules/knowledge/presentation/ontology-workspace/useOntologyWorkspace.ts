"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import { useSearchParams } from "next/navigation";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import {
  useKnowledgeState,
  useLiveOntology,
} from "@/modules/knowledge/infrastructure/state";
import { emptyOntologyDraft } from "@/modules/knowledge/infrastructure/queries";
import { useLocalStorageState } from "@/shared/infrastructure/useLocalStorageState";
import { useExpandedWorkspace } from "@/shared/ui/useExpandedWorkspace";
import type { GraphNode, OntologyDraft } from "@/modules/knowledge/domain/models";
import { useKnowledgeOperation } from "../useKnowledgeOperation";
import {
  getMobile,
  readHistory,
  subscribeMobile,
  subscribeNoop,
  type Connection,
  type Edit,
} from "./shared";

/** Selection, filters, undo history and the notice line of the ontology workspace. */
export function useOntologyWorkspace(
  slug: string,
  workspaceRef: RefObject<HTMLDivElement | null>,
) {
  const [expanded, setExpanded] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  useExpandedWorkspace(expanded, workspaceRef);
  const ont = useLiveOntology(slug);
  const { can } = usePermissions();
  const app_knowledge = useKnowledgeState();
  const operation = useKnowledgeOperation(slug);
  const [view, setView] = useState<"map" | "elements" | "connections">("map");
  const [elementLayout, setElementLayout] = useLocalStorageState<
    "cards" | "list"
  >("ontology.elements.layout", "list");
  const [scope, setScope] = useState("all");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const focusParam = useSearchParams().get("elemento");
  const [selectedId, setSelected] = useState<string | null>(focusParam);
  const [editing, setEditingState] = useState<Edit | null>(null);
  const [connection, setConnectionState] = useState<Connection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionFrom, setConnectionFrom] = useState<string | null>(null);
  const [deleting, setDeletingState] = useState<GraphNode | null>(null);
  function setEditing(next: Edit | null) {
    if (next) {
      if (operation.pending) return;
      operation.begin();
    }
    setEditingState(next);
  }
  function setConnection(next: Connection | null) {
    if (next) {
      if (operation.pending) return;
      operation.begin();
    }
    setConnectionState(next);
  }
  function setDeleting(next: GraphNode | null) {
    if (next) {
      if (operation.pending) return;
      operation.begin();
    }
    setDeletingState(next);
  }
  // Undo history survives navigation inside the session; the draft itself is persisted separately.
  const historyKey = `ontology.history.${slug}`;
  const [past, setPast] = useState<OntologyDraft[]>(
    () => readHistory(historyKey).past,
  );
  const [future, setFuture] = useState<OntologyDraft[]>(
    () => readHistory(historyKey).future,
  );
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  useEffect(() => {
    try {
      sessionStorage.setItem(historyKey, JSON.stringify({ past, future }));
    } catch {
      /* history is a convenience; the draft is already saved */
    }
  }, [historyKey, past, future]);
  const [notice, setNotice] = useState("");
  const mobileInspector = useSyncExternalStore(
    subscribeMobile,
    getMobile,
    () => false,
  );
  const draft = app_knowledge.ontologyDrafts[slug] ?? emptyOntologyDraft();

  function record(message: string, change: () => void) {
    setPast((p) => [...p.slice(-29), structuredClone(draft)]);
    setFuture([]);
    change();
    setNotice(message);
  }
  function undo() {
    if (!can("ontologia.editar", slug)) return;
    if (operation.remote !== false) {
      const targetVersion = operation.history.past.at(-1),
        expectedVersion = operation.history.version;
      if (
        targetVersion === undefined ||
        expectedVersion === undefined ||
        operation.remote === null
      )
        return;
      operation.run(
        "knowledge.history.restore",
        { company: slug, targetVersion, expectedVersion },
        () => {},
        () => {
          setScope("all");
          setSelected(null);
          setNotice("Alteração desfeita.");
        },
        "undo",
      );
      return;
    }
    const previous = past.at(-1);
    if (!previous) return;
    setFuture((f) => [...f, structuredClone(draft)]);
    app_knowledge.restoreOntologyDraft(slug, previous);
    setPast((p) => p.slice(0, -1));
    setScope("all");
    setSelected(null);
    setNotice("Alteração desfeita.");
  }
  function redo() {
    if (!can("ontologia.editar", slug)) return;
    if (operation.remote !== false) {
      const targetVersion = operation.history.future.at(-1),
        expectedVersion = operation.history.version;
      if (
        targetVersion === undefined ||
        expectedVersion === undefined ||
        operation.remote === null
      )
        return;
      operation.run(
        "knowledge.history.restore",
        { company: slug, targetVersion, expectedVersion },
        () => {},
        () => {
          setScope("all");
          setSelected(null);
          setNotice("Alteração refeita.");
        },
        "redo",
      );
      return;
    }
    const next = future.at(-1);
    if (!next) return;
    setPast((p) => [...p, structuredClone(draft)]);
    app_knowledge.restoreOntologyDraft(slug, next);
    setFuture((f) => f.slice(0, -1));
    setScope("all");
    setSelected(null);
    setNotice("Alteração refeita.");
  }
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  function clearFilters() {
    setQ("");
    setType("");
  }

  return {
    expanded,
    setExpanded,
    detailOpen,
    setDetailOpen,
    ont,
    can,
    app_knowledge,
    operation,
    draft,
    view,
    setView,
    elementLayout,
    setElementLayout,
    scope,
    setScope,
    q,
    setQ,
    type,
    setType,
    selectedId,
    setSelected,
    editing,
    setEditing,
    connection,
    setConnection,
    connecting,
    setConnecting,
    connectionFrom,
    setConnectionFrom,
    deleting,
    setDeleting,
    past,
    future,
    mounted,
    notice,
    setNotice,
    mobileInspector,
    record,
    undo,
    redo,
    clearFilters,
    undoDisabled:
      !mounted ||
      operation.pending ||
      operation.remote === null ||
      !(operation.remote ? operation.history.past : past).length,
    redoDisabled:
      !mounted ||
      operation.pending ||
      operation.remote === null ||
      !(operation.remote ? operation.history.future : future).length,
  };
}
