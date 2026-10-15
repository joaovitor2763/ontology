import { forgetDocuments } from "./request-context.ts";
export const OAUTH_GUARD="ontology.oauthauth.v1";
/** Storage port only; protocol, cryptography and token lifecycle belong to the provider library. */
export function oauthD1Kv(db: D1Database, workspace: string): KVNamespace {
  const guard = () => db.prepare("INSERT INTO state_documents(workspace_id,key,version,body,updated_at,updated_by) VALUES(?,?,1,'{}',?,'oauth') ON CONFLICT(workspace_id,key) DO UPDATE SET version=version+1,updated_at=excluded.updated_at").bind(workspace,OAUTH_GUARD,new Date().toISOString());
  const guarded = (key:string) => key.startsWith('grant:') || key.startsWith('client:');
  return {
    async get(key: string, options?: { type?: string } | string) {
      const row = await db.prepare('SELECT value FROM oauth_provider_kv WHERE workspace_id=? AND key=? AND (expires_at IS NULL OR expires_at>?)').bind(workspace,key,Math.floor(Date.now()/1000)).first<{value:string}>();
      if(!row) return null;
      return (typeof options==='string'?options:options?.type)==='json' ? JSON.parse(row.value) : row.value;
    },
    async put(key: string,value: string,options?:{expiration?:number;expirationTtl?:number}) {
      const expires=options?.expiration??(options?.expirationTtl?Math.floor(Date.now()/1000)+options.expirationTtl:null);
      const write=db.prepare('INSERT INTO oauth_provider_kv(workspace_id,key,value,expires_at) VALUES(?,?,?,?) ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at').bind(workspace,key,value,expires);
      if(guarded(key)) { await db.batch([write,guard()]); forgetDocuments(db); } else await write.run();
    },
    async delete(key:string) {
      const remove=db.prepare('DELETE FROM oauth_provider_kv WHERE workspace_id=? AND key=?').bind(workspace,key);
      if(guarded(key)) { await db.batch([remove,guard()]); forgetDocuments(db); }
      else await remove.run();
    },
    async list(options?:{prefix?:string;cursor?:string;limit?:number}) {
      const prefix=options?.prefix??'', limit=Math.min(options?.limit??1000,1000);
      const rows=await db.prepare('SELECT key FROM oauth_provider_kv WHERE workspace_id=? AND substr(key,1,?)=? AND key>? AND (expires_at IS NULL OR expires_at>?) ORDER BY key LIMIT ?').bind(workspace,prefix.length,prefix,options?.cursor??'',Math.floor(Date.now()/1000),limit+1).all<{key:string}>();
      const keys=rows.results.slice(0,limit).map(row=>({name:row.key}));
      return {keys,list_complete:rows.results.length<=limit,cursor:rows.results.length>limit?keys.at(-1)?.name:undefined,cacheStatus:null};
    },
  } as unknown as KVNamespace;
}
