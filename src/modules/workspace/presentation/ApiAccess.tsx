"use client";
import {useEffect, useState, useSyncExternalStore} from 'react';
import {KeyRound, BookOpen} from 'lucide-react';
import {Button} from '@/shared/ui/primitives';
import {fieldClass} from '@/shared/ui/Drawer';
import {Select} from '@/shared/ui/Select';
import {apiGuide} from '@/shared/lib/api-guide';
import {usePermissions} from './usePermissions';

type ApiKey = {id:string;name:string;created_at:string;expires_at:string;revoked_at:string|null};
async function request<T>(path:string, init?:RequestInit):Promise<T> {
  const response=await fetch(path,{...init,cache:'no-store'});
  const result=await response.json() as {data:T;error?:{message?:string}};
  if(!response.ok) throw Error(result.error?.message??'Não foi possível completar a operação.');
  return result.data;
}
const date=(value:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo'}).format(new Date(value));
const subscribeOrigin=()=>()=>{};
export function ApiAccess(){
  const {can}=usePermissions();
  const [keys,setKeys]=useState<ApiKey[]|null>(null),[name,setName]=useState(''),[days,setDays]=useState('90');
  const [secret,setSecret]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState('');
  const origin=useSyncExternalStore(subscribeOrigin,()=>window.location.origin,()=>'');
  const [now]=useState(()=>Date.now());
  useEffect(()=>{let alive=true;void request<ApiKey[]>('/api/v1/api-keys').then(value=>{if(alive)setKeys(value);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[]);
  async function refresh(){setKeys(await request<ApiKey[]>('/api/v1/api-keys'));}
  async function create(){
    if(busy)return;setBusy(true);setError('');setCopied('');
    try{
      const issued=await request<{token:string}>('/api/v1/api-keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,expiresInDays:Number(days)})});
      setSecret(issued.token);setName('');await refresh();
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível gerar a chave.');}finally{setBusy(false);}
  }
  async function revoke(id:string){if(busy)return;setBusy(true);setError('');try{await request(`/api/v1/api-keys/${encodeURIComponent(id)}`,{method:'DELETE'});await refresh();}catch(e){setError(e instanceof Error?e.message:'Não foi possível revogar.');}finally{setBusy(false);}}
  async function copy(text:string,label:string){try{await navigator.clipboard.writeText(text);setCopied(label);}catch{setError('Não foi possível copiar automaticamente. Selecione e copie o texto.');}}
  const guide=apiGuide(origin);
  return <div className="space-y-6">
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center gap-2"><KeyRound size={16}/><h2 className="text-[15px] font-medium">Minhas chaves de API</h2></div>
      <p className="mt-2 text-sm text-muted">Conecte suas automações ao Delivery. Cada chave usa seu nível de acesso e suas alocações atuais.</p>
      {can('api-keys.gerenciar')&&<form className="mt-5 flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();void create();}}>
        <label className="min-w-0 flex-1 basis-64"><span className="mb-1.5 block text-xs text-muted">Nome da chave</span><input className={fieldClass} value={name} onChange={e=>setName(e.target.value)} maxLength={100} placeholder="Ex.: HubSpot · vendas" required disabled={busy||!!secret}/></label>
        <div className="w-40"><span className="mb-1.5 block text-xs text-muted">Validade</span><Select label="Validade da chave" value={days} onValueChange={setDays} disabled={busy||!!secret} options={[{value:'30',label:'30 dias'},{value:'90',label:'90 dias'},{value:'365',label:'1 ano'}]}/></div>
        <Button type="submit" disabled={busy||!!secret||!name.trim()}>{busy?'Aguarde…':'Gerar chave'}</Button>
      </form>}
      {secret&&<div className="mt-5 rounded-xl border border-line bg-soft p-4"><h3 className="text-sm font-medium">Copie sua chave agora</h3><p className="mt-1 text-xs text-muted">Ela só aparece nesta criação. Guarde-a no campo de credenciais da sua automação.</p><input aria-label="Chave gerada" readOnly value={secret} className={`${fieldClass} mt-3 font-mono text-xs`}/><div className="mt-3 flex flex-wrap gap-2"><Button onClick={()=>void copy(secret,'key')}>{copied==='key'?'Copiada':'Copiar chave'}</Button><Button variant="ghost" onClick={()=>{setSecret('');setCopied('');}}>Já guardei</Button></div></div>}
      {error&&<p role="alert" className="mt-4 text-sm text-rose">{error} <button className="underline" disabled={busy} onClick={()=>{setError('');void refresh().catch(e=>setError(e.message));}}>Atualizar lista</button></p>}
      {keys===null&&!error&&<p className="mt-5 text-sm text-muted">Carregando suas chaves…</p>}
      {keys?.length===0&&<p className="mt-5 text-sm text-muted">Você ainda não gerou nenhuma chave.</p>}
      {keys?.map(key=>{const active=!key.revoked_at&&Date.parse(key.expires_at)>now;return <div key={key.id} className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"><div className="min-w-0"><p className="break-words text-sm font-medium">{key.name}</p><p className="mt-1 text-xs text-muted">{key.revoked_at?'Revogada':active?'Ativa':'Expirada'} · Criada em {date(key.created_at)} · Validade {date(key.expires_at)}</p></div>{active&&<Button variant="ghost" disabled={busy} onClick={()=>void revoke(key.id)}>Revogar</Button>}</div>;})}
    </section>
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center gap-2"><BookOpen size={16}/><h2 className="text-[15px] font-medium">Como usar a API</h2></div>
      <p className="mt-2 text-sm text-muted">Use uma chamada HTTP na sua automação para criar clientes, adicionar stakeholders e contratar produtos.</p>
      {origin&&<><code className="mt-4 block break-all rounded-lg bg-soft p-3 text-xs">{guide.baseUrl}</code>
      <div className="mt-4 flex flex-wrap gap-3"><Button variant="ghost" href={guide.docsUrl}>Instruções em JSON</Button><Button variant="ghost" href={guide.openApiUrl}>Contrato OpenAPI</Button><Button variant="ghost" onClick={()=>void copy(guide.instructions,'docs')}>{copied==='docs'?'Instruções copiadas':'Copiar instruções para IA'}</Button></div>
      {guide.sections.map((section,index)=><details key={section.title} className="mt-4 border-t border-line pt-4" open={index===0||index===2}><summary className="cursor-pointer text-sm font-medium">{section.title}</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">{section.text}</p>{index===2&&<><pre className="mt-3 overflow-x-auto rounded-lg bg-soft p-3 text-xs leading-relaxed">{guide.curlExample}</pre><Button variant="ghost" onClick={()=>void copy(guide.curlExample,'example')}>{copied==='example'?'Exemplo copiado':'Copiar exemplo'}</Button></>}</details>)}</>}
    </section>
    <span role="status" className="sr-only">{copied?'Conteúdo copiado':''}</span>
  </div>;
}
