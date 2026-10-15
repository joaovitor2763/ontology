"use client";
import { useState, useRef } from "react";
import { useClientsState } from "../../clients/infrastructure/state";
import { clientOperationBaseline, executeClientOperation, operationAttempt, usesRemoteOperations, type OperationAttempt } from "@/shared/infrastructure/operations";
import type { Company } from "../../clients/domain/models";
import type { JourneyTemplate } from "../../catalog/domain/models";
import type { Delivery } from "../domain/models";
import type { ServiceCycle } from "../domain/services";
import {
  planReferenceForDelivery,
  validDate,
  type DateChange,
} from "../application/plan-execution";
import { useDeliveryState } from "../infrastructure/state";
import { useScopedClientExecution } from "../infrastructure/ClientExecutionProvider";
import { executeScopedClientCommand, ScopedCommandError } from "../infrastructure/client-operations";
import { isUncertainFailure } from "@/shared/infrastructure/operation-error";
import { usePermissions } from "../../workspace/presentation/usePermissions";
import { selectPlanScheduleExecution, suggestPlanSchedule } from "../application/plan-schedule";
import { Combobox } from "@/shared/ui/Combobox";
import { Drawer } from "@/shared/ui/Drawer";
import { DatePicker } from "@/shared/ui/DatePicker";
import { Button } from "@/shared/ui/primitives";
import { workspaceDate } from "@/shared/lib/format";

