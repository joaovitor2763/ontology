"use client";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import {
  accessLabel,
  normalizeAccess,
  type AccessLevel,
  type Person,
} from "@/modules/workspace/domain/models";
import { emailOf } from "@/modules/workspace/infrastructure/queries";
import { MemberForm } from "@/modules/workspace/presentation/MemberForm";
import { PendingSignIns } from "@/modules/workspace/presentation/PendingSignIns";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { TeamSwitcher } from "@/modules/workspace/presentation/TeamSwitcher";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { cn } from "@/shared/lib/cn";
import { paths } from "@/shared/lib/routes";
import {
  DensityControl,
  useCollectionDisplay,
} from "@/shared/ui/DisplayControls";
import { FacetFilter } from "@/shared/ui/FacetFilter";
import { PageHeading } from "@/shared/ui/PageHeading";
import { Avatar, Badge, Button, Empty, Page } from "@/shared/ui/primitives";
import { TableToolbar } from "@/shared/ui/TableToolbar";
import { DataTable } from "@g4ai/ds";
import {
  Briefcase,
  Pencil,
  Plus,
  UserRound,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import { MemberActiveDialog } from "../MemberActiveDialog";
import { ActionMenu } from "@/shared/ui/Menu";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";

function MembrosScreenContent() {
  const { density, setDensity } = useCollectionDisplay("people");
  const { members, deactivated, me } = useTeam();
  const { allocations } = useClientsState();
  const [editing, setEditing] = useState<Person | "new" | null>(null);
  const [confirm, setConfirm] = useState<{id:string;name:string;active:boolean} | null>(null);
  const [q, setQ] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [access, setAccess] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const roleOpts = [...new Set(members.map((p) => p.role))].map((r) => ({
    id: r,
    label: r,
  }));
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return members.filter((p) => {
      const off = deactivated.has(p.id);
      if (roles.length && !roles.includes(p.role)) return false;
      if (access.length && !access.includes(normalizeAccess(p.access)))
        return false;
      if (status.length && !status.includes(off ? "inativo" : "ativo"))
        return false;
      if (!query) return true;
      return `${p.name} ${p.role} ${emailOf(p)}`.toLowerCase().includes(query);
    });
  }, [members, q, roles, access, status, deactivated]);
  const clientsOf = (id: string) =>
    new Set(allocations.filter((a) => a.memberId === id).map((a) => a.company))
      .size;

  const { can } = usePermissions();
  const canManage = can("equipe.gerenciar");
  return (
    <Page density={density} className="max-w-none">
      <PageHeading
        title="Equipe"
        description="Membros do workspace, seus papéis, acesso e capacidade."
        actions={
          <>
            <TeamSwitcher value="membros" />
            <DensityControl density={density} onChange={setDensity} />
            {canManage && (
              <Button onClick={() => setEditing("new")} size="sm">
                <Plus className="h-3.5 w-3.5" />
                Adicionar membro
              </Button>
            )}
          </>
        }
      />

      <div className="mt-6">
        <PendingSignIns />
        <TableToolbar
          query={q}
          onQuery={setQ}
          placeholder="Buscar nome, papel ou e-mail"
          shown={filtered.length}
          total={members.length}
          dirty={Boolean(q.trim() || roles.length || access.length || status.length)}
          onClear={() => {
            setQ("");
            setRoles([]);
            setAccess([]);
            setStatus([]);
          }}
          noun="membro"
        >
          <FacetFilter
            label="Papel"
            options={roleOpts}
            value={roles}
            onChange={setRoles}
          />
          <FacetFilter
            label="Acesso"
            options={(Object.keys(accessLabel) as AccessLevel[]).map((id) => ({
              id,
              label: accessLabel[id],
            }))}
            value={access}
            onChange={setAccess}
          />
          <FacetFilter
            label="Situação"
            options={[
              { id: "ativo", label: "Ativo" },
              { id: "inativo", label: "Inativo" },
            ]}
            value={status}
            onChange={setStatus}
          />
        </TableToolbar>
      </div>

      <DataTable
        className="mt-4"
        label="Membros"
        density={density}
        rows={filtered}
        rowKey={(p) => p.id}
        rowLabel={(p) => p.name}
        empty={
          <Empty
            title="Nenhum membro encontrado"
            hint="Ajuste o nome, papel, acesso ou situação para encontrar quem procura."
          />
        }
        columns={[
          {
            key: "member",
            header: "Membro",
            primary: true,
            cell: (p) => (
              <Link
                href={p.id === me.id ? paths.profile : paths.teamMember(p.id)}
                className={cn(
                  "inline-flex items-center gap-2 font-medium hover:underline",
                  deactivated.has(p.id) && "opacity-60",
                )}
              >
                <Avatar initials={p.initials} size="sm" />
                {p.name}
                {p.id === me.id && (
                  <span className="text-[11px] font-normal text-muted">
                    você
                  </span>
                )}
              </Link>
            ),
          },
          {
            key: "email",
            header: "E-mail",
            wide: true,
            className: "text-ink-soft",
            cell: (p) => emailOf(p),
          },
          {
            key: "role",
            header: "Papel",
            className: "text-ink-soft",
            cell: (p) => p.role,
          },
          {
            key: "access",
            header: "Acesso",
            cell: (p) => (
              <Badge tone={p.access === "admin" ? "accent" : "neutral"}>
                {accessLabel[normalizeAccess(p.access)]}
              </Badge>
            ),
          },
          {
            key: "capacity",
            header: "Capacidade",
            className: "tabular-nums text-ink-soft",
            cell: (p) =>
              p.capacityHoursWeek != null ? `${p.capacityHoursWeek} h/sem` : "—",
          },
          {
            key: "clients",
            header: "Clientes",
            className: "tabular-nums text-ink-soft",
            cell: (p) => {
              const n = clientsOf(p.id);
              return n ? (
                <Link href={paths.teamAllocation(p.id)} className="hover:underline">
                  {n} · ver alocação
                </Link>
              ) : (
                <Link href={paths.teamAllocation(p.id)} className="text-muted hover:text-ink">
                  Sem alocação
                </Link>
              );
            },
          },
          {
            key: "status",
            header: "Situação",
            cell: (p) => {
              const off = deactivated.has(p.id);
              return (
                <Badge tone={off ? "neutral" : "ok"}>
                  {off ? "Inativo" : "Ativo"}
                </Badge>
              );
            },
          },
          {
            key: "actions",
            header: <span className="sr-only">Ações</span>,
            action: true,
            align: "right",
            cell: (p) => {
              const off = deactivated.has(p.id);
              return (
                <ActionMenu
                  label={`Ações de ${p.name}`}
                  actions={[
                    {
                      label: "Ver perfil",
                      icon: <UserRound />,
                      href: p.id === me.id ? paths.profile : paths.teamMember(p.id),
                    },
                    {
                      label: "Editar",
                      icon: <Pencil />,
                      onSelect: () => setEditing(p),
                    },
                    {
                      label: "Ver alocação",
                      icon: <Briefcase />,
                      href: paths.teamAllocation(p.id),
                    },
                    {
                      label: off ? "Reativar" : "Desativar",
                      icon: off ? <UserRoundCheck /> : <UserRoundX />,
                      tone: off ? "neutral" : "danger",
                      separator: true,
                      disabled: p.id === me.id,
                      onSelect: () => setConfirm({id:p.id,name:p.name,active:off}),
                    },
                  ]}
                />
              );
            },
          },
        ]}
      />
      {editing && (
        <MemberForm
          member={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {confirm&&<MemberActiveDialog memberId={confirm.id} name={confirm.name} active={confirm.active} onClose={()=>setConfirm(null)}/>}

    </Page>
  );
}

/** Suspense dentro do módulo cliente, não em `page.tsx`: ver `docs/navegacao-e-visualizacoes.md`. */
export default function MembrosScreen() {
  return (
    <Suspense>
      <MembrosScreenContent />
    </Suspense>
  );
}
