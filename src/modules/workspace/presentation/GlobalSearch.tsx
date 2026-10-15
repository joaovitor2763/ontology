"use client";
import { clientEntry } from "@/shared/infrastructure/client-entry";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { deliveriesFor } from "@/modules/delivery/infrastructure/queries";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { glossary, paths } from "@/shared/lib/routes";
import {
  SearchPalette,
  type SearchResult,
  type SearchScope,
  type SearchSource,
} from "@g4ai/ds";
import {
  Building2,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";

export type SearchPage = { href: string; label: string };
type RemoteTask = { title: string; company: string; kind: "task" | "request" };

const scopes: SearchScope[] = [
  { id: "clients", label: glossary.clients, icon: <Building2 />, noun: "clientes" },
  { id: "tasks", label: "Tarefas", icon: <ClipboardList />, noun: "tarefas" },
  { id: "meetings", label: "Reuniões", icon: <CalendarDays />, noun: "reuniões" },
  { id: "pages", label: "Páginas", icon: <LayoutDashboard />, noun: "páginas" },
];

/**
 * Busca do workspace (⌘K ou `/`). Lê clientes, tarefas e reuniões — documentos
 * que, antes, toda página carregaria só porque o campo existia. Fechada, nada é
 * montado; abrir é o que lê os documentos. No modo publicado as tarefas vêm de
 * `/api/search/tasks`; no navegador, do documento de execução.
 */
export function GlobalSearch({
  open,
  onClose,
  pages,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  pages: SearchPage[];
  onNavigate?: () => void;
}) {
  const { mode } = useSyncStatus();
  if (!open) return null;
  const props = { onClose, pages, onNavigate };
  return mode === "remote" ? <RemoteSearch {...props} /> : <LocalSearch {...props} />;
}

type ActiveProps = {
  onClose: () => void;
  pages: SearchPage[];
  onNavigate?: () => void;
};

function taskResult(
  task: { title: string; company: string; kind?: string },
  clientName: (slug: string) => string,
  index: number,
): SearchResult {
  const request = task.kind === "request";
  return {
    id: `task-${task.company}-${index}-${task.title}`,
    scope: "tasks",
    title: task.title,
    subtitle: `${request ? glossary.request : glossary.delivery} · ${clientName(task.company)}`,
    href: paths.clientDeliveries(task.company, request ? "solicitacoes" : "entregas"),
  };
}

function LocalSearch(props: ActiveProps) {
  const { extraTasks, taskPatches, statusMap } = useDeliveryState();
  const { clients } = useClientsState();
  const tasks = useMemo(() => {
    const clientName = (slug: string) => clients.find((c) => c.slug === slug)?.name ?? "";
    return deliveriesFor(undefined, statusMap, extraTasks, taskPatches).map((task, i) =>
      taskResult(task, clientName, i),
    );
  }, [clients, statusMap, extraTasks, taskPatches]);
  return <Palette {...props} tasks={tasks} />;
}

function RemoteSearch(props: ActiveProps) {
  const { clients } = useClientsState();
  const source = useCallback<SearchSource>(
    async (query, scope, signal) => {
      if (!query || (scope !== "all" && scope !== "tasks")) return [];
      const response = await fetch(`/api/search/tasks?q=${encodeURIComponent(query)}`, {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error("Não foi possível buscar tarefas.");
      const body = (await response.json()) as { data?: RemoteTask[] };
      if (!Array.isArray(body.data)) throw new Error("Não foi possível buscar tarefas.");
      const clientName = (slug: string) => clients.find((c) => c.slug === slug)?.name ?? "";
      return body.data.map((task, i) => taskResult(task, clientName, i));
    },
    [clients],
  );
  return <Palette {...props} tasks={[]} source={source} />;
}

function Palette({
  onClose,
  pages,
  onNavigate,
  tasks,
  source,
}: ActiveProps & { tasks: SearchResult[]; source?: SearchSource }) {
  const router = useRouter();
  const { allMeetings } = useEngagementState();
  const { clients } = useClientsState();
  const items = useMemo<SearchResult[]>(() => {
    const clientName = (slug: string) => clients.find((c) => c.slug === slug)?.name ?? "";
    return [
      ...clients.map((c) => ({
        id: `client-${c.slug}`,
        scope: "clients",
        title: c.name,
        subtitle: c.sector,
        href: clientEntry(c.slug),
      })),
      ...pages.map((p) => ({
        id: `page-${p.href}`,
        scope: "pages",
        title: p.label,
        subtitle: "Navegação",
        href: p.href,
      })),
      ...allMeetings.map((m) => ({
        id: `meeting-${m.id}`,
        scope: "meetings",
        title: m.title,
        subtitle: clientName(m.company),
        href: paths.meeting(m.id),
      })),
      ...tasks,
    ];
  }, [clients, pages, allMeetings, tasks]);
  return (
    <SearchPalette
      open
      onClose={onClose}
      scopes={scopes}
      items={items}
      source={source}
      defaultPreview={false}
      placeholder="Buscar clientes, tarefas, reuniões ou páginas…"
      onSelect={(result, { newTab }) => {
        if (newTab || !result.href) return;
        onClose();
        onNavigate?.();
        router.push(result.href);
      }}
    />
  );
}
