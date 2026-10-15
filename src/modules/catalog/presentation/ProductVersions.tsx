"use client";
import { deadlineSummary } from "../domain/task-deadlines";
import { useEffect, useRef, useState } from "react";
import type { Product } from "../domain/products";
import { useCatalogState } from "../infrastructure/state";
import { useDeliveryState } from "@/modules/delivery/infrastructure/state";
import { loadClientCycleCollection } from "@/modules/delivery/infrastructure/client-collection";
import { useClientsState } from "@/modules/clients/infrastructure/state";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { Drawer } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/primitives";
import { Combobox } from "@/shared/ui/Combobox";
import { clientOperationBaseline, executeClientOperation, operationAttempt } from "@/shared/infrastructure/operations";
import { useSyncStatus } from "@/shared/infrastructure/useLocalStorageState";
import { enrollmentCanReceiveWork } from "@/modules/clients/domain/product-enrollments";
import { workspaceDate } from "@/shared/lib/format";
import { Checkbox } from "@g4ai/ds";
type Preview = { previewFingerprint:string; targetVersion:number; cycles:{id:string;name:string;blocked?:string;changes:string[];preserved:string[];addedTaskCount:number}[] };
export function ProductVersions({ product }: { product: Product }) {
  const { mode, resolved } = useSyncStatus();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  return <>
    <div className="mb-5 flex flex-wrap items-center gap-3 text-[12px]"><strong>Versão {product.version??1}</strong><span className="text-muted">Usada em novas contratações. Clientes atuais mantêm suas cópias.</span><Button variant="ghost" size="sm" onClick={()=>{setOpened(true);setOpen(true);}}>Versões e atualização de clientes</Button></div>
    {opened && resolved && (mode === 'remote'
      ? <ProductVersionsDrawer product={product} open={open} onClose={()=>setOpen(false)} execution={null} />
      : <LocalProductVersionsDrawer product={product} open={open} onClose={()=>setOpen(false)} />)}
  </>;
}

function LocalProductVersionsDrawer({ product, open, onClose }: {
  product: Product; open: boolean; onClose: () => void;
}) {
  const execution = useDeliveryState();
  return <ProductVersionsDrawer product={product} open={open} onClose={onClose} execution={execution} />;
}

