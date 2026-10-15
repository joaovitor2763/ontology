"use client";
import { CheckSquare, Plus, X } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { Checkbox } from "@/shared/ui/Checkbox";
import { formatDate } from "@/shared/lib/format";
import { fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import type { DeliveryDraft } from "./useDeliveryDraft";

export function ChecklistSection({ editor }: { editor: DeliveryDraft }) {
  const { draft, checklist, who } = editor;
  if (draft.kind === "request") return null;
  const checklistDone = checklist.filter((i) => i.done).length;
  return (
    <section aria-label="Checklist" className="mb-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="inline-flex items-center gap-1.5 text-[13px] font-medium">
          <CheckSquare className="h-3.5 w-3.5 text-muted" />
          Checklist
          {checklist.length > 0 && (
            <span className="text-[11px] text-muted">
              {checklistDone}/{checklist.length}
            </span>
          )}
        </h3>
      </div>
      <ul className="mt-2 space-y-1">
        {checklist.map((item) => (
          <li
            key={item.id}
            className="group flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-soft/60"
          >
            <Checkbox
              className="shrink-0"
              checked={item.done}
              label={item.title}
              onCheckedChange={() => editor.toggleItem(item.id, !item.done)}
            />
            <span className="min-w-0 flex-1 text-[13.5px]">
              <span className={cn(item.done && "text-muted line-through")}>
                {item.title}
              </span>
              {item.done && item.doneBy && (
                <span className="ml-2 text-[11px] text-muted">
                  {who(item.doneBy)}
                  {item.doneAt ? ` · ${formatDate(item.doneAt)}` : ""}
                </span>
              )}
            </span>
            <button
              type="button"
              aria-label={`Remover item ${item.title}`}
              onClick={() => editor.removeItem(item.id)}
              className="text-muted opacity-0 hover:text-ink group-hover:opacity-100 focus:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (editor.newItem.trim()) editor.addItem();
        }}
      >
        <input
          aria-label="Novo item do checklist"
          className={`${fieldClass} h-9 text-[13px]`}
          value={editor.newItem}
          onChange={(e) => editor.setNewItem(e.target.value)}
          placeholder="Adicionar item"
        />
        <Button
          size="sm"
          variant="ghost"
          type="submit"
          disabled={!editor.newItem.trim()}
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar
        </Button>
      </form>
      {checklist.some((i) => !i.done) && (
        <p className="mt-1.5 text-[11.5px] text-muted">
          A tarefa só pode ser concluída com todos os itens marcados.
        </p>
      )}
    </section>
  );
}
