"use client";

import { CheckboxGroup, collectionThresholds, FieldBlock, MultiSelect } from "@g4ai/ds";

import { healthFlagLabel } from "@/modules/clients/domain/models";
import { serviceModelLabel } from "@/modules/clients/domain/service-config";
import { NO_RESPONSIBLE } from "@/modules/clients/domain/responsibility-filters";
import { formatDate } from "@/shared/lib/format";
import { Combobox } from "@/shared/ui/Combobox";
import { DatePicker } from "@/shared/ui/DatePicker";
import { FacetFilter } from "@/shared/ui/FacetFilter";
import { Switch } from "@/shared/ui/Switch";

import { CollapsibleFilters, type ActiveFilter } from "@/shared/ui/CollapsibleFilters";
import { EntryDateFilter } from "../EntryDateFilter";
import { ResponsibleFilters } from "../ResponsibleFilters";

export const ALL = "__all__";
export const NONE = "__none__";

type Member = { id: string; name: string };

/** Estado dos filtros da lista de Clientes (vive na tela, entra nas visões salvas). */
export type ClientFilters = {
  q: string; setQ: (value: string) => void;
  productId: string; setProductId: (value: string) => void;
  cycleName: string; setCycleName: (value: string) => void;
  entryFrom: string; setEntryFrom: (value: string) => void;
  entryTo: string; setEntryTo: (value: string) => void;
  health: string[]; setHealth: (value: string[]) => void;
  models: string[]; setModels: (value: string[]) => void;
  leads: string[]; setLeads: (value: string[]) => void;
  productLeads: string[]; setProductLeads: (value: string[]) => void;
  archived: boolean; setArchived: (value: boolean) => void;
};

const names = (ids: string[], options: { id: string; label: string }[]) =>
  ids.map((id) => options.find((option) => option.id === id)?.label ?? id).join(", ");

