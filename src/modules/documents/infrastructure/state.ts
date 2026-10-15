import {
  documentVersion,
  reviewPatch,
  type ClientDocument,
  type DocReviewStatus,
} from "@/modules/documents/domain/models";
import { documentsFor } from "./queries";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { migrateLegacy } from "@/shared/infrastructure/migration";
import { useLocalStorageState } from "@/shared/infrastructure/useLocalStorageState";
import { notify } from "@/shared/ui/Feedback";
import { type SetStateAction } from "react";
export type StoredState = {
  extraDocs: ClientDocument[];
  removedDocIds: string[];
  /** Field-level edits over any document, seeded ones included. */
  docEdits: Record<string, Partial<ClientDocument>>;
};
const INITIAL: StoredState = { extraDocs: [], removedDocIds: [], docEdits: {} };
const migrate = () =>
  migrateLegacy(INITIAL, ["ontology.praxis.v1", "ontology.documents.v2"]);
const stamp = () => new Date().toISOString();
type API = {
  storageError: string | null;
  extraDocs: ClientDocument[];
  removedDocs: Set<string>;
  docEdits: Record<string, Partial<ClientDocument>>;
  addDoc: (d: ClientDocument) => void;
  /** Registers `record` as the next version of `of`, inheriting its links and type. */
  addVersion: (of: ClientDocument, record: ClientDocument) => void;
  updateDocument: (id: string, patch: Partial<ClientDocument>) => void;
  /** Approves or requests changes; the trail is kept on the document. */
  reviewDocument: (
    id: string,
    status: DocReviewStatus,
    notes?: string,
  ) => string | null;
  removeDoc: (id: string) => void;
  restoreDoc: (id: string) => void;
};
export function useDocumentsState(): API {
  const [stored, setStored, storageError] = useLocalStorageState(
    "ontology.documents.v3",
    INITIAL,
    migrate,
  );
  const { extraDocs, removedDocIds, docEdits } = stored;
  const { currentUserId } = useWorkspaceState();
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
  const setExtraDocs = field("extraDocs");
  const setRemovedDocIds = field("removedDocIds");
  const setDocEdits = field("docEdits");
  const value: API = {
    storageError,
    extraDocs,
    removedDocs: new Set(removedDocIds),
    docEdits,
    addDoc: (d) => {
      const now = stamp();
      setExtraDocs((xs) => [{ createdAt: now, updatedAt: now, ...d }, ...xs]);
      notify("Documento adicionado ao cliente");
    },
    addVersion: (of, record) => {
      const now = stamp();
      setExtraDocs((xs) => [
        {
          ...record,
          relatedTaskId: record.relatedTaskId ?? of.relatedTaskId,
          relatedMeetingId: record.relatedMeetingId ?? of.relatedMeetingId,
          visibility: record.visibility ?? of.visibility,
          version: documentVersion(of) + 1,
          supersedesId: of.id,
          createdAt: now,
          updatedAt: now,
        },
        ...xs,
      ]);
      notify(`Versão ${documentVersion(of) + 1} registrada`);
    },
    updateDocument: (id, patch) => {
      setDocEdits((e) => ({
        ...e,
        [id]: { ...e[id], ...patch, updatedAt: stamp() },
      }));
      notify("Documento atualizado");
    },
    reviewDocument: (id, status, notes = "") => {
      const current = documentsFor(undefined, extraDocs, new Set(), docEdits).find((d) => d.id === id) ?? {};
      const patch = reviewPatch(current, status, notes, currentUserId, stamp());
      if ("error" in patch) return patch.error;
      setDocEdits((e) => ({
        ...e,
        [id]: { ...e[id], ...patch, updatedAt: stamp() },
      }));
      notify(
        status === "aprovado"
          ? "Documento aprovado"
          : status === "ajustes"
            ? "Ajustes solicitados"
            : "Documento enviado para revisão",
      );
      return null;
    },
    restoreDoc: (id) => { setRemovedDocIds((ids) => ids.filter((x) => x !== id)); },
    removeDoc: (id) => {
      setRemovedDocIds((ids) => (ids.includes(id) ? ids : [...ids, id]));

      notify("Documento removido", () => {
        setRemovedDocIds((ids) => ids.filter((x) => x !== id));
      });
    },
  };
  return value;
}
