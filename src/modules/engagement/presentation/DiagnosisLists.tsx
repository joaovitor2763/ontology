"use client";
import { useDiagnosisOperation, DiagnosisOperationFeedback } from "./useDiagnosisOperation";
import { OperationButton } from "@/shared/ui/OperationFeedback";
import {
  effortLabel,
  painSeverityLabel,
  painStatusLabel,
  solutionStatusLabel,
} from "@/modules/engagement/domain/diagnosis";
import {
  evidenceKindLabel,
  evidenceSentence,
  evidenceSourceLabel,
  evidenceSummary,
  hypothesisStatusLabel,
  openHypothesisStatuses,
  optionsForPain,
  refineHypothesis,
  tradeoffAxisLabel,
  tradeoffLevelLabel,
} from "@/modules/engagement/domain/hypotheses";
import type {
  Hypothesis,
  HypothesisStatus,
  OptionTradeoffs,
  Pain,
  PainStatus,
  Solution,
  SolutionStatus,
} from "@/modules/engagement/domain/models";
import { useEngagementState } from "@/modules/engagement/infrastructure/state";
import { useTeam } from "@/modules/workspace/presentation/useTeam";
import { formatDate } from "@/shared/lib/format";
import { paths } from "@/shared/lib/routes";
import { Modal } from "@/shared/ui/Dialog";
import { ActionMenu } from "@/shared/ui/Menu";
import { Select } from "@/shared/ui/Select";
import { Badge, Button } from "@/shared/ui/primitives";
import {
  CheckCircle2,
  FlaskConical,
  GitBranch,
  Pencil,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { uid } from "./diagnosis/shared";
import {
  EvidenceModal,
  HypothesisForm,
  RefineModal,
} from "./diagnosis/HypothesisForms";

const severityTone: Record<Pain["severity"], "neutral" | "warn" | "bad"> = {
  baixa: "neutral",
  media: "neutral",
  alta: "warn",
  critica: "bad",
};

const PAIN_STATUS: PainStatus[] = [
  "aberta",
  "validada",
  "em-tratamento",
  "resolvida",
];
const SOLUTION_STATUS: SolutionStatus[] = [
  "proposta",
  "aprovada",
  "em-execucao",
  "concluida",
  "descartada",
];

/** Pains of a client or meeting, with the status editable in place. */
export function PainList({
  pains,
  solutions,
  emptyHint = "Nenhuma dor registrada. Registre uma reunião realizada para capturar dores.",
  showMeeting,
}: {
  pains: Pain[];
  solutions: Solution[];
  emptyHint?: string;
  showMeeting?: boolean;
}) {
  const { savePain, allMeetings } = useEngagementState();
  const operation=useDiagnosisOperation();
  if (pains.length === 0) {
    return <p className="p-5 text-[13px] text-muted">{emptyHint}</p>;
  }
  return (
    <><DiagnosisOperationFeedback operation={operation}/><fieldset disabled={operation.busy||operation.pending} className="min-w-0"><ul className="divide-y divide-line">
      {pains.map((p) => {
        const linked = solutions.filter((s) => s.painIds.includes(p.id));
        const meeting =
          showMeeting && p.meetingId
            ? allMeetings.find((m) => m.id === p.meetingId)
            : undefined;
        return (
          <li
            key={p.id}
            className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium leading-snug">
                  {p.title}
                </span>
                <Badge tone={severityTone[p.severity]}>
                  {painSeverityLabel[p.severity]}
                </Badge>
                {p.area && (
                  <span className="text-[12px] text-muted">{p.area}</span>
                )}
              </div>
              {p.description && (
                <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                  {p.description}
                </p>
              )}
              <p className="mt-1 text-[12px] text-muted">
                {linked.length === 0
                  ? "Sem solução vinculada"
                  : `${linked.length} solução${linked.length === 1 ? "" : "ões"}: ${linked.map((s) => s.title).join(", ")}`}
                {optionsForPain(solutions, p.id).length === 1 && (
                  <span className="text-amber">
                    {" · "}1 opção proposta · advisors apresentam alternativas
                  </span>
                )}
                {p.status !== "resolvida" &&
                  linked.length > 0 &&
                  optionsForPain(solutions, p.id).length === 0 && (
                    <span className="text-amber">{" · "}Sem opção ativa</span>
                  )}
                {meeting && (
                  <>
                    {" · "}
                    <Link
                      href={paths.meeting(meeting.id)}
                      className="hover:text-blue"
                    >
                      {meeting.title} · {formatDate(meeting.startsAt)}
                    </Link>
                  </>
                )}
              </p>
            </div>
            <Select
              label={`Status da dor ${p.title}`}
              size="compact"
              value={p.status}
              onValueChange={(v) =>
                operation.run("pains.update",{company:p.company,painId:p.id,patch:{status:v}},()=>savePain({...p,status:v as PainStatus},"Status da dor atualizado"))
              }
              options={PAIN_STATUS.map((s) => ({
                value: s,
                label: painStatusLabel[s],
              }))}
            />
          </li>
        );
      })}
    </ul></fieldset></>
  );
}

/** Solutions with the pains they answer and the hypothesis behind them. */
export function SolutionList({
  solutions,
  pains,
  emptyHint = "Nenhuma solução proposta ainda.",
}: {
  solutions: Solution[];
  pains: Pain[];
  emptyHint?: string;
}) {
  const { saveSolution } = useEngagementState();
  const operation=useDiagnosisOperation();
  const { resolve } = useTeam();
  if (solutions.length === 0) {
    return <p className="p-5 text-[13px] text-muted">{emptyHint}</p>;
  }
  return (
    <><DiagnosisOperationFeedback operation={operation}/><fieldset disabled={operation.busy||operation.pending} className="min-w-0"><ul className="divide-y divide-line">
      {solutions.map((s) => {
        const answers = s.painIds
          .map((id) => pains.find((p) => p.id === id)?.title)
          .filter(Boolean);
        const owner = s.ownerId ? resolve(s.ownerId) : undefined;
        return (
          <li
            key={s.id}
            className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium leading-snug">
                  {s.title}
                </span>
                {s.effort && (
                  <Badge tone="neutral">esforço {effortLabel[s.effort]}</Badge>
                )}
                {s.chosen && <Badge tone="ok">Escolhida</Badge>}
              </div>
              <TradeoffChips tradeoffs={s.tradeoffs} />
              {s.description && (
                <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                  {s.description}
                </p>
              )}
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">
                <span className="text-muted">Hipótese: </span>
                {s.hypothesis}
              </p>
              <p className="mt-1 text-[12px] text-muted">
                {answers.length > 0
                  ? `Responde a: ${answers.join(", ")}`
                  : "Sem dor vinculada"}
                {s.successMetric ? ` · Métrica: ${s.successMetric}` : ""}
                {owner ? ` · ${owner.name.split(" ")[0]}` : ""}
              </p>
              {s.chosen && s.chosenReason && (
                <p className="mt-1 text-[12px] text-ink-soft">
                  <span className="text-muted">Por que foi escolhida: </span>
                  {s.chosenReason}
                </p>
              )}
            </div>
            <Select
              label={`Status da solução ${s.title}`}
              size="compact"
              value={s.status}
              onValueChange={(v) =>
                operation.run("solutions.update",{company:s.company,solutionId:s.id,patch:{status:v}},()=>saveSolution({...s,status:v as SolutionStatus},"Status da solução atualizado"))
              }
              options={SOLUTION_STATUS.map((st) => ({
                value: st,
                label: solutionStatusLabel[st],
              }))}
            />
          </li>
        );
      })}
    </ul></fieldset></>
  );
}

/** Small chips with the cost of an option on the three tradeoff variables. */
export function TradeoffChips({ tradeoffs }: { tradeoffs?: OptionTradeoffs }) {
  const axes = (Object.keys(tradeoffAxisLabel) as (keyof OptionTradeoffs)[]).filter(
    (axis) => tradeoffs?.[axis],
  );
  if (!axes.length) return null;
  return (
    <p className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
      {axes.map((axis) => (
        <span
          key={axis}
          className="inline-flex items-center gap-1 rounded-md bg-soft px-1.5 py-0.5 text-ink-soft"
        >
          <span className="text-muted">{tradeoffAxisLabel[axis]}</span>
          {tradeoffLevelLabel[tradeoffs![axis]!]}
        </span>
      ))}
    </p>
  );
}

const hypothesisTone: Record<HypothesisStatus, "neutral" | "ok" | "warn" | "bad"> = {
  aberta: "neutral",
  "em-teste": "warn",
  confirmada: "ok",
  refutada: "bad",
  refinada: "neutral",
};


/**
 * Hypotheses of the diagnosis: what the team presumes as root cause and the
 * evidence for and against it. Being refuted is progress; refining keeps the parent.
 */
export function HypothesisList({
  hypotheses,
  pains,
  company,
  editing,
  onEditingChange,
  emptyHint = "Nenhuma hipótese registrada. Escreva o que você presume como causa raiz e teste nas próximas conversas.",
}: {
  hypotheses: Hypothesis[];
  pains: Pain[];
  company: string;
  /** Controlled editor: `"new"` opens an empty form; a hypothesis opens it filled. */
  editing?: Hypothesis | "new" | null;
  onEditingChange?: (next: Hypothesis | "new" | null) => void;
  emptyHint?: string;
}) {
  const { saveHypothesis, removeHypothesis, restoreHypothesis, addHypothesisEvidence, allMeetings } =
    useEngagementState();
  const { resolve, me } = useTeam();
  const operation=useDiagnosisOperation();
  const [removed,setRemoved]=useState<Hypothesis|null>(null);
  const [localEditing, setLocalEditing] = useState<Hypothesis | "new" | null>(null);
  const editingValue = editing === undefined ? localEditing : editing;
  const setEditing = (next:Hypothesis|"new"|null)=>{if(operation.busy)return;if(next)operation.begin();else operation.reset();(onEditingChange??setLocalEditing)(next);};
  const [evidenceFor, setEvidenceFor] = useState<Hypothesis | null>(null);
  const [refining, setRefining] = useState<Hypothesis | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Hypothesis | null>(null);
  const byId = new Map(hypotheses.map((h) => [h.id, h]));
  const ordered = [...hypotheses].sort(
    (a, b) =>
      Number(openHypothesisStatuses.includes(b.status)) -
        Number(openHypothesisStatuses.includes(a.status)) ||
      (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
  );

  function setStatus(h: Hypothesis, status: HypothesisStatus) {
    void operation.run("hypotheses.update",{company,hypothesisId:h.id,patch:{status}},()=>saveHypothesis({...h,status}));
  }

  return (
    <>
      <DiagnosisOperationFeedback operation={operation}/>
      {removed&&<div className="flex flex-wrap items-center gap-3 border-b border-line p-3 text-sm"><span>Hipótese removida: {removed.statement}</span><OperationButton operation={operation} busyLabel="Restaurando…" variant="ghost" size="sm" onClick={()=>void operation.run("hypotheses.restore",{company,hypothesisId:removed.id},()=>restoreHypothesis(removed.id),()=>setRemoved(null))}>Restaurar hipótese</OperationButton></div>}
      <fieldset disabled={operation.busy||operation.pending} className="min-w-0">
      {ordered.length === 0 ? (
        <p className="p-5 text-[13px] text-muted">{emptyHint}</p>
      ) : (
        <ul className="divide-y divide-line">
          {ordered.map((h) => {
            const summary = evidenceSummary(h);
            const linked = h.painIds
              .map((id) => pains.find((p) => p.id === id)?.title)
              .filter(Boolean);
            const parent = h.parentId ? byId.get(h.parentId) : undefined;
            const owner = h.ownerId ? resolve(h.ownerId) : undefined;
            const open = openHypothesisStatuses.includes(h.status);
            return (
              <li
                key={h.id}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={hypothesisTone[h.status]}>
                      {hypothesisStatusLabel[h.status]}
                    </Badge>
                    <span className="text-[14px] font-medium leading-snug">
                      {h.statement}
                    </span>
                  </div>
                  {h.rootCause && (
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                      <span className="text-muted">Causa raiz presumida: </span>
                      {h.rootCause}
                    </p>
                  )}
                  <p className="mt-1 text-[12px] text-muted">
                    <span
                      className={
                        summary.total
                          ? summary.contradiz > summary.confirma
                            ? "text-rose"
                            : summary.confirma
                              ? "text-ok"
                              : ""
                          : open
                            ? "text-amber"
                            : ""
                      }
                    >
                      {evidenceSentence(h)}
                    </span>
                    {summary.lastAt ? ` · última em ${formatDate(summary.lastAt)}` : ""}
                    {linked.length ? ` · Dores: ${linked.join(", ")}` : " · Sem dor vinculada"}
                    {owner ? ` · ${owner.name.split(" ")[0]}` : ""}
                    {parent && (
                      <>
                        {" · refinada de "}
                        <span className="text-ink-soft">“{parent.statement}”</span>
                      </>
                    )}
                  </p>
                  {h.evidence.length > 0 && (
                    <ul className="mt-2 space-y-1 border-l border-line pl-3 text-[12px]">
                      {[...h.evidence]
                        .sort((a, b) => b.at.localeCompare(a.at))
                        .slice(0, 3)
                        .map((e) => {
                          const meeting = e.meetingId
                            ? allMeetings.find((m) => m.id === e.meetingId)
                            : undefined;
                          return (
                            <li key={e.id} className="text-ink-soft">
                              <span
                                className={
                                  e.kind === "confirma"
                                    ? "text-ok"
                                    : e.kind === "contradiz"
                                      ? "text-rose"
                                      : "text-ink"
                                }
                              >
                                {evidenceKindLabel[e.kind]}
                              </span>
                              {" · "}
                              {e.note}
                              <span className="text-muted">
                                {" · "}
                                {e.source ? `${evidenceSourceLabel[e.source]} · ` : ""}
                                {formatDate(e.at)}
                                {meeting && (
                                  <>
                                    {" · "}
                                    <Link href={paths.meeting(meeting.id)} className="hover:text-blue">
                                      {meeting.title}
                                    </Link>
                                  </>
                                )}
                              </span>
                            </li>
                          );
                        })}
                      {h.evidence.length > 3 && (
                        <li className="text-muted">
                          e mais {h.evidence.length - 3} evidência
                          {h.evidence.length - 3 === 1 ? "" : "s"}
                        </li>
                      )}
                    </ul>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {open && (
                    <Button variant="ghost" size="sm" onClick={() => (operation.begin(),setEvidenceFor(h))}>
                      <FlaskConical className="h-3.5 w-3.5" />
                      Registrar evidência
                    </Button>
                  )}
                  <ActionMenu
                    label={`Ações da hipótese ${h.statement}`}
                    actions={[
                      { label: "Editar", icon: <Pencil />, onSelect: () => setEditing(h) },
                      ...(!open
                        ? [
                            {
                              label: "Registrar evidência",
                              icon: <FlaskConical />,
                              onSelect: () => (operation.begin(),setEvidenceFor(h)),
                            },
                          ]
                        : []),
                      {
                        label: "Marcar como confirmada",
                        icon: <CheckCircle2 />,
                        disabled: h.status === "confirmada",
                        onSelect: () => setStatus(h, "confirmada"),
                      },
                      {
                        label: "Marcar como refutada",
                        icon: <XCircle />,
                        disabled: h.status === "refutada",
                        onSelect: () => setStatus(h, "refutada"),
                      },
                      {
                        label: "Refinar em nova hipótese",
                        icon: <GitBranch />,
                        onSelect: () => (operation.begin(),setRefining(h)),
                      },
                      {
                        label: "Remover",
                        icon: <Trash2 />,
                        tone: "danger",
                        separator: true,
                        onSelect: () => (operation.begin(),setConfirmRemove(h)),
                      },
                    ]}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      </fieldset>
      {editingValue && (
        <HypothesisForm
          operation={operation}
          hypothesis={
            editingValue === "new"
              ? {
                  id: uid("hyp"),
                  company,
                  statement: "",
                  rootCause: "",
                  status: "aberta",
                  painIds: [],
                  ownerId: me.id,
                  evidence: [],
                  createdAt: new Date().toISOString(),
                }
              : editingValue
          }
          isNew={editingValue === "new"}
          pains={pains}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            const patch={statement:next.statement,rootCause:next.rootCause??"",status:next.status,painIds:next.painIds,ownerId:next.ownerId??""};
            void operation.run(editingValue==="new"?"hypotheses.create":"hypotheses.update",editingValue==="new"?{company,hypothesis:patch}:{company,hypothesisId:next.id,patch},()=>saveHypothesis(next),()=>(onEditingChange??setLocalEditing)(null));
          }}
        />
      )}

      <EvidenceModal key={evidenceFor?.id??"closed-evidence"}
        operation={operation}
        hypothesis={evidenceFor}
        onClose={() => {if(!operation.busy){operation.reset();setEvidenceFor(null);}}}
        onSave={(evidence) => {
          if (!evidenceFor) return;
          void operation.run("hypotheses.evidence.add",{company,hypothesisId:evidenceFor.id,kind:evidence.kind,source:evidence.source,note:evidence.note},()=>addHypothesisEvidence(evidenceFor.id,{...evidence,by:me.id}),()=>setEvidenceFor(null));
        }}
      />

      <RefineModal key={refining?.id??"closed-refine"}
        operation={operation}
        hypothesis={refining}
        onClose={() => {if(!operation.busy){operation.reset();setRefining(null);}}}
        onSave={(statement) => {
          if (!refining) return;
          const now = new Date().toISOString();
          const child = refineHypothesis(refining, statement, uid("hyp"), now);
          void operation.run("hypotheses.refine",{company,hypothesisId:refining.id,statement},()=>{saveHypothesis({...refining,status:"refinada"},null);saveHypothesis(child,"Hipótese refinada em uma nova");},()=>setRefining(null));
        }}
      />

      <Modal open={!!confirmRemove} onClose={()=>{if(!operation.busy){operation.reset();setConfirmRemove(null);}}} title="Remover esta hipótese?" description="As evidências são preservadas. Você pode restaurar após a confirmação." footer={<OperationButton operation={operation} busyLabel="Removendo…" onClick={()=>{if(confirmRemove)void operation.run("hypotheses.remove",{company,hypothesisId:confirmRemove.id},()=>removeHypothesis(confirmRemove.id),()=>{setRemoved(confirmRemove);setConfirmRemove(null);});}}>Remover</OperationButton>}><DiagnosisOperationFeedback operation={operation}/></Modal>

    </>
  );
}
