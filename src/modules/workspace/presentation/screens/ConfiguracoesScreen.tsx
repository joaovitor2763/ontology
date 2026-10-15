"use client";
import {ApiAccess} from "../ApiAccess";
import { AuditLogTable } from "../AuditLogTable";
import {ConnectedApps} from "../ConnectedApps";
import { ComposioSettings } from "../ComposioSettings";
import { ZApiSettings } from "../ZApiSettings";
import { Select } from "@/shared/ui/Select";
import { useCatalogState } from "@/modules/catalog/infrastructure/state";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import {
  accessHint,
  accessLabel,
  type AccessLevel,
} from "@/modules/workspace/domain/models";
import {
  alertRuleLabel,
  defaultAlertRules,
  type AlertRules,
} from "@/modules/workspace/domain/models";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { paths } from "@/shared/lib/routes";
import { fieldClass } from "@/shared/ui/Drawer";
import { PageHeading } from "@/shared/ui/PageHeading";
import { Button, CardAction, Metric, Page } from "@/shared/ui/primitives";
import {
  BellRing,
  BookOpen,
  Building2,
  CalendarDays,
  MessageCircle,
  Sparkles,
  Users,
  Package,
} from "lucide-react";
import { useAiStatus } from "@/shared/infrastructure/ai";
import { useWhatsAppStatus } from "@/shared/infrastructure/whatsapp";
import { useGoogleStatus } from "@/shared/infrastructure/google";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { usePermissions } from "../usePermissions";
import { useWorkspaceOperation, WorkspaceOperationFeedback } from "../useWorkspaceOperation";
import { alertRulesError } from "../../domain/models";
import { RoleCatalogSettings } from "../RoleCatalogSettings";

