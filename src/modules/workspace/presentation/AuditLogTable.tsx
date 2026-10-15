"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, PanelRightOpen, RotateCcw, ShieldCheck } from "lucide-react";
import { Drawer } from "@/shared/ui/Drawer";
import { Combobox } from "@/shared/ui/Combobox";
import { Select } from "@/shared/ui/Select";
import { Button } from "@/shared/ui/primitives";
import { DataTable } from "@g4ai/ds";
import { formatDate } from "@/shared/lib/format";

type AuditRow = {
  id: string;
  operationId: string;
  command: string;
  action: string;
  area: string;
  company: string | null;
  subject: string;
  actor: { id: string; email: string | null; principalId: string };
  source: "interface" | "api" | "mcp";
  application: string;
  data: unknown;
  at: string;
};

type Filters = { company: string; actor: string; source: string; area: string; limit: string };
const initialFilters: Filters = { company: "all", actor: "all", source: "all", area: "all", limit: "25" };
const areaOptions = [
  ["client", "Clientes"], ["enrollment", "Contratações"], ["sale", "Vendas"],
  ["stakeholder", "Stakeholders"], ["participant", "Participantes"], ["allocation", "Alocações"],
  ["product", "Produtos"], ["plan", "Planos"], ["cycle", "Ciclos"], ["task", "Tarefas"],
  ["meeting", "Reuniões"], ["agenda", "Agenda"], ["engagement", "Interações e sinais"],
  ["diagnosis", "Diagnóstico"], ["document", "Documentos"], ["knowledge", "Ontologia"], ["member", "Equipe"],
  ["workspace", "Workspace"], ["webhook", "Webhooks"], ["alert", "Alertas"],
] as const;
const sourceLabel = { interface: "Interface", api: "API", mcp: "MCP" } as const;
const actionLabel: Record<string, string> = {
  "client.created": "Cliente criado", "clients.configure": "Cliente alterado", "clients.archive": "Cliente arquivado", "clients.restore": "Cliente restaurado",
  "enrollment.created": "Produto contratado", "enrollment.updated": "Contratação alterada", "enrollment.cancelled": "Produto cancelado", "enrollment.archived": "Produto arquivado", "enrollment.restored": "Produto restaurado", "enrollment.removed": "Produto removido", "enrollment.execution_rebuilt": "Execução reconstruída",
  "tasks.complete": "Tarefa concluída",
  "webhook.created": "Webhook criado", "webhooks.update": "Webhook alterado", "webhooks.deactivate": "Webhook desativado", "webhooks.rotateSecret": "Segredo do webhook trocado", "webhooks.replay": "Entrega de webhook repetida",
};
const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

function labelAction(action: string) {
  return actionLabel[action] ?? action.replaceAll(".", " · ").replaceAll("_", " ");
}

function effectiveCompletionDate(row: AuditRow | null) {
  if (!row?.data || typeof row.data !== "object" || Array.isArray(row.data)) return null;
  const value = (row.data as Record<string, unknown>).completedAt;
  return typeof value === "string" ? value : null;
}

function paginationItems(current: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 4) return [1, 2, 3, 4, "gap", total];
  if (current >= total - 3) return [1, "gap", total - 3, total - 2, total - 1, total];
  return [1, "gap", current - 1, current, current + 1, "gap", total];
}

/** Filtro de barra com busca: mesma altura dos controles compactos; largura toda no celular. */
const filterClass =
  "h-9 w-full rounded-lg border border-line bg-surface px-3 text-[13px] hover:border-line-strong sm:w-[200px]";

