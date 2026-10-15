import type { ServerEnv } from '../context';
import { getDoc } from '../db.ts';
import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { commitOperation, receipt, requestHash, type VersionGuard } from './transaction.ts';
import { OperationError } from './errors.ts';
import * as v from './input.ts';
import { editNote, type NotePatch } from '../../modules/engagement/domain/notes.ts';
import { interactionTags, normalizeInteractionTags } from '../../modules/engagement/domain/interaction-tags.ts';
import type { Thread, ThreadMessage } from '../../modules/engagement/domain/models.ts';
import type { ClientDocument } from '../../modules/documents/domain/models.ts';
import { documents as seedDocuments } from '../../modules/documents/infrastructure/seed.ts';
import { threads as seedThreads } from '../../modules/engagement/infrastructure/seed.ts';
import { projectAllMeetings } from '../../modules/engagement/infrastructure/snapshot.ts';
import { people } from '../../modules/workspace/infrastructure/seed.ts';
import { projectClients } from '../../modules/clients/infrastructure/snapshot.ts';
const RELATIONSHIP='ontology.relationship.v1',DOCUMENTS='ontology.documents.v3',CLIENTS='ontology.clients.v3',ENGAGEMENT='ontology.engagement.v2';
type Relationship={spaces:Thread[];notes:Record<string,ThreadMessage[]>;read:string[];unread:string[];pinned:string[]};
type Documents={extraDocs:ClientDocument[];removedDocIds:string[];docEdits:Record<string,Partial<ClientDocument>>};
type UploadedFile={id:string;company:string;created_by:string;status:string;r2_key:string;name:string;mime:string;size:number};
function relationship(raw:unknown):Relationship{return{spaces:[],notes:{},read:[],unread:[],pinned:[],...(raw as Partial<Relationship>??{})};}
function unique(guards:VersionGuard[]){const map=new Map<string,number>();for(const guard of guards){if(map.has(guard.key)&&map.get(guard.key)!==guard.version)throw new OperationError(409,'version_conflict','Os dados ou as permissões mudaram.');map.set(guard.key,guard.version);}return [...map].map(([key,version])=>({key,version}));}
function date(value:unknown){const text=v.string(value,'data',undefined,40);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)||!Number.isFinite(Date.parse(text)))v.invalid('Informe data e hora com fuso válidos.');const day=text.slice(0,10);if(new Date(`${day}T00:00:00Z`).toISOString().slice(0,10)!==day)v.invalid('Informe uma data válida.');return new Date(text).toISOString();}
function tags(value:unknown){if(!Array.isArray(value)||value.some(tag=>!interactionTags.includes(tag)))v.invalid('Informe tags válidas.');return normalizeInteractionTags(value);}
function fields(raw:Record<string,unknown>,allowed:string[]){if(Object.keys(raw).some(key=>!allowed.includes(key)))v.invalid('Campo de interação inválido.');}
export async function executeInteractionCommand(env:ServerEnv,principal:OperationPrincipal,command:'interactions.create'|'interactions.update',input:unknown,key:string,expectedVersions:Record<string,number>={}){
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');const db=env.DB,workspace=env.WORKSPACE_ID||'default',raw=v.object(input),company=v.id(raw.company);
 fields(raw,command==='interactions.create'?['company','title','text','at','kind','tags','fileIds']:['company','noteId','patch']);
 const fileIds=command==='interactions.create'&&raw.fileIds!==undefined?v.strings(raw.fileIds,'arquivos'):[];if(fileIds.length>30)v.invalid('Use no máximo 30 arquivos por interação.');
 const auth=[...await authorizeOperation(db,workspace,principal,{action:'interacoes.registrar',scope:'engagement:write',company}),...(fileIds.length?await authorizeOperation(db,workspace,principal,{action:'documentos.enviar',scope:'documents:write',company}):[])];
 const hash=await requestHash(command,input),saved=await receipt(db,workspace,principal.id,key,command,hash);if(saved)return saved.result;
 const rosterKey=auth.find(g=>g.key.startsWith('ontology.workspace.'))!.key;
 const keys=[RELATIONSHIP,CLIENTS,rosterKey,...(fileIds.length?[DOCUMENTS,'ontology.documents.v2',ENGAGEMENT]:[])],docs=await Promise.all(keys.map(k=>getDoc(db,workspace,k))),byKey=new Map(keys.map((k,i)=>[k,docs[i]]));
 const guards=unique([...auth,...keys.map((key,i)=>({key,version:docs[i]?.version??0}))]);
 for(const [name,version] of Object.entries(expectedVersions)){if(!Number.isSafeInteger(version)||version<0)v.invalid('Versão inválida.');const guard=guards.find(g=>g.key===name);if(guard&&guard.version!==version)throw new OperationError(409,'version_conflict','Atualize os dados antes de salvar a interação.');}
 if(!projectClients(byKey.get(CLIENTS)?.value??{}).clients.some(c=>c.slug===company))throw new OperationError(404,'client_not_found','Cliente ativo não encontrado.');
 const roster=byKey.get(rosterKey)?.value as {extraMembers?:{id:string;name?:string}[];memberEdits?:Record<string,{name?:string}>},member=[...(roster?.extraMembers??[]),...people].find(m=>m.id===principal.memberId),author=roster?.memberEdits?.[principal.memberId]?.name??member?.name;
 if(!author?.trim())throw new OperationError(409,'member_name_required','Complete o nome do membro da equipe antes de registrar a interação.');
 let state=relationship(byKey.get(RELATIONSHIP)?.value);const spaces=state.spaces.filter(s=>s.company===company&&s.kind==='notes');
 let thread=spaces[0];const at=new Date().toISOString(),statements:D1PreparedStatement[]=[],operationId=crypto.randomUUID();let note:ThreadMessage,changed=true;
 let documents:Documents={extraDocs:[],removedDocIds:[],docEdits:{},...(byKey.get(DOCUMENTS)?.value as Partial<Documents>??{})};const attached:ClientDocument[]=[];
 if(command==='interactions.create'){
  const title=v.string(raw.title,'título','',500),text=v.string(raw.text,'texto',undefined,50000),happenedAt=date(raw.at),kind=v.choice(raw.kind,['nota','ligacao','email','conversa'] as const),labels=raw.tags===undefined?[]:tags(raw.tags);
  if(!text&&!title&&!fileIds.length)v.invalid('Escreva a interação ou adicione um arquivo.');
  if(!thread){thread={id:`t-notes-${crypto.randomUUID()}`,company,channel:'note',kind:'notes',title:'Notas do cliente',counterpart:author,participants:[author],lastAt:at,unread:0,preview:'',messages:[]};state={...state,spaces:[thread,...state.spaces]};}
  for(const id of fileIds){
   if(!id.startsWith('up-'))v.invalid('Use identificadores de arquivos enviados.');
   const file=await db.prepare('SELECT id,company,created_by,status,r2_key,name,mime,size FROM files WHERE workspace_id=? AND id=?').bind(workspace,id).first<UploadedFile>();
   if(!file||file.company!==company||file.created_by!==principal.id||file.status!=='ready')throw new OperationError(409,'file_unavailable','O arquivo precisa estar pronto, pertencer a este cliente e ter sido enviado por você.');
   const oldDocuments=byKey.get('ontology.documents.v2')?.value as Partial<Documents>|undefined;
   const referenced=[...seedDocuments,...documents.extraDocs,...(oldDocuments?.extraDocs??[])].some(d=>d.id===id)||[...seedThreads,...state.spaces].some(t=>[...t.messages,...(state.notes[t.id]??[])].some(n=>n.files?.some(f=>f.id===id)))||Object.values(state.notes).some(notes=>notes.some(n=>n.files?.some(f=>f.id===id)))||projectAllMeetings(byKey.get(ENGAGEMENT)?.value??{}).some(m=>m.google?.transcriptDocId===id);
   if(referenced)throw new OperationError(409,'file_already_linked','O arquivo já está vinculado. Envie uma cópia para esta interação.');
   attached.push({id,company,name:file.name,kind:'comunicacao',mime:file.mime||'application/octet-stream',size:file.size,uploadedAt:at,uploadedBy:principal.memberId,relatedThreadId:thread.id,note:title||text||undefined,visibility:'interna'});
   statements.push(db.prepare('INSERT INTO file_operation_guards(transaction_id,workspace_id,file_id,expected_status,expected_r2_key) VALUES(?,?,?,?,?)').bind(operationId,workspace,id,'ready',file.r2_key));
  }
  if(fileIds.length)statements.push(db.prepare('DELETE FROM file_operation_guards WHERE transaction_id=?').bind(operationId));
  note={id:`n-${crypto.randomUUID()}`,at:happenedAt,createdAt:at,from:author,title:title||undefined,text,kind:'note',interaction:kind,tags:labels,...(attached.length?{files:attached.map(({id,name,mime})=>({id,name,mime}))}:{})};
  state={...state,notes:{...state.notes,[thread.id]:[...(state.notes[thread.id]??[]),note]}};
  documents={...documents,extraDocs:[...attached,...documents.extraDocs]};
 }else{
  const noteId=v.id(raw.noteId),patchInput=v.object(raw.patch);fields(patchInput,['at','title','text','tags']);if(!Object.keys(patchInput).length)v.invalid('Informe uma alteração.');
  if(!thread)throw new OperationError(404,'note_not_found','Interação não encontrada.');const owners=spaces.filter(s=>(state.notes[s.id]??[]).some(n=>n.id===noteId));if(owners.length!==1)throw new OperationError(404,'note_not_found','Interação não encontrada ou ambígua.');thread=owners[0];const matches=(state.notes[thread.id]??[]).filter(n=>n.id===noteId);if(matches.length!==1)throw new OperationError(404,'note_not_found','Interação não encontrada ou ambígua.');
  const patch:NotePatch={...(patchInput.at!==undefined?{at:date(patchInput.at)}:{}),...(patchInput.title!==undefined?{title:v.string(patchInput.title,'título',undefined,500)}:{}),...(patchInput.text!==undefined?{text:v.string(patchInput.text,'texto',undefined,50000)}:{}),...(patchInput.tags!==undefined?{tags:tags(patchInput.tags)}:{})};
  note=editNote(matches[0],patch,author,at);if(!note.text&&!note.title&&!note.files?.length)v.invalid('A interação não pode ficar vazia.');changed=note!==matches[0];state={...state,notes:{...state.notes,[thread.id]:(state.notes[thread.id]??[]).map(n=>n.id===noteId?note:n)}};
 }
 const writes=[...(changed?[{key:RELATIONSHIP,value:state}]:[]),...(attached.length?[{key:DOCUMENTS,value:documents}]:[])];
 try{return await commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash, checked: true,id:operationId,guards,writes,statements,events:changed?[{type:command==='interactions.create'?'interaction.created':'interaction.updated',company,subject:note.id!},...attached.map(d=>({type:'document.created',company,subject:d.id}))]:[],result:{data:{note,thread},documents:principal.kind==='session'?[{key:RELATIONSHIP,value:state,version:(byKey.get(RELATIONSHIP)?.version??0)+(changed?1:0),updatedAt:changed?at:byKey.get(RELATIONSHIP)?.updatedAt??at},...(attached.length?[{key:DOCUMENTS,value:documents,version:(byKey.get(DOCUMENTS)?.version??0)+1,updatedAt:at}]:[])]:[]}});}catch(error){if(String(error).includes('file_version_conflict'))throw new OperationError(409,'version_conflict','O arquivo mudou durante a operação. Tente novamente.');throw error;}
}
export async function readInteractions(env:ServerEnv,principal:OperationPrincipal,input:{company:string;limit?:number;offset?:number}){
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');const company=v.id(input.company),workspace=env.WORKSPACE_ID||'default';await authorizeOperation(env.DB,workspace,principal,{action:'clientes.ver',scope:'engagement:read',company});
 const limit=input.limit??50,offset=input.offset??0;if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)v.invalid('Paginação inválida.');
 const state=relationship((await getDoc(env.DB,workspace,RELATIONSHIP))?.value),spaces=[...state.spaces,...seedThreads.filter(t=>!state.spaces.some(s=>s.id===t.id))].filter(s=>s.company===company&&s.kind==='notes'),notes=spaces.flatMap(t=>[...t.messages,...(state.notes[t.id]??[])]).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||(a.id??'').localeCompare(b.id??''));
 return {notes:notes.slice(offset,offset+limit),nextOffset:offset+limit<notes.length?offset+limit:null};
}