const settingsTabs = [{id:"geral",label:"Geral"},{id:"funcoes",label:"Cargos e papéis"},{id:"alertas",label:"Alertas"},{id:"apps",label:"Integrações"},{id:"mcp",label:"MCP"},{id:"api",label:"API"},{id:"auditoria",label:"Auditoria"}] as const;
function subscribeSettingsTab(notify:()=>void){window.addEventListener("hashchange",notify);return()=>window.removeEventListener("hashchange",notify);}
function currentSettingsTab(){const hash=window.location.hash.slice(1);return ["aplicativos-conectados","integracoes"].includes(hash)?"apps":hash==="regras"?"alertas":settingsTabs.some(tab=>tab.id===hash)?hash:"geral";}
export default function ConfiguracoesScreen() {
  const tab=useSyncExternalStore(subscribeSettingsTab,currentSettingsTab,()=>"geral");
  const { workspaceName, setWorkspaceName, currentUserId, setCurrentUser } =
    useWorkspaceState();
  const { members, active, me } = useTeam();
  // Publicado, o membro atual é quem entrou; "ver como" é só do modo navegador.
  const { mode } = useSyncStatus();
  const { clients } = useClientsState();
  const { products } = useCatalogState();
  const [name, setName] = useState(workspaceName);
  const operation = useWorkspaceOperation();
  const { can } = usePermissions();
  const currentTab = tab === "auditoria" && !can("auditoria.ver") ? "geral" : tab;

  return (
    <Page className="max-w-none">
      <PageHeading
        title="Configurações"
        description="Workspace, regras de alertas, conexões e auditoria."
      />

      <nav aria-label="Seções de configurações" className="mt-5 flex gap-1 overflow-x-auto border-b border-line">
        {settingsTabs.filter(item=>item.id!=="auditoria"||can("auditoria.ver")).map(item=><a key={item.id} href={`#${item.id}`} aria-current={currentTab===item.id?"page":undefined} className={`shrink-0 border-b-2 px-3 py-3 text-[13px] ${currentTab===item.id?"border-ink font-medium text-ink":"border-transparent text-muted hover:text-ink"}`}>{item.label}</a>)}
      </nav>
      <div hidden={currentTab!=="geral"}>
      <div id="geral" className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="Membros"
          value={String(members.length)}
          icon={<Users className="h-3.5 w-3.5" />}
        />
        <Metric
          label="Ativos"
          value={String(active.length)}
          tone="ok"
          icon={<Users className="h-3.5 w-3.5" />}
        />
        <Metric
          label="Clientes"
          value={String(clients.length)}
          icon={<Building2 className="h-3.5 w-3.5" />}
        />
        <Metric
          label="Produtos no catálogo"
          value={String(products.length)}
          icon={<Package className="h-3.5 w-3.5" />}
        />
      </div>

      <div className="mt-7 grid items-start gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[15px] font-medium">Workspace</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            O nome aparece no menu e identifica esta equipe de consultoria.
          </p>
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) void operation.run("workspace.settings.update",{workspaceName:name.trim()},()=>setWorkspaceName(name));
            }}
          >
            <label className="min-w-0 flex-1 basis-[220px]">
              <span className="mb-1.5 block text-[12.5px] text-muted">
                Nome do workspace
              </span>
              <input
                className={fieldClass}
                value={name}
                disabled={!can("configuracoes.editar")||operation.pending}
                onChange={(e) => {operation.begin();setName(e.target.value);}}
                required
              />
            </label>
            <Button type="submit" size="sm" disabled={!can("configuracoes.editar")||operation.pending||name.trim() === workspaceName}>
              {operation.busy ? "Salvando…" : "Salvar"}
            </Button>
          </form>
          <WorkspaceOperationFeedback operation={operation} />
        </section>

        {mode !== "remote" && <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[15px] font-medium">Ver como</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Prévia local de como outro membro vê o workspace: visão geral,
            clientes alocados e perfil. Não altera os registros.
          </p>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-[12.5px] text-muted">
              Membro atual
            </span>
            <Select
              label="Membro atual"
              value={currentUserId}
              onValueChange={(v) => setCurrentUser(v)}
              options={active.map((p) => ({
                value: p.id,
                label: p.name,
                description: p.role,
              }))}
            />
          </label>
          <p className="mt-2 text-[12px] text-muted">
            Agora você está vendo como {me.name}.
          </p>
        </section>}

        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[15px] font-medium">Papéis e acesso</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Cada membro tem um papel na tarefa e um nível de acesso. O papel
            organiza a alocação; o acesso define o que pode editar.
          </p>
          <dl className="mt-4 divide-y divide-line text-[13px]">
            {(Object.keys(accessLabel) as AccessLevel[]).map((level) => (
              <div key={level} className="flex gap-4 py-2.5">
                <dt className="w-32 shrink-0 font-medium">
                  {accessLabel[level]}
                </dt>
                <dd className="text-muted">{accessHint[level]}</dd>
              </div>
            ))}
          </dl>
          <Link href={paths.teamMembers} className="mt-2 inline-block">
            <CardAction>Gerenciar equipe</CardAction>
          </Link>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-soft text-ink">
            <BookOpen className="h-3.5 w-3.5" />
          </span>
          <h2 className="mt-3 text-[15px] font-medium">Catálogo</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Produtos versionados definem marcos, ciclos, tarefas e critérios.
            Cada contratação recebe uma cópia independente para o cliente.
          </p>
          <div className="mt-3 flex flex-wrap gap-4">
            <Link href={paths.catalogProducts()}>
              <CardAction>Produtos</CardAction>
            </Link>
          </div>
        </section>
      </div>
      </div>
      <div hidden={currentTab!=="funcoes"}>
        {currentTab === "funcoes" ? <RoleCatalogSettings /> : null}
      </div>
      <div hidden={currentTab!=="alertas"}>
      <section id="regras" className="mt-8 scroll-mt-6"><h2 className="mb-4 text-base font-semibold">Alertas</h2><AlertRulesCard /></section>
      </div>
      <div hidden={currentTab!=="apps"}>
      {currentTab === "apps" && <div id="integracoes" className="mt-8 space-y-4"><ComposioSettings /><ZApiSettings /><ConnectedApps /></div>}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
        <GoogleCard />
        <WhatsAppCard />
        <AiCard />
      </div>
      </div>
      {currentTab==="mcp"&&<section className="mt-8"><ConnectedApps mode="mcp" /></section>}
      {currentTab==="api"&&<section className="mt-8"><ApiAccess /></section>}
      {currentTab==="auditoria"&&<AuditLogTable clients={clients} members={members}/>}
    </Page>
  );
}