export function AuditLogTable({ clients, members }: {
  clients: { slug: string; name: string }[];
  members: { id: string; name: string; email?: string }[];
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const anchor = useRef("");
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const clientNames = useMemo(() => new Map(clients.map(client => [client.slug, client.name])), [clients]);
  const memberNames = useMemo(() => new Map(members.map(member => [member.id, member.name])), [members]);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ limit: filters.limit, page: String(page) });
    if (anchor.current) query.set("anchor", anchor.current);
    for (const key of ["company", "actor", "source", "area"] as const)
      if (filters[key] !== "all") query.set(key, filters[key]);
    void fetch(`/api/v1/admin/audit-log?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json() as { data?: AuditRow[]; total?: number; totalPages?: number; anchor?: string | null; error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível consultar a auditoria.");
        setRows(body.data ?? []); setTotal(body.total ?? 0); setTotalPages(body.totalPages ?? 1); anchor.current=body.anchor ?? "";
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível consultar a auditoria."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, filters]);

  function change<K extends keyof Filters>(key: K, value: Filters[K]) {
    setLoading(true); setError("");
    setFilters(current => ({ ...current, [key]: value }));
    setPage(1); anchor.current="";
  }
  const dirty = Object.entries(filters).some(([key, value]) => key !== "limit" && value !== "all");
  const limit = Number(filters.limit);
  const firstVisible = total ? (page - 1) * limit + 1 : 0;
  const lastVisible = Math.min(page * limit, total);

  return (
    <section className="mt-8 rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-5">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4"/><h2 className="text-[15px] font-medium">Auditoria do workspace</h2></div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">Alterações confirmadas, com autoria, canal e contexto técnico mínimo. Somente admins podem consultar.</p>
        </div>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => { setLoading(true); setError(""); setPage(1); anchor.current=""; setRows(null); setFilters(current => ({ ...current })); }}><RotateCcw className="h-3.5 w-3.5"/>Atualizar</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
        <Combobox className={filterClass} label="Cliente" value={filters.company} onValueChange={value => change("company", value || "all")} options={[{value:"all",label:"Todos os clientes"},...clients.map(client=>({value:client.slug,label:client.name}))]}/>
        <Combobox className={filterClass} label="Pessoa" value={filters.actor} onValueChange={value => change("actor", value || "all")} options={[{value:"all",label:"Todas as pessoas"},...members.map(member=>({value:member.id,label:member.name,description:member.email}))]}/>
        <Combobox className={filterClass} label="Origem" value={filters.source} onValueChange={value => change("source", value || "all")} options={[{value:"all",label:"Todas as origens"},{value:"interface",label:"Interface"},{value:"api",label:"API"},{value:"mcp",label:"MCP"}]}/>
        <Combobox className={filterClass} label="Área" value={filters.area} onValueChange={value => change("area", value || "all")} options={[{value:"all",label:"Todas as áreas"},...areaOptions.map(([value,label])=>({value,label}))]}/>
        {dirty && <Button variant="ghost" size="sm" onClick={() => { setLoading(true); setError(""); setFilters(current => ({ ...initialFilters, limit: current.limit })); setPage(1); anchor.current=""; }}>Limpar filtros</Button>}
        <span aria-live="polite" className="ml-auto text-xs text-muted">{loading ? "Atualizando…" : total ? `${firstVisible}–${lastVisible} de ${total} registros` : "Nenhum registro"}</span>
      </div>

      {error && <p role="alert" className="m-4 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{error}</p>}
      {!(error && !rows?.length) && <DataTable
        label="Registro de auditoria"
        className="rounded-none border-0"
        rows={rows ?? []}
        rowKey={row => row.id}
        rowLabel={row => labelAction(row.action)}
        loading={rows === null || loading}
        empty={<div className="p-4 text-center"><p className="text-sm font-medium">Nenhum registro encontrado</p><p className="mt-1 text-xs text-muted">Ajuste os filtros ou aguarde uma nova alteração confirmada.</p></div>}
        columns={[
          { key: "at", header: "Quando", width: 145, nowrap: true, className: "tabular-nums", cell: row => <time dateTime={row.at}>{dateTime.format(new Date(row.at))}</time> },
          { key: "actor", header: "Quem", width: 175, primary: true, cell: row => { const actorName = memberNames.get(row.actor.id) ?? row.actor.email ?? row.actor.id; return <span className="block truncate font-medium" title={actorName}>{actorName}</span>; } },
          { key: "source", header: "Origem", width: 95, cell: row => <span className="rounded-md bg-soft px-2 py-1 text-xs font-medium">{sourceLabel[row.source]}</span> },
          { key: "company", header: "Cliente", width: 155, cell: row => row.company ? clientNames.get(row.company) ?? row.company : <span className="text-muted">Workspace</span> },
          { key: "action", header: "Ação", cell: row => <><span className="font-medium">{labelAction(row.action)}</span><code className="mt-0.5 block text-[11px] text-muted">{row.command}</code></> },
          { key: "subject", header: "Entidade", width: 220, wide: true, className: "break-all font-mono text-xs", cell: row => row.subject },
          { key: "context", header: "Detalhes", width: 125, action: true, cell: row => <button type="button" onClick={()=>setSelected(row)} className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium hover:text-accent"><PanelRightOpen className="h-3.5 w-3.5"/>Contexto</button> },
        ]}
      />}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4">
        <Select size="compact" label="Registros por página" value={filters.limit} onValueChange={value => change("limit", value)} options={[{value:"25",label:"25 por página"},{value:"50",label:"50 por página"},{value:"100",label:"100 por página"}]}/>
        <nav aria-label="Paginação da auditoria" className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-1 text-xs text-muted">Página {page} de {totalPages}</span>
          <Button variant="ghost" size="sm" disabled={loading || page === 1} onClick={() => { setLoading(true); setError(""); setPage(current => Math.max(1, current - 1)); }}><ChevronLeft className="h-3.5 w-3.5"/>Anterior</Button>
          <div className="flex items-center gap-1">{paginationItems(page,totalPages).map((item,index)=>item==="gap"?<span key={`gap-${index}`} aria-hidden className="px-1 text-sm text-muted">…</span>:<Button key={item} variant={item===page?"primary":"ghost"} size="sm" className="min-w-9 px-2" aria-current={item===page?"page":undefined} aria-label={item===totalPages&&totalPages>7?`Última página, ${item}`:`Página ${item}`} disabled={loading} onClick={()=>{if(item!==page){setLoading(true);setError("");setPage(item);}}}>{item}</Button>)}</div>
          <Button variant="ghost" size="sm" disabled={loading || page === totalPages} onClick={() => { setLoading(true); setError(""); setPage(current => Math.min(totalPages, current + 1)); }}>Próxima<ChevronRight className="h-3.5 w-3.5"/></Button>
        </nav>
      </div>
      <Drawer open={selected!==null} onClose={()=>setSelected(null)} title={selected?labelAction(selected.action):"Contexto da alteração"} kicker={selected?`${dateTime.format(new Date(selected.at))} · ${sourceLabel[selected.source]}`:undefined} footer={<div className="flex justify-end"><Button variant="ghost" onClick={()=>setSelected(null)}>Fechar</Button></div>}>
        {selected&&<div className="space-y-6">
          <dl className="grid grid-cols-[100px_1fr] gap-x-4 gap-y-3 text-[13px]"><dt className="text-muted">Quem</dt><dd className="min-w-0 break-words font-medium">{memberNames.get(selected.actor.id)??selected.actor.email??selected.actor.id}{selected.actor.email&&<span className="mt-0.5 block text-xs font-normal text-muted">{selected.actor.email}</span>}</dd><dt className="text-muted">Cliente</dt><dd>{selected.company?clientNames.get(selected.company)??selected.company:"Workspace"}</dd><dt className="text-muted">Origem</dt><dd>{sourceLabel[selected.source]}</dd>{effectiveCompletionDate(selected)&&<><dt className="text-muted">Data efetiva</dt><dd>{formatDate(effectiveCompletionDate(selected)!)}</dd></>}<dt className="text-muted">Comando</dt><dd className="break-all font-mono text-xs">{selected.command}</dd><dt className="text-muted">Entidade</dt><dd className="break-all font-mono text-xs">{selected.subject}</dd><dt className="text-muted">Operação</dt><dd className="break-all font-mono text-xs">{selected.operationId}</dd><dt className="text-muted">Aplicação</dt><dd className="break-all font-mono text-xs">{selected.application}</dd></dl>
          <section><h3 className="text-sm font-medium">Dados registrados</h3><pre className="mt-2 max-h-[45vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-soft p-4 text-xs leading-relaxed">{JSON.stringify(selected.data,null,2)}</pre></section>
        </div>}
      </Drawer>
    </section>
  );
}
