"use client";
import { MessageSquare } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { formatDateTime, relativeFrom } from "@/shared/lib/format";
import { areaClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import type { DeliveryDraft } from "./useDeliveryDraft";

export function CommentsSection({
  editor,
  layout,
}: {
  editor: DeliveryDraft;
  layout: "drawer" | "page";
}) {
  const { comments, who } = editor;
  return (
    <section
      className={cn(layout === "drawer" && "mt-6 border-t border-line pt-5")}
      aria-label="Comentários"
    >
      <h3 className="inline-flex items-center gap-1.5 text-[13px] font-medium">
        <MessageSquare className="h-3.5 w-3.5 text-muted" />
        Comentários
        {comments.length > 0 && (
          <span className="text-[11px] text-muted">{comments.length}</span>
        )}
      </h3>
      <ol className="mt-3 space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="rounded-xl border border-line px-3.5 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11.5px] text-muted">
              <span className="font-medium text-ink">{who(c.by)}</span>
              <time dateTime={c.at} title={formatDateTime(c.at)}>
                {relativeFrom(c.at, new Date())}
              </time>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed">
              {c.text}
            </p>
          </li>
        ))}
        {!comments.length && (
          <li className="text-[12.5px] text-muted">
            Nenhum comentário ainda. Registre decisões e contexto aqui em vez de
            no WhatsApp.
          </li>
        )}
      </ol>
      <div className="mt-3 flex items-end gap-2">
        <textarea
          aria-label="Novo comentário"
          className={areaClass}
          rows={2}
          value={editor.comment}
          placeholder="Escreva um comentário. Enter envia, Shift+Enter quebra linha."
          onChange={(e) => editor.setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              editor.sendComment();
            }
          }}
        />
        <Button
          size="sm"
          onClick={editor.sendComment}
          disabled={!editor.comment.trim()}
        >
          Comentar
        </Button>
      </div>
    </section>
  );
}
