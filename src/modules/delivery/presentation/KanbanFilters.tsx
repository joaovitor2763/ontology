"use client";

import { CheckboxGroup, FieldBlock, MultiSelect } from "@g4ai/ds";

import { CollapsibleFilters, type ActiveFilter } from "@/shared/ui/CollapsibleFilters";
import { deliveryLabel, deliveryOrder, formatDate, padMilestone } from "@/shared/lib/format";
import { DatePicker } from "@/shared/ui/DatePicker";
import { FacetFilter } from "@/shared/ui/FacetFilter";
import { Select } from "@/shared/ui/Select";

import type { TaskScope } from "../domain/task-scope";

/** Valor gravado nas visões salvas: não mudar. */
export const MY_CLIENTS = "__meus__";

export type DuePeriod = "all" | "overdue" | "today" | "next7" | "custom";
export type DueOrder = "default" | "soonest";

/** Estado dos filtros do quadro e da lista de tarefas (vive no `Kanban`, entra nas visões salvas). */
export type TaskFilters = {
  scope: TaskScope; setScope: (value: TaskScope) => void;
  q: string; setQ: (value: string) => void;
  clients: string[]; setClients: (value: string[]) => void;
  owners: string[]; setOwners: (value: string[]) => void;
  milestones: string[]; setMilestones: (value: string[]) => void;
  kinds: string[]; setKinds: (value: string[]) => void;
  statuses: string[]; setStatuses: (value: string[]) => void;
  period: DuePeriod; setPeriod: (value: DuePeriod) => void;
  dateFrom: string; setDateFrom: (value: string) => void;
  dateTo: string; setDateTo: (value: string) => void;
  dueOrder: DueOrder; setDueOrder: (value: DueOrder) => void;
};

const scopeOptions = [
  { value: "project", label: "Tarefas do Projeto" },
  { value: "requests", label: "Tarefas de Tickets e Solicitações" },
  { value: "all", label: "Todas as tarefas" },
];
const kindOptions = [
  { id: "ciclo", label: "Ciclo" },
  { id: "plano", label: "Plano" },
  { id: "solicitacao", label: "Ticket / Solicitação" },
];
const periodOptions: { value: DuePeriod; label: string }[] = [
  { value: "all", label: "Qualquer prazo" },
  { value: "overdue", label: "Atrasadas" },
  { value: "today", label: "Hoje" },
  { value: "next7", label: "Próximos 7 dias" },
  { value: "custom", label: "Intervalo" },
];
const orderOptions = [
  { value: "soonest", label: "Prazo mais próximo" },
  { value: "default", label: "Por cliente" },
];
const statusOptions = deliveryOrder.map((id) => ({ id, label: deliveryLabel[id] }));

const names = (ids: string[], options: { id: string; label: string }[]) =>
  ids.map((id) => options.find((option) => option.id === id)?.label ?? id).join(", ");
const asValues = (options: { id: string; label: string }[]) =>
  options.map(({ id, label }) => ({ value: id, label }));

