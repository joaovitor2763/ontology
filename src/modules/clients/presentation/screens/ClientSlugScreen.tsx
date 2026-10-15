"use client";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";

import {
  charterFieldLabel,
  charterMissing,
} from "@/modules/clients/domain/models";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { ServiceSettings } from "@/modules/delivery/presentation/ServiceSettings";
import { StakeholderSummary } from "@/modules/clients/presentation/Stakeholders";
import type { Delivery } from "@/modules/delivery/domain/models";
import { ServiceSummary } from "@/modules/delivery/presentation/ServiceSummary";
import { useServices } from "@/modules/delivery/presentation/state";
import { TaskDrawer } from "@/modules/delivery/presentation/TaskDrawer";
import { useClientProgress } from "@/modules/delivery/presentation/useClientProgress";
import { meetingsFor } from "@/modules/engagement/infrastructure/queries";
import { useLiveOntology } from "@/modules/knowledge/infrastructure/state";
import { useAlerts } from "@/modules/workspace/presentation/useAlerts";
import { precedenceRank } from "@/modules/workspace/domain/derived-alerts";
import { useClientHealth } from "@/modules/clients/presentation/useClientHealth";
import { allocationRoleName } from "@/modules/clients/domain/allocation";
import { AllocationManager } from "@/modules/clients/presentation/AllocationManager";
import { cycleStatusLabel } from "@/modules/delivery/domain/services";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { useWorkspaceState } from "@/modules/workspace/infrastructure/state";
import {
  NOW,
  coverageCopy,
  dueMeta,
  formatDate,
  formatDateTime,
  isRequest,
  padMilestone,
} from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { ListPanel } from "@/shared/ui/ListPanel";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardStack,
  Empty,
  HealthBadge,
  StatusBadge,
} from "@/shared/ui/primitives";
import {
  ArrowUpRight,
  CheckCircle2,
  Target,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

type Attention = {
  id: string;
  rank: number;
  category: string;
  title: string;
  detail: string;
  due?: string;
  tone: "bad" | "warn" | "neutral";
  href?: string;
  task?: Delivery;
};

export default function ClientOverview() {
  const { slug } = useParams<{ slug: string }>();
  const { clientBySlug, allocationsFor, enrollments } = useClientsState();
  const c = clientBySlug(slug);
  const { configFor, products } = useServices();
  const ont = useLiveOntology(slug);
  const { patchTask } = useDeliveryState();
  const { allMeetings } = useEngagementState();
  const { resolve } = useTeam();
  const { can } = usePermissions();
  const { allocationRoles } = useWorkspaceState();
  const progress = useClientProgress(slug);
  const { alerts } = useAlerts(slug);
  const health = useClientHealth(slug);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [charterOpen, setCharterOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  if (!c) return null;
  const missing = charterMissing(c.charter);
  const lastDebrief = progress.cycles
    .filter((x) => x.debrief)
    .sort((a, b) => a.debrief!.at.localeCompare(b.debrief!.at))
    .at(-1);

  const dels = progress.open;
  const reqs = progress.requests.filter((d) => d.status !== "entregue");
  const last =
    allMeetings.find((m) => m.company === slug) ?? meetingsFor(slug)[0];
  const ontologyOn = configFor(slug).modules.ontology;
  const holes = (ontologyOn ? (ont?.nodes ?? []) : [])
    .filter((n) => n.coverageAssessed !== false && n.coverage < 40)
    .sort((a, b) => a.coverage - b.coverage);
  const currentTask =
    progress.all.find((d) => d.id === openTask) ?? null;

  const items: Attention[] = [];
  for (const d of [...dels, ...reqs]) {
    const due = dueMeta(d.dueAt);
    const blocked = d.status === "bloqueado" || Boolean(d.blockers);
    const overdue = due.days !== null && due.days < 0;
    if (
      !blocked &&
      !overdue &&
      d.priority !== "alta" &&
      d.priority !== "critica" &&
      !isRequest(d)
    )
      continue;
    items.push({
      id: d.id,
      rank: blocked ? 0 : overdue ? 5 : isRequest(d) ? 6 : 7,
      category: blocked
        ? "bloqueio"
        : overdue
          ? "prazo"
          : isRequest(d)
            ? "solicitação"
            : "entrega",
      title: d.title,
      detail: d.blockers || d.description,
      due: due.label,
      tone:
        blocked || overdue
          ? "bad"
          : d.priority === "alta" || d.priority === "critica"
            ? "warn"
            : "neutral",
      task: d,
    });
  }
  for (const a of alerts) {
    items.push({
      id: a.id,
      rank: precedenceRank(a),
      category: a.severity === "critico" ? "alerta" : "sinal",
      title: a.title,
      detail: a.detail,
      tone:
        a.severity === "critico"
          ? "bad"
          : a.severity === "atencao"
            ? "warn"
            : "neutral",
      href: paths.alerts(slug),
    });
  }
  for (const h of holes.slice(0, 3)) {
    items.push({
      id: h.id,
      rank: 9,
      category: "ontologia",
      title: `Mapeamento pendente · ${h.label}`,
      detail: `${coverageCopy.fraca.hint} ${h.coverage}% de cobertura avaliada.`,
      due: `${h.coverage}%`,
      tone: h.coverage < 30 ? "bad" : "warn",
      href: paths.clientOntology(slug, h.id),
    });
  }
  const tone = (x: Attention) =>
    x.tone === "bad" ? 0 : x.tone === "warn" ? 1 : 2;
  items.sort((a, b) => a.rank - b.rank || tone(a) - tone(b));
  const shown = items.slice(0, 6);
  const team = allocationsFor(slug);
  const scopeName = (enrollmentId?: string) => {
    if (!enrollmentId) return "Cliente inteiro";
    const enrollment = enrollments.find(row => row.id === enrollmentId);
    return products.find(product => product.id === enrollment?.productId)?.name ?? "Contratação";
  };
  const acceptance = progress.cycles.find((x) => x.status === "em-aceite");
  const acceptanceSince = acceptance
    ? ((acceptance as { acceptanceRequestedAt?: string }).acceptanceRequestedAt ??
      acceptance.endsAt)
    : null;
  const waitingDays = acceptanceSince
    ? Math.max(
        0,
        Math.round(
          (Date.parse(`${NOW.slice(0, 10)}T00:00:00`) -
            Date.parse(`${acceptanceSince.slice(0, 10)}T00:00:00`)) /
            86400000,
        ),
      )
    : 0;

  return (
    <div className="space-y-6">
      <section
        aria-label="Contrato de valor"
        className="rounded-xl border border-line p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="inline-flex items-center gap-2 text-[12px] font-medium text-muted">
            <Target className="h-3.5 w-3.5" />
            Contrato de valor
          </h2>
          <button
            type="button"
            onClick={() => setCharterOpen(true)}
            className="text-[12px] text-muted hover:text-ink"
          >
            {missing.length ? "Definir" : "Editar"}
          </button>
        </div>
        {missing.length === 0 && c.charter ? (
          <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                Como fica quando termina
              </p>
              <p className="mt-1 text-[15px] font-medium leading-snug tracking-tight">
                {c.charter.finishedLooksLike}
              </p>
              <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                Pergunta-chave
              </p>
              <p className="mt-1 text-[13px] leading-relaxed">{c.charter.keyQuestion}</p>
            </div>
            <div className="text-[12.5px] leading-relaxed">
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                Objetivo
              </p>
              <p className="mt-1 text-ink-soft">{c.charter.objective}</p>
              {c.charter.clarifiedObjective?.trim() && (
                <p className="mt-1.5 border-l-2 border-line pl-2.5">
                  <span className="text-muted">Leitura da equipe · </span>
                  {c.charter.clarifiedObjective}
                </p>
              )}
              {Object.values(c.charter.constraints ?? {}).some((v) => v?.trim()) && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(
                    [
                      ["time", "Tempo"],
                      ["capital", "Capital"],
                      ["talent", "Talento"],
                    ] as const
                  )
                    .filter(([key]) => c.charter?.constraints?.[key]?.trim())
                    .map(([key, label]) => (
                      <span
                        key={key}
                        className="rounded-md bg-soft px-2 py-1 text-[11.5px]"
                      >
                        <span className="text-muted">{label} · </span>
                        {c.charter?.constraints?.[key]}
                      </span>
                    ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[15px] font-medium tracking-tight">
                Defina como fica quando termina
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                Sem o estado final combinado, cada ciclo mede sucesso de um
                jeito. Faltam:{" "}
                {missing.map((key) => charterFieldLabel[key].toLowerCase()).join(", ")}.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCharterOpen(true)}>
              Definir contrato de valor
            </Button>
          </div>
        )}
      </section>
      <ServiceSummary company={slug} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-6">
          <ListPanel
            title="Na sua atenção"
            icon={<TriangleAlert />}
            tone={items.some((i) => i.tone !== "neutral") ? "attention" : undefined}
            count={items.length}
            action={<Link href={paths.alerts(slug)}>Ver alertas</Link>}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
              <span className="text-[12px] text-muted">Saúde do cliente</span>
              <HealthBadge health={health} />
            </div>
            {shown.length ? (
              <div className="divide-y divide-line">
                {shown.map((item) => {
                  const body = (
                    <div className="flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <Badge tone={item.tone === "neutral" ? "neutral" : item.tone}>
                            {item.category}
                          </Badge>
                          {item.due && (
                            <span className="text-[11px] text-muted">
                              {item.due}
                            </span>
                          )}
                        </div>
                        <div className="text-[14px] font-medium">
                          {item.title}
                        </div>
                        <div className="mt-1 text-[12.5px] leading-relaxed text-muted">
                          {item.detail}
                        </div>
                      </div>
                      <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-muted" />
                    </div>
                  );
                  return item.task ? (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setOpenTask(item.id)}
                      className="block w-full text-left hover:bg-soft/50"
                    >
                      {body}
                    </button>
                  ) : (
                    <Link
                      key={item.id}
                      href={item.href ?? paths.alerts(slug)}
                      className="block hover:bg-soft/50"
                    >
                      {body}
                    </Link>
                  );
                })}
              </div>
            ) : (
              <Empty
                framed={false}
                title="Tudo em dia por aqui"
                hint="Nenhum bloqueio, prazo vencido ou alerta aberto neste cliente."
                icon={<CheckCircle2 className="h-5 w-5 text-ok" />}
              />
            )}
          </ListPanel>

          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[15px] font-medium">Tarefas abertas</h2>
              <Link
                href={paths.clientDeliveries(slug)}
                className="text-[13px] text-muted hover:text-ink"
              >
                Ver todas
              </Link>
            </div>
            {dels.length ? (
              <CardStack>
                {dels.slice(0, 5).map((d) => (
                  <Card key={d.id} onClick={() => setOpenTask(d.id)}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[14px] font-medium">{d.title}</div>
                        <div className="mt-0.5 text-[12.5px] text-muted">
                          {resolve(d.ownerId).name} ·{" "}
                          {d.productId
                            ? products.find((p) => p.id === d.productId)?.name
                            : `Marco ${padMilestone(d.milestone)}`}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={d.status} />
                        <ArrowUpRight
                          className="h-3.5 w-3.5 text-muted"
                          aria-hidden
                        />
                      </div>
                    </div>
                  </Card>
                ))}
              </CardStack>
            ) : (
              <Empty
                title="Nenhuma tarefa aberta"
                hint="Abra um ciclo no plano para gerar as próximas tarefas."
              />
            )}
          </div>
          {reqs.length > 0 && (
            <div>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-[15px] font-medium">Solicitações</h2>
                <Link
                  href={paths.clientDeliveries(slug, "solicitacoes")}
                  className="text-[13px] text-muted hover:text-ink"
                >
                  Ver todas
                </Link>
              </div>
              <CardStack>
                {reqs.slice(0, 3).map((d) => (
                  <Card
                    key={d.id}
                    href={paths.clientDeliveries(slug, "solicitacoes")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[14px] font-medium">{d.title}</div>
                        <div className="mt-0.5 text-[12.5px] text-muted">
                          {d.requestedBy ?? resolve(d.ownerId).name}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={d.status} />
                        <ArrowUpRight
                          className="h-3.5 w-3.5 text-muted"
                          aria-hidden
                        />
                      </div>
                    </div>
                  </Card>
                ))}
              </CardStack>
            </div>
          )}
        </section>
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[15px] font-medium">Última reunião</h2>
            <Link
              href={paths.clientAgenda(slug)}
              className="text-[13px] text-muted hover:text-ink"
            >
              Ver agenda
            </Link>
          </div>
          {last ? (
            <Card href={paths.meeting(last.id)} className="mt-3">
              <div className="text-[14px] font-medium">{last.title}</div>
              <p className="mt-1 line-clamp-2 text-[13.5px] text-ink-soft">
                {last.summary}
              </p>
              <div className="mt-1 text-[12.5px] text-muted">
                {formatDateTime(last.startsAt)}
              </div>
              <CardAction>Abrir reunião</CardAction>
            </Card>
          ) : (
            <p className="mt-3 text-[13.5px] text-muted">Nenhuma reunião.</p>
          )}
          {lastDebrief?.debrief && (
            <Link
              href={paths.clientCycle(slug, lastDebrief.id)}
              className="mt-3 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted hover:text-ink"
            >
              <span>Último debrief · nota {lastDebrief.debrief.score}/5</span>
              <span>·</span>
              <span>
                Chamaria de novo:{" "}
                <span className={lastDebrief.debrief.wouldRehire ? "text-ok" : "text-rose"}>
                  {lastDebrief.debrief.wouldRehire ? "Sim" : "Não"}
                </span>
              </span>
              <span>· {lastDebrief.name}</span>
            </Link>
          )}
          {acceptance && (
            <section className="mt-6 rounded-xl border border-amber/30 bg-amber-soft/30 p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[13px] font-semibold text-amber">
                  Aceite pendente
                </h2>
                <Link
                  href={paths.clientPlan(slug, "ciclos")}
                  className="text-[12px] text-muted hover:text-ink"
                >
                  Ver ciclo
                </Link>
              </div>
              <p className="mt-2 text-[14px] font-medium">{acceptance.name}</p>
              <p className="mt-1 text-[12.5px] text-muted">
                {cycleStatusLabel[acceptance.status]} ·{" "}
                {acceptance.acceptance.filter((a) => a.done).length}/
                {acceptance.acceptance.length} critérios aceitos · término{" "}
                {formatDate(acceptance.endsAt)}
              </p>
              <p
                className={
                  waitingDays > 5
                    ? "mt-2 text-[12.5px] font-medium text-amber"
                    : "mt-2 text-[12.5px] text-muted"
                }
              >
                {waitingDays === 0
                  ? "Enviado para aceite hoje."
                  : `Aguardando o cliente há ${waitingDays} ${waitingDays === 1 ? "dia" : "dias"}.`}
              </p>
            </section>
          )}
          <section className="mt-6 border-t border-line pt-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-medium">
                Equipe alocada{" "}
                <span className="text-[12px] text-muted">{team.length}</span>
              </h2>
              {can("alocacao.editar") ? <button type="button" onClick={() => setTeamOpen(true)} className="text-[12px] text-muted hover:text-ink">Gerenciar →</button> : null}
            </div>
            <div className="mt-3 divide-y divide-line">
              {team.map((a) => {
                const person = resolve(a.memberId);
                return (
                  <Link
                    key={a.id}
                    href={paths.teamMember(a.memberId)}
                    className="flex items-center gap-3 py-3 hover:bg-soft/40"
                  >
                    <span
                      className="inline-grid h-7 w-7 place-items-center rounded-full bg-ink text-[11px] font-medium text-on-ink"
                      aria-hidden
                    >
                      {person.initials}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium">{person.name}</p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {allocationRoleName(a.role, allocationRoles)} · {scopeName(a.enrollmentId)} · {a.percent}% da semana
                      </p>
                    </div>
                  </Link>
                );
              })}
              {!team.length && (
                <p className="py-3 text-[13px] text-muted">
                  Ninguém alocado. Defina o responsável e a equipe deste cliente.
                </p>
              )}
            </div>
          </section>
          <StakeholderSummary company={slug} />
        </section>
      </div>

      <TaskDrawer
        task={currentTask}
        onClose={() => setOpenTask(null)}
        onChange={(id, patch) => patchTask(id, patch)}
      />
      {charterOpen && (
        <ServiceSettings
          company={slug}
          initialSection="contrato"
          onClose={() => setCharterOpen(false)}
        />
      )}
      {teamOpen ? <AllocationManager client={c} onClose={() => setTeamOpen(false)} /> : null}
    </div>
  );
}
