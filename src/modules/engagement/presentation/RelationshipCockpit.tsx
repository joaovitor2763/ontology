"use client";
import { Checkbox } from "@/shared/ui/Checkbox";
import { useSignalOperation, SignalOperationFeedback } from "./useSignalOperation";
import { Combobox } from "@/shared/ui/Combobox";
import { InsightsPanel } from "./InsightsPanel";
import { useCatalogState } from "@/modules/catalog/infrastructure/state";
import { useCatalog } from "@/modules/catalog/presentation/catalog";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { enrollmentCanReceiveWork } from "@/modules/clients/domain/product-enrollments";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import type {
  Signal,
  SignalCategory,
} from "@/modules/engagement/domain/models";
import {
  healthLevelLabel,
  signalCategoryLabel,
  signalPriorityLabel,
} from "@/modules/engagement/domain/signals";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import {
  useSignals,
  type ThreadSignals,
} from "@/modules/engagement/presentation/useSignals";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { cn } from "@/shared/lib/cn";
import {
  NOW,
  formatDateTime,
  padMilestone,
  relativeFrom,
} from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { Modal } from "@/shared/ui/Dialog";
import { Badge, Button, Empty } from "@/shared/ui/primitives";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPlus,
  HelpCircle,
  Handshake,
  Info,
  MessageCircle,
  MonitorSmartphone,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type Tab = "all" | SignalCategory;
const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "Tudo" },
  { id: "pergunta", label: "Perguntas" },
  { id: "risco", label: "Riscos" },
  { id: "compromisso", label: "Compromissos" },
  { id: "acao", label: "Ações" },
  { id: "informacao_faltante", label: "Info faltante" },
];

const ICONS: Record<SignalCategory, typeof Info> = {
  pergunta: HelpCircle,
  risco: AlertTriangle,
  compromisso: Handshake,
  acao: ClipboardPlus,
  informacao_faltante: Info,
  plataforma: MonitorSmartphone,
};

const priorityTone: Record<Signal["priority"], "neutral" | "warn" | "bad"> = {
  baixa: "neutral",
  media: "warn",
  alta: "bad",
};

/**
 * Operational queue of a client's conversations: what needs a person, why,
 * and safe actions. Nothing here sends anything to the client.
 */
