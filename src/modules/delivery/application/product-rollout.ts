import { deadlineSummary, type TaskDeadline } from "../../catalog/domain/task-deadlines.ts";
import {
  instantiateDeliveries,
  type Product,
  type CycleTemplate,
} from "../../catalog/domain/products.ts";
import type { ProductVersion } from "../../catalog/domain/product-versions.ts";
import type { Delivery } from "../domain/models.ts";
import type { ServiceCycle } from "../domain/services.ts";
import type { ExecutionSnapshot } from "./cycles.ts";
import { mergeTaskOverride } from "../domain/task-overrides.ts";
import { addDays } from "./plan-execution.ts";

export type ProductImpact = {
  cycle: ServiceCycle;
  next: ServiceCycle;
  tasks: Delivery[];
  added: Delivery[];
  changes: string[];
  preserved: string[];
  blocked?: string;
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export type ProductRolloutOptions = {
  /** Omit only for an aggregate preview; null selects explicitly unlinked legacy execution. */
  scope?: { company: string; enrollmentId: string | null };
  enrollmentStarts?: Record<string, string | undefined>;
};
/** Three-way merge: template changes may update untouched fields, never client overrides. */
export function previewProduct(
  product: Product,
  versions: ProductVersion[],
  cycles: ServiceCycle[],
  tasks: Delivery[],
  today: string,
  clientStarts: Record<string, string | undefined> = {},
  options: ProductRolloutOptions = {},
): ProductImpact[] {
  return cycles
    .filter((c) => c.productId === product.id && !c.removed && (!options.scope || (c.company === options.scope.company && (c.enrollmentId ?? null) === options.scope.enrollmentId)))
    .map((cycle) => {
      const result: ProductImpact = {
        cycle,
        next: structuredClone(cycle),
        tasks: [],
        added: [],
        changes: [],
        preserved: [],
      };
      const old =
        cycle.productBaseline ??
        versions
          .find(
            (v) => cycle.productVersion !== undefined && v.version === cycle.productVersion && v.snapshot.id === product.id,
          )
          ?.snapshot.cycles.find((t) => t.id === cycle.templateId);
      const target = product.cycles.find((t) => t.id === cycle.templateId);
      const members = tasks.filter((t) => cycle.taskIds.includes(t.id));
      if (members.length !== new Set(cycle.taskIds).size || members.some(t => t.company !== cycle.company || t.enrollmentId !== cycle.enrollmentId || (t.productId !== undefined && t.productId !== product.id))) {
        result.blocked = "As tarefas do ciclo possuem vínculos ausentes ou incompatíveis. Revise a execução.";
        return result;
      }
      if (
        cycle.status !== "planejado" ||
        cycle.startsAt <= today ||
        members.some(
          (t) =>
            t.status !== "fila" ||
            t.checklist?.some((i) => i.done) ||
            t.evidence ||
            t.effortActual ||
            t.comments?.length ||
            t.history?.length,
        ) ||
        cycle.acceptance.some((a) => a.done)
      ) {
        result.blocked =
          "Histórico preservado: ciclo iniciado, encerrado ou com trabalho registrado.";
        return result;
      }
      if (!old || !target) {
        result.blocked = !target
          ? "Ciclo removido do padrão; cópia do cliente preservada."
          : "Sem versão de origem comparável; ajuste este ciclo individualmente.";
        return result;
      }
      const displayValue = (key: string, value: unknown) => key === "deadline" ? deadlineSummary(value as TaskDeadline | undefined, members) : value === undefined ? "não definido" : typeof value === "boolean" ? (value ? "Sim" : "Não") : String(value);
      const merge = (
        dest: Record<string, unknown>,
        key: string,
        before: unknown,
        after: unknown,
        label: string,
      ) => {
        if (same(before, after)) return;
        if (same(dest[key], before) || (key === "deadline" && !before && (dest[key] as { mode?: string } | undefined)?.mode === "fixed")) {
          dest[key] = structuredClone(after);
          result.changes.push(
            key === "dueAt"
              ? label
              : `${label}: ${displayValue(key, before)} → ${displayValue(key, after)}`,
          );
        } else result.preserved.push(`${label}: ajuste do cliente preservado`);
      };
      merge(
        result.next as unknown as Record<string, unknown>,
        "name",
        old.name,
        target.name,
        "Nome do ciclo",
      );
      merge(
        result.next as unknown as Record<string, unknown>,
        "goal",
        old.goal,
        target.goal,
        "Objetivo do ciclo",
      );
      if (old.durationDays !== target.durationDays) {
        const expected = addDays(cycle.startsAt, old.durationDays - 1);
        if (cycle.endsAt === expected) {
          result.next.endsAt = addDays(cycle.startsAt, target.durationDays - 1);
          result.changes.push(
            `Término: ${cycle.endsAt} → ${result.next.endsAt}`,
          );
        } else
          result.preserved.push(
            "Duração personalizada ou por mês de calendário preservada",
          );
      }
      if (!same(old.acceptance, target.acceptance)) {
        if (
          same(
            cycle.acceptance.map((a) => a.text),
            old.acceptance,
          )
        ) {
          result.next.acceptance = target.acceptance.map((text, i) => ({
            id: `${cycle.id}-v${product.version}-a${i}`,
            text,
            done: false,
          }));
          result.changes.push(
            `Critérios de aceite: ${old.acceptance.join("; ")} → ${target.acceptance.join("; ")}`,
          );
        } else
          result.preserved.push(
            "Critérios de aceite personalizados preservados",
          );
      }
      const generate = (template: CycleTemplate) =>
        instantiateDeliveries(template.deliveries, {
          cycleId: cycle.id,
          company: cycle.company,
          productId: product.id,
          templateId: template.id,
          startsAt: cycle.startsAt,
          clientStartsAt: cycle.enrollmentId ? options.enrollmentStarts?.[cycle.enrollmentId] : clientStarts[cycle.company],
          ownerId: cycle.ownerId,
        });
      let beforeTasks: Delivery[], afterTasks: Delivery[];
      try { beforeTasks = generate(old); afterTasks = generate(target); }
      catch (error) { result.blocked = error instanceof Error ? error.message : "Revise as regras de prazo do ciclo."; return result; }
        const remapRule = (task: Delivery) => {
          const rule = task.deadline;
          if (rule?.mode !== "task") return rule;
          const baseId = rule.taskId.slice(cycle.id.length + 1);
          const base = old.deliveries.find(d => d.id === baseId);
          const actual = members.find(t => t.baseDeliveryId === baseId) ?? members.find(t => base && t.title === base.title && t.cycleTemplateId === cycle.templateId);
          return { ...rule, taskId: actual?.id ?? `${cycle.id}-${baseId}-v${product.version}` };
        };
      for (const row of afterTasks) {
        const before = beforeTasks.find(
          (t) => t.baseDeliveryId === row.baseDeliveryId,
        );
        const legacyMatches = before
          ? members.filter(
              (t) =>
                t.title === before.title &&
                t.cycleTemplateId === cycle.templateId &&
                !old.deliveries.some((d) => d.id === t.baseDeliveryId),
            )
          : [];
        const current =
          members.find((t) => t.baseDeliveryId === row.baseDeliveryId) ??
          (legacyMatches.length === 1 ? legacyMatches[0] : undefined);
        if (!current) {
          // A missing existing row was removed by a human, not added to the template.
          if (before) {
            result.preserved.push(
              `${row.title}: ausência no cliente preservada`,
            );
            continue;
          }
          const added = {
            ...row,
            ...(cycle.enrollmentId ? { enrollmentId: cycle.enrollmentId } : {}),
            id: `${row.id}-v${product.version}`,
            deadline: remapRule(row),
            startsAt: cycle.startsAt,
            milestone: members[0]?.milestone ?? cycle.milestone ?? 1,
            journeyId: members[0]?.journeyId,
          };
          result.added.push(added);
          result.next.taskIds.push(added.id);
          result.changes.push(`Adicionar tarefa: ${row.title}`);
          continue;
        }
        if (!before) {
          result.preserved.push(`${row.title}: sem origem comparável`);
          continue;
        }
        const next = {
          ...structuredClone(current),
          baseDeliveryId: row.baseDeliveryId,
        };
        merge(next as unknown as Record<string, unknown>, "deadline", remapRule(before), remapRule(row), `${current.title} · Regra de prazo`);
        for (const key of [
          "title",
          "description",
          "hours",
          "completion",
          "requiresEvidence",
          "approvalRequired",
          "deliverableTemplateId",
          "responsibleRole",
          "party",
          "dueAt",
        ] as const) {
          merge(
            next as unknown as Record<string, unknown>,
            key,
            before[key],
            row[key],
            `${current.title} · ${key === "dueAt" ? `Prazo: ${current.dueAt} → ${row.dueAt}` : { deadline: "Regra de prazo", title: "Nome", description: "Descrição", hours: "Esforço", completion: "Forma de conclusão", requiresEvidence: "Evidência", approvalRequired: "Aprovação", deliverableTemplateId: "Modelo de documento", responsibleRole: "Papel responsável", party: "Responsabilidade" }[key]}`,
          );
        }
        const labels = (t: Delivery) => (t.checklist ?? []).map((i) => i.title);
        if (!same(labels(before), labels(row))) {
          if (same(labels(current), labels(before))) {
            next.checklist = row.checklist;
            result.changes.push(
              `${current.title} · Checklist: ${labels(before).join("; ") || "vazio"} → ${labels(row).join("; ") || "vazio"}`,
            );
          } else
            result.preserved.push(
              `${current.title} · Checklist personalizado preservado`,
            );
        }
        result.tasks.push(next);
      }
      for (const t of members)
        if (
          t.baseDeliveryId &&
          !result.tasks.some((n) => n.id === t.id) &&
          !target.deliveries.some((d) => d.id === t.baseDeliveryId)
        )
          result.preserved.push(
            `${t.title}: removida do padrão, mantida no cliente`,
          );
      if (!same(old.milestones, target.milestones))
        result.preserved.push(
          "Marcos do plano do cliente preservados; reorganização disponível no plano",
        );
      const finalTasks = [
        ...members.map((t) => result.tasks.find((n) => n.id === t.id) ?? t),
        ...result.added,
      ];
      if (
        finalTasks.some(
          (t) =>
            // A Backlog task (no deadline) has no date to fit in the cycle.
            Boolean(t.dueAt) && (t.dueAt > result.next.endsAt ||
            t.dueAt < cycle.startsAt ||
            (t.startsAt && t.dueAt < t.startsAt)),
        )
      )
        result.blocked =
          "Os novos prazos não cabem no período do ciclo. Ajuste as datas antes de aplicar.";
      if (
        result.next.endsAt !== cycle.endsAt &&
        cycles.some(
          (c) =>
            c.id !== cycle.id &&
            c.company === cycle.company &&
            c.productId === cycle.productId &&
            c.enrollmentId === cycle.enrollmentId &&
            !c.removed &&
            c.startsAt > cycle.endsAt &&
            c.startsAt <= result.next.endsAt,
        )
      )
        result.blocked =
          "A nova duração sobrepõe o próximo ciclo. Ajuste o cronograma antes de aplicar.";
      result.next.productVersion = product.version ?? 1;
      result.next.productBaseline = structuredClone(target);
      return result;
    });
}
export function rolloutFingerprint(cycles: ServiceCycle[], tasks: Delivery[]) {
  return JSON.stringify({ cycles, tasks });
}
/** Apply exactly a reviewed snapshot; a status/date/edit change invalidates the preview. */
export function applyProductImpact<T extends ExecutionSnapshot>(
  state: T,
  impacts: ProductImpact[],
  cycles: ServiceCycle[],
  tasks: Delivery[],
  expected: string,
  by: string,
  at: string,
): T {
  if (rolloutFingerprint(cycles, tasks) !== expected)
    throw new Error("A execução mudou. Gere uma nova prévia antes de aplicar.");
  const next = {
    ...state,
    extraCycles: [...state.extraCycles],
    cycleEdits: { ...state.cycleEdits },
    extraTasks: [...state.extraTasks],
    taskPatches: { ...state.taskPatches },
  };
  for (const impact of impacts) {
    if (impact.blocked)
      throw new Error("Um ciclo selecionado não pode ser atualizado.");
    const cycle = {
      ...impact.next,
      updatedAt: at,
      productUpdates: [
        ...(impact.cycle.productUpdates ?? []),
        { version: impact.next.productVersion!, by, at },
      ],
    };
    if (next.extraCycles.some((c) => c.id === cycle.id))
      next.extraCycles = next.extraCycles.map((c) =>
        c.id === cycle.id ? cycle : c,
      );
    else next.cycleEdits[cycle.id] = cycle;
    for (const task of impact.tasks)
      next.taskPatches[task.id] = mergeTaskOverride(next.taskPatches[task.id] ?? {}, task);
    next.extraTasks.push(...impact.added);
  }
  return next;
}
