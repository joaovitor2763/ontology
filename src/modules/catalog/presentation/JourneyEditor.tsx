"use client";
import { CatalogOperationFeedback, type CatalogOperationUI } from "./useCatalogOperations";

import {
  journeyError,
  milestoneError,
  type JourneyMilestone,
  type JourneyTemplate,
} from "@/modules/catalog/domain/models";
import { validateSchedules } from "@/modules/catalog/domain/schedule";
import { allocationRoleLabel } from "@/modules/clients/domain/allocation";
import { cn } from "@/shared/lib/cn";
import { padMilestone } from "@/shared/lib/format";
import { areaClass, Drawer, FieldBlock, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import {
  ListEditor,
  TaskListEditor,
} from "./journey-editor/ListEditors";

type JourneyEditorProps = {
  open: boolean;
  initial?: JourneyTemplate | null;
  onClose: () => void;
  onSave: (j: JourneyTemplate) => void;
  operation?: CatalogOperationUI;
};

export function JourneyEditor(props: JourneyEditorProps) {
  return props.open ? (
    <JourneyEditorContent key={props.initial?.id ?? "new"} {...props} />
  ) : null;
}

const slug = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const blank = (n: number, stage = ""): JourneyMilestone => ({
  n,
  stage,
  name: "",
  owner: "Responsável",
  goal: "",
  durationWeeks: 2,
  exitCriteria: [],
  tasks: [],
});

function JourneyEditorContent({
  operation,
  open,
  initial,
  onClose,
  onSave,
}: JourneyEditorProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [milestones, setMilestones] = useState<JourneyMilestone[]>(
    () =>
      initial?.milestones.map((m) => ({
        ...m,
        exitCriteria: [...(m.exitCriteria ?? [])],
        tasks: (m.tasks ?? []).map((t) => ({
          ...t,
          checklistItems: t.checklistItems ? [...t.checklistItems] : undefined,
          schedule: t.schedule ? { ...t.schedule } : undefined,
        })),
      })) ?? [
        { ...blank(1, "Alinhamento"), name: "Kickoff" },
        { ...blank(2, "Execução"), name: "Primeira tarefa" },
        { ...blank(3, "Encerramento"), name: "Encerramento" },
      ],
  );
  const [expanded, setExpanded] = useState<number | null>(
    initial ? null : 0,
  );
  const [error, setError] = useState<{ index: number | null; text: string }>({
    index: null,
    text: "",
  });
  const [suffix] = useState(() => Math.random().toString(36).slice(2, 5));
  const planId = initial?.id ?? `${slug(name) || "plano"}-${suffix}`;

  function renumber(list: JourneyMilestone[]) {
    return list.map((m, i) => ({ ...m, n: i + 1 }));
  }
  function patch(i: number, changes: Partial<JourneyMilestone>) {
    setMilestones((ms) => ms.map((m, j) => (j === i ? { ...m, ...changes } : m)));
  }
  function move(i: number, delta: number) {
    setMilestones((ms) => {
      const j = i + delta;
      if (j < 0 || j >= ms.length) return ms;
      const next = ms.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return renumber(next);
    });
    setExpanded(i + delta);
  }
  function submit() {
    if(operation?.busy)return;
    const journey: JourneyTemplate = {
      ...initial,
      id: planId,
      name: name.trim(),
      description: description.trim(),
      milestones: renumber(milestones).map((m) => ({
        ...m,
        name: m.name.trim(),
        stage: m.stage.trim() || "Etapa",
        owner: m.owner.trim() || "Responsável",
        goal: m.goal?.trim() || undefined,
        exitCriteria: (m.exitCriteria ?? [])
          .map((c) => c.trim())
          .filter(Boolean),
        tasks: (m.tasks ?? []).map((t) => ({
          ...t,
          title: t.title.trim(),
          description: t.description.trim(),
          checklistItems: t.checklistItems
            ?.map((c) => c.trim())
            .filter(Boolean),
          schedule:
            t.schedule && t.schedule.mode !== "none" ? t.schedule : undefined,
        })),
      })),
    };
    const bad = journey.milestones.findIndex(
      (m) => milestoneError(m) || validateSchedules(m.tasks ?? []),
    );
    const problem =
      journeyError(journey) ??
      (bad >= 0
        ? `${journey.milestones[bad].name || `Marco ${bad + 1}`}: ${validateSchedules(journey.milestones[bad].tasks ?? [])}`
        : null);
    if (problem) {
      setError({ index: bad >= 0 ? bad : null, text: problem });
      if (bad >= 0) setExpanded(bad);
      return;
    }
    onSave(journey);
  }

  return (
    <Drawer
      open={open}
      onClose={()=>{if(!operation?.busy)onClose();}}
      kicker={initial ? "Editar plano" : "Novo plano"}
      title={name || "Plano sem nome"}
      footer={
        <div className="flex items-center justify-between gap-3">
          {error.text ? (
            <p role="alert" className="text-[12.5px] text-rose">
              {error.text}
            </p>
          ) : (
            <span className="text-[12px] text-muted">
              {milestones.length} marco{milestones.length === 1 ? "" : "s"}
              {initial?.version ? ` · rascunho sobre a v${initial.version}` : ""}
            </span>
          )}
          <div className="flex gap-2">
            <Button disabled={operation?.busy} variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button disabled={operation?.busy} onClick={submit}>{operation?.busy ? "Salvando…" : "Salvar rascunho"}</Button>
          </div>
        </div>
      }
    >
      <CatalogOperationFeedback operation={operation} />
      <fieldset disabled={operation?.busy} className="space-y-5">
      <FieldBlock label="Nome do plano">
        <input
          className={fieldClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tarefa de consultoria"
        />
      </FieldBlock>
      <FieldBlock label="Descrição">
        <input
          className={fieldClass}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Para que tipo de contrato este plano serve"
        />
      </FieldBlock>
      <div className="mb-2 mt-2 flex items-center justify-between">
        <div className="text-[12.5px] text-muted">
          Marcos · cada um pode ser executado por um ou mais ciclos
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"
          onClick={() => {
            setMilestones((ms) => [
              ...ms,
              blank(ms.length + 1, ms.at(-1)?.stage ?? ""),
            ]);
            setExpanded(milestones.length);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Marco
        </button>
      </div>
      <div className="space-y-2">
        {milestones.map((m, i) => {
          const isOpen = expanded === i;
          const bad = error.index === i;
          return (
            <div
              key={i}
              className={cn(
                "rounded-xl ring-1",
                bad ? "ring-rose/40" : "ring-line",
              )}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : i)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="w-9 shrink-0 text-[11px] tabular-nums text-muted">
                    {padMilestone(i + 1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {m.name || "Marco sem nome"}
                  </span>
                  <span className="hidden text-[11px] text-muted sm:inline">
                    {m.durationWeeks ? `${m.durationWeeks} sem` : ""}
                    {m.tasks?.length
                      ? ` · ${m.tasks.length} tarefa${m.tasks.length === 1 ? "" : "s"}`
                      : ""}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-muted transition-transform",
                      !isOpen && "-rotate-90",
                    )}
                  />
                </button>
                <button
                  type="button"
                  aria-label="Mover marco para cima"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="rounded p-1 text-muted hover:text-ink disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Mover marco para baixo"
                  disabled={i === milestones.length - 1}
                  onClick={() => move(i, 1)}
                  className="rounded p-1 text-muted hover:text-ink disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Remover marco"
                  className="rounded p-1 text-muted hover:text-rose disabled:opacity-30"
                  onClick={() => {
                    setMilestones((ms) =>
                      renumber(ms.filter((_, j) => j !== i)),
                    );
                    setExpanded(null);
                  }}
                  disabled={milestones.length <= 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {isOpen && (
                <div className="border-t border-line px-3 pb-4 pt-3">
                  <FieldBlock label="Nome do marco">
                    <input
                      className={fieldClass}
                      value={m.name}
                      onChange={(e) => patch(i, { name: e.target.value })}
                      placeholder="Plano de melhoria aprovado"
                    />
                  </FieldBlock>
                  <div className="grid gap-x-4 sm:grid-cols-3">
                    <FieldBlock label="Etapa">
                      <input
                        className={fieldClass}
                        value={m.stage}
                        onChange={(e) => patch(i, { stage: e.target.value })}
                        placeholder="Diagnóstico"
                      />
                    </FieldBlock>
                    <FieldBlock label="Responsável">
                      <input
                        className={fieldClass}
                        list="milestone-owners"
                        value={m.owner}
                        onChange={(e) => patch(i, { owner: e.target.value })}
                      />
                    </FieldBlock>
                    <FieldBlock label="Duração (semanas)">
                      <input
                        type="number"
                        min={1}
                        max={52}
                        className={fieldClass}
                        value={m.durationWeeks ?? ""}
                        onChange={(e) =>
                          patch(i, {
                            durationWeeks: e.target.value
                              ? Number(e.target.value)
                              : undefined,
                          })
                        }
                      />
                    </FieldBlock>
                  </div>
                  <FieldBlock label="Objetivo">
                    <textarea
                      rows={2}
                      className={areaClass}
                      value={m.goal ?? ""}
                      onChange={(e) => patch(i, { goal: e.target.value })}
                      placeholder="O que precisa ser verdade quando este marco terminar"
                    />
                  </FieldBlock>
                  <ListEditor
                    label="Critérios de saída"
                    addLabel="Critério"
                    placeholder="Plano aprovado pelo patrocinador"
                    values={m.exitCriteria ?? []}
                    onChange={(exitCriteria) => patch(i, { exitCriteria })}
                  />
                  <TaskListEditor
                    milestoneId={`${planId}-m${i + 1}`}
                    tasks={m.tasks ?? []}
                    onChange={(tasks) => patch(i, { tasks })}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <datalist id="milestone-owners">
        {Object.values(allocationRoleLabel).map((label) => (
          <option key={label} value={label} />
        ))}
        <option value="Responsável + CS" />
        <option value="Responsável + cliente" />
      </datalist>
      <p className="mt-4 text-[12px] leading-5 text-muted">
        Salvar guarda um rascunho. Os clientes seguem a última versão publicada;
        publique na tela de Planos quando o rascunho estiver pronto.
      </p>
      </fieldset>
    </Drawer>
  );
}
