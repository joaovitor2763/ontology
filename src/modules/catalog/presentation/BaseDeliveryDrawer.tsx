"use client";
import { CatalogOperationFeedback, type CatalogOperationUI } from "./useCatalogOperations";
import { TaskDeadlineFields } from "@/modules/catalog/presentation/TaskDeadlineFields";
import { deadlineGraphError } from "../domain/task-deadlines";
import { useState } from "react";
import type { BaseDelivery, CycleTemplate } from "../domain/products";
import { Drawer, FieldBlock, fieldClass, areaClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { Select } from "@/shared/ui/Select";
import { Plus, Trash2 } from "lucide-react";

export function BaseDeliveryDrawer({
  operation,
  delivery,
  cycle,
  productName,
  onClose,
  onSave,
}: {
  delivery: BaseDelivery;
  cycle: CycleTemplate;
  productName: string;
  onClose: () => void;
  operation?: CatalogOperationUI;
  onSave: (delivery: BaseDelivery) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(delivery));
  const [items, setItems] = useState(() =>
    (delivery.checklistItems ?? []).map((title) => ({
      id: crypto.randomUUID(),
      title,
    })),
  );
  const [error, setError] = useState("");
  return (
    <Drawer
      open
      title="Editar tarefa padrão"
      kicker={`${productName} · ${cycle.name}`}
      onClose={onClose}
      footer={
        <>
          <Button disabled={operation?.busy} variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={operation?.busy} type="submit" form="base-delivery-form">
            {operation?.busy ? "Salvando…" : "Salvar tarefa"}
          </Button>
        </>
      }
    >
      <CatalogOperationFeedback operation={operation} />
      <fieldset disabled={operation?.busy}><form
        id="base-delivery-form"
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
        if(operation?.busy)return;
          if (!draft.title.trim()) {
            setError("Informe o nome da tarefa.");
            return;
          }
          if (
            ((!draft.deadline || draft.deadline.mode === "fixed") && (!Number.isInteger(draft.day) || draft.day < 1)) ||
            !Number.isFinite(draft.hours) ||
            draft.hours < 0
          ) {
            setError("Informe prazo e esforço válidos.");
            return;
          }
          if (items.some((item) => !item.title.trim())) {
            setError("Preencha ou remova os itens vazios do checklist.");
            return;
          }
          const problem = deadlineGraphError(cycle.deliveries.map(d => d.id === draft.id ? draft : d));
          if (problem) { setError(problem); return; }
          onSave({
            ...draft,
            title: draft.title.trim(),
            description: draft.description.trim(),
            checklistItems: items.map((item) => item.title.trim()),
          });
        }}
      >
        <p className="text-xs leading-5 text-muted">
          Este é o padrão do produto, usado ao criar novas tarefas a partir
          deste ciclo. As tarefas já criadas para clientes mantêm sua própria
          cópia.
        </p>
        <FieldBlock label="Tarefa">
          <input
            required
            className={fieldClass}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </FieldBlock>
        <FieldBlock label="Descrição ou resultado esperado">
          <textarea
            className={areaClass}
            rows={3}
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
        </FieldBlock>
        <div className="grid grid-cols-2 gap-3">
          <FieldBlock label="Dia a partir do início">
            <input
              type="number"
              required
              min={1}
              step={1}
              className={fieldClass}
              readOnly={!!draft.deadline && draft.deadline.mode !== "fixed"}
                title="Dia inicial usado quando não há vínculo de prazo"
                value={draft.day}
              onChange={(e) =>
                setDraft({ ...draft, day: e.target.valueAsNumber })
              }
            />
          </FieldBlock>
          <FieldBlock label="Esforço previsto (h)">
            <input
              type="number"
              required
              min={0}
              step={0.5}
              className={fieldClass}
              value={draft.hours}
              onChange={(e) =>
                setDraft({ ...draft, hours: e.target.valueAsNumber })
              }
            />
          </FieldBlock>
        </div>
        <TaskDeadlineFields template value={draft.deadline} onChange={deadline=>setDraft({...draft,deadline})} tasks={cycle.deliveries.filter(d=>d.id!==draft.id)} />
        {!!cycle.milestones?.length && (
          <Select
            label="Marco"
            value={draft.milestoneId ?? ""}
            onValueChange={(value) =>
              setDraft({ ...draft, milestoneId: value || undefined })
            }
            options={[
              { value: "", label: "Sem marco" },
              ...cycle.milestones.map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
        )}
        <section className="space-y-3 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Checklist padrão</h3>
            <span className="text-xs text-muted">{items.length} itens</span>
          </div>
          <p className="text-xs text-muted">
            O responsável confirma estes itens antes de concluir a tarefa.
          </p>
          {items.map((item, index) => (
            <div key={item.id} className="flex items-start gap-2">
              <span className="pt-3 text-xs text-muted">{index + 1}.</span>
              <textarea
                aria-label={`Item ${index + 1} do checklist`}
                rows={2}
                className={`${areaClass} min-w-0 flex-1`}
                value={item.title}
                onChange={(e) =>
                  setItems(
                    items.map((i) =>
                      i.id === item.id ? { ...i, title: e.target.value } : i,
                    ),
                  )
                }
              />
              <button
                type="button"
                aria-label={`Remover item ${index + 1}`}
                className="rounded p-2 text-muted hover:bg-soft hover:text-rose"
                onClick={() => setItems(items.filter((i) => i.id !== item.id))}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {!items.length && (
            <p className="rounded-lg bg-soft p-3 text-xs text-muted">
              Esta tarefa ainda não tem checklist padrão.
            </p>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              setItems([...items, { id: crypto.randomUUID(), title: "" }])
            }
          >
            <Plus className="h-4 w-4" />
            Adicionar item
          </Button>
        </section>
        {error && (
          <p role="alert" className="text-sm text-rose">
            {error}
          </p>
        )}
      </form></fieldset>
    </Drawer>
  );
}
