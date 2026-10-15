"use client";
import { useState } from "react";
import { Repeat2 } from "lucide-react";
import { Checkbox } from "@g4ai/ds";
import {
  templateError,
  type CycleTemplate,
  type Product,
} from "@/modules/catalog/domain/products";
import { BaseDeliveriesEditor } from "@/modules/catalog/presentation/BaseDeliveriesEditor";
import { areaClass, Drawer, FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { Select } from "@/shared/ui/Select";
import { serviceModelLabel } from "@/modules/clients/domain/service-config";
import {
  CatalogOperationFeedback,
  type CatalogOperationUI,
} from "../../useCatalogOperations";

export function ProductForm({
  operation,
  product,
  onClose,
  onSave,
}: {
  operation: CatalogOperationUI;
  product: Product;
  onClose: () => void;
  onSave: (p: Product) => void;
}) {
  const [draft, setDraft] = useState(product);
  return (
    <Drawer
      open
      title={product.name ? "Editar produto" : "Novo produto"}
      onClose={onClose}
      footer={
        <Button disabled={operation.busy} form="product-form" type="submit">
          {operation.busy ? "Salvando…" : "Salvar produto"}
        </Button>
      }
    >
      <CatalogOperationFeedback operation={operation} />
      <fieldset disabled={operation.busy}><form
        id="product-form"
        onSubmit={(e) => {
          e.preventDefault();
          if(operation.busy)return;
          if (draft.name.trim())
            onSave({
              ...draft,
              name: draft.name.trim(),
              description: draft.description.trim(),
            });
        }}
      >
        <FieldBlock label="Nome do produto">
          <input
            required
            className={fieldClass}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </FieldBlock>
        <FieldBlock label="Descrição">
          <textarea
            className={areaClass}
            rows={4}
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
        </FieldBlock>
        <FieldBlock label="Modelo de trabalho">
          <Select
            label="Modelo de trabalho do produto"
            value={draft.serviceModel ?? "client"}
            onValueChange={(value) =>
              setDraft({
                ...draft,
                serviceModel:
                  value === "client"
                    ? undefined
                    : (value as NonNullable<Product["serviceModel"]>),
              })
            }
            options={[
              {
                value: "client",
                label: "Definido no cliente",
                description: "Não classifica automaticamente a contratação.",
              },
              ...Object.entries(serviceModelLabel).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
        </FieldBlock>
        <Checkbox
          label="Alocar AI Master automaticamente"
          className="mt-2 w-full rounded-xl border border-line p-3"
          checked={Boolean(draft.autoAllocateLead)}
          onCheckedChange={(checked) =>
            setDraft({ ...draft, autoAllocateLead: checked })
          }
          description="Ao criar um cliente deste produto, o responsável sugerido é o AI Master com menos clientes. Quem cria pode trocar; a escolha manual vale."
        />
      </form></fieldset>
    </Drawer>
  );
}
export function TemplateForm({
  operation,
  template,
  onClose,
  onSave,
}: {
  operation: CatalogOperationUI;
  template: CycleTemplate;
  onClose: () => void;
  onSave: (t: CycleTemplate) => void;
}) {
  const [draft, setDraft] = useState(template);
  const [acceptance, setAcceptance] = useState(template.acceptance.join("\n"));
  const [error, setError] = useState("");
  return (
    <Drawer
      open
      title={template.name ? "Editar modelo de ciclo" : "Novo modelo de ciclo"}
      kicker="Padrão do produto"
      onClose={onClose}
      footer={
        <Button disabled={operation.busy} form="template-form" type="submit">
          {operation.busy ? "Salvando…" : "Salvar modelo"}
        </Button>
      }
    >
      <CatalogOperationFeedback operation={operation} />
      <fieldset disabled={operation.busy}><form
        id="template-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if(operation.busy)return;
          const next = {
            ...draft,
            name: draft.name.trim(),
            goal: draft.goal.trim(),
            acceptance: acceptance
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          };
          const issue = templateError(next);
          if (issue) {
            setError(issue);
            return;
          }
          onSave(next);
        }}
      >
        <FieldBlock label="Nome do modelo">
          <input
            required
            className={fieldClass}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </FieldBlock>
        <FieldBlock label="Objetivo base">
          <textarea
            required
            rows={3}
            className={areaClass}
            value={draft.goal}
            onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
          />
        </FieldBlock>
        <FieldBlock label="Duração (dias)">
          <input
            required
            type="number"
            min={1}
            max={365}
            className={fieldClass}
            value={draft.durationDays}
            onChange={(e) =>
              setDraft({ ...draft, durationDays: Number(e.target.value) })
            }
          />
        </FieldBlock>
        <h3 className="flex items-center gap-2 text-[14px] font-medium">
          <Repeat2 className="h-4 w-4" />
          Tarefas base
        </h3>
        <p className="text-[12px] text-muted">
          O dia 1 é o início do ciclo. O prazo de cada tarefa é calculado a
          partir dele.
        </p>
        <BaseDeliveriesEditor
          rows={draft.deliveries}
          onChange={(deliveries) => setDraft({ ...draft, deliveries })}
          maxDay={draft.durationDays}
        />
        <FieldBlock label="Critérios de aceite (um por linha)">
          <textarea
            required
            rows={3}
            className={areaClass}
            value={acceptance}
            onChange={(e) => setAcceptance(e.target.value)}
          />
        </FieldBlock>
        {error && (
          <p role="alert" className="text-[13px] text-rose">
            {error}
          </p>
        )}
      </form></fieldset>
    </Drawer>
  );
}
