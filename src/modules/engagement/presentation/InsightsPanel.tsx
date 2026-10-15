"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import { InsightSource } from "./InsightSource";
import { ConfirmDialog } from "@/shared/ui/Dialog";
import type { Insight, InsightBody } from "../domain/insights";
import { Button } from "@/shared/ui/primitives";
import { Select } from "@/shared/ui/Select";
import { useAiStatus } from "@/shared/infrastructure/ai";
import { operationAttempt, type OperationAttempt } from "@/shared/infrastructure/operations";
import { formatDateTime } from "@/shared/lib/format";
type Snapshot = {
  items: Insight[];
  nextCursor: string | null;
  bookmark?: string;
  job: {
    status: string;
    phase: string;
    imported: number;
    error: string | null;
  } | null;
  canReview: boolean;
  canSync: boolean;
  fallbackStatus?: Insight["status"] | null;
};
/** Persistent, contextual review inbox. Validation does not execute the suggested actions. */
export function InsightsPanel(props: { company: string; meeting?: string }) {
  return (
    <ContextInsights
      key={`${props.company}:${props.meeting ?? "whatsapp"}`}
      {...props}
    />
  );
}

function ContextInsights({
  company,
  meeting,
}: {
  company: string;
  meeting?: string;
}) {
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [days, setDays] = useState("30"),
    [view, setView] = useState("pending"),
    [cursor, setCursor] = useState("");
  const [confirmation, setConfirmation] = useState<{ hash: string; message: string } | null>(null);
  const [notice, setNotice] = useState("");
  const actionRunning = useRef(false);
  const actionAttempt = useRef<OperationAttempt | null>(null);
  const bookmark = useRef("");
  const ai = useAiStatus();
  const generation = useRef(0);
  const initialMeetingViewResolved = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    const query = new URLSearchParams({
      company,
      status: view,
      ...(cursor ? { cursor } : {}),
      ...(meeting ? { meeting } : {}),
    });
    const response = await fetch(`/api/insights?${query}`, {
      cache: "no-store",
      headers: bookmark.current ? { "x-d1-bookmark": bookmark.current } : {},
    });
    if (!response.ok) throw new Error("Não foi possível carregar as análises.");
    const snapshot = (await response.json()) as Snapshot;
    if (version !== generation.current) return;
    bookmark.current = snapshot.bookmark ?? "";
    if (meeting && !initialMeetingViewResolved.current) {
      initialMeetingViewResolved.current = true;
      if (
        view === "pending" &&
        snapshot.items.length === 0 &&
        snapshot.fallbackStatus &&
        snapshot.fallbackStatus !== "pending"
      ) {
        setView(snapshot.fallbackStatus);
        setCursor("");
        return;
      }
    }
    setData(snapshot);
    setLoaded(true);
    setError("");
  }, [company, meeting, view, cursor]);
  // Só há análise nova a chegar com a IA ligada ou uma importação em curso;
  // fora disso a caixa é lida uma vez, sem relógio.
  const live = ai.enabled || data?.job != null;
  useEffect(() => {
    const requests = generation;
    let alive = true;
    const read = () => {
      if (alive && !document.hidden)
        void refresh().catch((e) => {
          if (alive) setError(e.message);
        });
    };
    read();
    return () => {
      alive = false;
      requests.current++;
    };
  }, [refresh]);
  // Ligar o polling não repete a carga inicial nem invalida uma resposta em voo.
  useEffect(() => {
    if (!live) return;
    let alive = true;
    const timer = setInterval(() => {
      if (!document.hidden)
        void refresh().catch((e) => {
          if (alive) setError(e.message);
        });
    }, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [refresh, live]);
  async function act(action: string, id?: string, confirmedHash?: string) {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const input = {
        action,
        company,
        meeting,
        id,
        days: Number(days),
        confirmedHash,
      };
      const attempt = operationAttempt(
        `insights.${action}`,
        input,
        actionAttempt.current,
      );
      actionAttempt.current = attempt;
      const response = await fetch("/api/insights", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": attempt.key,
        },
        body: JSON.stringify(input),
      });
      const body = (await response.json()) as {
        error?: string;
        sourceHash?: string;
        reused?: boolean;
        status?: Insight["status"];
      };
      if (response.status === 409 && body.sourceHash) {
        setConfirmation({ hash: body.sourceHash, message: body.error || "O conteúdo mudou." });
        return;
      }
      if (!response.ok)
        throw new Error(body.error || "Não foi possível concluir.");
      actionAttempt.current = null;
      if (action === "meeting")
        setNotice(
          body.reused
            ? "Este conteúdo já estava analisado. Abrimos a análise salva, sem chamar a IA novamente."
            : "Nova análise gerada e salva a partir da fonte atual.",
        );
      bookmark.current = "";
      const target =
        action === "accept"
          ? "accepted"
          : action === "dismiss"
            ? "dismissed"
            : action === "meeting"
              ? body.status
              : undefined;
      if (target && target !== view) {
        setLoaded(false);
        setData(null);
        setView(target);
        setCursor("");
        return;
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao atualizar.");
    } finally {
      actionRunning.current = false;
      setBusy(false);
    }
  }
  const items = (data?.items ?? []).filter(
    (i) => i.status === view && (meeting || i.source_kind === "whatsapp"),
  );
  return (
    <section className="my-4 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">
            {meeting ? "Sugestões da reunião" : "Resumos e sinais do WhatsApp"}
          </h2>
          <p className="mt-1 text-[12px] text-muted">
            A IA propõe. Você valida ou descarta; nenhuma ação é executada
            automaticamente.
          </p>
        </div>
        {meeting
          ? data?.canReview && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !ai.enabled || !ai.configured}
                onClick={() => void act("meeting")}
              >
                {busy ? "Analisando…" : "Analisar transcrição ou notas"}
              </Button>
            )
          : data?.canSync && (
              <div className="flex flex-wrap gap-2">
                <Select
                  label="Período de importação"
                  value={days}
                  onValueChange={setDays}
                  options={[
                    { value: "2", label: "Últimos 2 dias" },
                    { value: "30", label: "Últimos 30 dias" },
                    { value: "90", label: "Últimos 90 dias" },
                    { value: "365", label: "Último ano" },
                  ]}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={
                    busy ||
                    ["pending", "running"].includes(data.job?.status ?? "")
                  }
                  onClick={() => void act("sync")}
                >
                  Importar e analisar
                </Button>
              </div>
            )}
      </div>
      {!meeting && (
        <p className="mt-2 text-[12px] text-muted">
          Coleta diária às 06h (São Paulo). Históricos extensos continuam em
          segundo plano. Resumos de dias movimentados são divididos em partes.
        </p>
      )}
      {!meeting && data?.job && (
        <p role="status" className="mt-2 text-[12px] text-muted">
          {data.job.status === "complete"
            ? "Atualização concluída"
            : data.job.status === "failed"
              ? "Atualização interrompida"
              : data.job.status === "cancelled"
                ? "Grupo alterado; atualização cancelada"
                : data.job.phase === "import"
                  ? "Importando mensagens…"
                  : "Gerando resumos…"}{" "}
          · {data.job.imported} mensagens processadas
          {data.job.error ? ` · ${data.job.error}` : ""}
        </p>
      )}
      {notice && <p role="status" className="mt-2 text-[13px] text-muted">{notice}</p>}
      <ConfirmDialog open={Boolean(confirmation)} onClose={() => setConfirmation(null)} onConfirm={() => { if (confirmation) void act("meeting", undefined, confirmation.hash); }} title="Analisar conteúdo atualizado?" description={confirmation?.message} confirmLabel="Gerar nova análise" />
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-rose">
          {error}
        </p>
      )}
      <div className="my-3 flex flex-wrap gap-2">
        {[
          ["pending", "Para revisar"],
          ["accepted", "Validados"],
          ["dismissed", "Descartados"],
        ].map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => {
              setLoaded(false);
              setData(null);
              setView(v);
              setCursor("");
            }}
            className={`rounded-lg px-3 py-1.5 text-[12px] ${view === v ? "bg-ink text-on-ink" : "bg-soft text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {!loaded && !error && (
        <p role="status" className="text-[13px] text-muted">
          Carregando análises…
        </p>
      )}
      {loaded && !items.length && (
        <p className="text-[13px] text-muted">Nenhuma análise nesta lista.</p>
      )}
      {items.length > 0 && (
        <p className="mb-3 text-[12px] text-muted">
          {items.length}
          {data?.nextCursor ? "+" : ""} análises nesta lista · Abra uma para
          revisar os detalhes.
        </p>
      )}
      <div className="space-y-2">
        {items.map((item) => {
          const body = JSON.parse(item.body) as InsightBody;
          return (
            <details
              key={item.id}
              className="rounded-xl border border-line p-3"
            >
              <summary className="cursor-pointer text-[13px] font-medium">
                <span>{meeting ? item.title : compactTitle(item.title)}</span>
                {meeting && <span className="ml-2 rounded bg-soft px-2 py-0.5 text-[11px] font-normal text-muted">{(JSON.parse(item.evidence) as string[]).some((id) => id.startsWith("up-")) ? "Transcrição" : "Notas / resumo"}</span>}
                <span className="mt-1 block truncate text-[12px] font-normal text-muted">
                  {body.summary}
                </span>
                <span className="mt-1 block text-[11px] font-normal text-muted">
                  {body.decisions.length}{" "}
                  {body.decisions.length === 1 ? "decisão" : "decisões"} ·{" "}
                  {body.actions.length}{" "}
                  {body.actions.length === 1 ? "sugestão" : "sugestões"} ·{" "}
                  {body.risks.length}{" "}
                  {body.risks.length === 1 ? "sinal" : "sinais"}
                </span>
              </summary>
              <p className="mt-1 text-[11px] text-muted">
                {formatDateTime(item.created_at)} · {item.model}
                {item.reviewed_by
                  ? ` · revisado por ${item.reviewed_by}`
                  : " · aguardando revisão"}
              </p>
              <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed">
                {body.summary}
              </p>
              {(
                [
                  ["Decisões mencionadas", body.decisions],
                  ["Sugestões do que fazer", body.actions],
                  ["Riscos e sinais", body.risks],
                  ["Pendências", body.questions],
                ] as [string, string[]][]
              )
                .filter(([, values]) => values.length)
                .map(([label, values]) => (
                  <div key={label} className="mt-3">
                    <h4 className="text-[12px] font-medium">{label}</h4>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-[13px]">
                      {values.map((v, i) => (
                        <li key={i}>{v}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              <InsightSource item={item} />
              {item.status === "pending" && data?.canReview && (
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void act("accept", item.id)}
                  >
                    Validar análise
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void act("dismiss", item.id)}
                  >
                    Descartar
                  </Button>
                </div>
              )}
            </details>
          );
        })}
      </div>
      <div className="mt-3 flex gap-2">
        {cursor && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setLoaded(false);
              setData(null);
              setCursor("");
            }}
          >
            Mais recentes
          </Button>
        )}
        {data?.nextCursor && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setLoaded(false);
              setData(null);
              setCursor(data.nextCursor!);
            }}
          >
            Mais antigas
          </Button>
        )}
      </div>
    </section>
  );
}

/** The group is already in the page header. Keep the review list focused on its day. */
function compactTitle(title: string) {
  const match = title.match(/(\d{4})-(\d{2})-(\d{2})(.*)$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}${match[4]}` : title;
}