export function KanbanFilters({
  filters: f,
  company,
  companies,
  members,
  milestoneOptions,
  shown,
  total,
  onClear,
}: {
  filters: TaskFilters;
  /** Quadro de um cliente: sem filtro de cliente, com filtro de marco. */
  company?: string;
  companies: readonly { slug: string; name: string }[];
  members: readonly { id: string; name: string }[];
  milestoneOptions: readonly { n: number; name: string }[];
  shown: number;
  total: number;
  onClear: () => void;
}) {
  const clientOptions = [{ id: MY_CLIENTS, label: "Meus clientes (alocado)" }, ...companies.map((c) => ({ id: c.slug, label: c.name }))];
  const ownerOptions = members.map((p) => ({ id: p.id, label: p.name }));
  const msOptions = milestoneOptions.map((m) => ({ id: String(m.n), label: `${padMilestone(m.n)} · ${m.name}` }));
  const showMilestones = Boolean(company) && msOptions.length > 0;
  const choosePeriod = (value: string) => f.setPeriod(value as DuePeriod);
  const chooseOrder = (value: string) => f.setDueOrder(value as DueOrder);

  const applied: ActiveFilter[] = [];
  if (f.scope !== "project")
    applied.push({ key: "scope", label: scopeOptions.find((o) => o.value === f.scope)?.label ?? f.scope, onRemove: () => f.setScope("project") });
  if (!company && f.clients.length) applied.push({ key: "clients", label: `Cliente: ${names(f.clients, clientOptions)}`, onRemove: () => f.setClients([]) });
  if (f.owners.length) applied.push({ key: "owners", label: `Responsável: ${names(f.owners, ownerOptions)}`, onRemove: () => f.setOwners([]) });
  if (showMilestones && f.milestones.length) applied.push({ key: "milestones", label: `Marco: ${names(f.milestones, msOptions)}`, onRemove: () => f.setMilestones([]) });
  if (f.kinds.length) applied.push({ key: "kinds", label: `Origem: ${names(f.kinds, kindOptions)}`, onRemove: () => f.setKinds([]) });
  if (f.statuses.length) applied.push({ key: "statuses", label: `Status: ${names(f.statuses, statusOptions)}`, onRemove: () => f.setStatuses([]) });
  if (f.period !== "all")
    applied.push({
      key: "period",
      label: f.period === "custom"
        ? `Prazo: ${f.dateFrom ? formatDate(f.dateFrom) : "…"} – ${f.dateTo ? formatDate(f.dateTo) : "…"}`
        : `Prazo: ${periodOptions.find((o) => o.value === f.period)?.label}`,
      onRemove: () => { f.setPeriod("all"); f.setDateFrom(""); f.setDateTo(""); },
    });

  return (
    <CollapsibleFilters
      label="Filtros das tarefas"
      className="mb-5 w-full min-w-0 shrink-0"
      query={f.q}
      onQuery={f.setQ}
      placeholder="Filtrar tarefas…"
      active={applied}
      onClear={onClear}
      shown={shown}
      total={total}
      noun="tarefa"
      showCount={false}
      sheet={
        <>
          <Select label="Escopo das tarefas" hideLabel={false} value={f.scope} onValueChange={(value) => f.setScope(value as TaskScope)} options={scopeOptions} />
          {!company && <MultiSelect label="Cliente" options={asValues(clientOptions)} value={f.clients} onValueChange={f.setClients} />}
          <MultiSelect label="Responsável" options={asValues(ownerOptions)} value={f.owners} onValueChange={f.setOwners} />
          {showMilestones && <MultiSelect label="Marco" options={asValues(msOptions)} value={f.milestones} onValueChange={f.setMilestones} />}
          <CheckboxGroup label="Origem" options={asValues(kindOptions)} value={f.kinds} onValueChange={f.setKinds} />
          <CheckboxGroup label="Status" options={asValues(statusOptions)} value={f.statuses} onValueChange={f.setStatuses} />
          <Select label="Período do prazo" hideLabel={false} value={f.period} onValueChange={choosePeriod} options={periodOptions} />
          {f.period === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <FieldBlock label="Prazo a partir de">
                <DatePicker label="Prazo a partir de" value={f.dateFrom} max={f.dateTo || undefined} onValueChange={f.setDateFrom} />
              </FieldBlock>
              <FieldBlock label="Prazo até">
                <DatePicker label="Prazo até" value={f.dateTo} min={f.dateFrom || undefined} onValueChange={f.setDateTo} />
              </FieldBlock>
            </div>
          )}
          <Select label="Ordenação das tarefas" hideLabel={false} value={f.dueOrder} onValueChange={chooseOrder} options={orderOptions} />
        </>
      }
    >
      <Select label="Escopo das tarefas" size="compact" value={f.scope} onValueChange={(value) => f.setScope(value as TaskScope)} options={scopeOptions} />
      {!company && <FacetFilter label="Cliente" options={clientOptions} value={f.clients} onChange={f.setClients} />}
      <FacetFilter label="Responsável" options={ownerOptions} value={f.owners} onChange={f.setOwners} />
      {showMilestones && <FacetFilter label="Marco" options={msOptions} value={f.milestones} onChange={f.setMilestones} />}
      <FacetFilter label="Origem" options={kindOptions} value={f.kinds} onChange={f.setKinds} />
      <FacetFilter label="Status" options={statusOptions} value={f.statuses} onChange={f.setStatuses} />
      <Select label="Período do prazo" size="compact" className="min-w-36 shrink-0" value={f.period} onValueChange={choosePeriod} options={periodOptions} />
      {f.period === "custom" && (
        <>
          <DatePicker label="Prazo a partir de" value={f.dateFrom} max={f.dateTo || undefined} onValueChange={f.setDateFrom} className="h-9 rounded-lg border border-line bg-surface px-2 text-caption" />
          <DatePicker label="Prazo até" value={f.dateTo} min={f.dateFrom || undefined} onValueChange={f.setDateTo} className="h-9 rounded-lg border border-line bg-surface px-2 text-caption" />
        </>
      )}
      <Select label="Ordenação das tarefas" size="compact" className="min-w-44 shrink-0" value={f.dueOrder} onValueChange={chooseOrder} options={orderOptions} />
    </CollapsibleFilters>
  );
}
