import { authorizeOperation, type OperationPrincipal } from './principal.ts';
import { OperationError } from './errors.ts';
export type EventRow={seq:number;id:string;workspace_id:string;operation_id:string;type:string;company:string|null;subject:string;actor:string;application:string;data:string;created_at:string};
export function eventPayload(event:EventRow) {return {id:event.id,sequence:event.seq,type:event.type,company:event.company,subject:event.subject,operationId:event.operation_id,at:event.created_at,data:JSON.parse(event.data)};}
export async function listEvents(db:D1Database,workspace:string,principal:OperationPrincipal,options:{cursor?:string;limit?:number;company?:string}={}) {
  const cursor=Number(options.cursor??0),limit=options.limit??50;
  if(!Number.isSafeInteger(limit)||limit<1||limit>100) throw new OperationError(400,'invalid_limit','Informe um limite inteiro entre 1 e 100.');
  if(!Number.isSafeInteger(cursor)||cursor<0) throw new OperationError(400,'invalid_cursor','Cursor inválido.');
  if(principal.companies?.length===0) await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'events:read',company:options.company});
  if(principal.companies!==null) {
    for(const company of options.company?[options.company]:principal.companies) await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'events:read',company});
  } else await authorizeOperation(db,workspace,principal,{action:'clientes.ver',scope:'events:read',company:options.company});
  let sequence=cursor;
  const items:ReturnType<typeof eventPayload>[]=[];
  // Bound the scan even when most events lie outside the grant. The returned cursor advances past skipped rows.
  const rows=(await db.prepare('SELECT *, sequence AS seq FROM operation_events WHERE workspace_id=? AND sequence>? ORDER BY sequence LIMIT 500').bind(workspace,cursor).all<EventRow>()).results;
  for(const event of rows) {
    sequence=event.seq;
    if(options.company&&event.company!==options.company) continue;
    if(principal.companies!==null&&(!event.company||!principal.companies.includes(event.company))) continue;
    items.push(eventPayload(event));if(items.length>=limit) break;
  }
  return {data:items,nextCursor:String(sequence),hasMore:sequence<(rows.at(-1)?.seq??sequence)||rows.length===500};
}
