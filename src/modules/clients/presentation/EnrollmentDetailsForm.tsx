"use client";
import { DatePicker } from "@/shared/ui/DatePicker";
import { useRef, useState } from "react";
import type { ProductEnrollment } from "../domain/product-enrollments";
import { useClientsState } from "../infrastructure/state";
import { useCatalogState } from "../../catalog/infrastructure/state";
import { usePermissions } from "../../workspace/presentation/usePermissions";
import { clientOperationBaseline, executeOperation, operationAttempt, usesRemoteOperations, type OperationAttempt } from "@/shared/infrastructure/operations";
import { Combobox } from "@/shared/ui/Combobox";
import { Button } from "@/shared/ui/primitives";
import { fieldClass } from "@/shared/ui/Drawer";

export function EnrollmentDetailsForm({enrollment}:{enrollment:ProductEnrollment}) {
  const {products,productVersions}=useCatalogState(),{saveEnrollment}=useClientsState(),{can}=usePermissions();
  const product=products.find(p=>p.id===enrollment.productId);
  const versions=[...new Set([...(product?[product.version??1]:[]),...(productVersions[enrollment.productId]??[]).map(v=>v.version)])].sort((a,b)=>b-a);
  const [startsAt,setStartsAt]=useState(enrollment.startsAt??""),[version,setVersion]=useState(enrollment.productVersion===undefined?"":String(enrollment.productVersion));
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [baseline]=useState(clientOperationBaseline),attempt=useRef<OperationAttempt|null>(null),lock=useRef(false);
  async function save(event:React.FormEvent) {
    event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError("");
    try {
      const input={company:enrollment.company,enrollmentId:enrollment.id,startsAt,productVersion:Number(version)};
      if(await usesRemoteOperations()){attempt.current=operationAttempt("enrollments.update",input,attempt.current);await executeOperation("enrollments.update",input,attempt.current,baseline);}
      else saveEnrollment({...enrollment,startsAt,productVersion:Number(version)});
    }catch(failure){setError(failure instanceof Error?failure.message:"Não foi possível salvar.");}
    finally{lock.current=false;setBusy(false);}
  }
  if(!can("plano.editar",enrollment.company))return <p className="text-sm text-muted">A equipe responsável precisa informar a data inicial e a versão contratada.</p>;
  return <form onSubmit={save} className="space-y-4">
    <p className="text-sm text-muted">Informe os dados combinados na contratação. Salvar estes dados mantém os ciclos e as tarefas existentes.</p>
    <label className="block text-sm">Data de início<DatePicker label="Data de início" required
              className={fieldClass+" mt-2"}
              value={startsAt}
              disabled={busy||Boolean(enrollment.startsAt)}
              onValueChange={next=>setStartsAt(next)} /></label>
    <div><p className="mb-2 text-sm">Versão contratada do produto</p><Combobox label="Versão contratada do produto" placeholder="Escolha a versão contratada" value={version} required disabled={busy||enrollment.productVersion!==undefined} onValueChange={setVersion} options={versions.map(v=>({value:String(v),label:`Versão ${v}${v===(product?.version??1)?" · atual":""}`}))}/></div>
    {error&&<p role="alert" className="text-sm text-rose">{error}</p>}
    <Button type="submit" disabled={busy||!startsAt||!version}>{busy?"Salvando…":"Salvar dados da contratação"}</Button>
  </form>;
}
