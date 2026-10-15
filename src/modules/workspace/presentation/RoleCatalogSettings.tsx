"use client";

import { systemAllocationRoleLabels } from "@/modules/clients/domain/allocation";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { deliveryRoles, type NamedRole } from "@/modules/workspace/domain/models";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { usePermissions } from "./usePermissions";
import { useTeam } from "./useTeam";
import { useWorkspaceOperation, WorkspaceOperationFeedback } from "./useWorkspaceOperation";

function customRoleId(label: string) {
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "papel";
  return `custom-${slug}-${crypto.randomUUID().slice(0, 8)}`;
}

export function RoleCatalogSettings() {
  const { memberRoles, allocationRoles } = useWorkspaceState();
  return <div className="mt-8 grid items-start gap-4 lg:grid-cols-2">
    <MemberRoleSettings key={JSON.stringify(memberRoles)} initialRoles={memberRoles} />
    <AllocationRoleSettings key={JSON.stringify(allocationRoles)} initialRoles={allocationRoles} />
  </div>;
}

function MemberRoleSettings({ initialRoles }: { initialRoles: string[] }) {
  const workspace = useWorkspaceState();
  const { members } = useTeam();
  const { can } = usePermissions();
  const operation = useWorkspaceOperation();
  const [draft, setDraft] = useState(initialRoles);
  const [newRole, setNewRole] = useState("");
  const [error, setError] = useState("");
  const canManage = can("configuracoes.editar");

  function addRole() {
    const label = newRole.trim();
    if (!label) return;
    if ([...deliveryRoles, ...draft].some(role => role.toLocaleLowerCase("pt-BR") === label.toLocaleLowerCase("pt-BR"))) {
      setError("Este cargo já está cadastrado.");
      return;
    }
    setError("");
    setDraft(current => [...current, label]);
    setNewRole("");
  }

  return <div>
    <RoleCard
      title="Cargos da equipe"
      description="Descrevem a posição organizacional da pessoa, sem criar acesso nem alocação."
      system={deliveryRoles.map(label => ({ id: label, label }))}
      custom={draft.map(label => ({ id: label, label }))}
      value={newRole}
      placeholder="Ex.: Head de Operações"
      canManage={canManage}
      busy={operation.pending}
      canRenameUsed={false}
      used={role => members.filter(member => member.role === role.id).length}
      onValue={setNewRole}
      onAdd={addRole}
      onLabel={(id, label) => setDraft(current => current.map(role => role === id ? label : role))}
      onRemove={id => setDraft(current => current.filter(role => role !== id))}
      onSave={() => {
        const roles = draft.map(role => role.trim()).filter(Boolean);
        void operation.run("workspace.settings.update", { memberRoles: roles }, () => workspace.setMemberRoles(roles));
      }}
    />
    {error ? <p role="alert" className="mt-2 text-sm text-rose">{error}</p> : null}
    <WorkspaceOperationFeedback operation={operation} />
  </div>;
}

function AllocationRoleSettings({ initialRoles }: { initialRoles: NamedRole[] }) {
  const workspace = useWorkspaceState();
  const { allocations } = useClientsState();
  const { can } = usePermissions();
  const operation = useWorkspaceOperation();
  const [draft, setDraft] = useState(initialRoles);
  const [newRole, setNewRole] = useState("");
  const [error, setError] = useState("");
  const canManage = can("configuracoes.editar");

  function addRole() {
    const label = newRole.trim();
    if (!label) return;
    if ([...Object.values(systemAllocationRoleLabels), ...draft.map(role => role.label)].some(role => role.toLocaleLowerCase("pt-BR") === label.toLocaleLowerCase("pt-BR"))) {
      setError("Este papel já está cadastrado.");
      return;
    }
    setError("");
    setDraft(current => [...current, { id: customRoleId(label), label }]);
    setNewRole("");
  }

  return <div>
    <RoleCard
      title="Papéis nas equipes dos clientes"
      description="Descrevem a atuação em um cliente ou em uma contratação. Responsável e CX continuam únicos em cada escopo."
      system={Object.entries(systemAllocationRoleLabels).map(([id, label]) => ({ id, label }))}
      custom={draft}
      value={newRole}
      placeholder="Ex.: Especialista de Dados"
      canManage={canManage}
      busy={operation.pending}
      canRenameUsed
      used={role => allocations.filter(allocation => allocation.role === role.id).length}
      onValue={setNewRole}
      onAdd={addRole}
      onLabel={(id, label) => setDraft(current => current.map(role => role.id === id ? { ...role, label } : role))}
      onRemove={id => setDraft(current => current.filter(role => role.id !== id))}
      onSave={() => {
        const roles = draft.map(role => ({ ...role, label: role.label.trim() })).filter(role => role.label);
        void operation.run("workspace.settings.update", { allocationRoles: roles }, () => workspace.setAllocationRoles(roles));
      }}
    />
    {error ? <p role="alert" className="mt-2 text-sm text-rose">{error}</p> : null}
    <WorkspaceOperationFeedback operation={operation} />
  </div>;
}

function RoleCard({ title, description, system, custom, value, placeholder, canManage, busy, canRenameUsed, used, onValue, onAdd, onLabel, onRemove, onSave }: {
  title: string;
  description: string;
  system: readonly NamedRole[];
  custom: NamedRole[];
  value: string;
  placeholder: string;
  canManage: boolean;
  busy: boolean;
  canRenameUsed: boolean;
  used: (role: NamedRole) => number;
  onValue: (value: string) => void;
  onAdd: () => void;
  onLabel: (id: string, label: string) => void;
  onRemove: (id: string) => void;
  onSave: () => void;
}) {
  return <section className="rounded-2xl border border-line bg-surface p-5">
    <h2 className="text-[15px] font-medium">{title}</h2>
    <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>
    <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
      {system.map(role => <li key={role.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13px]"><span>{role.label}</span><span className="text-[11px] text-muted">Padrão{used(role) ? ` · ${used(role)} em uso` : ""}</span></li>)}
      {custom.map((role, index) => {
        const usage = used(role);
        return <li key={`${index}-${role.id.startsWith("custom-") ? role.id : "cargo"}`} className="flex items-center gap-2 px-3 py-2">
          <input aria-label={`Nome de ${role.label}`} className={`${fieldClass} h-8 min-w-0 flex-1`} value={role.label} disabled={!canManage || busy || (usage > 0 && !canRenameUsed)} title={usage && !canRenameUsed ? "Este item não pode ser renomeado enquanto estiver em uso." : undefined} onChange={event => onLabel(role.id, event.target.value)} />
          {usage ? <span className="shrink-0 text-[11px] text-muted">{usage} em uso</span> : null}
          <Button type="button" size="sm" variant="ghost" disabled={!canManage || busy || usage > 0} title={usage ? "Remova as alocações antes de excluir este item." : "Remover"} onClick={() => onRemove(role.id)}><X className="h-3.5 w-3.5" /></Button>
        </li>;
      })}
    </ul>
    {canManage ? <div className="mt-3 flex gap-2">
      <input aria-label={`Novo item em ${title}`} className={fieldClass} maxLength={80} value={value} disabled={busy} onChange={event => onValue(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); onAdd(); } }} placeholder={placeholder} />
      <Button type="button" size="sm" variant="ghost" disabled={busy || !value.trim()} onClick={onAdd}><Plus className="h-3.5 w-3.5" />Adicionar</Button>
    </div> : null}
    {canManage ? <div className="mt-3"><Button type="button" size="sm" disabled={busy} onClick={onSave}>{busy ? "Salvando…" : "Salvar alterações"}</Button></div> : null}
  </section>;
}