const ruleUnit: Record<keyof AlertRules, string> = {
  acceptanceWaitDays: "dias",
  silentClientDays: "dias",
  lateDeliveryCriticalDays: "dias",
  presentationRehearsalHours: "horas",
  hypothesisStaleDays: "dias",
};
const ruleKeys = Object.keys(defaultAlertRules) as (keyof AlertRules)[];

/** Thresholds behind the derived alerts; the queue recalculates as soon as they are saved. */
function AlertRulesCard() {
  const { alertRules, setAlertRules } = useWorkspaceState();
  const operation=useWorkspaceOperation();
  const {can}=usePermissions();
  const [draft, setDraft] = useState<Record<keyof AlertRules, string>>(() =>
    Object.fromEntries(
      ruleKeys.map((key) => [key, String(alertRules[key])]),
    ) as Record<keyof AlertRules, string>,
  );
  const [error, setError] = useState<string | null>(null);
  const parsed = Object.fromEntries(
    ruleKeys.map((key) => [key, Number(draft[key])]),
  ) as AlertRules;
  const dirty = ruleKeys.some((key) => parsed[key] !== alertRules[key]);
  const isDefault = ruleKeys.every(
    (key) => alertRules[key] === defaultAlertRules[key],
  );

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-soft text-ink">
        <BellRing className="h-3.5 w-3.5" />
      </span>
      <h2 className="mt-3 text-[15px] font-medium">Regras de alerta</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Limites que transformam dados em alertas derivados: aceite parado,
        cliente em silêncio, tarefa crítica, apresentação sem ensaio e
        hipótese sem evidência. Valem para todo o workspace.
      </p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const overrides: Partial<AlertRules> = {};
          for (const key of ruleKeys) {
            const value = draft[key].trim() === "" ? NaN : Number(draft[key]);
            if (value !== defaultAlertRules[key]) overrides[key] = value;
          }
          const issue=alertRulesError(overrides);setError(issue);
          if(!issue) void operation.run("workspace.settings.update",{alertRules:overrides},()=>{setAlertRules(overrides);});
        }}
      >
        {ruleKeys.map((key) => (
          <label
            key={key}
            className="flex flex-wrap items-center justify-between gap-3 text-[13px]"
          >
            <span className="min-w-0 flex-1 basis-[220px]">
              {alertRuleLabel[key]}
            </span>
            <span className="inline-flex items-center gap-2">
              <input
                disabled={!can("configuracoes.editar")||operation.pending}
                type="number"
                min={0}
                max={365}
                inputMode="numeric"
                aria-label={alertRuleLabel[key]}
                className={`${fieldClass} w-24 text-right tabular-nums`}
                value={draft[key]}
                onChange={(e) => {operation.begin();setDraft((d) => ({ ...d, [key]: e.target.value }));}}
              />
              <span className="w-10 text-[12px] text-muted">{ruleUnit[key]}</span>
            </span>
          </label>
        ))}
        {error && (
          <p role="alert" className="text-[12.5px] text-rose">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="submit" size="sm" disabled={!can("configuracoes.editar")||operation.pending||!dirty}>
            {operation.busy ? "Salvando…" : "Salvar"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!can("configuracoes.editar")||operation.pending||(isDefault && !dirty)}
            onClick={() => {
              setError(null);
              void operation.run("workspace.settings.update",{alertRules:{}},()=>{setAlertRules({});},()=>setDraft(Object.fromEntries(ruleKeys.map(key=>[key,String(defaultAlertRules[key])])) as Record<keyof AlertRules,string>));
            }}
          >
            Restaurar padrão
          </Button>
        </div>
      </form>
      <WorkspaceOperationFeedback operation={operation} />
    </section>
  );
}

