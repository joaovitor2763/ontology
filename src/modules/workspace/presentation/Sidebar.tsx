"use client";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { AlertCount } from "@/modules/workspace/presentation/AlertBadge";
import { GlobalSearch } from "@/modules/workspace/presentation/GlobalSearch";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { accessLabel, normalizeAccess } from "@/modules/workspace/domain/permissions";
import { timeOf } from "@/shared/lib/dates";
import { glossary, paths } from "@/shared/lib/routes";
import {
  useLocalStorageState,
  useSyncStatus,
} from "@/shared/infrastructure/useLocalStorageState";
import {
  ProductMark,
  Sidebar as DsSidebar,
  SyncStatus,
  useTheme,
  type MenuEntry,
  type NavGroup,
  type NavItem,
  type ThemeMode,
} from "@g4ai/ds";
import {
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardList,
  Files,
  GitGraph,
  LayoutDashboard,
  MessageCircle,
  Settings,
  UserRound,
  Users,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const work: NavItem[] = [
  { href: paths.home, label: glossary.overview, icon: LayoutDashboard },
  { href: paths.clients, label: glossary.clients, icon: Building2 },
  { href: paths.execution(), label: glossary.execution, icon: ClipboardList },
  { href: paths.agenda, match: "/agenda", label: glossary.agenda, icon: CalendarDays },
  { href: paths.conversations(), label: glossary.conversations, icon: MessageCircle },
  { href: paths.documents(), label: glossary.documents, icon: Files },
  { href: paths.alerts(), label: glossary.alerts, icon: Bell },
];
const manage: NavItem[] = [
  { href: paths.catalogProducts(), match: "/catalogo", label: glossary.catalog, icon: BookOpen },
  { href: paths.teamMembers, match: "/equipe", label: glossary.team, icon: Users },
  { href: paths.ontologies, label: glossary.ontologies, icon: GitGraph },
  { href: paths.settings, label: glossary.settings, icon: Settings },
];

function Sync({ collapsed }: { collapsed: boolean }) {
  const { pending, error, lastSyncAt, hydrated } = useSyncStatus();
  const label = error
    ? "Erro ao sincronizar"
    : pending > 0
      ? "Salvando…"
      : !hydrated
        ? "Carregando…"
        : lastSyncAt
          ? `Sincronizado ${timeOf(new Date(lastSyncAt))}`
          : "Conectado";
  const state = error ? "error" : pending > 0 || !hydrated ? "pending" : "ok";
  return <SyncStatus state={state} label={error ?? label} collapsed={collapsed} />;
}

const themeOptions: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "Automático" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
];

export function Sidebar({
  mobileOpen = false,
  onNavigate,
}: {
  mobileOpen?: boolean;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  const { me, session } = useTeam();
  const { workspaceName } = useWorkspaceState();
  const { clients, configFor } = useClientsState();
  const ontologyInUse = clients.some((c) => configFor(c.slug).modules.ontology);
  const [rail, setRail] = useLocalStorageState("ontology.sidebar.collapsed", 0);
  const [searching, setSearching] = useState(false);
  const { mode, setMode } = useTheme();
  const remote = useSyncStatus().mode === "remote";
  const collapsed = rail === 1 && !mobileOpen;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const editing =
        event.target instanceof HTMLElement &&
        (event.target.matches("input, textarea, select") ||
          event.target.isContentEditable);
      if (
        (event.key === "/" && !editing && !event.metaKey && !event.ctrlKey) ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")
      ) {
        event.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const pages = useMemo(
    () => [...work, ...manage].map(({ href, label }) => ({ href, label })),
    [],
  );
  const manageVisible = manage.filter(
    (item) => item.href !== paths.ontologies || ontologyInUse,
  );
  const userMenu: MenuEntry[] = [
    { label: "Meu perfil", href: paths.profile, icon: <UserRound /> },
    { type: "separator" },
    { type: "label", label: "Tema" },
    {
      type: "radio",
      value: mode,
      onValueChange: (value) => setMode(value as ThemeMode),
      options: themeOptions,
    },
    ...(session?.authMode === "dev"
      ? ([
          { type: "separator" },
          { label: "Trocar de usuário (desenvolvimento)", href: paths.signIn },
        ] satisfies MenuEntry[])
      : []),
  ];
  return (
    <>
      <AlertCount>
        {(alerts) => {
          const groups: NavGroup[] = [
            {
              label: "Trabalho",
              items: work.map((item) =>
                item.href === paths.alerts() && alerts > 0 ? { ...item, badge: alerts } : item,
              ),
            },
            { label: "Gestão", items: manageVisible },
          ];
          return (
            <DsSidebar
              product="Ontology"
              workspace={workspaceName}
              mark={<ProductMark />}
              groups={groups}
              currentPath={path}
              collapsed={collapsed}
              onToggle={() => setRail(collapsed ? 0 : 1)}
              onSearch={() => setSearching(true)}
              mobileOpen={mobileOpen}
              onNavigate={onNavigate}
              footer={remote ? <Sync collapsed={collapsed} /> : undefined}
              user={{
                name: me.name,
                initials: me.initials,
                role: accessLabel[normalizeAccess(me.access)],
                menu: userMenu,
              }}
            />
          );
        }}
      </AlertCount>
      <GlobalSearch
        open={searching}
        onClose={() => setSearching(false)}
        pages={pages}
        onNavigate={onNavigate}
      />
    </>
  );
}
