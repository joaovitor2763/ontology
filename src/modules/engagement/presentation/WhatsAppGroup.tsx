"use client";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { useStakeholders } from "@/modules/clients/infrastructure/stakeholders-state";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { participantFor, phoneKey } from "../application/participants";
import { ParticipantEditor } from "./WhatsAppParticipants";
import { InsightsPanel } from "./InsightsPanel";
import type { WhatsAppMessage } from "@/modules/engagement/application/whatsapp";
import { useInteractionNotes } from "@/modules/engagement/presentation/interactions-state";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";
import {
  fetchGroupMessages,
  type WhatsAppStatus,
} from "@/shared/infrastructure/whatsapp";
import { Button } from "@/shared/ui/primitives";
import {
  Activity,
  BookmarkPlus,
  Bot,
  Check,
  MessageCircle,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";

function dayLabel(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}
const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

/**
 * The client's WhatsApp group is not readable yet: either the client has no
 * group set, or the base of conversations is not connected on the server.
 * Says which, and what to do about it.
 */
export type WhatsAppGroup = { name: string; id: string };

export function ConnectWhatsApp({
  group,
  status,
  onConfigure,
  onDemo,
}: {
  group: WhatsAppGroup | null;
  status: WhatsAppStatus;
  onConfigure: () => void;
  onDemo: () => void;
}) {
  const hasGroup = Boolean(group);
  return (
    <div className="page-gutter flex min-h-0 flex-1 items-start justify-center overflow-y-auto py-10">
      <div className="w-full max-w-[560px] rounded-2xl border border-line bg-surface p-6">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-ok-soft text-ok">
          <MessageCircle className="h-4 w-4" />
        </span>
        <h2 className="mt-4 text-[18px] font-semibold tracking-tight">
          {hasGroup
            ? "Grupo definido, fonte ainda desligada"
            : "Conectar com o WhatsApp"}
        </h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          As conversas do grupo de WhatsApp do cliente ficam na base do Supabase
          alimentada pela integração. Aqui elas aparecem só para leitura,
          filtradas pelo grupo do cliente. O que valer a pena guardar vai para a
          timeline de interações com um clique.
        </p>
        <ol className="mt-4 space-y-2 text-[13px]">
          <li className="flex items-start gap-2.5">
            <Step done={hasGroup} n={1} />
            <span>
              Informar o nome exato do grupo em Configurar cliente › Recursos.
              {group && (
                <span className="block text-[12px] text-muted">
                  {group.name || group.id}
                  {group.name && group.id ? ` · ${group.id}` : ""}
                </span>
              )}
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <Step done={status.enabled} n={2} />
            <span>
              Ligar a fonte no servidor: variáveis{" "}
              <code className="rounded bg-soft px-1">SUPABASE_URL</code>,{" "}
              <code className="rounded bg-soft px-1">SUPABASE_SERVICE_KEY</code>{" "}
              e <code className="rounded bg-soft px-1">WHATSAPP_ENABLED</code>,
              com o nome da tabela e das colunas. Passo a passo em DEPLOY.md.
              <span className="block text-[12px] text-muted">
                {status.enabled
                  ? "Ligada."
                  : status.configured
                    ? "Configurada, desligada."
                    : "Não configurada."}
              </span>
            </span>
          </li>
        </ol>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onConfigure}>
            <Settings2 className="h-3.5 w-3.5" />
            {hasGroup ? "Alterar grupo" : "Definir grupo do cliente"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDemo}>
            <Bot className="h-3.5 w-3.5" />
            Ver conversa demonstrativa
          </Button>
        </div>
      </div>
    </div>
  );
}

function Step({ done, n }: { done: boolean; n: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-medium",
        done ? "bg-ok-soft text-ok" : "bg-soft text-muted",
      )}
    >
      {done ? <Check className="h-3 w-3" /> : n}
    </span>
  );
}

