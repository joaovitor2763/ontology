"use client";
import { Check, ChevronDown, Settings2, ListChecks } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useClientsState } from "../infrastructure/state";
import type { Company } from "../domain/models";
import { useCatalog } from "../../catalog/presentation/catalog";
import { useServices } from "../../delivery/presentation/state";
import { ActionMenu } from "@/shared/ui/Menu";
import { Drawer } from "@/shared/ui/Drawer";
import { ProductPreparation } from "../../delivery/presentation/ProductPreparation";
import { usePermissions } from "../../workspace/presentation/usePermissions";
import { ProductEnrollments } from "./ProductEnrollments";
import { enrollmentCanReceiveWork, enrollmentIsCurrent } from "../domain/product-enrollments";
import { hasLegacyExecutionForClient, legacyExecutionProductIds, selectedExecutionId } from "../../delivery/application/plan-schedule";
import { useDeliveryState } from "../../delivery/infrastructure/state";
import { deliveriesFor } from "../../delivery/infrastructure/queries";

/** Plan context belongs beside the client identity, not in the execution content. */
export function ClientPlanProductMenu({company}:{company:Company}) {
  const {enrollments,configFor}=useClientsState();
  const {journeyOf}=useCatalog();
  const {products,cycles,companyJourney}=useServices();
  const {statusMap,extraTasks,taskPatches}=useDeliveryState();
  const {can}=usePermissions();
  const params=useSearchParams(),router=useRouter(),path=usePathname();
  const allPurchases=enrollments.filter(e=>e.company===company.slug);
  const purchases=allPurchases.filter(enrollmentIsCurrent);
  const followed=journeyOf(company);
  const projectedTasks=deliveriesFor(company.slug,statusMap,extraTasks,taskPatches);
  const legacyExecutionProducts=new Set(legacyExecutionProductIds({cycles,tasks:projectedTasks},company.slug));
  const hasLegacyExecution=hasLegacyExecutionForClient({cycles,tasks:projectedTasks},company.slug,[companyJourney[company.slug],company.journeyId],allPurchases.map(e=>e.planId));
  const fallbackId=purchases.find(e=>e.planId===followed.id)?.id??purchases[0]?.id??(hasLegacyExecution?"__legacy__":"__none__");
  const requested=selectedExecutionId(params.get("contratacao"),allPurchases.map(e=>e.id),fallbackId,hasLegacyExecution);
  const selected=allPurchases.find(e=>e.id===requested);
  const productName=(id:string)=>products.find(p=>p.id===id)?.name??"Produto";
  const legacyProducts=configFor(company.slug).productIds??[];
  const legacyLabel=!purchases.length&&legacyProducts.length===1?productName(legacyProducts[0]):"Plano do cliente";
  const visiblePurchases=selected&&!purchases.some(e=>e.id===selected.id)?[selected,...purchases]:purchases;
  const options=[...visiblePurchases.map(e=>({value:e.id,label:productName(e.productId)+(visiblePurchases.filter(p=>p.productId===e.productId).length>1?` · ${e.startsAt??"Sem data de início"}`:"")+(e.archivedAt?" · Arquivada":e.status==="cancelada"?" · Cancelada":"")})),...(hasLegacyExecution?[{value:"__legacy__",label:legacyLabel}]:[])];
  const selectedLegacy=params.get("produto");
  const value=selected?.id??(requested.startsWith("legacy:")?requested:selectedLegacy?`legacy:${selectedLegacy}`:hasLegacyExecution?"__legacy__":"__none__");
  for(const productId of legacyProducts.filter(id=>legacyExecutionProducts.has(id)&&!allPurchases.some(e=>e.productId===id))) options.splice(Math.max(0,options.length-(hasLegacyExecution?1:0)),0,{value:`legacy:${productId}`,label:productName(productId)});
  const preparation=allPurchases.find(e=>e.id===params.get("prepararContratacao")&&enrollmentCanReceiveWork(e));
  const preparationProduct=products.find(p=>p.id===preparation?.productId);
  function update(name:string,value:string|null) {
    const next=new URLSearchParams(params.toString());
    if(value===null)next.delete(name);else next.set(name,value);
    if(name==="contratacao"){next.delete("marco");next.delete("produto");if(value?.startsWith("legacy:")){next.set("contratacao","__legacy__");next.set("produto",value.slice(7));}}
    if(name==="gerenciarContratacoes")next.delete("prepararContratacao");
    if(name==="prepararContratacao")next.delete("gerenciarContratacoes");
    router.replace(path+(next.size?"?"+next:""),{scroll:false});
  }
  function viewEnrollment(enrollmentId:string) {
    const next=new URLSearchParams(params.toString());
    next.set("contratacao",enrollmentId);
    next.delete("produto");next.delete("marco");next.delete("gerenciarContratacoes");next.delete("prepararContratacao");
    router.replace(path+(next.size?"?"+next:""),{scroll:false});
  }
  return <>
    <ActionMenu label="Produto contratado" align="start" className="shrink-0 max-w-[min(260px,45vw)] border border-line bg-surface text-ink" trigger={<><span className="truncate">{options.find(o=>o.value===value)?.label??"Nenhuma contratação atual"}</span><ChevronDown className="h-3.5 w-3.5 shrink-0"/></>} actions={[
      ...options.map(o=>({label:o.label,icon:o.value===value?<Check/>:undefined,onSelect:()=>update("contratacao",o.value)})),
      ...(selected&&enrollmentCanReceiveWork(selected)&&can("plano.editar",company.slug)?[{label:!selected.startsAt||selected.productVersion===undefined?"Completar dados da contratação":"Preparar ciclos e tarefas",icon:<ListChecks/>,separator:true,onSelect:()=>update("prepararContratacao",selected.id)}]:[]),
      {label:"Gerenciar contratações",icon:<Settings2/>,separator:true,onSelect:()=>update("gerenciarContratacoes","1")},
    ]}/>
    {preparation&&preparationProduct&&<ProductPreparation company={company} product={preparationProduct} enrollmentId={preparation.id} onClose={()=>update("prepararContratacao",null)}/>}
    {params.get("gerenciarContratacoes")==="1"&&<Drawer open title="Produtos contratados" kicker={company.name} onClose={()=>update("gerenciarContratacoes",null)}><ProductEnrollments company={company} compact onView={viewEnrollment}/></Drawer>}
  </>;
}
