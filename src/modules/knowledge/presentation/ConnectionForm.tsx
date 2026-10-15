"use client";
import { Combobox } from "@/shared/ui/Combobox";
import type { GraphEdge, Ontology } from "@/modules/knowledge/domain/models";
import {
  edgeError,
  relationName,
  RELATIONS,
  typeMeta,
  typeOf,
} from "@/modules/knowledge/domain/ontology";
import { RelationPicker } from "@/modules/knowledge/presentation/RelationPicker";
import { areaClass, Drawer, FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import { Button } from "@/shared/ui/primitives";
import { ArrowDown, ArrowDownUp } from "lucide-react";
import { useState, type ReactNode } from "react";

export function ConnectionForm({
  ontology,
  edge,
  fromId,
  toId,
  onClose,
  pending = false,
  busy = false,
  feedback,
  onSave,
  onDelete,
}: {
  ontology: Ontology;
  edge?: GraphEdge;
  fromId?: string;
  toId?: string;
  onClose: () => void;
  pending?: boolean;
  /** Confirmando agora: o botão conta o progresso. */
  busy?: boolean;
  feedback?: ReactNode;
  onSave: (edge: GraphEdge) => void;
  onDelete: (edge: GraphEdge) => void;
}) {
  const [from, setFrom] = useState(edge?.from ?? fromId ?? "");
  const [to, setTo] = useState(edge?.to ?? toId ?? "");
  const [label, setLabel] = useState(
    edge ? relationName(edge.label) : "inclui",
  );
  const [description, setDescription] = useState(edge?.description ?? "");
  const [cardinality, setCardinality] = useState<GraphEdge["cardinality"]>(
    edge?.cardinality ?? "many-many",
  );
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const options = ontology.nodes.map((n) => ({
    value: n.id,
    label: n.label,
    description: typeMeta(typeOf(n)).label,
  }));
  const suggestions = [
    ...new Set([
      ...RELATIONS,
      ...ontology.edges.map((e) => relationName(e.label)),
    ]),
  ].filter(Boolean);
  return (
    <Drawer
      open
      onClose={onClose}
      kicker="Relação entre elementos"
      title={edge ? "Editar conexão" : "Nova conexão"}
      footer={
        <div className="flex justify-between gap-2">
          {edge ? (
            <Button disabled={pending} variant="danger" onClick={() => setDeleting(true)}>
              Remover
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button disabled={pending} type="submit" form="ontology-connection-form">
              {busy ? "Salvando…" : "Salvar conexão"}
            </Button>
          </div>
        </div>
      }
    >
      {feedback}
      <form
        id="ontology-connection-form"
        onSubmit={(e) => {
          e.preventDefault();
          const next: GraphEdge = {
            id: edge?.id ?? `edge-${crypto.randomUUID()}`,
            from,
            to,
            label: label.trim(),
            description: description.trim(),
            cardinality,
          };
          const err = edgeError(next, ontology);
          if (err) setError(err);
          else onSave(next);
        }}
      >
        <fieldset disabled={pending}>
        <FieldBlock label="Elemento de origem">
          <Combobox
            label="Elemento de origem"
            required
            className={fieldClass}
            value={from}
            onValueChange={(value) => {
              setFrom(value);
              setError("");
            }}
            placeholder="Selecione a origem"
            options={options}
          />
        </FieldBlock>
        <div className="mb-5 flex items-center justify-between">
          <ArrowDown className="h-4 w-4 text-blue" />
          <button
            type="button"
            className="flex items-center gap-2 text-[12px] text-muted hover:text-ink"
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
          >
            <ArrowDownUp className="h-3.5 w-3.5" />
            Inverter direção
          </button>
        </div>
        <FieldBlock label="Como se relacionam">
          <RelationPicker
            className={fieldClass}
            value={label}
            onChange={(value) => {
              setLabel(value);
              setError("");
            }}
            suggestions={suggestions}
          />
        </FieldBlock>
        <p className="-mt-3 mb-5 text-[12px] text-muted">
          Prefira uma relação sugerida para manter o vocabulário do mapa
          consistente. Uma relação nova pode ser criada quando nenhuma servir.
        </p>
        <FieldBlock label="Elemento de destino">
          <Combobox
            label="Elemento de destino"
            required
            className={fieldClass}
            value={to}
            onValueChange={(value) => {
              setTo(value);
              setError("");
            }}
            placeholder="Selecione o destino"
            options={options}
          />
        </FieldBlock>
        <div className="mb-6 rounded-xl bg-soft p-4 text-[13px] leading-relaxed">
          <strong>
            {ontology.nodes.find((n) => n.id === from)?.label ?? "Origem"}
          </strong>
          <span className="mx-1 text-blue">→ {label || "relação"} →</span>
          <strong>
            {ontology.nodes.find((n) => n.id === to)?.label ?? "Destino"}
          </strong>
        </div>
        <FieldBlock label="Quantidade de vínculos permitida">
          <Select
            label="Quantidade de vínculos permitida"
            value={cardinality ?? "many-many"}
            onValueChange={(value) =>
              setCardinality(value as GraphEdge["cardinality"])
            }
            options={[
              { value: "one-one", label: "Um para um" },
              { value: "one-many", label: "Um para muitos" },
              { value: "many-many", label: "Muitos para muitos" },
            ]}
          />
        </FieldBlock>
        <p className="-mt-3 mb-5 text-[12px] text-muted">
          Documenta a regra do negócio para esta relação.
        </p>
        <FieldBlock label="Contexto da relação">
          <textarea
            rows={3}
            className={areaClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Quando esta relação vale? Há uma condição ou exceção?"
          />
        </FieldBlock>
        {error && (
          <p role="alert" className="mb-4 text-sm text-rose">
            {error}
          </p>
        )}
        {deleting && edge && (
          <div role="alert" className="rounded-xl border border-rose/30 p-4">
            <p className="mb-3 text-sm">
              Remover esta conexão? Os dois elementos continuam no mapa.
            </p>
            <Button variant="danger" onClick={() => onDelete(edge)}>
              Confirmar remoção
            </Button>
          </div>
        )}
        </fieldset>
      </form>
    </Drawer>
  );
}