/** Reset history and review context whenever the client or configured group changes. */
export function WhatsAppGroupView(props: {
  company: string;
  group: WhatsAppGroup;
  onTimeline: () => void;
}) {
  return (
    <GroupHistory
      key={`${props.company}:${props.group.id}:${props.group.name}`}
      {...props}
    />
  );
}
function GroupHistory({
  company,
  group,
  onTimeline,
}: {
  company: string;
  group: WhatsAppGroup;
  onTimeline: () => void;
}) {
  const { add,reset } = useInteractionNotes(company);
  const [saveError,setSaveError]=useState<{id:string;message:string}|null>(null);
  const savingLock=useRef(false);
  const { members } = useTeam();
  const { contacts } = useStakeholders();
  const { can } = usePermissions();
  const [tab, setTab] = useState("messages");
  const [number, setNumber] = useState<string | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [fetchedAt, setFetchedAt] = useState("");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const lastRefresh = useRef(0);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState("");
  const [previous, setPrevious] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const { id: groupId, name: groupName } = group;
  useEffect(() => {
    const controller = new AbortController();
    const refresh = tick !== lastRefresh.current;
    lastRefresh.current = tick;
    fetchGroupMessages(
      company,
      cursor,
      controller.signal,
      refresh,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setMessages(result.messages);
        setNextCursor(result.nextCursor);
        setFetchedAt(result.fetchedAt);
        setError(
          result.stale
            ? "Exibindo a última leitura salva. Atualização em segundo plano; use Atualizar para consultar novamente."
            : "",
        );
        // A page is a bounded reading window, never an ever-growing message list.
        requestAnimationFrame(() => {
          if (!controller.signal.aborted)
            scroller.current?.scrollTo({
              top: cursor ? 0 : scroller.current.scrollHeight,
            });
        });
      })
      .catch((problem: unknown) => {
        if (!controller.signal.aborted)
          setError(
            problem instanceof Error
              ? problem.message
              : "Não foi possível ler o grupo.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [company, groupId, groupName, cursor, tick]);
  function beginPage() {
    setLoading(true);
    setMessages([]);
    setNextCursor(null);
    setError("");
  }
  function latest() {
    beginPage();
    setPrevious([]);
    setCursor("");
    setTick((n) => n + 1);
  }
  function older() {
    if (nextCursor) {
      beginPage();
      setPrevious((p) => [...p, cursor]);
      setCursor(nextCursor);
    }
  }
  function newer() {
    beginPage();
    setCursor(previous.at(-1) ?? "");
    setPrevious((p) => p.slice(0, -1));
  }
  const personFor = (from: string) =>
    participantFor(from, members, contacts, company);
  async function keep(m: WhatsAppMessage) {
    if(savingLock.current)return;
    savingLock.current=true;setSaveError(null);setSaving(m.id);
    try {
      const problem = await add({
        title: `WhatsApp · ${personFor(m.from)?.name ?? m.from}`,
        text: m.text,
        at: m.at,
        kind: "conversa",
        files: [],
      },undefined,"whatsapp:"+m.id);
      if (!problem) setSaved((set) => new Set([...set, m.id]));
      else setSaveError({id:m.id,message:problem});
    } catch(e){setSaveError({id:m.id,message:e instanceof Error?e.message:"Não foi possível confirmar a interação."});}
    finally {
      savingLock.current=false;setSaving(null);
    }
  }
  const groups: { day: string; items: WhatsAppMessage[] }[] = [];
  for (const m of messages) {
    const day = dayLabel(m.at),
      last = groups.at(-1);
    if (last?.day === day) last.items.push(m);
    else groups.push({ day, items: [m] });
  }
  const numbers = [...new Set(messages.map((m) => phoneKey(m.from) || m.from))];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="page-gutter shrink-0 border-b border-line py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2
              className="truncate text-[14px] font-semibold"
              title={group.name}
            >
              {group.name || "Grupo do cliente"}
            </h2>
            <p className="mt-1 text-[11px] text-muted">
              Só leitura
              {fetchedAt ? ` · atualizado ${formatDateTime(fetchedAt)}` : ""}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={latest} disabled={loading}>
            <RefreshCw
              className={cn("h-3.5 w-3.5", loading && "animate-spin")}
            />
            Atualizar
          </Button>
        </div>
        <div
          className="mt-3 flex flex-wrap gap-1"
          aria-label="Conteúdo do WhatsApp"
        >
          {[
            ["messages", "Mensagens"],
            ["insights", "Resumos e sugestões"],
            ["people", "Participantes"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                "rounded-lg px-3 py-2 text-[12px] font-medium",
                tab === value
                  ? "bg-ink text-on-ink"
                  : "text-muted hover:bg-soft",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      {tab === "insights" ? (
        <div className="page-gutter min-h-0 flex-1 overflow-y-auto">
          <InsightsPanel company={company} />
        </div>
      ) : (
        <>
          <div className="page-gutter flex shrink-0 flex-wrap items-center gap-2 border-b border-line py-2 text-[11px] text-muted">
            <span className="mr-auto">
              {loading
                ? "Carregando mensagens…"
                : `${messages.length} mensagens · ${cursor ? "histórico anterior" : "mais recentes"}`}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={loading || !nextCursor}
              onClick={older}
            >
              Mais antigas
            </Button>
            {cursor && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={loading}
                  onClick={newer}
                >
                  Mais novas
                </Button>
                <button
                  className="px-2 underline"
                  disabled={loading}
                  onClick={latest}
                >
                  Ir para recentes
                </button>
              </>
            )}
          </div>
          <div
            ref={scroller}
            aria-busy={loading}
            className="page-gutter min-h-0 flex-1 overflow-y-auto bg-soft/30 py-4"
          >
            {error && (
              <p
                role="alert"
                className="mb-3 rounded-lg bg-rose-soft p-3 text-[13px] text-rose"
              >
                {error}{" "}
                <button
                  className="underline"
                  onClick={() => {
                    setLoading(true);
                    setTick((n) => n + 1);
                  }}
                >
                  Tentar novamente
                </button>
              </p>
            )}
            {tab === "people" ? (
              <div className="mx-auto max-w-3xl">
                <p className="mb-4 text-[13px] text-muted">
                  Participantes das mensagens desta página. Clique em um número
                  para vincular ao cadastro. Consulte páginas anteriores para
                  outros participantes.
                </p>
                <div className="divide-y divide-line rounded-xl border border-line bg-surface">
                  {numbers.map((n) => {
                    const person = personFor(n);
                    return (
                      <button
                        key={n}
                        onClick={() => setNumber(n)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left"
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-soft text-[11px]">
                          {person?.initials || "?"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">
                            {person?.name || n}
                          </span>
                          <span className="text-[11px] text-muted">
                            {person
                              ? `${person.org === "praxis" ? "Equipe G4" : "Stakeholder"} · ${n}`
                              : "Identificar participante"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-[860px]">
                {!loading && !messages.length && !error && (
                  <p className="py-10 text-center text-[13px] text-muted">
                    Nenhuma mensagem neste período.
                  </p>
                )}
                {groups.map((g) => (
                  <section key={g.day} className="mb-5">
                    <h3 className="sticky top-0 z-10 mb-3 text-center">
                      <span className="inline-block rounded-full border border-line bg-surface px-3 py-1 text-[10px] text-muted">
                        {g.day}
                      </span>
                    </h3>
                    <ul className="space-y-1">
                      {g.items.map((m, i) => {
                        const person = personFor(m.from),
                          internal =
                            person?.org === "praxis" || (!person && m.fromMe);
                        const consecutive =
                          i > 0 &&
                          g.items[i - 1].from === m.from &&
                          Date.parse(m.at) - Date.parse(g.items[i - 1].at) <
                            300000;
                        return (
                          <li
                            key={m.id}
                            className={cn(
                              "flex",
                              internal ? "justify-end" : "justify-start",
                              !consecutive && "pt-2",
                            )}
                          >
                            <article
                              className={cn(
                                "min-w-0 max-w-[94%] rounded-xl px-3 py-2 text-[13px] sm:max-w-[80%]",
                                internal
                                  ? "bg-ok-soft"
                                  : "border border-line bg-surface",
                              )}
                            >
                              {!consecutive && (
                                <button
                                  onClick={() => setNumber(m.from)}
                                  className="mb-1 block max-w-full truncate text-left text-[11px] font-semibold text-ink-soft hover:underline"
                                  title="Identificar ou editar participante"
                                >
                                  {person?.name || m.from}
                                  <span className="ml-2 font-normal text-muted">
                                    {person
                                      ? internal
                                        ? "Equipe G4"
                                        : "Stakeholder"
                                      : "Identificar"}
                                  </span>
                                </button>
                              )}
                              <MessageText text={m.text} />
              {saveError?.id===m.id&&<div className="mt-2 text-xs"><p role="alert" className="text-rose">{saveError.message}</p><button disabled={saving!==null} onClick={()=>void keep(m)} className="mr-3 text-blue">Verificar gravação</button><button disabled={saving!==null} onClick={()=>{reset("whatsapp:"+m.id);setSaveError(null);}} className="text-muted">Revisar gravação</button></div>}
                              <div className="mt-1 flex items-center justify-end gap-3 text-[10px] text-muted">
                                <time dateTime={m.at}>{timeLabel(m.at)}</time>
                                {can("interacoes.registrar", company) && (
                                  <button
                                    disabled={
                                      saved.has(m.id) || saving !== null
                                    }
                                    onClick={() => void keep(m)}
                                    className="rounded p-1 hover:bg-surface/60"
                                    aria-label={
                                      saved.has(m.id)
                                        ? "Mensagem salva na timeline"
                                        : "Salvar mensagem na timeline"
                                    }
                                    title="Salvar na timeline"
                                  >
                                    {saved.has(m.id) ? (
                                      <Check className="h-3 w-3 text-ok" />
                                    ) : (
                                      <BookmarkPlus className="h-3 w-3" />
                                    )}
                                  </button>
                                )}
                              </div>
                            </article>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>
          <footer className="page-gutter flex shrink-0 items-center justify-between gap-2 border-t border-line py-2 text-[11px] text-muted">
            <span>Nenhuma mensagem é enviada por aqui.</span>
            <button
              onClick={onTimeline}
              className="inline-flex items-center gap-1 hover:text-ink"
            >
              <Activity className="h-3 w-3" />
              Timeline
            </button>
          </footer>
        </>
      )}
      {number && (
        <ParticipantEditor
          key={number}
          company={company}
          number={number}
          onClose={() => setNumber(null)}
        />
      )}
    </div>
  );
}
function MessageText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 900;
  return (
    <>
      <p className="whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">
        {long && !expanded ? `${text.slice(0, 900)}…` : text}
      </p>
      {long && (
        <button
          className="mt-1 text-[11px] font-medium underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Recolher mensagem" : "Ler mensagem completa"}
        </button>
      )}
    </>
  );
}
