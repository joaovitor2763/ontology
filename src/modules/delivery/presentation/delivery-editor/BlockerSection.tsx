"use client";
import { ShieldAlert } from "lucide-react";
import { formatDate } from "@/shared/lib/format";
import { Combobox } from "@/shared/ui/Combobox";
import { FieldBlock, areaClass, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import type { DeliveryDraft } from "./useDeliveryDraft";

export function BlockerSection({ editor }: { editor: DeliveryDraft }) {
  const { activeBlocker, blocking, who } = editor;
  if (activeBlocker)
    return (
      <section
        className="mb-5 rounded-xl border border-rose/30 bg-rose-soft/40 p-4"
        aria-label="Bloqueio ativo"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-rose">
              <ShieldAlert className="h-3.5 w-3.5" />
              Bloqueada
              {activeBlocker.since
                ? ` desde ${formatDate(activeBlocker.since)}`
                : ""}
            </p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed">
              {activeBlocker.reason}
            </p>
            {"ownerId" in activeBlocker && activeBlocker.ownerId && (
              <p className="mt-1 text-[12px] text-muted">
                Quem resolve · {who(activeBlocker.ownerId)}
              </p>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={editor.resolveBlocker}>
            Resolver
          </Button>
        </div>
      </section>
    );
  if (!blocking) return null;
  return (
    <section className="mb-5 rounded-xl border border-line p-4">
      <p className="text-[13px] font-medium">Registrar bloqueio</p>
      <FieldBlock label="Motivo">
        <textarea
          className={areaClass}
          rows={2}
          autoFocus
          value={editor.blockReason}
          onChange={(e) => editor.setBlockReason(e.target.value)}
          placeholder="O que impede esta tarefa de avançar"
        />
      </FieldBlock>
      <FieldBlock label="Quem resolve (opcional)">
        <Combobox
          label="Quem resolve"
          className={fieldClass}
          value={editor.blockOwner}
          placeholder="Escolher membro"
          onValueChange={editor.setBlockOwner}
          options={editor.members
            .filter((p) => !editor.deactivated.has(p.id))
            .map((p) => ({ value: p.id, label: p.name }))}
        />
      </FieldBlock>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            editor.setBlocking(false);
            editor.setBlockReason("");
          }}
        >
          Cancelar
        </Button>
        <Button
          size="sm"
          disabled={!editor.blockReason.trim()}
          onClick={editor.saveBlocker}
        >
          Bloquear tarefa
        </Button>
      </div>
    </section>
  );
}
