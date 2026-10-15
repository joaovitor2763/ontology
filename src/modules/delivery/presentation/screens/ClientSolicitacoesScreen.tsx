"use client";
import Link from "next/link";
import { paths } from "@/shared/lib/routes";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";

import {
  DensityControl,
  useCollectionDisplay,
} from "@/shared/ui/DisplayControls";
import { PageHeading } from "@/shared/ui/PageHeading";

import { useClientsState } from "@/modules/clients/infrastructure/state";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import type {
  Delivery,
  DeliveryStatus,
} from "@/modules/delivery/domain/models";
import { RequestForm } from "@/modules/delivery/presentation/RequestForm";
import { TaskDrawer } from "@/modules/delivery/presentation/TaskDrawer";
import { cn } from "@/shared/lib/cn";
import {
  dueMeta,
  formatDate,
  isRequest,
  originLabel,
  priorityLabel,
} from "@/shared/lib/format";
import { FacetFilter } from "@/shared/ui/FacetFilter";
import { Badge, Empty, Metric, StatusBadge } from "@/shared/ui/primitives";
import { TableToolbar } from "@/shared/ui/TableToolbar";
import { DataTable } from "@g4ai/ds";

const priorityTone: Record<
  NonNullable<Delivery["priority"]>,
  "neutral" | "ok" | "warn" | "bad"
> = {
  baixa: "neutral",
  media: "neutral",
  alta: "warn",
  critica: "bad",
};

