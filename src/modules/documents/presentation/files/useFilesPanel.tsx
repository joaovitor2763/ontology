"use client";
import {
  downloadAttachment,
} from "@/modules/documents/infrastructure/attachments";
import {
  stageFiles,
  type Staged,
} from "@/modules/documents/presentation/StageDocumentModal";
import { useDocumentsState } from "@/modules/documents/infrastructure/state";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import {
  currentDocuments,
  versionChain,
  type ClientDocument,
  type DocKind,
  type DocReviewStatus,
  type DocVisibility,
} from "@/modules/documents/domain/models";
import { documentsFor } from "@/modules/documents/infrastructure/queries";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { meetingById } from "@/modules/engagement/infrastructure/queries";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import {
  CheckCircle2,
  Download,
  History,
  MessageSquareWarning,
  Pencil,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { docKindLabel } from "@/shared/lib/format";
import { useCollectionDisplay } from "@/shared/ui/DisplayControls";
import { useDocumentOperation } from "../useDocumentOperation";

type EditForm = {
  id: string;
  kind: DocKind;
  visibility: DocVisibility;
  note: string;
};


/** Todo o estado do painel de documentos: filtros, rascunho de edição, revisão e remoção. */
export function useFilesPanel(company: string | undefined, deliveryTitle: (id: string) => string | undefined) {
  const { view, setView, density, setDensity } = useCollectionDisplay(
    `files.${company ?? "all"}`,
  );
  const {
    extraDocs,
    removedDocs,
    docEdits,
    updateDocument,
    reviewDocument,
    removeDoc,
    restoreDoc,
  } = useDocumentsState();
  const { clientBySlug } = useClientsState();
  const { allMeetings } = useEngagementState();
  const { me, resolve } = useTeam();
  const all = documentsFor(company, extraDocs, removedDocs, docEdits);
  const [q, setQ] = useState("");
  const [kinds, setKinds] = useState<string[]>([]);
  const [showOld, setShowOld] = useState(false);
  const [fileError, setFileError] = useState("");
  const [pending, setPending] = useState(0);
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState<ClientDocument | null>(null);
  const [removing, setRemoving] = useState<ClientDocument | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [edit, setEdit] = useState<EditForm | null>(null);
  const [requestingChanges, setRequestingChanges] =
    useState<ClientDocument | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const [reviewError, setReviewError] = useState("");
  const isAdmin = me.access === "admin";
  const operation = useDocumentOperation();
  const [removed, setRemoved] = useState<ClientDocument | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const [versionFor, setVersionFor] = useState<ClientDocument | null>(null);
  useEffect(() => {
    if (versionFor) versionInput.current?.click();
  }, [versionFor]);

  const meetingTitle = (id: string) =>
    allMeetings.find((m) => m.id === id)?.title ?? meetingById(id)?.title;

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    const base = showOld ? all : currentDocuments(all);
    return base.filter((d) => {
      if (kinds.length && !kinds.includes(d.kind)) return false;
      if (!query) return true;
      return `${d.name} ${clientBySlug(d.company)?.name ?? ""} ${docKindLabel[d.kind]} ${d.note ?? ""}`
        .toLowerCase()
        .includes(query);
    });
  }, [all, q, kinds, showOld, clientBySlug]);

  function stage(files: File[], versionOf?: ClientDocument) {
    if (!files.length || !company) return;
    setFileError("");
    setStaged(stageFiles(files, { versionOf }));
  }
  function newVersion(doc: ClientDocument) {
    setOpen(null);
    setVersionFor(doc);
  }

  async function download(doc: ClientDocument) {
    try {
      await downloadAttachment(doc.id, doc.name);
    } catch (error) {
      setFileError(
        error instanceof Error
          ? error.message
          : "Não foi possível baixar o documento.",
      );
    }
  }

  const selected = open ? (all.find((d) => d.id === open.id) ?? open) : null;
  const form: EditForm | null = selected
    ? edit?.id === selected.id
      ? edit
      : {
          id: selected.id,
          kind: selected.kind,
          visibility: selected.visibility ?? "interna",
          note: selected.note ?? "",
        }
    : null;
  const dirty =
    selected &&
    form &&
    (form.kind !== selected.kind ||
      form.visibility !== (selected.visibility ?? "interna") ||
      form.note !== (selected.note ?? ""));

  const chain = selected ? versionChain(all, selected) : [];
  const rowActions = (d: ClientDocument) => operation.pending ? [] : [
    {
      label: "Editar",
      icon: <Pencil />,
      onSelect: () => { operation.begin(); setOpen(d); },
    },
    ...(d.id.startsWith("up-")
      ? [
          {
            label: "Baixar",
            icon: <Download />,
            onSelect: () => void download(d),
          },
        ]
      : []),
    ...(company
      ? [
          {
            label: "Nova versão",
            icon: <History />,
            onSelect: () => newVersion(d),
          },
        ]
      : []),
    ...(isAdmin && reviewable(d)
      ? [
          {
            label: "Aprovar",
            icon: <CheckCircle2 />,
            separator: true,
            onSelect: () => review(d, "aprovado"),
          },
          {
            label: "Solicitar ajustes",
            icon: <MessageSquareWarning />,
            onSelect: () => {
              setChangeNote("");
              setRequestingChanges(d);
            },
          },
        ]
      : []),
    {
      label: "Remover",
      icon: <Trash2 />,
      tone: "danger" as const,
      separator: true,
      onSelect: () => {operation.begin();setRemoving(d);},
    },
  ];
  const reviewable = (d: ClientDocument) =>
    d.kind === "entregavel" || Boolean(d.deliverableTemplateId) || Boolean(d.reviewStatus);
  function review(d: ClientDocument, status: DocReviewStatus, notes = "") {
    if (!isAdmin) return;
    void operation.run("documents.review", {documentId:d.id,status,notes}, () => {
      const problem = reviewDocument(d.id,status,notes);
      if (problem) throw new Error(problem);
    }, () => {setReviewError("");setRequestingChanges(null);});
  }
  function removeSelected() {
    if (!removing) return;
    const doc = removing;
    void operation.run("documents.remove", {documentId:doc.id}, () => removeDoc(doc.id), () => {
      setRemoved(doc); setRemoving(null); if(open?.id===doc.id)setOpen(null);
    });
  }
  const reviewTone = (status?: DocReviewStatus) =>
    status === "aprovado" ? "ok" : status === "ajustes" ? "warn" : "neutral";


  return {
    view,
    setView,
    density,
    setDensity,
    updateDocument,
    restoreDoc,
    clientBySlug,
    me,
    resolve,
    all,
    q,
    setQ,
    kinds,
    setKinds,
    showOld,
    setShowOld,
    fileError,
    setFileError,
    pending,
    over,
    setOver,
    open,
    setOpen,
    removing,
    setRemoving,
    staged,
    setStaged,
    edit,
    setEdit,
    requestingChanges,
    setRequestingChanges,
    changeNote,
    setChangeNote,
    reviewError,
    setReviewError,
    isAdmin,
    operation,
    removed,
    setRemoved,
    input,
    versionInput,
    versionFor,
    setVersionFor,
    meetingTitle,
    deliveryTitle,
    rows,
    stage,
    newVersion,
    download,
    selected,
    form,
    dirty,
    chain,
    rowActions,
    reviewable,
    review,
    removeSelected,
    reviewTone,
    setPending,
  };
}
