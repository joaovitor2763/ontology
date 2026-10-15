"use client";
import { DatePicker } from "@/shared/ui/DatePicker";
import { EnrollmentDetailsForm } from "@/modules/clients/presentation/EnrollmentDetailsForm";
import { paths } from "@/shared/lib/routes";
import { useRef, useState } from "react";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { mergeJourneys } from "@/modules/catalog/infrastructure/journey";
import { useCatalogState } from "@/modules/catalog/infrastructure/state";
import { enrollmentCanReceiveWork, type ProductEnrollment } from "@/modules/clients/domain/product-enrollments";
import { Combobox } from "@/shared/ui/Combobox";
import { clientOperationBaseline, executeOperation, operationAttempt, usesRemoteOperations } from "@/shared/infrastructure/operations";
import type { Company } from "../../clients/domain/models";
import type { Product } from "../../catalog/domain/products";
import { useDeliveryState } from "../infrastructure/state";
import {
  prepareProduct,
  executionError,
  type ProductExecution,
} from "../application/product-execution";
import { addDays } from "../application/plan-execution";
import { Drawer, fieldClass } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";

export function useProductPreparation() {
  const { initializeProduct } = useDeliveryState();
  return (draft: ProductExecution) => {
    const error = executionError(draft);
    if (error) throw new Error(error);
    initializeProduct(draft);
  };
}
export function ProductPreparation({company,product,onClose,enrollmentId}: {company:Company;product:Product;onClose:()=>void;enrollmentId?:string}) {
  const {enrollments}=useClientsState();
  const {productVersions,extraJourneys,journeyEdits,removedJourneys}=useCatalogState();
  const automatic=mergeJourneys(extraJourneys,journeyEdits,removedJourneys).some(p=>p.productId===product.id&&p.autoCreateCycles);
  const options=enrollments.filter(e=>e.company===company.slug&&e.productId===product.id&&enrollmentCanReceiveWork(e));
  const [selected,setSelected]=useState(enrollmentId??(options.length===1?options[0].id:""));
  const enrollment=options.find(e=>e.id===selected);
  const snapshot=enrollment?.productVersion===undefined?undefined:
    productVersions[product.id]?.find(v=>v.version===enrollment.productVersion)?.snapshot;
  // The current catalog is only a baseline when it is exactly the purchased version.
  const purchasedProduct=snapshot??(enrollment?.productVersion===(product.version??1)?product:undefined);
  if(enrollment&&(!enrollment.startsAt||enrollment.productVersion===undefined)) return <Drawer open onClose={onClose} title="Completar dados da contratação" kicker={`${company.name} · ${product.name}`}><EnrollmentDetailsForm enrollment={enrollment}/></Drawer>;
  if(enrollment) return <PreparationForm key={enrollment.id} company={company} product={purchasedProduct} automatic={automatic} enrollment={enrollment} onClose={onClose}/>;
  return <Drawer open onClose={onClose} title="Preparar produto" kicker={`${company.name} · ${product.name}`}>
    {options.length ? <Combobox label="Contratação para preparar" value={selected} onValueChange={setSelected} options={options.map(e=>({value:e.id,label:`Início ${e.startsAt??"não informado"} · v${e.productVersion??"não informada"} · ${e.id.slice(0,8)}`}))}/> :
      <p className="text-sm text-muted">Este produto ainda não tem uma contratação identificada. Abra a gestão de contratações nesta página para registrar a compra ou revisar a execução legada.</p>}
    <a className="mt-4 inline-block text-sm underline" href={paths.clientPlan(company.slug)+"?gerenciarContratacoes=1"} onClick={onClose}>Ir para contratações</a>
  </Drawer>;
}
function PreparationForm({company,product,automatic,enrollment,onClose}:{company:Company;product?:Product;automatic:boolean;enrollment:ProductEnrollment;onClose:()=>void}) {
  const {initializeProduct,initializePlan,productPlans}=useDeliveryState();
  const {provisionEnrollmentPlan}=useClientsState();
  const [initial]=useState(()=>{
    try {
      if(!enrollment.startsAt||enrollment.productVersion===undefined) throw new Error("Esta contratação legada precisa de revisão de data e versão antes de preparar a execução.");
      if(!enrollmentCanReceiveWork(enrollment)) throw new Error("Prepare somente contratações ativas ou planejadas e não arquivadas.");
      const plan=enrollment.planId?productPlans[enrollment.planId]:undefined;
      if(plan&&plan.productId!==enrollment.productId) throw new Error("O plano não corresponde ao produto contratado. Revise a contratação.");
      if(plan?.autoCreateCycles) return {draft:null,plan,error:""};
      if(enrollment.legacy||(!plan&&automatic)) throw new Error("O modelo histórico desta contratação precisa de revisão antes de preparar a execução.");
      if(!product||product.id!==enrollment.productId) throw new Error("A versão contratada não tem um modelo disponível. Revise o histórico do produto antes de preparar a execução.");
      const draft=prepareProduct(product,company,new Date().toISOString(),{id:enrollment.id,startsAt:enrollment.startsAt});
      if(enrollment.planId&&draft.plan.id!==enrollment.planId) throw new Error("Esta contratação segue um plano próprio. Use Preparar plano completo no plano contratado.");
      return {draft,error:""};
    } catch(e) { return {draft:null,error:e instanceof Error?e.message:"Não foi possível preparar a contratação."}; }
  });
  const [draft,setDraft]=useState(initial.draft);
  const [error,setError]=useState(initial.error);
  const [busy,setBusy]=useState(false);
  const [uncertain,setUncertain]=useState(false);
  const locked=useRef(false);
  const [baseline]=useState(clientOperationBaseline);
  const pending=useRef<null|(()=>Promise<void>)>(null);
  async function save() {
    if(locked.current||(!draft&&!initial.plan)) return;
    locked.current=true;setBusy(true);
    try {
      if(!pending.current) {
        const issue=draft?executionError(draft):null;if(issue) throw new Error(issue);
        if(await usesRemoteOperations()) {
          const input={company:company.slug,enrollmentId:enrollment.id,...(draft?{prepared:structuredClone(draft)}:{})};
          const attempt=operationAttempt("enrollments.provision",input);
          pending.current=async()=>{await executeOperation("enrollments.provision",input,attempt,baseline);};
          setUncertain(true);
        } else {
          const planId=draft?.plan.id??initial.plan!.id;
          provisionEnrollmentPlan(enrollment,planId,()=>{
            if(draft) initializeProduct(draft,{preserveSelection:true});
            else if(initial.plan) initializePlan(initial.plan,company,{id:enrollment.id,startsAt:enrollment.startsAt!},{preserveSelection:true});
          });
          onClose();return;
        }
      }
      await pending.current();onClose();
    } catch(e) {setError(e instanceof Error?e.message:"Não foi possível confirmar a preparação.");}
    finally {locked.current=false;setBusy(false);}
  }
  return <Drawer open onClose={()=>{if(!locked.current) onClose();}} title="Preparar contratação" kicker={`${company.name} · ${product?.name??enrollment.productId} · v${enrollment.productVersion??"não informada"} · ${enrollment.startsAt??"sem data"}`} footer={<div className="flex justify-end gap-2">
    <Button variant="ghost" disabled={busy} onClick={onClose}>Cancelar</Button>
    <Button disabled={busy||(!draft&&!initial.plan)} onClick={save}>{busy?"Salvando…":uncertain?"Verificar gravação":"Salvar ciclos e tarefas"}</Button>
  </div>}>
    <p className="mb-5 text-sm text-muted">Somente ciclos ausentes serão preparados. Ciclos existentes, trabalho concluído e remoções anteriores serão preservados.</p>
    {error&&<p role="alert" className="mb-4 text-sm text-rose">{error}</p>}
    {uncertain&&!busy&&<p className="mb-4 text-sm text-muted">Há uma gravação sem confirmação. Verifique a mesma tentativa antes de fazer novas alterações.</p>}
    {initial.plan&&<p className="mb-4 text-sm">Plano contratado: {initial.plan.name} · {initial.plan.milestones.length} marcos.</p>}
    {draft&&<fieldset disabled={busy||uncertain}><ExecutionFields draft={draft} onChange={setDraft}/></fieldset>}
  </Drawer>;
}
export function ExecutionFields({
  draft,
  onChange,
}: {
  draft: ProductExecution;
  onChange: (next: ProductExecution) => void;
}) {
  return (
    <div className="space-y-4">
      {draft.cycles.map((cycle, i) => (
        <details
          key={cycle.id}
          open={i === 0}
          className="rounded-xl border border-line p-4"
        >
          <summary className="cursor-pointer text-sm font-medium">
            {cycle.name} · {cycle.taskIds.length} tarefas
          </summary>
          <div className="mt-4 space-y-3">
            <label className="block text-xs text-muted">
              Nome do ciclo
              <input
                className={fieldClass}
                value={cycle.name}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    cycles: draft.cycles.map((c) =>
                      c.id === cycle.id ? { ...c, name: e.target.value } : c,
                    ),
                  })
                }
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(["startsAt", "endsAt"] as const).map((key) => (
                <label key={key} className="min-w-0 text-xs text-muted">
                  {key === "startsAt" ? "Início" : "Fim"}
                  <DatePicker
                    label={`${key === "startsAt" ? "Início" : "Fim"} · ${cycle.name}`}
                    className={`${fieldClass} min-w-0`}
                    value={cycle[key]}
                    onValueChange={(next) => {
                      const value = next;
                      const delta =
                        key === "startsAt" && value
                          ? Math.round(
                              (Date.parse(value + "T12:00:00Z") -
                                Date.parse(cycle.startsAt + "T12:00:00Z")) /
                                86400000,
                            )
                          : 0;
                      onChange({
                        ...draft,
                        cycles: draft.cycles.map((c) =>
                          c.id === cycle.id
                            ? {
                                ...c,
                                [key]: value,
                                ...(delta
                                  ? { endsAt: addDays(c.endsAt, delta) }
                                  : {}),
                              }
                            : c,
                        ),
                        tasks: delta
                          ? draft.tasks.map((t) =>
                              cycle.taskIds.includes(t.id)
                                ? {
                                    ...t,
                                    startsAt: addDays(t.startsAt!, delta),
                                    dueAt: addDays(t.dueAt, delta),
                                  }
                                : t,
                            )
                          : draft.tasks,
                      });
                    }}
                  />
                </label>
              ))}
            </div>
            <p className="text-xs text-muted">
              Alterar o início desloca as tarefas deste ciclo.
            </p>
            {draft.plan.milestones
              .filter((m) => m.cycleTemplateId === cycle.templateId)
              .map((m) => (
                <div key={m.n} className="border-t border-line pt-3">
                  <p className="mb-2 text-xs font-semibold">Marco · {m.name}</p>
                  {draft.tasks
                    .filter(
                      (t) =>
                        cycle.taskIds.includes(t.id) && t.milestone === m.n,
                    )
                    .map((t) => (
                      <div key={t.id} className="mb-4 space-y-2">
                        <input
                          aria-label={`Tarefa · ${t.title}`}
                          className={fieldClass}
                          value={t.title}
                          onChange={(e) =>
                            onChange({
                              ...draft,
                              tasks: draft.tasks.map((row) =>
                                row.id === t.id
                                  ? { ...row, title: e.target.value }
                                  : row,
                              ),
                            })
                          }
                        />
                        <label className="block text-xs text-muted">
                          Prazo
                          <DatePicker
                            label="Prazo"
                            className={fieldClass}
                            value={t.dueAt}
                            onValueChange={(next) =>
                              onChange({
                                ...draft,
                                tasks: draft.tasks.map((row) =>
                                  row.id === t.id
                                    ? { ...row, dueAt: next }
                                    : row,
                                ),
                              })
                            }
                          />
                        </label>
                        <details>
                          <summary className="cursor-pointer text-xs text-muted">
                            Checklist · {t.checklist?.length ?? 0} itens
                          </summary>
                          <textarea
                            aria-label={`Checklist · ${t.title}`}
                            className={`${fieldClass} mt-2`}
                            rows={3}
                            placeholder="Um item por linha"
                            value={
                              t.checklist?.map((c) => c.title).join("\n") ?? ""
                            }
                            onChange={(e) =>
                              onChange({
                                ...draft,
                                tasks: draft.tasks.map((row) =>
                                  row.id === t.id
                                    ? {
                                        ...row,
                                        checklist: e.target.value
                                          .split("\n")
                                          .map((title, i) => ({
                                            id: `${t.id}-c${i}`,
                                            title,
                                            done: false,
                                          })),
                                      }
                                    : row,
                                ),
                              })
                            }
                          />
                        </details>
                      </div>
                    ))}
                </div>
              ))}
          </div>
        </details>
      ))}
    </div>
  );
}
