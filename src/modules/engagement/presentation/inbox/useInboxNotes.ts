"use client";
import { useRef, useState } from "react";
import { attachmentRepository } from "@/modules/documents/infrastructure/attachments";
import type { useDocumentsState } from "@/modules/documents/infrastructure/state";
import { editNote as applyNoteEdit } from "@/modules/engagement/domain/notes";
import type {
  Thread,
  ThreadFile,
  ThreadMessage,
} from "@/modules/engagement/domain/models";
import { storeNoteFiles } from "../note-files";
import type { InboxOperation } from "../useInboxOperation";
import { useInboxState } from "../../infrastructure/relationship-state";

type InboxState = ReturnType<typeof useInboxState>[0];
type SetInbox = ReturnType<typeof useInboxState>[1];

/** Writing in a space: internal notes, their edits, attachments, read and pinned. */
export function useInboxNotes({
  thread: t,
  setInbox,
  pinnedIds,
  me,
  operation,
  addDoc,
}: {
  thread: Thread | undefined;
  setInbox: SetInbox;
  pinnedIds: string[];
  me: { id: string; name: string };
  operation: InboxOperation;
  addDoc: ReturnType<typeof useDocumentsState>["addDoc"];
}) {
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(0);
  const [attachError, setAttachError] = useState("");
  const uploaded = useRef(new WeakMap<File, { id: string; ready: boolean }>());

  function addNoteLocal(body: string, files?: ThreadFile[], at?: string) {
    if (!t) return;
    const now = new Date().toISOString();
    const msg: ThreadMessage = {
      id: "n-" + crypto.randomUUID(),
      at: at ?? now,
      createdAt: now,
      from: me.name,
      text: body,
      kind: "note",
      files: files?.length ? files : undefined,
    };
    setInbox((previous: InboxState) => ({
      ...previous,
      notes: {
        ...previous.notes,
        [t.id]: [...(previous.notes[t.id] ?? []), msg],
      },
      read: [...new Set([...previous.read, t.id])],
      unread: previous.unread.filter((x) => x !== t.id),
    }));
    setText("");
  }

  /** Date and text of a note can change; the domain appends every change to its log. */
  function editNoteLocal(noteId: string, patch: { at?: string; text?: string }) {
    if (!t) return;
    const threadId = t.id;
    const now = new Date().toISOString();
    setInbox((previous: InboxState) => ({
      ...previous,
      notes: {
        ...previous.notes,
        [threadId]: (previous.notes[threadId] ?? []).map((note) =>
          note.id === noteId ? applyNoteEdit(note, patch, me.name, now) : note,
        ),
      },
    }));
  }

  async function addNote(body: string, files?: ThreadFile[], at?: string) {
    if (!t) return "Conversa não encontrada.";
    return operation.run(
      "inbox.notes.create",
      {
        threadId: t.id,
        text: body,
        ...(at ? { at } : {}),
        fileIds: files?.map((f) => f.id) ?? [],
      },
      () => addNoteLocal(body, files, at),
      () => setText(""),
    );
  }

  function editNote(
    noteId: string,
    patch: { at?: string; text?: string },
    confirmed: () => void,
  ) {
    if (!t) return;
    void operation.run(
      "inbox.notes.update",
      { threadId: t.id, noteId, patch },
      () => editNoteLocal(noteId, patch),
      confirmed,
    );
  }

  function updateThread(
    threadId: string,
    patch: { read?: boolean; pinned?: boolean },
    confirmed?: () => void,
  ) {
    if (operation.busy || operation.pending) return;
    void operation.run(
      "inbox.thread.update",
      { threadId, ...patch },
      () =>
        setInbox((previous: InboxState) => ({
          ...previous,
          ...(patch.read === undefined
            ? {}
            : {
                read: patch.read
                  ? [...new Set([...previous.read, threadId])]
                  : previous.read.filter((id) => id !== threadId),
                unread: patch.read
                  ? previous.unread.filter((id) => id !== threadId)
                  : [...new Set([...previous.unread, threadId])],
              }),
          ...(patch.pinned === undefined
            ? {}
            : {
                pinned: patch.pinned
                  ? [...new Set([...previous.pinned, threadId])]
                  : previous.pinned.filter((id) => id !== threadId),
              }),
        })),
      confirmed,
    );
  }

  function togglePin(threadId: string) {
    updateThread(threadId, { pinned: !pinnedIds.includes(threadId) });
  }

  function send() {
    const value = text.trim();
    if (!t) return;
    if (!value) return;
    if (!operation.busy && !operation.pending) void addNote(value);
  }

  async function attachFiles(picked: File[], body: string, at?: string) {
    if (!picked.length || !t || operation.busy || operation.pending) return;
    const thread = t;
    const files = picked.map((file) => {
      let saved = uploaded.current.get(file);
      if (!saved) {
        saved = { id: "up-" + crypto.randomUUID(), ready: false };
        uploaded.current.set(file, saved);
      }
      return { file, saved };
    });
    const noteText =
      body ||
      (picked.length === 1
        ? `Anexou ${picked[0].name}`
        : `Anexou ${picked.length} arquivos`);
    setAttachError("");
    setUploading(picked.length);
    await operation.run(
      "inbox.notes.create",
      {
        threadId: thread.id,
        text: noteText,
        ...(at ? { at } : {}),
        fileIds: files.map((f) => f.saved.id),
      },
      async () => {
        const { stored, error } = await storeNoteFiles({
          files: picked,
          company: thread.company,
          threadId: thread.id,
          note: body,
          uploadedBy: me.id,
          addDoc,
        });
        if (error) throw new Error(error);
        addNoteLocal(noteText, stored, at);
      },
      () => setText(""),
      async () => {
        for (const { file, saved } of files)
          if (!saved.ready) {
            await attachmentRepository.put(saved.id, file, {
              company: thread.company,
            });
            saved.ready = true;
          }
      },
    );
    setUploading(0);
  }

  /** Each file becomes a document of the client, then the note points to it. */
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    await attachFiles(picked, text.trim());
  }

  return {
    text,
    setText,
    uploading,
    attachError,
    addNote,
    editNote,
    updateThread,
    togglePin,
    send,
    onFile,
  };
}