export default function SolicitacoesPage() {
  const { density, setDensity } = useCollectionDisplay("requests");
  const { slug } = useParams<{ slug: string }>();
  const { clientBySlug } = useClientsState();
  const c = clientBySlug(slug);
  const { resolve: person } = useTeam();
  const { statusMap, extraTasks, taskPatches, patchTask } = useDeliveryState();
  const [open, setOpen] = useState<Delivery | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [priority, setPriority] = useState<string[]>([]);
  const [origins, setOrigins] = useState<string[]>([]);

  const all = deliveriesFor(slug, statusMap, extraTasks, taskPatches).filter(
    isRequest,
  );
  const openN = all.filter((d) => d.status !== "entregue").length;
  const blockedN = all.filter((d) => d.status === "bloqueado").length;
  const doneN = all.filter((d) => d.status === "entregue").length;

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return all
      .filter((d) => {
        if (status.length && !status.includes(d.status)) return false;
        if (priority.length && !priority.includes(d.priority ?? "media"))
          return false;
        if (origins.length && !origins.includes(d.origin ?? "outro"))
          return false;
        if (!query) return true;
        const hay =
          `${d.title} ${d.description} ${d.requestedBy ?? ""} ${person(d.ownerId).name}`.toLowerCase();
        return hay.includes(query);
      })
      .sort((a, b) => {
        const rank = (s: DeliveryStatus) =>
          s === "bloqueado" ? 0 : s === "entregue" ? 4 : 1;
        return (
          rank(a.status) - rank(b.status) || Number(!a.dueAt) - Number(!b.dueAt) || a.dueAt.localeCompare(b.dueAt)
        );
      });
  }, [all, q, status, priority, origins, person]);

  const current = open ? (all.find((d) => d.id === open.id) ?? open) : null;
  const hasFilters = Boolean(
    q.trim() || status.length || priority.length || origins.length,
  );
  if (!c) return null;

  return (
    <div className="space-y-7" data-density={density}>
      <PageHeading
        compact
        title="Tickets e Solicitações"
        description="Cada ticket ou solicitação tem uma tarefa associada. Status, responsável e prazo são compartilhados nas duas visões."
        actions={
          <>
            <DensityControl density={density} onChange={setDensity} />
            <RequestForm company={c} onCreated={(t) => setOpen(t)} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric
          label="Total"
          value={String(all.length)}
          icon={<ClipboardList className="h-4 w-4" />}
        />
        <Metric
          label="Em aberto"
          value={String(openN)}
          icon={<CalendarDays className="h-4 w-4" />}
        />
        <Metric
          label="Bloqueadas"
          value={String(blockedN)}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={blockedN ? "bad" : "neutral"}
        />
        <Metric
          label="Concluídas"
          value={String(doneN)}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="ok"
        />
      </div>

      <TableToolbar
        query={q}
        onQuery={setQ}
        placeholder="Buscar solicitação, contato ou responsável"
        shown={filtered.length}
        total={all.length}
        dirty={hasFilters}
        onClear={() => {
          setQ("");
          setStatus([]);
          setPriority([]);
          setOrigins([]);
        }}
        noun="solicitação"
        nounPlural="solicitações"
      >
        <FacetFilter
          label="Status"
          options={[
            { id: "fila", label: "A fazer" },
            { id: "em-curso", label: "Em andamento" },
            { id: "revisao", label: "Revisão" },
            { id: "bloqueado", label: "Bloqueada" },
            { id: "entregue", label: "Concluída" },
          ]}
          value={status}
          onChange={setStatus}
        />
        <FacetFilter
          label="Prioridade"
          options={[
            { id: "baixa", label: "Baixa" },
            { id: "media", label: "Média" },
            { id: "alta", label: "Alta" },
            { id: "critica", label: "Crítica" },
          ]}
          value={priority}
          onChange={setPriority}
        />
        <FacetFilter
          label="Origem"
          options={[
            { id: "whatsapp", label: "WhatsApp" },
            { id: "reuniao", label: "Reunião" },
            { id: "ligacao", label: "Ligação" },
            { id: "email", label: "E-mail" },
            { id: "outro", label: "Outro" },
          ]}
          value={origins}
          onChange={setOrigins}
        />
      </TableToolbar>

      <DataTable
        label="Solicitações"
        density={density}
        rows={filtered}
        rowKey={(d) => d.id}
        onRowClick={setOpen}
        rowLabel={(d) => `Abrir solicitação ${d.title}`}
        columns={[
          {
            key: "title",
            header: "Solicitação",
            primary: true,
            cell: (d) => (
              <>
                <Link href={paths.clientDelivery(slug, d.id)} onClick={(event) => event.stopPropagation()} className="font-medium hover:underline">{d.title}</Link>
                <div className="mt-0.5 text-caption font-normal text-muted">
                  {d.origin ? originLabel[d.origin] : "Outro"}
                  {d.requestedBy ? ` · ${d.requestedBy}` : ""}
                </div>
              </>
            ),
          },
          { key: "status", header: "Status", cell: (d) => <StatusBadge status={d.status} /> },
          { key: "owner", header: "Responsável", cell: (d) => <span className="text-ink-soft">{person(d.ownerId).name}</span> },
          {
            key: "priority",
            header: "Prioridade",
            cell: (d) => (
              <Badge tone={priorityTone[d.priority ?? "media"]}>
                {priorityLabel[d.priority ?? "media"]}
              </Badge>
            ),
          },
          {
            key: "due",
            header: "Prazo",
            cell: (d) => {
              const due = dueMeta(d.dueAt);
              return (
                <span className={cn("tabular-nums", due.tone === "bad" && d.status !== "entregue" && "text-rose")}>
                  <span className="block">{formatDate(d.dueAt)}</span>
                  <span className="block text-caption text-muted">{due.label}</span>
                </span>
              );
            },
          },
        ]}
        empty={
          <Empty
            title={
              all.length
                ? "Nenhuma solicitação neste filtro"
                : "Nenhuma solicitação registrada"
            }
            hint={
              all.length
                ? "Ajuste a busca ou os filtros."
                : "Registre o primeiro pedido recebido do cliente."
            }
          />
        }
      />

      <TaskDrawer
        task={current}
        onClose={() => setOpen(null)}
        onChange={(id, patch) => patchTask(id, patch)}
      />
    </div>
  );
}
