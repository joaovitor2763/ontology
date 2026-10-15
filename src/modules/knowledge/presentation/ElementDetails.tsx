"use client";
import type {
  GraphEdge,
  GraphNode,
  Ontology,
} from "@/modules/knowledge/domain/models";
import {
  elementChecks,
  relationName,
  typeMeta,
  typeOf,
} from "@/modules/knowledge/domain/ontology";
import { CoverageBadge } from "@/modules/knowledge/presentation/Coverage";
import { ElementIcon } from "@/modules/knowledge/presentation/ElementIcon";
import { Button } from "@/shared/ui/primitives";
import {
  ArrowRight,
  Check,
  CircleDashed,
  Link2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

export function ElementDetails({
  node,
  ontology,
  onEdit,
  onConnect,
  onCreate,
  onSelect,
  onEdge,
  onDelete,
}: {
  node: GraphNode;
  ontology: Ontology;
  onEdit: () => void;
  onConnect: () => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onEdge: (edge: GraphEdge) => void;
  onDelete: () => void;
}) {
  const meta = typeMeta(typeOf(node));
  const links = ontology.edges.filter(
    (e) => e.from === node.id || e.to === node.id,
  );
  const checks = elementChecks(node, ontology);
  const owner = ontology.nodes.find((n) => n.id === node.ownerId);
  return (
    <div className="space-y-6">
      <div>
        <div
          className="mb-3 flex items-center gap-2 text-[12px]"
          style={{ color: meta.color }}
        >
          <ElementIcon type={meta.id} />
          {meta.label}
          <span className="text-muted">
            ·{" "}
            {node.kind === "class" ? "Definição de tipo" : "Elemento concreto"}
          </span>
        </div>
        <h3 className="break-words text-[20px] font-semibold leading-snug tracking-tight">
          {node.label}
        </h3>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          {node.description ||
            "Defina este elemento para que a equipe compartilhe o mesmo entendimento."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </Button>
        <Button size="sm" variant="ghost" onClick={onConnect}>
          <Link2 className="h-3.5 w-3.5" />
          Conectar
        </Button>
      </div>
      <dl className="space-y-4 border-y border-line py-5 text-[12px]">
        <div>
          <dt className="mb-1 text-muted">Responsável</dt>
          <dd>
            {owner ? (
              <button
                className="text-blue hover:underline"
                onClick={() => onSelect(owner.id)}
              >
                {owner.label}
              </button>
            ) : (
              "Não definido"
            )}
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-muted">Estado atual</dt>
          <dd>{node.state || "Não registrado"}</dd>
        </div>
        <div>
          <dt className="mb-1 text-muted">Fonte</dt>
          <dd className="break-words leading-relaxed">
            {node.source || "Não informada"}
          </dd>
        </div>
        {node.identity && (
          <div>
            <dt className="mb-1 text-muted">Identidade</dt>
            <dd className="break-words">{node.identity}</dd>
          </div>
        )}
      </dl>
      <div>
        <div className="flex justify-between gap-3 text-[12px]">
          <h4 className="font-medium">Documentação</h4>
          <span className="text-muted">
            {checks.filter((c) => c.done).length} de {checks.length}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2">
          {checks.map((c) => (
            <span
              key={c.label}
              className={`flex items-center gap-1.5 text-[11px] ${c.done ? "text-ok" : "text-muted"}`}
            >
              {c.done ? (
                <Check className="h-3 w-3" />
              ) : (
                <CircleDashed className="h-3 w-3" />
              )}
              {c.label}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          Presença de informações no cadastro. Não indica validação do
          conteúdo.
        </p>
      </div>
      {node.coverageAssessed !== false && (
        <div className="border-t border-line pt-4">
          <h4 className="mb-3 text-[12px] font-medium">
            Avaliação manual do mapeamento
          </h4>
          <CoverageBadge value={node.coverage} withLegend />
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            Definida pela equipe. Edite para revisar a avaliação.
          </p>
        </div>
      )}
      {node.properties.length > 0 && (
        <div>
          <h4 className="mb-3 text-[12px] font-medium">Atributos</h4>
          <div className="flex flex-wrap gap-2">
            {node.properties.map((p, i) => (
              <span
                key={`${p}-${i}`}
                className="max-w-full break-words rounded-lg bg-soft px-2.5 py-1.5 text-[11px] text-ink-soft"
              >
                {p.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}
      {(node.policy || node.permission) && (
        <div className="rounded-xl border border-line p-4">
          <h4 className="mb-3 text-[12px] font-medium">Regras e autoridade</h4>
          {node.policy && (
            <p className="mb-3 text-[12px] leading-relaxed">
              <span className="block text-muted">Política</span>
              {node.policy}
            </p>
          )}
          {node.permission && (
            <p className="text-[12px] leading-relaxed">
              <span className="block text-muted">Permissão</span>
              {node.permission}
            </p>
          )}
        </div>
      )}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-[12px] font-medium">
            Conexões <span className="ml-1 text-muted">{links.length}</span>
          </h4>
          <button
            onClick={onConnect}
            aria-label="Adicionar conexão"
            className="rounded-md p-1 text-blue hover:bg-soft"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2">
          {links.map((edge) => {
            const outgoing = edge.from === node.id;
            const other = ontology.nodes.find(
              (n) => n.id === (outgoing ? edge.to : edge.from),
            );
            return (
              <div key={edge.id} className="rounded-xl border border-line p-3">
                <button
                  onClick={() => onEdge(edge)}
                  className="mb-1.5 flex max-w-full items-center gap-1.5 text-left text-[10px] text-muted hover:text-blue"
                >
                  <ArrowRight
                    className={`h-3 w-3 shrink-0 ${outgoing ? "" : "rotate-180"}`}
                  />
                  <span>
                    {outgoing ? "Saída" : "Entrada"} ·{" "}
                    {relationName(edge.label)}
                  </span>
                </button>
                <button
                  onClick={() => other && onSelect(other.id)}
                  className="text-left text-[12px] font-medium leading-relaxed hover:text-blue"
                >
                  {other?.label}
                </button>
              </div>
            );
          })}
          {!links.length && (
            <p className="text-[12px] leading-relaxed text-muted">
              Este elemento ainda está isolado. Conecte-o a uma área, pessoa ou
              outro elemento.
            </p>
          )}
        </div>
        <Button
          className="mt-3 w-full"
          size="sm"
          variant="ghost"
          onClick={onCreate}
        >
          <Plus className="h-3.5 w-3.5" />
          Criar elemento conectado
        </Button>
      </div>
      <div className="border-t border-line pt-4">
        <button
          onClick={onDelete}
          className="flex items-center gap-2 text-[12px] text-muted hover:text-rose"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remover elemento
        </button>
      </div>
    </div>
  );
}
