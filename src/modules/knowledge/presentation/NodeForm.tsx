"use client";
import { Combobox } from "@/shared/ui/Combobox";

import type {
  ElementType,
  GraphEdge,
  GraphNode,
  Ontology,
} from "@/modules/knowledge/domain/models";
import {
  ELEMENT_TYPES,
  typeMeta,
  typeOf,
} from "@/modules/knowledge/domain/ontology";
import { Drawer, FieldBlock, areaClass, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { Checkbox } from "@g4ai/ds";
import { Select } from "@/shared/ui/Select";
import { useState, type ReactNode } from "react";

type Props = {
  ontology: Ontology;
  node: GraphNode | null;
  initialType?: ElementType;
  connectFrom?: string;
  onClose: () => void;
  pending?: boolean;
  /** Confirmando agora: o botão conta o progresso. */
  busy?: boolean;
  feedback?: ReactNode;
  onSave: (node: GraphNode, edge?: GraphEdge) => void;
};

export function NodeForm({
  ontology,
  node,
  initialType,
  connectFrom,
  onClose,
  pending = false,
  busy = false,
  feedback,
  onSave,
}: Props) {
  const [label, setLabel] = useState(node?.label ?? "");
  const [elementType, setElementType] = useState<ElementType>(
    node ? typeOf(node) : (initialType ?? "object"),
  );
  const [kind, setKind] = useState(node?.kind ?? "instance");
  const [domain, setDomain] = useState(node?.domain ?? "organizacao");
  const [description, setDescription] = useState(node?.description ?? "");
  const [ownerId, setOwnerId] = useState(node?.ownerId ?? "");
  const [state, setState] = useState(node?.state ?? "");
  const [source, setSource] = useState(node?.source ?? "");
  const [identity, setIdentity] = useState(node?.identity ?? "");
  const [policy, setPolicy] = useState(node?.policy ?? "");
  const [permission, setPermission] = useState(node?.permission ?? "");
  const [properties, setProperties] = useState(
    node?.properties.join("\n") ?? "",
  );
  const [parent, setParent] = useState(connectFrom ?? "");
  const [relation, setRelation] = useState("inclui");
  const [error, setError] = useState("");
  const [assessed, setAssessed] = useState(
    Boolean(node && node.coverageAssessed !== false),
  );
  const [coverage, setCoverage] = useState(node?.coverage ?? 0);
  const people = ontology.nodes.filter(
    (n) => typeOf(n) === "person" && n.id !== node?.id,
  );

  function save() {
    if (!label.trim()) {
      setError("Dê um nome ao elemento para continuar.");
      return;
    }
    const id = node?.id ?? `${ontology.company}-${crypto.randomUUID()}`;
    onSave(
      {
        ...node,
        id,
        label: label.trim(),
        elementType,
        kind,
        domain,
        description: description.trim(),
        ownerId,
        state: state.trim(),
        source: source.trim(),
        identity: identity.trim(),
        policy: policy.trim(),
        permission: permission.trim(),
        properties: properties
          .split("\n")
          .map((p) => p.trim())
          .filter(Boolean),
        coverage,
        coverageAssessed: assessed,
        x: node?.x ?? 0,
        y: node?.y ?? 0,
      },
      !node && parent
        ? {
            id: `edge-${crypto.randomUUID()}`,
            from: parent,
            to: id,
            label: relation.trim() || "inclui",
          }
        : undefined,
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      kicker={node ? "Editar elemento" : "Adicionar ao mapa"}
      title={node ? node.label : "Novo elemento"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={pending} type="submit" form="ontology-element-form">
            {busy ? (node ? "Salvando…" : "Criando…") : node ? "Salvar alterações" : "Criar elemento"}
          </Button>
        </div>
      }
    >
      {feedback}
      <form
        id="ontology-element-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset disabled={pending}>
        <FieldBlock label="Nome do elemento">
          <input
            autoFocus
            required
            maxLength={100}
            className={fieldClass}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex.: Comercial, Ana Silva ou Contrato"
          />
        </FieldBlock>
        <FieldBlock label="Tipo de elemento">
          <Combobox
            label="Tipo de elemento"
            className={fieldClass}
            value={elementType}
            onValueChange={(value) => setElementType(value as ElementType)}
            options={ELEMENT_TYPES.map((t) => ({
              value: t.id,
              label: t.label,
            }))}
          />
        </FieldBlock>
        <p className="-mt-3 mb-5 text-[12px] leading-relaxed text-muted">
          {ELEMENT_TYPES.find((t) => t.id === elementType)?.hint}
        </p>
        <FieldBlock label="Definição">
          <textarea
            rows={3}
            className={areaClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="O que é, para que serve e o que fica fora desta definição."
          />
        </FieldBlock>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <FieldBlock label="Responsável">
            <Combobox
              label="Responsável"
              className={fieldClass}
              value={ownerId}
              onValueChange={(value) => setOwnerId(value)}
              options={[
                { value: "", label: "Ainda não definido" },
                ...people.map((p) => ({ value: p.id, label: p.label })),
              ]}
            />
          </FieldBlock>
          <FieldBlock label="Estado atual">
            <input
              className={fieldClass}
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="Ex.: Ativo, em revisão"
            />
          </FieldBlock>
        </div>
        {!node && (
          <div className="mb-6 rounded-xl border border-line-strong bg-soft p-4">
            <h3 className="mb-3 text-[13px] font-medium">Já nasce conectado</h3>
            <FieldBlock label="Conectar a partir de">
              <Combobox
                label="Conectar a partir de"
                className={fieldClass}
                value={parent}
                onValueChange={(value) => setParent(value)}
                options={[
                  { value: "", label: "Conectar depois" },
                  ...ontology.nodes.map((n) => ({
                    value: n.id,
                    label: n.label,
                    description: typeMeta(typeOf(n)).label,
                  })),
                ]}
              />
            </FieldBlock>
            {parent && (
              <FieldBlock label="Relação com o novo elemento">
                <input
                  className={fieldClass}
                  required
                  value={relation}
                  onChange={(e) => setRelation(e.target.value)}
                  placeholder="Ex.: inclui, usa, depende de"
                />
              </FieldBlock>
            )}
          </div>
        )}
        <FieldBlock label="Fonte da informação">
          <input
            className={fieldClass}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Ex.: Workshop com a equipe, CRM ou documento"
          />
        </FieldBlock>
        <details
          className="mb-5 rounded-xl border border-line p-4"
          open={undefined}
        >
          <summary className="cursor-pointer text-[13px] font-medium">
            Identidade e atributos
          </summary>
          <div className="pt-5">
            <FieldBlock label="Representa">
              <Select
                label="Representa"
                value={kind}
                onValueChange={(value) => setKind(value as GraphNode["kind"])}
                options={[
                  {
                    value: "instance",
                    label: "Um elemento concreto",
                    description: "Ex.: Contrato 1042",
                  },
                  {
                    value: "class",
                    label: "Uma definição de tipo",
                    description: "Ex.: Contrato",
                  },
                ]}
              />
            </FieldBlock>
            <FieldBlock label="Domínio de conhecimento">
              <Combobox
                label="Domínio de conhecimento"
                className={fieldClass}
                value={domain}
                onValueChange={(value) => setDomain(value)}
                options={ontology.domains.map((d) => ({
                  value: d.id,
                  label: d.label,
                }))}
              />
            </FieldBlock>
            <FieldBlock label="Identificador / correspondência entre sistemas">
              <input
                className={fieldClass}
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                placeholder="Ex.: CRM Account ID ↔ código no ERP"
              />
            </FieldBlock>
            <FieldBlock label="Atributos · um por linha">
              <textarea
                className={areaClass}
                rows={4}
                value={properties}
                onChange={(e) => setProperties(e.target.value)}
                placeholder={
                  "Status: ativo\nReceita: 120.000 BRL\nVigência: 12 meses"
                }
              />
            </FieldBlock>
          </div>
        </details>
        <details className="rounded-xl border border-line p-4">
          <summary className="cursor-pointer text-[13px] font-medium">
            Regras e autoridade
          </summary>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Documente os limites da operação e quem pode agir. Estas definições
            não executam ações nos sistemas.
          </p>
          <div className="pt-4">
            <FieldBlock label="Política / condição">
              <textarea
                className={areaClass}
                rows={3}
                value={policy}
                onChange={(e) => setPolicy(e.target.value)}
                placeholder="Ex.: Desconto acima de 15% exige aprovação."
              />
            </FieldBlock>
            <FieldBlock label="Quem pode propor, aprovar ou executar">
              <textarea
                className={areaClass}
                rows={3}
                value={permission}
                onChange={(e) => setPermission(e.target.value)}
                placeholder="Ex.: Comercial propõe; diretoria aprova."
              />
            </FieldBlock>
          </div>
        </details>
        <details className="mt-5 rounded-xl border border-line p-4">
          <summary className="cursor-pointer text-[13px] font-medium">
            Avaliação do mapeamento
          </summary>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Avaliação manual de definições, campos, exemplos e evidências. Não
            mede a precisão de nenhum sistema. Elementos não avaliados ficam
            fora da média.
          </p>
          <Checkbox
            className="mt-4"
            label="Este elemento foi avaliado"
            checked={assessed}
            onCheckedChange={setAssessed}
          />
          {assessed && (
            <label className="mt-4 block text-[12px]">
              Cobertura avaliada: {coverage}%
              <input
                aria-label="Cobertura avaliada"
                type="range"
                min="0"
                max="100"
                value={coverage}
                onChange={(e) => setCoverage(Number(e.target.value))}
                className="mt-3 w-full"
              />
            </label>
          )}
        </details>
        {error && (
          <p role="alert" className="mt-4 text-sm text-rose">
            {error}
          </p>
        )}
        </fieldset>
      </form>
    </Drawer>
  );
}
