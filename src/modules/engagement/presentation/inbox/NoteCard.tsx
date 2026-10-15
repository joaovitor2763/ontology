"use client";
import { DateTimePicker } from "@/shared/ui/DateTimePicker";
import { useState } from "react";
import { TextareaField } from "@g4ai/ds";
import { FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { History } from "lucide-react";
import { formatDateTime } from "@/shared/lib/format";
import { Avatar, Button } from "@/shared/ui/primitives";
import { Attachs } from "../NoteAttachments";
import { InboxOperationFeedback, type InboxOperation } from "../useInboxOperation";
import type { ThreadMessage } from "@/modules/engagement/domain/models";
import { initials, isPraxis, toLocalInput } from "./helpers";

export function NoteCard({
  operation,
  msg,
  tint,
  meName,
  onEdit,
}: {
  operation: InboxOperation;
  msg: ThreadMessage;
  tint: string;
  meName: string;
  /** Present when the note was written in the app and can be edited. */
  onEdit?: (
    patch: { at?: string; text?: string },
    confirmed: () => void,
  ) => void;
}) {
  const mine = msg.from.startsWith(meName);
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(msg.at));
  const [body, setBody] = useState(msg.text);
  const [logOpen, setLogOpen] = useState(false);
  const history = msg.history ?? [];
  const dateEdited = history.some((h) => h.field === "at");
  function startEdit() {
    if (operation.busy || operation.pending) return;
    operation.begin();
    setWhen(toLocalInput(msg.at));
    setBody(msg.text);
    setEditing(true);
  }
  function save() {
    const parsed = new Date(when);
    if (Number.isNaN(parsed.getTime())) return;
    if (operation.busy || operation.pending) return;
    onEdit?.({ at: parsed.toISOString(), text: body.trim() || msg.text }, () =>
      setEditing(false),
    );
  }
  return (
    <article className="mb-5 rounded-2xl bg-surface p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Avatar
          initials={initials(msg.from)}
          tint={isPraxis(msg.from) ? undefined : tint}
          size="sm"
        />
        <span className="text-[13px] font-medium">{msg.from}</span>
        {isPraxis(msg.from) && (
          <span className="text-[11.5px] text-muted">Equipe</span>
        )}
        {mine && <span className="text-[11.5px] text-muted">você</span>}
        <span className="basis-full inline-flex items-center gap-2 text-[11.5px] text-muted xl:ml-auto xl:basis-auto">
          <span title={dateEdited ? "Data ajustada; veja o histórico" : undefined}>
            {formatDateTime(msg.at)}
            {dateEdited && <span className="ml-1 text-amber">· ajustada</span>}
          </span>
          {onEdit && !editing && (
            <button
              type="button"
              onClick={startEdit}
              className="rounded-md px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-soft hover:text-ink"
            >
              Editar
            </button>
          )}
        </span>
      </div>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="mt-3 space-y-3"
        >
          <FieldBlock label="Quando aconteceu" className="mb-0!">
            <DateTimePicker
              label="Quando aconteceu"
              disabled={operation.busy || operation.pending}
              value={when}
              onValueChange={(next) => setWhen(next)}
              className={fieldClass}
              required
            />
          </FieldBlock>
          <TextareaField
            label="Nota"
            disabled={operation.busy || operation.pending}
            value={body}
            onChange={setBody}
            minRows={3}
            className="mb-0!"
          />
          <InboxOperationFeedback operation={operation} />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={operation.busy}
              onClick={() => {
                operation.reset();
                setEditing(false);
              }}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              type="submit"
              disabled={operation.busy || operation.pending}
            >
              {operation.busy ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-3 break-words text-[14px] leading-relaxed text-ink-soft">
          {msg.text}
        </p>
      )}
      <Attachs files={msg.attachments} docs={msg.files} />
      {(msg.createdAt || history.length > 0) && (
        <div className="mt-3 border-t border-line pt-2 text-[11.5px] text-muted">
          <button
            type="button"
            onClick={() => setLogOpen((v) => !v)}
            aria-expanded={logOpen}
            className="inline-flex items-center gap-1.5 hover:text-ink"
          >
            <History className="h-3 w-3" />
            {msg.createdAt
              ? `Registrada em ${formatDateTime(msg.createdAt)}`
              : "Histórico"}
            {history.length > 0 &&
              ` · ${history.length} ${history.length === 1 ? "edição" : "edições"}`}
          </button>
          {logOpen && history.length > 0 && (
            <ol className="mt-2 space-y-1.5">
              {history.map((h, i) => (
                <li key={`${h.at}-${i}`} className="leading-relaxed">
                  <span className="text-ink-soft">{h.by}</span> ·{" "}
                  {formatDateTime(h.at)} ·{" "}
                  {h.field === "at" ? (
                    <>
                      data de <s>{formatDateTime(h.from)}</s> para{" "}
                      <span className="text-ink-soft">
                        {formatDateTime(h.to)}
                      </span>
                    </>
                  ) : h.field === "tags" ? (
                    <>
                      tags de <s>{h.from || "nenhuma"}</s> para{" "}
                      <span className="text-ink-soft">{h.to || "nenhuma"}</span>
                    </>
                  ) : (
                    <>
                      texto alterado
                      <span className="mt-1 block rounded-md bg-soft px-2 py-1 text-[11.5px]">
                        <s>{h.from}</s>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </article>
  );
}