/** Integration status of the AI Gateway; the features stay hidden until it is on. */
function AiCard() {
  const ai = useAiStatus();
  const state = ai.enabled && ai.configured ? "Ligada" : ai.configured ? "Configurada, desligada" : "Não configurada";
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-soft text-ink">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <h2 className="mt-3 text-[15px] font-medium">Inteligência artificial</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Assistente por tarefa, extração de reuniões, sinais de conversas e
        relatórios passam pelo Cloudflare AI Gateway. Tudo sai como rascunho para
        revisão humana; nada é enviado ao cliente automaticamente.
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
        <dt className="text-muted">Estado</dt>
        <dd>{state}</dd>
        <dt className="text-muted">Provedor</dt>
        <dd>{ai.provider}{ai.model ? ` · ${ai.model}` : ""}</dd>
        <dt className="text-muted">Gateway</dt>
        <dd>{ai.gateway ?? "—"}</dd>
      </dl>
      <p className="mt-3 text-[12px] text-muted">
        Como ligar: seção “IA pelo AI Gateway” em DEPLOY.md.
      </p>
    </section>
  );
}

/** Read-only view of the clients' WhatsApp groups, from the Supabase base of the integration. */
function WhatsAppCard() {
  const wa = useWhatsAppStatus();
  const state = wa.enabled ? "Ligada" : wa.configured ? "Configurada, desligada" : "Não configurada";
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-ok-soft text-ok">
        <MessageCircle className="h-3.5 w-3.5" />
      </span>
      <h2 className="mt-3 text-[15px] font-medium">Conversas do WhatsApp</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Ative a captura de mensagens pela Z-API acima ou mantenha uma base Supabase existente.
        As conversas ficam restritas aos clientes e grupos associados. O app não envia mensagens ao WhatsApp.
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
        <dt className="text-muted">Estado</dt>
        <dd>{state}</dd>
        <dt className="text-muted">Fonte</dt>
        <dd>{wa.source === "z-api" ? "Z-API · banco próprio" : `Supabase${wa.table ? ` · tabela ${wa.table}` : ""}`}</dd>
        <dt className="text-muted">Filtro</dt>
        <dd>{wa.groupNameColumn ? `coluna ${wa.groupNameColumn} = nome exato do grupo do cliente` : "—"}</dd>
      </dl>
      <p className="mt-3 text-[12px] text-muted">
        Para Z-API, use o formulário acima. A fonte Supabase continua opcional e é configurada pelo operador do deploy.
      </p>
    </section>
  );
}

/** Workspace-level state of the Google integration; the connection itself is personal (Perfil). */
function GoogleCard() {
  const google = useGoogleStatus();
  const state = !google.enabled
    ? google.configured
      ? "Configurada, desligada"
      : "Não configurada"
    : "Ligada";
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-soft text-ink">
        <CalendarDays className="h-3.5 w-3.5" />
      </span>
      <h2 className="mt-3 text-[15px] font-medium">Google Agenda e Meet</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        A integração é ligada uma vez no servidor; a conexão é de cada pessoa,
        feita no próprio perfil. Reuniões nascem na agenda de quem agenda, com
        link do Meet e convites; gravação e transcrição chegam depois.
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
        <dt className="text-muted">Integração</dt>
        <dd>{state}</dd>
        <dt className="text-muted">Sua conta</dt>
        <dd>
          {google.connected ? `Conectada · ${google.accountEmail}` : "Não conectada"} ·{" "}
          <Link href={paths.profile} className="text-blue hover:underline">
            gerenciar no perfil
          </Link>
        </dd>
      </dl>
      <p className="mt-3 text-[12px] text-muted">
        Como ligar no servidor: seção “Google Agenda e Meet” em DEPLOY.md.
      </p>
    </section>
  );
}