export function PlanScheduleEditor({
  company,
  plan,
  tasks,
  enrollmentId,
}: {
  company: Company;
  plan: JourneyTemplate;
  tasks: Delivery[];
  enrollmentId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [activationError, setActivationError] = useState("");
  const [activating,setActivating]=useState(false);
  const [activationUncertain,setActivationUncertain]=useState(false);
  const activationLock=useRef(false);
  const activationPending=useRef<null|(()=>Promise<void>)>(null);
  const { cycles, initializePlan, savePlanDates, companyJourney } = useDeliveryState();
  const { can } = usePermissions();
  const { enrollments } = useClientsState();
  const [chosenEnrollmentId, setChosenEnrollmentId] = useState("");
  const matchingEnrollments = enrollments.filter(e => e.company === company.slug && e.planId === plan.id);
  const assignedPlanId = companyJourney[company.slug] ?? company.journeyId;
  const clientExecution = { cycles: cycles.filter(c => c.company === company.slug), tasks };
  const legacy = selectPlanScheduleExecution(clientExecution, plan.id, assignedPlanId);
  const hasLegacy = legacy.cycles.length > 0 || legacy.tasks.length > 0;
  const needsSelection = enrollmentId === undefined && (matchingEnrollments.length !== 1 || hasLegacy);
  const legacySelected = enrollmentId === null || (chosenEnrollmentId === "__legacy__" && (hasLegacy || !matchingEnrollments.length));
  const enrollment = enrollmentId !== undefined ? matchingEnrollments.find(e => e.id === enrollmentId) : needsSelection ? matchingEnrollments.find(e => e.id === chosenEnrollmentId) : matchingEnrollments[0];
  const ambiguous = needsSelection && !enrollment && !legacySelected;
  const execution = enrollment ? selectPlanScheduleExecution(clientExecution, plan.id, assignedPlanId, enrollment.id) : legacy;
  const selected = ambiguous ? [] : execution.cycles;
  const planTasks = ambiguous ? [] : execution.tasks;
  const ready =
    plan.milestones.every((m) =>
      selected.some((c) => c.templateId === m.cycleTemplateId),
    ) &&
    plan.milestones
      .flatMap((m) => m.tasks ?? [])
      .every((ref) =>
        planTasks.some(
          (t) =>
            (t.productId === plan.productId || t.journeyId === plan.id) &&
            planReferenceForDelivery(plan, t)?.id === ref.id,
        ),
      );
  async function activate() {
    if(activationLock.current) return;
    activationLock.current=true;setActivating(true);setActivationError("");
    try {
      if(!activationPending.current) {
        if(ambiguous) throw new Error("Selecione a contratação ou a execução sem contratação.");
        if(!enrollment&&plan.productId) throw new Error("Este produto precisa de uma contratação identificada. Revise a gestão de contratações nesta página.");
        if(enrollment&&!["ativa","planejada"].includes(enrollment.status)) throw new Error("Prepare somente contratações ativas ou planejadas.");
        const startsAt=enrollment?.startsAt??company.startedAt;
        if(!validDate(startsAt??"")||(enrollment&&(!enrollment.startsAt||enrollment.productVersion===undefined))) throw new Error("Revise a data e a versão da contratação antes de preparar o plano.");
        const command=enrollment?"enrollments.provision":"plans.provision";
        const input=enrollment?{company:company.slug,enrollmentId:enrollment.id}:{company:company.slug,planId:plan.id,enrollmentId:null};
        const baseline=clientOperationBaseline();
        if(await usesRemoteOperations()) {
          const attempt=operationAttempt(command,input);
          activationPending.current=async()=>{await executeClientOperation(command,input,attempt,baseline);};
          setActivationUncertain(true);
        } else {
          initializePlan(plan,company,enrollment?{id:enrollment.id,startsAt:startsAt!}:undefined,{preserveSelection:true});return;
        }
      }
      await activationPending.current();activationPending.current=null;setActivationUncertain(false);
    } catch(e) {setActivationError(e instanceof Error?e.message:"Não foi possível confirmar a preparação.");}
    finally {activationLock.current=false;setActivating(false);}
  }
  if (!can("plano.editar", company.slug)) return null;
  return (
    <>
      {needsSelection && <Combobox disabled={activating||activationUncertain} label="Contratação para preparar ou ajustar datas" value={chosenEnrollmentId} onValueChange={value=>{if(!activationLock.current&&!activationPending.current)setChosenEnrollmentId(value);}} options={[
        ...((hasLegacy || !matchingEnrollments.length) ? [{ value: "__legacy__", label: "Execução sem contratação" }] : []),
        ...matchingEnrollments.map(e => ({ value: e.id, label: `Início ${e.startsAt ?? "não informado"} · ${e.id.slice(0,8)}` })),
      ]} />}
      {activationError && (
        <p role="alert" className="text-sm text-rose">
          {activationError}
        </p>
      )}
      {((plan.autoCreateCycles && !ready) || activationUncertain) && (
        <Button size="sm" disabled={activating || (ambiguous&&!activationUncertain)} onClick={activate}>
          {activating?"Preparando…":activationUncertain?"Verificar preparação":"Preparar plano completo"}
        </Button>
      )}
      {activationUncertain&&!activating&&<p className="text-sm text-muted">Gravação sem confirmação. Verifique a mesma tentativa antes de preparar outra execução.</p>}
      {activationUncertain && activationError && !activating && <Button size="sm" variant="ghost" onClick={() => {
        if(activationLock.current) return;
        activationPending.current=null;
        setActivationUncertain(false);
        setActivationError("");
      }}>Revisar seleção</Button>}
      {selected.some(c=>c.status!=="concluido") && <Button
        size="sm"
        variant="ghost"
        disabled={activating||activationUncertain}
        onClick={() => setOpen(true)}
      >
        Ajustar datas
      </Button>}
      {open && (
        <DatesForm
          company={enrollment?.startsAt ? {...company,startedAt:enrollment.startsAt} : company}
          plan={plan}
          enrollmentId={enrollment?.id ?? null}
          cycles={selected}
          tasks={planTasks}
          onClose={() => setOpen(false)}
          onSave={(c, t) => {
            savePlanDates(company.slug, c, t);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
function DatesForm({
  company,
  plan,
  enrollmentId,
  cycles: incomingCycles,
  tasks: incomingTasks,
  onClose,
  onSave,
}: {
  company: Company;
  plan: JourneyTemplate;
  enrollmentId?: string | null;
  cycles: ServiceCycle[];
  tasks: Delivery[];
  onClose: () => void;
  onSave: (cycles: DateChange[], tasks: DateChange[]) => void;
}) {
  const scoped = useScopedClientExecution();
  const [openedSnapshot] = useState(scoped?.clientSnapshot);
  // Freeze the comparison baseline: polling after an uncertain commit must not change the retry payload.
  const [{cycles,tasks}] = useState(() => ({cycles:incomingCycles,tasks:incomingTasks}));
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const attempt = useRef<OperationAttempt | null>(null);
  const pendingSave=useRef<null|(()=>Promise<void>)>(null);
  const [uncertain,setUncertain]=useState(false);
  const [baseline] = useState(clientOperationBaseline);
  const [base, setBase] = useState(() => workspaceDate());
  const [error, setError] = useState("");
  const [suggestion] = useState(() => suggestPlanSchedule({cycles,tasks},base));
  const [cycleDates, setCycleDates] = useState<Record<string,DateChange>>(() => Object.fromEntries(suggestion.cycles.map(row=>[row.id,row])));
  const [taskDates, setTaskDates] = useState<Record<string,DateChange>>(() => Object.fromEntries(suggestion.tasks.map(row=>[row.id,row])));
  function recalculate(value:string) {
    setBase(value);
    const next=suggestPlanSchedule({cycles,tasks},value);
    setCycleDates(Object.fromEntries(next.cycles.map(row=>[row.id,row])));
    setTaskDates(Object.fromEntries(next.tasks.map(row=>[row.id,row])));
    setError("");
  }
  async function save() {
    if(locked.current) return;
    locked.current=true; setBusy(true);
    try {
      if(pendingSave.current) {await pendingSave.current();onClose();return;}
      const changedCycles = Object.values(cycleDates).filter((row) => {
        const original = cycles.find((c) => c.id === row.id);
        return (
          original &&
          (original.startsAt !== row.startsAt || original.endsAt !== row.endsAt)
        );
      });
      const changedTasks = Object.values(taskDates).filter((row) => {
        const original = tasks.find((t) => t.id === row.id);
        return (
          original &&
          ((original.startsAt ?? original.dueAt) !== row.startsAt ||
            original.dueAt !== row.endsAt)
        );
      });
      if (
        [...changedCycles, ...changedTasks].some(
          (row) =>
            !validDate(row.startsAt) ||
            !validDate(row.endsAt) ||
            row.startsAt > row.endsAt,
        )
      ) {
        setError(
          "Informe início e fim válidos; o fim não pode ser anterior ao início.",
        );
        return;
      }
      if (await usesRemoteOperations()) {
        const input={company:company.slug,planId:plan.id,enrollmentId,cycles:changedCycles,tasks:changedTasks};
        attempt.current=operationAttempt("plans.schedule",input,attempt.current);
        const capturedAttempt=attempt.current;
        pendingSave.current=async()=>{
          if (scoped) {
            if (!openedSnapshot) throw new Error("A execução ainda não foi carregada. Reabra as datas.");
            await executeScopedClientCommand("plans.schedule",input,capturedAttempt.key,openedSnapshot);
            await scoped.refresh();
          } else await executeClientOperation("plans.schedule",input,capturedAttempt,baseline);
        };
        setUncertain(true);
        await pendingSave.current();
        onClose();
      } else onSave(changedCycles, changedTasks);
    } catch (e) {
      const uncertain=e instanceof ScopedCommandError ? (e.status??500)>=500 : isUncertainFailure(e);
      if(!uncertain){pendingSave.current=null;setUncertain(false);}
      if(scoped&&e instanceof ScopedCommandError&&e.code==='snapshot_changed')
        void scoped.refresh().catch(()=>{ /* keep the current form for review */ });
      setError(e instanceof Error ? e.message : "Revise as datas.");
    } finally { locked.current=false; setBusy(false); }
  }
  function fields(
    row: DateChange,
    title: string,
    change: (next: DateChange) => void,
    disabled = false,
  ) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <label className="min-w-0 text-xs text-muted">
          Início
          <DatePicker label={`Início · ${title}`} disabled={disabled} className="mt-1" value={row.startsAt} onValueChange={value => change({...row,startsAt:value})} />
        </label>
        <label className="min-w-0 text-xs text-muted">
          Fim
          <DatePicker label={`Fim · ${title}`} disabled={disabled} className="mt-1" value={row.endsAt} onValueChange={value => change({...row,endsAt:value})} />
        </label>
      </div>
    );
  }
  return (
    <Drawer
      open
      onClose={() => { if(!locked.current) onClose(); }}
      title="Datas do plano"
      kicker={company.name}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy} onClick={save}>{busy ? "Salvando…" : uncertain ? "Verificar gravação" : "Salvar datas"}</Button>
        </div>
      }
    >
      {uncertain&&!busy&&<p className="mb-4 text-sm text-muted">Gravação sem confirmação. Verifique a mesma tentativa antes de alterar as datas.</p>}
      <fieldset disabled={busy||uncertain}>
      <p className="mb-4 text-sm text-muted">
        Sugerimos novas datas para as pendências. Revise a prévia abaixo; nada muda até salvar.
      </p>
      <div className="mb-5 space-y-3 rounded-xl border border-line bg-soft/30 p-3">
        <label className="block text-sm">
          Reprogramar pendências a partir de
          <DatePicker label="Reprogramar pendências a partir de" className="mt-1" value={base} onValueChange={recalculate} />
        </label>
        <p className="text-xs text-muted">
          Mantém as durações e os intervalos entre as pendências. Trabalho concluído mantém suas datas.
        </p>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-rose">
          {error}
        </p>
      )}
      <div className="space-y-4">
        {[...cycles]
          .sort((a, b) => (a.milestone ?? 0) - (b.milestone ?? 0))
          .map((cycle, index) => (
            <details
              key={cycle.id}
              open={index === 0}
              className="rounded-xl border border-line p-4"
            >
              <summary className="cursor-pointer text-sm font-semibold">
                {cycle.name} · {cycle.taskIds.length} tarefas
              </summary>
              <div className="mt-4 space-y-4">
                {fields(cycleDates[cycle.id], cycle.name, (next) =>
                  setCycleDates((rows) => ({ ...rows, [next.id]: next })), cycle.status === "concluido",
                )}
                {cycle.taskIds
                  .map((id) => tasks.find((t) => t.id === id))
                  .filter((t): t is Delivery => !!t)
                  .map((task) => (
                    <div
                      key={task.id}
                      className="space-y-2 border-t border-line pt-3"
                    >
                      <p className="text-sm">
                        {task.title}
                        {task.status === "entregue" && (
                          <span className="ml-2 text-xs text-muted">
                            Concluída
                          </span>
                        )}
                      </p>
                      {fields(taskDates[task.id], task.title, (next) =>
                        setTaskDates((rows) => ({ ...rows, [next.id]: next })), task.status === "entregue" || cycle.status === "concluido",
                      )}
                    </div>
                  ))}
              </div>
            </details>
          ))}
      </div>
      </fieldset>
    </Drawer>
  );
}