function ProductVersionsDrawer({ product, open, onClose, execution }: {
  product: Product; open: boolean; onClose: () => void;
  execution: ReturnType<typeof useDeliveryState> | null;
}) {
  const { productVersions } = useCatalogState();
  const { clients, enrollments } = useClientsState();
  const { can } = usePermissions();
  const [company,setCompany]=useState(""),[purchase,setPurchase]=useState("");
  const [preview,setPreview]=useState<Preview|null>(null),[selected,setSelected]=useState<string[]>([]),[error,setError]=useState("");
  const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const lock=useRef(false),pending=useRef<null|(()=>Promise<void>)>(null);
  const reviewed=useRef<null|{remote:boolean;input:{company:string;enrollmentId:string|null;productId:string;targetVersion:number};baseline:ReturnType<typeof clientOperationBaseline>;product:Product;versions:typeof productVersions[string];today:string}>(null);
  const versions=productVersions[product.id]??[];
  const matching=enrollments.filter(e=>e.company===company&&e.productId===product.id&&enrollmentCanReceiveWork(e));
  const [lookup, setLookup] = useState<{ company: string; productId: string; legacy: boolean;
    ready: boolean; error: string }>({ company: '', productId: '', legacy: false, ready: false, error: '' });
  const [lookupAttempt, setLookupAttempt] = useState(0);
  useEffect(() => {
    if (execution || !company || !open) return;
    const controller = new AbortController();
    void loadClientCycleCollection(company, { signal: controller.signal }).then(cycles => {
      if (controller.signal.aborted) return;
      setLookup({ company, productId: product.id,
        legacy: cycles.some(c => c.productId === product.id && !c.enrollmentId && !c.removed),
        ready: true, error: '' });
    }).catch(failure => {
      if (controller.signal.aborted) return;
      setLookup({ company, productId: product.id, legacy: false, ready: false,
        error: failure instanceof Error ? failure.message : 'Não foi possível verificar os ciclos.' });
    });
    return () => controller.abort();
  }, [company, execution, lookupAttempt, open, product.id]);
  const lookupCurrent = lookup.company === company && lookup.productId === product.id;
  const legacyReady = Boolean(execution) || (lookupCurrent && lookup.ready);
  const legacy = execution
    ? execution.cycles.some(c=>c.company===company&&c.productId===product.id&&!c.enrollmentId&&!c.removed)
    : lookupCurrent && lookup.legacy;
  function reset(){setPreview(null);setSelected([]);setError("");reviewed.current=null;}
  async function review(){
    if(lock.current||pending.current||!company||!purchase)return;
    lock.current=true;setBusy(true);setError("");setPreview(null);setSelected([]);
    try {
      const input={company,enrollmentId:purchase==="__legacy__"?null:purchase,productId:product.id,targetVersion:product.version??1};
      const remote=!execution;
      const today=workspaceDate();
      const baseline=clientOperationBaseline();
      if(remote){
        const response=await fetch("/api/v1/product-rollouts/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
        const payload=await response.json() as {data:Preview;detail?:string;message?:string;error?:{message?:string}};if(!response.ok)throw new Error(payload.detail??payload.message??payload.error?.message??"Não foi possível gerar a prévia.");
        setPreview(payload.data);
      }else{
        const result=execution!.productPreview(product,versions,today,{company,enrollmentId:input.enrollmentId});
        setPreview({previewFingerprint:result.fingerprint,targetVersion:input.targetVersion,cycles:result.impacts.map(i=>({id:i.cycle.id,name:i.cycle.name,blocked:i.blocked,changes:i.changes,preserved:i.preserved,addedTaskCount:i.added.length}))});
      }
      reviewed.current={remote,input,baseline,product:structuredClone(product),versions:structuredClone(versions),today};
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível gerar a prévia.");}
    finally{lock.current=false;setBusy(false);}
  }
  async function apply(){
    if(lock.current||!preview||!reviewed.current)return;
    lock.current=true;setBusy(true);setError("");
    try{
      // Local execution fingerprints cover tasks/cycles only. Revalidate the
      // catalog separately on every attempt; remote retries keep their original intent.
      if(!reviewed.current.remote && (JSON.stringify(product)!==JSON.stringify(reviewed.current.product) || JSON.stringify(versions)!==JSON.stringify(reviewed.current.versions)))
        throw new Error("O produto mudou. Gere uma nova prévia antes de aplicar.");
      if(!pending.current){
        const captured=reviewed.current,ids=[...selected],fingerprint=preview.previewFingerprint;
        const input={...captured.input,cycleIds:ids,previewFingerprint:fingerprint};
        const attempt=operationAttempt("product-rollouts.apply",input);
        pending.current=async()=>{
          if(captured.remote) await executeClientOperation("product-rollouts.apply",input,attempt,captured.baseline);
          else execution!.applyProductVersion(captured.product,captured.versions,captured.today,ids,fingerprint,{company:captured.input.company,enrollmentId:captured.input.enrollmentId});
        };
      }
      await pending.current();pending.current=null;setUncertain(false);reset();
    }catch(e){if(!reviewed.current?.remote)pending.current=null;setUncertain(!!reviewed.current?.remote);setError(e instanceof Error?e.message:"Não foi possível confirmar a atualização.");}
    finally{lock.current=false;setBusy(false);}
  }
  const frozen=busy||uncertain;
  return <>
    <Drawer open={open} onClose={()=>{if(!busy)onClose();}} title="Versões do produto" kicker={product.name} footer={<Button disabled={busy} onClick={onClose}>Fechar</Button>}>
      <p className="text-sm text-muted">Escolha o cliente e a contratação. Ciclos iniciados, concluídos e tarefas com trabalho registrado ficam preservados.</p>
        <details className="my-5 rounded-xl border border-line p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Histórico · {versions.length || 1} versões
          </summary>
          <ul className="mt-3 space-y-2 text-sm">
            {versions.length ? (
              [...versions].reverse().map((v) => (
                <li key={v.version}>
                  <details>
                    <summary className="cursor-pointer">
                      v{v.version} · {new Date(v.at).toLocaleString("pt-BR")} ·{" "}
                      {v.snapshot.cycles.length} ciclos
                    </summary>
                    <ul className="ml-4 mt-2 text-muted">
                      {v.snapshot.cycles.map((c) => (
                        <li key={c.id}>
                          <details>
                            <summary>
                              {c.name} · {c.durationDays} dias ·{" "}
                              {c.deliveries.length} tarefas
                            </summary>
                            <ul className="ml-3 space-y-2 py-2">
                              {c.deliveries.map((d) => (
                                <li key={d.id}>
                                  {d.title} · {deadlineSummary(d.deadline, c.deliveries, d.day)} · {d.hours} h
                                  {d.checklistItems?.length ? (
                                    <p className="text-xs">
                                      Checklist: {d.checklistItems.join("; ")}
                                    </p>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </details>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))
            ) : (
              <li>
                v1 · Padrão inicial. O histórico começa no próximo salvamento.
              </li>
            )}
          </ul>
        </details>

      <div className="space-y-3">
        <Combobox label="Cliente para atualizar" value={company} disabled={frozen} onValueChange={value=>{setCompany(value);setLookup({company:'',productId:'',legacy:false,ready:false,error:''});setPurchase("");reset();}} options={clients.filter(c=>can("plano.editar",c.slug)).map(c=>({value:c.slug,label:c.name}))}/>
        <Combobox label="Contratação para atualizar" value={purchase} disabled={frozen||!company||!legacyReady} onValueChange={value=>{setPurchase(value);reset();}} options={[...matching.map(e=>({value:e.id,label:`${e.startsAt??"Início não registrado"} · ${e.status} · ${e.id.slice(-8)}`})),...(legacy?[{value:"__legacy__",label:"Execução sem contratação"}]:[])]}/>
        {!execution && company && !legacyReady && !lookup.error && <p role="status" className="text-xs text-muted">Verificando ciclos do cliente…</p>}
        {!execution && lookupCurrent && lookup.error && <p role="alert" className="text-xs text-rose">{lookup.error} <Button size="sm" variant="ghost" onClick={()=>{setLookup({company:'',productId:'',legacy:false,ready:false,error:''});setLookupAttempt(value=>value+1);}}>Tentar novamente</Button></p>}
        <Button disabled={frozen||!company||!purchase||!legacyReady} onClick={review}>{busy&&!preview?"Gerando prévia…":"Gerar prévia para clientes atuais"}</Button>
      </div>
      {error&&<p role="alert" className="mt-4 text-sm text-rose">{error}</p>}
      {preview&&<div className="mt-5 space-y-4">
        <p className="text-sm font-medium">Prévia da versão {preview.targetVersion}</p>
        {!preview.cycles.length&&<p>Nenhum ciclo vinculado a esta execução.</p>}
        {preview.cycles.map(c=><section key={c.id} className="rounded-xl border border-line p-4">
          <Checkbox label={c.name} className="font-medium" disabled={frozen||!!c.blocked} checked={selected.includes(c.id)} onCheckedChange={checked=>setSelected(ids=>checked?[...ids,c.id]:ids.filter(id=>id!==c.id))}/>
          {c.blocked?<p className="mt-2 text-sm text-muted">{c.blocked}</p>:<><ul className="mt-3 space-y-1 text-sm">{c.changes.map((change,i)=><li key={i}>{change}</li>)}</ul>{!c.changes.length&&<p className="mt-2 text-sm text-muted">Sem alterações de conteúdo ou prazo.</p>}{!!c.preserved.length&&<details className="mt-3 text-sm text-muted"><summary>Preservado no cliente ({c.preserved.length})</summary><ul>{c.preserved.map((item,i)=><li key={i}>{item}</li>)}</ul></details>}</>}
        </section>)}
        <Button disabled={busy||!selected.length} onClick={apply}>{busy?"Salvando…":uncertain?"Tentar confirmar novamente":`Aplicar v${preview.targetVersion} em ${selected.length} ciclos selecionados`}</Button>
        {uncertain&&<><p className="text-sm text-muted">A seleção está preservada. Repita a confirmação para consultar o resultado da mesma operação.</p><Button variant="ghost" onClick={()=>{pending.current=null;setUncertain(false);reset();}}>Descartar prévia e revisar os dados atuais</Button></>}
      </div>}
    </Drawer>
  </>;
}