export function ClientesFilters({
  filters: f,
  products,
  cycleOptions,
  members,
  active,
  shown,
  total,
  onClear,
  className,
}: {
  filters: ClientFilters;
  products: { id: string; name: string }[];
  cycleOptions: { value: string; label: string }[];
  members: Member[];
  active: Member[];
  shown: number;
  total: number;
  onClear: () => void;
  className?: string;
}) {
  const productOptions = [
    { value: ALL, label: "Todos os produtos" },
    { value: NONE, label: "Nenhum produto" },
    ...products.map((product) => ({ value: product.id, label: product.name })),
  ];
  const concreteProduct = f.productId !== ALL && f.productId !== NONE;
  const healthOptions = Object.entries(healthFlagLabel).map(([id, label]) => ({ id, label }));
  const modelOptions = Object.entries(serviceModelLabel).map(([id, label]) => ({ id, label }));
  const responsibleOptions = [
    { id: NO_RESPONSIBLE, label: "Sem responsável" },
    ...members
      .filter((member) => active.some((row) => row.id === member.id) || f.leads.includes(member.id) || f.productLeads.includes(member.id))
      .map((member) => ({ id: member.id, label: member.name })),
  ];
  const chooseProduct = (id: string) => { f.setProductId(id); f.setProductLeads([]); };

  const applied: ActiveFilter[] = [];
  if (f.productId !== ALL)
    applied.push({ key: "product", label: f.productId === NONE ? "Sem produto" : `Produto: ${productOptions.find((o) => o.value === f.productId)?.label ?? f.productId}`, onRemove: () => chooseProduct(ALL) });
  if (f.cycleName !== ALL)
    applied.push({ key: "cycle", label: f.cycleName === NONE ? "Sem ciclo atual" : `Ciclo: ${f.cycleName}`, onRemove: () => f.setCycleName(ALL) });
  if (f.entryFrom || f.entryTo)
    applied.push({
      key: "entry",
      label: `Entrada: ${f.entryFrom ? formatDate(f.entryFrom) : "…"} – ${f.entryTo ? formatDate(f.entryTo) : "…"}`,
      onRemove: () => { f.setEntryFrom(""); f.setEntryTo(""); },
    });
  if (f.health.length) applied.push({ key: "health", label: `Saúde: ${names(f.health, healthOptions)}`, onRemove: () => f.setHealth([]) });
  if (f.models.length) applied.push({ key: "models", label: `Modelo: ${names(f.models, modelOptions)}`, onRemove: () => f.setModels([]) });
  if (f.leads.length) applied.push({ key: "leads", label: `Responsável: ${names(f.leads, responsibleOptions)}`, onRemove: () => f.setLeads([]) });
  if (f.productLeads.length) applied.push({ key: "productLeads", label: `Responsável pelo produto: ${names(f.productLeads, responsibleOptions)}`, onRemove: () => f.setProductLeads([]) });
  if (f.archived) applied.push({ key: "archived", label: "Arquivados", onRemove: () => f.setArchived(false) });

  return (
    <CollapsibleFilters
      query={f.q}
      onQuery={f.setQ}
      placeholder="Buscar cliente, cidade, responsável…"
      showSearch={total >= collectionThresholds.search}
      active={applied}
      onClear={onClear}
      shown={shown}
      total={total}
      noun="cliente"
      className={className}
      sheet={
        <>
          <Combobox label="Produto" hideLabel={false} value={f.productId} onValueChange={chooseProduct} options={productOptions} />
          <Combobox label="Ciclo atual" hideLabel={false} value={f.cycleName} onValueChange={f.setCycleName} options={cycleOptions} />
          <div className="grid grid-cols-2 gap-3">
            <FieldBlock label="Entrada a partir de">
              <DatePicker label="Entrada a partir de" value={f.entryFrom} onValueChange={f.setEntryFrom} />
            </FieldBlock>
            <FieldBlock label="Entrada até">
              <DatePicker label="Entrada até" value={f.entryTo} onValueChange={f.setEntryTo} />
            </FieldBlock>
          </div>
          <CheckboxGroup label="Saúde" options={healthOptions.map(({ id, label }) => ({ value: id, label }))} value={f.health} onValueChange={f.setHealth} />
          <CheckboxGroup label="Modelo" options={modelOptions.map(({ id, label }) => ({ value: id, label }))} value={f.models} onValueChange={f.setModels} />
          <MultiSelect label="Responsável pelo cliente" options={responsibleOptions.map(({ id, label }) => ({ value: id, label }))} value={f.leads} onValueChange={f.setLeads} />
          {concreteProduct && (
            <MultiSelect label="Responsável pelo produto" options={responsibleOptions.map(({ id, label }) => ({ value: id, label }))} value={f.productLeads} onValueChange={f.setProductLeads} />
          )}
          <Switch label="Mostrar arquivados" checked={f.archived} onCheckedChange={f.setArchived} />
        </>
      }
    >
      <div className="min-w-[170px] flex-1 sm:max-w-[220px]">
        <Combobox label="Filtrar por produto" value={f.productId} onValueChange={chooseProduct} options={productOptions} />
      </div>
      <div className="min-w-[170px] flex-1 sm:max-w-[220px]">
        <Combobox label="Filtrar por ciclo atual" value={f.cycleName} onValueChange={f.setCycleName} options={cycleOptions} />
      </div>
      <EntryDateFilter from={f.entryFrom} to={f.entryTo} onFrom={f.setEntryFrom} onTo={f.setEntryTo} />
      <FacetFilter label="Saúde" options={healthOptions} value={f.health} onChange={f.setHealth} />
      <FacetFilter label="Modelo" options={modelOptions} value={f.models} onChange={f.setModels} />
      <ResponsibleFilters showProduct={concreteProduct} members={members} active={active} client={f.leads} product={f.productLeads} onClient={f.setLeads} onProduct={f.setProductLeads} />
      <Switch label="Mostrar arquivados" checked={f.archived} onCheckedChange={f.setArchived} />
    </CollapsibleFilters>
  );
}
