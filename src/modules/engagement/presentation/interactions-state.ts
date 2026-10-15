"use client";
import { useRef } from "react";
import { attachmentRepository } from "@/modules/documents/infrastructure/attachments";
import { executeOperation, interactionOperationBaseline, operationAttempt, usesRemoteOperations } from "@/shared/infrastructure/operations";
import { normalizeInteractionTags, type InteractionTag } from "@/modules/engagement/domain/interaction-tags";
import { useDocumentsState } from "@/modules/documents/infrastructure/state";
import type {
  InteractionKind,
  Thread,
  ThreadMessage,
} from "@/modules/engagement/domain/models";
import { editNote, type NotePatch } from "@/modules/engagement/domain/notes";
import { useInboxState } from "@/modules/engagement/infrastructure/relationship-state";
import { storeNoteFiles } from "@/modules/engagement/presentation/note-files";
import { useTeam } from "@/modules/workspace/presentation/useTeam";

export type NewInteraction = {
  title: string;
  text: string;
  at: string;
  kind: InteractionKind;
  tags?: InteractionTag[];
  files: File[];
};

/**
 * The interactions a team writes about a client (notes, calls, e-mails,
 * saved conversations) live in the client's notes space of the relationship
 * document. This hook is the single writer for that space.
 */
export function useInteractionNotes(company: string) {
  const { me } = useTeam();
  const requests=useRef(new Map<string,{run:()=>Promise<void>;inFlight?:Promise<string>}>());
  const uploads=useRef(new WeakMap<File,{id:string;uploaded:boolean}>());
  function reset(key="create") { const pending=requests.current.get(key);if(!pending?.inFlight)requests.current.delete(key); }
  async function remote(key:string,prepare:()=>()=>Promise<void>):Promise<string>{
    let pending=requests.current.get(key);
    if(!pending){pending={run:prepare()};requests.current.set(key,pending);}
    if(pending.inFlight)return pending.inFlight;
    const attempt=pending;
    attempt.inFlight=(async()=>{try{await attempt.run();requests.current.delete(key);return "";}catch(error){return error instanceof Error?error.message:"Não foi possível confirmar a interação.";}finally{attempt.inFlight=undefined;}})();
    return attempt.inFlight;
  }
  const { addDoc } = useDocumentsState();
  const [inbox, setInbox, storageError] = useInboxState();
  const space = inbox.spaces.find((s) => s.company === company && s.kind === "notes");
  const notes = space ? (inbox.notes[space.id] ?? []) : [];

  function ensureSpace(): Thread {
    if (space) return space;
    const thread: Thread = {
      id: "t-notes-" + Math.random().toString(36).slice(2, 8),
      company,
      channel: "note",
      kind: "notes",
      title: "Notas do cliente",
      counterpart: me.name,
      participants: [me.name],
      lastAt: new Date().toISOString(),
      unread: 0,
      preview: "",
      messages: [],
    };
    setInbox((previous) => ({ ...previous, spaces: [thread, ...previous.spaces] }));
    return thread;
  }

  /** Resolves with an error message when a file could not be stored; empty when saved. */
  async function add(input: NewInteraction, baseline=interactionOperationBaseline(), intention="create"): Promise<string> {
    if(await usesRemoteOperations())return remote(intention,()=>{
      const files=[...input.files].map(file=>{
        let saved=uploads.current.get(file);
        if(!saved){saved={id:"up-"+crypto.randomUUID(),uploaded:false};uploads.current.set(file,saved);}
        return {file,saved};
      });
      const body={company,title:input.title,text:input.text,at:input.at,kind:input.kind,tags:normalizeInteractionTags(input.tags),fileIds:files.map(({saved})=>saved.id)};
      const attempt=operationAttempt("interactions.create",body);
      return async()=>{
        for(const {file,saved} of files)if(!saved.uploaded){await attachmentRepository.put(saved.id,file,{company});saved.uploaded=true;}
        await executeOperation("interactions.create",body,attempt,baseline);
      };
    });
    const thread = ensureSpace();
    const { stored, error } = await storeNoteFiles({
      files: input.files,
      company,
      threadId: thread.id,
      note: input.title || input.text,
      uploadedBy: me.id,
      addDoc,
    });
    if (input.files.length && !stored.length) return error;
    const now = new Date().toISOString();
    const note: ThreadMessage = {
      id: "n-" + crypto.randomUUID(),
      at: input.at,
      createdAt: now,
      from: me.name,
      title: input.title || undefined,
      text: input.text,
      kind: "note",
      interaction: input.kind,
      tags: normalizeInteractionTags(input.tags),
      files: stored.length ? stored : undefined,
    };
    setInbox((previous) => ({
      ...previous,
      notes: {
        ...previous.notes,
        [thread.id]: [...(previous.notes[thread.id] ?? []), note],
      },
    }));
    return error;
  }

  async function edit(noteId: string, patch: NotePatch, baseline=interactionOperationBaseline()):Promise<string> {
    if(await usesRemoteOperations())return remote("edit:"+noteId,()=>{
      const input={company,noteId,patch:structuredClone(patch)};
      const attempt=operationAttempt("interactions.update",input);
      return async()=>{await executeOperation("interactions.update",input,attempt,baseline);};
    });
    if (!space) return "Interação não encontrada.";
    const now = new Date().toISOString();
    setInbox((previous) => ({
      ...previous,
      notes: {
        ...previous.notes,
        [space.id]: (previous.notes[space.id] ?? []).map((note) =>
          note.id === noteId ? editNote(note, patch, me.name, now) : note,
        ),
      },
    }));
    return "";
  }

  return { notes, add, edit, reset, storageError, me };
}