export function RelationshipCockpit({
  company,
  onOpenThread,
}: {
  company: string;
  onOpenThread?: (threadId: string) => void;
}) {
  const { byThread, open, next } = useSignals(company);
  const { resolveSignal, reopenSignal } = useEngagementState();
  const { addTask,companyJourney } = useDeliveryState();
  const { me } = useTeam();
  const { clientBySlug,enrollments } = useClientsState();
  const { milestoneOf } = useCatalog();
  const {products}=useCatalogState();
  const operation=useSignalOperation();
  const [enrollmentId,setEnrollmentId]=useState("");
  const choices=enrollments.filter(e=>e.company===company&&enrollmentCanReceiveWork(e));
  const [tab, setTab] = useState<Tab>("all");
  const [showResolved, setShowResolved] = useState(false);
  const [selected, setSelected] = useState<Signal | null>(null);
  const client = clientBySlug(company);
  const milestone = client ? milestoneOf(client) : null;
  const main = pickMainThread(byThread);
  const rows = byThread
    .flatMap((t) => t.signals)
    .filter((s) => (showResolved ? true : !s.resolvedAt && !s.answeredLater))
    .filter((s) => tab === "all" || s.categories.includes(tab));
  const current = selected
    ? (byThread.flatMap((t) => t.signals).find((s) => s.id === selected.id) ??
      selected)
    : null;

  function createDelivery(signal: Signal) {
    if(operation.pending||operation.busy)return;
    const enrollment=choices.length===1?choices[0]:choices.find(e=>e.id===enrollmentId);
    if(choices.length&&!enrollment)return;
    const input={company,signalId:signal.id,enrollmentId:enrollment?.id??null};
    void operation.run("signals.createTask",input,()=>{
    if(signal.deliveryId){resolveSignal(signal.id,me.id);return;}
    const id = `d-${crypto.randomUUID()}`;
    addTask({
      id,
      company: signal.company,
      title:
        signal.title.replace(/^[^·]+·\s*/, "").slice(0, 120) ||
        "Acompanhar conversa",
      description: `Origem: conversa de ${formatDateTime(signal.at)}. “${signal.text}”`,
      status: "fila",
      ownerId: me.id,
      dueAt: plusDays(signal.priority === "alta" ? 2 : 7),
      hours: 2,
      workstream: "Relacionamento",
      milestone: 0,
      completion: "checklist",
      kind: "journey",
      origin: "whatsapp",
      requestedBy: me.id,
      ...(enrollment?{enrollmentId:enrollment.id,productId:enrollment.productId,journeyId:enrollment.planId}:{journeyId:companyJourney[company]??client?.journeyId}),
      priority: signal.priority === "alta" ? "alta" : "media",
    });
    resolveSignal(signal.id, me.id, id);
    });
  }

  return (
    <div className="space-y-5">
      <InsightsPanel company={company} />
      {main ? (
        <section
          className={cn(
            "rounded-2xl border p-4",
            main.health.level === "critical"
              ? "border-rose/30 bg-rose-soft/40"
              : main.health.level === "attention"
                ? "border-amber/30 bg-amber-soft/40"
                : "border-line bg-surface",
          )}
          aria-label="Saúde da conversa"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <MessageCircle className="h-4 w-4 text-muted" />
                <span className="text-[13px] font-medium">
                  {main.thread.title}
                </span>
                <Badge
                  tone={
                    main.health.level === "critical"
                      ? "bad"
                      : main.health.level === "attention"
                        ? "warn"
                        : "ok"
                  }
                >
                  {healthLevelLabel[main.health.level]} · {main.health.score}
                </Badge>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                {main.health.summary}
              </p>
              <p className="mt-1 text-[12px] text-muted">
                {main.health.messages7d} mensagens em 7 dias
                {main.health.lastActivityAt
                  ? ` · última atividade ${relativeFrom(main.health.lastActivityAt)}`
                  : " · sem atividade"}
                {" · "}sinais por regra, atualizados agora
              </p>
            </div>
            {main.thread.id && onOpenThread && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenThread(main.thread.id)}
              >
                Abrir conversa
              </Button>
            )}
          </div>
        </section>
      ) : (
        <Empty
          title="Nenhuma conversa com sinais"
          hint="Quando houver mensagens de WhatsApp, calls ou e-mails registradas, os sinais aparecem aqui."
        />
      )}

      {next && (
        <section className="rounded-2xl border border-accent/25 bg-accent-soft/25 p-[3px]">
          <div className="flex items-center gap-2 px-3 py-2 text-[12px] font-medium text-accent-deep">
            <Sparkles className="h-3.5 w-3.5" />
            Próxima melhor ação
          </div>
          <button
            type="button"
            onClick={() => {operation.begin();setSelected(next);setEnrollmentId("");}}
            className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left hover:bg-soft/60"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium">
                {next.title}
              </span>
              <span className="mt-0.5 block text-[12.5px] text-muted">
                {next.author} · {relativeFrom(next.at)} ·{" "}
                {main?.health.recommendation}
              </span>
            </span>
            <Badge tone={priorityTone[next.priority]}>
              {signalPriorityLabel[next.priority]}
            </Badge>
          </button>
        </section>
      )}

      <section aria-label="Fila de sinais">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-0.5 text-[12.5px]">
            {TABS.map((t) => {
              const n = byThread
                .flatMap((x) => x.open)
                .filter(
                  (s) => t.id === "all" || s.categories.includes(t.id),
                ).length;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5",
                    tab === t.id
                      ? "bg-ink font-medium text-on-ink"
                      : "text-muted hover:bg-soft",
                  )}
                >
                  {t.label}
                  {n > 0 && <span className="ml-1 opacity-70">{n}</span>}
                </button>
              );
            })}
          </div>
          <Checkbox
            label="Mostrar resolvidos e respondidos"
            hideLabel={false}
            checked={showResolved}
            onCheckedChange={setShowResolved}
          />
        </div>
        <ul className="mt-3 divide-y divide-line rounded-xl ring-1 ring-line">
          {rows.length === 0 && (
            <li className="px-4 py-6 text-center text-[13px] text-muted">
              Nada pendente neste recorte.{" "}
              {open.length === 0 ? "A conversa está em dia." : ""}
            </li>
          )}
          {rows.map((s) => {
            const Icon = ICONS[s.categories[0] ?? "acao"];
            const done = Boolean(s.resolvedAt) || Boolean(s.answeredLater);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {operation.begin();setSelected(s);setEnrollmentId("");}}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-soft/60",
                    done && "opacity-60",
                  )}
                >
                  <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-soft text-ink-soft">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium">
                        {s.title}
                      </span>
                      <Badge tone={priorityTone[s.priority]}>
                        {signalPriorityLabel[s.priority]}
                      </Badge>
                      {s.source === "ia" && <Badge tone="neutral">IA</Badge>}
                      {s.answeredLater && !s.resolvedAt && (
                        <Badge tone="neutral">respondido depois</Badge>
                      )}
                      {s.resolvedAt && <Badge tone="ok">resolvido</Badge>}
                    </span>
                    <span className="mt-1 block truncate text-[12.5px] text-muted">
                      {s.author} · {relativeFrom(s.at)} ·{" "}
                      {s.categories
                        .map((c) => signalCategoryLabel[c])
                        .join(", ")}
                    </span>
                    <span className="mt-1 block line-clamp-2 text-[13px] text-ink-soft">
                      “{s.text}”
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <Modal
        open={!!current}
        onClose={() => {if(!operation.busy){operation.reset();setSelected(null);}}}
        size="md"
        kicker={
          current
            ? `${current.author} · ${formatDateTime(current.at)}`
            : undefined
        }
        title={current?.title ?? ""}
        footer={
          current && (
            <>
              {current.deliveryId&&<Button href={paths.clientDelivery(current.company,current.deliveryId)} variant="ghost" size="sm">Ver tarefa criada</Button>}
              {current.resolvedAt?<Button variant="ghost" size="sm" disabled={operation.busy||operation.pending} onClick={()=>void operation.run("signals.reopen",{company,signalId:current.id},()=>reopenSignal(current.id))}>{operation.busy?"Reabrindo…":"Reabrir"}</Button>:<>
                <Button variant="ghost" size="sm" disabled={operation.busy||operation.pending} onClick={()=>void operation.run("signals.resolve",{company,signalId:current.id},()=>resolveSignal(current.id,me.id))}><CheckCircle2 className="h-3.5 w-3.5"/>{operation.busy?"Resolvendo…":"Marcar como resolvida"}</Button>
                {!current.deliveryId&&<Button size="sm" disabled={operation.busy||operation.pending||(choices.length>1&&!enrollmentId)} onClick={()=>createDelivery(current)}><ClipboardPlus className="h-3.5 w-3.5"/>{operation.busy?"Criando…":"Criar tarefa"}</Button>}
              </>}

            </>
          )
        }
      >
        <SignalOperationFeedback operation={operation}/>
        {current&&!current.deliveryId&&!current.resolvedAt&&<div className="mb-4">{choices.length>1?<Combobox label="Contratação da tarefa" value={enrollmentId} disabled={operation.busy||operation.pending} onValueChange={setEnrollmentId} options={choices.map(e=>({value:e.id,label:`${products.find(p=>p.id===e.productId)?.name??"Produto"} · ${e.startsAt??"sem data"} · ${e.id.slice(0,8)}`}))}/>:<p className="text-xs text-muted">{choices[0]?`Contratação: ${products.find(p=>p.id===choices[0].productId)?.name??"Produto"} · ${choices[0].startsAt??"sem data"}`:"Tarefa avulsa, sem contratação."}</p>}</div>}
        {current && (
          <div className="space-y-5 text-[13.5px]">
            <blockquote className="rounded-xl border-l-2 border-line-strong bg-soft px-4 py-3 leading-relaxed text-ink-soft">
              {current.text}
            </blockquote>
            <section>
              <h3 className="text-[12px] font-medium uppercase tracking-wide text-muted">
                Por que é prioritário?
              </h3>
              <p className="mt-1.5 leading-relaxed">{current.reason}</p>
              {current.source === "ia" && current.confidence != null && (
                <p className="mt-1 text-[12px] text-muted">
                  Classificado pela inteligência com confiança{" "}
                  {Math.round(current.confidence * 100)}%.
                </p>
              )}
            </section>
            <section>
              <h3 className="text-[12px] font-medium uppercase tracking-wide text-muted">
                Contexto
              </h3>
              <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
                <dt className="text-muted">Categorias</dt>
                <dd>
                  {current.categories
                    .map((c) => signalCategoryLabel[c])
                    .join(", ")}
                </dd>
                <dt className="text-muted">Prioridade</dt>
                <dd>{signalPriorityLabel[current.priority]}</dd>
                {main && (
                  <>
                    <dt className="text-muted">Saúde da conversa</dt>
                    <dd>
                      {healthLevelLabel[main.health.level]} ·{" "}
                      {main.health.score}
                    </dd>
                  </>
                )}
                {milestone && (
                  <>
                    <dt className="text-muted">Marco atual</dt>
                    <dd>
                      <Link
                        href={paths.clientPlan(company)}
                        className="hover:text-blue"
                      >
                        {padMilestone(milestone.n)} · {milestone.def.name}
                      </Link>
                    </dd>
                  </>
                )}
                {current.resolvedAt && (
                  <>
                    <dt className="text-muted">Resolvido</dt>
                    <dd>
                      {formatDateTime(current.resolvedAt)}
                      {current.resolvedBy ? ` · ${current.resolvedBy}` : ""}
                    </dd>
                  </>
                )}
              </dl>
            </section>
            <p className="flex items-start gap-2 rounded-xl bg-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-muted">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Ação segura: marcar como resolvida ou criar uma tarefa registra
              só no workspace. Nada é enviado ao cliente.
            </p>
            {onOpenThread && (
              <button
                type="button"
                disabled={operation.busy}
                onClick={() => {
                  operation.reset();
                  onOpenThread(current.threadId);
                  setSelected(null);
                }}
                className="text-[12.5px] text-blue hover:underline"
              >
                Abrir a conversa original
              </button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function pickMainThread(byThread: ThreadSignals[]) {
  return [...byThread].sort(
    (a, b) =>
      Number(b.thread.channel === "whatsapp") -
        Number(a.thread.channel === "whatsapp") ||
      b.thread.lastAt.localeCompare(a.thread.lastAt),
  )[0];
}

function plusDays(days: number) {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
