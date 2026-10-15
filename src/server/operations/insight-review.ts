import type {ServerEnv} from '../context';
import {getDoc} from '../db.ts';
import {authorizeOperation,type OperationPrincipal} from './principal.ts';
import {commitOperation,receipt,requestHash} from './transaction.ts';
import {OperationError} from './errors.ts';
import {object,id,choice} from './input.ts';

export async function reviewInsight(env:ServerEnv,principal:OperationPrincipal,input:unknown,key:string){
 if(!env.DB)throw new OperationError(503,'database_unavailable','Banco indisponível.');
 const raw=object(input),company=id(raw.company),insight=id(raw.insight),decision=choice(raw.decision,['accept','dismiss']);
 const db=env.DB,workspace=env.WORKSPACE_ID||'default',command='insights.review';
 const guards=await authorizeOperation(db,workspace,principal,{action:'ia.revisar',scope:'engagement:write',company});
 const hash=await requestHash(command,{company,insight,decision}),saved=await receipt(db,workspace,principal.id,key,command,hash);
 if(saved)return saved.result;
 // All review writers advance this guard, so competing decisions cannot both commit.
 const guardKey=`ontology.insightreview.${insight}`,guard=await getDoc(db,workspace,guardKey);
 const row=await db.prepare('SELECT status FROM ai_suggestions WHERE workspace_id=? AND company=? AND id=?').bind(workspace,company,insight).first<{status:string}>();
 if(!row)throw new OperationError(404,'insight_not_found','Análise não encontrada.');
 if(row.status!=='pending')throw new OperationError(409,'already_reviewed','Esta sugestão já foi revisada. Atualize a lista.');
 const status=decision==='accept'?'accepted':'dismissed',at=new Date().toISOString();
 return commitOperation(db,{workspace,principal:principal.id,application:principal.application,actor:principal,key,command,hash, checked: true,id:crypto.randomUUID(),guards:[...guards,{key:guardKey,version:guard?.version??0}],writes:[{key:guardKey,value:{status}}],events:[{type:command,company,subject:insight,data:{status}}],statements:[db.prepare("UPDATE ai_suggestions SET status=?,reviewed_at=?,reviewed_by=? WHERE workspace_id=? AND company=? AND id=? AND status='pending'").bind(status,at,principal.email,workspace,company,insight)],result:{data:{id:insight,company,status,reviewedAt:at}}});
}
