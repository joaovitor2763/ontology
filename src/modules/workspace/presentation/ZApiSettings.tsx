"use client";
import {useEffect,useState} from 'react';
import {TextField,PasswordField} from '@g4ai/ds';
import {Button} from '@/shared/ui/primitives';
import {Combobox} from '@/shared/ui/Combobox';
import {Select} from '@/shared/ui/Select';
import {useClientsState} from '@/modules/clients/infrastructure/state';
import {useSyncStatus} from '@/shared/infrastructure/useLocalStorageState';
import {usePermissions} from './usePermissions';
type Mapping={channel:string;company:string};
type Config={configured:boolean;storageReady:boolean;enabled:boolean;instanceId:string;mappings:Mapping[];webhookUrl?:string;retentionDays:number};
async function request<T>(url:string,init?:RequestInit):Promise<T>{const r=await fetch(url,{cache:'no-store',...init,headers:{'content-type':'application/json',...init?.headers}});const data=await r.json() as T & {error?:string};if(!r.ok)throw new Error(data.error||'Não foi possível concluir.');return data;}
export function ZApiSettings(){
 const {access}=usePermissions();const {pending}=useSyncStatus();const {clients}=useClientsState();const [config,setConfig]=useState<Config|null>(null);
 const [instanceId,setInstanceId]=useState(''),[instanceToken,setInstanceToken]=useState(''),[clientToken,setClientToken]=useState('');
 const [enabled,setEnabled]=useState(false),[mappings,setMappings]=useState<Mapping[]>([]),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function load(){const value=await request<Config>('/api/z-api/config');setConfig(value);setInstanceId(value.instanceId);setEnabled(value.enabled);setMappings(value.mappings);}
 useEffect(()=>{if(access!=='admin'||pending)return;let alive=true;void request<Config>('/api/z-api/config').then(value=>{if(alive){setError('');setConfig(value);setInstanceId(value.instanceId);setEnabled(value.enabled);setMappings(value.mappings);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[access,pending]);
 if(access!=='admin')return null;
 async function save(event:React.FormEvent){event.preventDefault();setBusy('save');setError('');setNotice('');try{await request('/api/z-api/config',{method:'PUT',body:JSON.stringify({instanceId,instanceToken,clientToken,enabled,mappings})});setInstanceToken('');setClientToken('');await load();setNotice('Configuração salva. Copie o webhook para o painel da Z-API; mensagens novas de conversas associadas serão recebidas.');}catch(e){setError(e instanceof Error?e.message:'Falha ao salvar.');}finally{setBusy('');}}
 async function test(){setBusy('test');setError('');try{const r=await request<{connected:boolean}>('/api/z-api/test',{method:'POST'});setNotice(r.connected?'Instância conectada. Teste o recebimento de uma mensagem consentida.':'Instância não conectada. Vincule o número por QR no painel da Z-API.');}catch(e){setError(e instanceof Error?e.message:'Falha na verificação.');}finally{setBusy('');}}
 async function copy(){try{await navigator.clipboard.writeText(config?.webhookUrl||'');setNotice('Webhook copiado. Esta URL contém um segredo; não a compartilhe publicamente.');}catch{setError('Copie a URL do campo de webhook.');}}
 return <section className="rounded-2xl border border-line bg-surface p-5"><h2 className="text-[15px] font-medium">WhatsApp · Z-API</h2><p className="mt-1 text-[13px] leading-relaxed text-muted">Capture mensagens novas no banco próprio. Nenhum envio, histórico retroativo ou mídia arquivada. Retenção de 90 dias; associe somente conversas consentidas.</p>
 {error&&<p role="alert" className="mt-3 text-sm text-rose">{error}</p>}{notice&&<p role="status" className="mt-3 text-sm text-ink">{notice}</p>}
 {!config&&!error&&<p className="mt-3 text-sm text-muted">Carregando configuração…</p>}
 {config&&!config.storageReady&&<p className="mt-3 text-sm text-amber">O operador deve configurar o secret INTEGRATION_SECRET_KEY no Worker antes de ativar integrações. Veja DEPLOY.md.</p>}
 <form onSubmit={save} className="mt-4 space-y-4"><div className="grid gap-3 md:grid-cols-3"><TextField label="ID da instância" value={instanceId} onChange={setInstanceId} required disabled={!!busy}/><PasswordField label="Token da instância" value={instanceToken} onChange={setInstanceToken} placeholder={config?.configured?'Mantido se vazio':'Token do painel Z-API'} autoComplete="new-password" disabled={!!busy}/><PasswordField label="Client token da conta" value={clientToken} onChange={setClientToken} placeholder={config?.configured?'Mantido se vazio':'Token de segurança Z-API'} autoComplete="new-password" disabled={!!busy}/></div>
 <Select label="Recebimento após salvar" hideLabel={false} value={enabled?'on':'off'} onValueChange={v=>setEnabled(v==='on')} options={[{value:'off',label:'Desativado'},{value:'on',label:'Ativado'}]} disabled={!!busy}/>
 <div><h3 className="text-sm font-medium">Conversas por cliente</h3><p className="mt-1 text-xs text-muted">Número com DDI (ex.: 5511999999999) ou ID do grupo no painel da Z-API. Cada conversa pertence a um único cliente. Conversas sem associação não são armazenadas.</p>
 <div className="mt-3 space-y-3">{mappings.map((mapping,index)=><div key={index} className="grid items-end gap-2 rounded-lg border border-line p-3 md:grid-cols-[1fr_1fr_auto]"><Combobox label="Cliente" hideLabel={false} value={mapping.company} onValueChange={value=>setMappings(all=>all.map((item,i)=>i===index?{...item,company:value||''}:item))} options={clients.map(c=>({value:c.slug,label:c.name}))} disabled={!!busy}/><TextField label="Número ou ID do grupo" value={mapping.channel} onChange={value=>setMappings(all=>all.map((item,i)=>i===index?{...item,channel:value}:item))} disabled={!!busy}/><Button type="button" variant="ghost" disabled={!!busy} onClick={()=>setMappings(all=>all.filter((_,i)=>i!==index))}>Retirar associação</Button></div>)}</div>
 <Button type="button" variant="ghost" className="mt-3" disabled={!!busy||mappings.length>=200} onClick={()=>setMappings(all=>[...all,{company:'',channel:''}])}>Associar conversa</Button></div>
 <div className="flex flex-wrap gap-2"><Button type="submit" disabled={!!busy||!config?.storageReady}>{busy==='save'?'Salvando…':'Salvar configuração Z-API'}</Button><Button type="button" variant="ghost" disabled={!!busy||!config?.configured} onClick={()=>void test()}>{busy==='test'?'Verificando…':'Verificar instância'}</Button></div></form>
 {config?.webhookUrl&&<div className="mt-5 space-y-3 rounded-xl bg-soft p-4"><TextField label="Webhook privado" value={config.webhookUrl} onChange={()=>{}} readOnly/><Button type="button" variant="ghost" onClick={()=>void copy()}>Copiar webhook</Button><p className="text-xs leading-relaxed text-muted">No painel da Z-API, configure o webhook de recebimento incluindo mensagens enviadas por você e vincule o número por QR. O app não sobrescreve webhooks existentes. Se usar Cloudflare Access, libere somente o caminho exato acima para o provedor; o segredo e a instância são verificados pelo app.</p></div>}
 </section>;
}
