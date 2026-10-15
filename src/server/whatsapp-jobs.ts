import { missingMessageRanges, type ImportRange } from "./whatsapp-ranges.ts";
import {
  clientsContext,
  configuredGroup,
  groupKey,
} from "./insight-context.ts";
import {
  fetchMessagePage,
  whatsappSourceAvailable,
  type WhatsAppEnv,
} from "./whatsapp.ts";
import { generateInsight } from "./insights.ts";
import { aiConfigured, aiEnabled, type AiEnv } from "./ai/gateway.ts";

export type JobEnv = WhatsAppEnv &
  AiEnv & { DB?: D1Database; WORKSPACE_ID?: string };
type Job = {
  id: string;
  company: string;
  group_key: string;
  group_json: string;
  since: string;
  until_at: string;
  cursor_at: string | null;
  cursor_id: string | null;
  summary_cursor: string | null;
  import_ranges: string | null;
  phase: string;
  attempts: number;
  lease_owner: string;
};
const dayOf = (at: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
export async function prepareWhatsAppSync(env:JobEnv,company:string,days:number,by:string){
  const db = env.DB!,
    workspace = env.WORKSPACE_ID || "default";
  const group = await configuredGroup(db, workspace, company);
  if (!group)
    throw new Error("Defina o grupo em Configurar cliente › Recursos.");
  if (!await whatsappSourceAvailable(env)) throw new Error("Fonte do WhatsApp indisponível.");
  const now = new Date(),
    since = new Date(
      new Date(now.getTime() - days * 86400000).setUTCHours(0, 0, 0, 0),
    ).toISOString();
  const coverage = await db.prepare(
    "SELECT since,until_at AS until FROM whatsapp_jobs WHERE workspace_id=? AND company=? AND group_key=? AND phase='summary' AND status<>'cancelled' AND until_at>=? AND since<=?",
  ).bind(workspace, company, groupKey(group), since, now.toISOString()).all<ImportRange>();
  // Manual refresh reconciles five minutes; daily collection catches two days of late arrivals.
  const ranges = missingMessageRanges({ since, until: now.toISOString() }, coverage.results,
    by === "daily" ? 2 * 86400000 : 5 * 60000);
  const existing=await db.prepare("SELECT id FROM whatsapp_jobs WHERE workspace_id=? AND company=? AND group_key=? AND phase='import' AND since<=? AND status IN ('pending','running') LIMIT 1").bind(workspace,company,groupKey(group),since).first<{id:string}>();
  if(existing)return {id:existing.id,statements:[] as D1PreparedStatement[],created:false};
  const id=crypto.randomUUID();
  return {id,created:true,statements:[
    db.prepare("UPDATE whatsapp_jobs SET status='cancelled',lease_until=0,lease_owner=NULL WHERE workspace_id=? AND company=? AND (group_key<>? OR (phase='import' AND since>?)) AND status IN ('pending','running')").bind(workspace,company,groupKey(group),since),
    db.prepare("INSERT INTO whatsapp_jobs (id,workspace_id,company,group_key,group_json,since,until_at,created_at,updated_at,requested_by,import_ranges) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(id,workspace,company,groupKey(group),JSON.stringify(group),since,now.toISOString(),now.toISOString(),now.toISOString(),by,JSON.stringify(ranges)),
  ]};
}
export function isWhatsAppQueueConflict(error:unknown){return error instanceof Error&&error.message.includes('UNIQUE constraint failed: whatsapp_jobs.workspace_id, whatsapp_jobs.company');}
export async function enqueueSync(env:JobEnv,company:string,days:number,by:string){
 for(let attempt=0;attempt<3;attempt++){
  const plan=await prepareWhatsAppSync(env,company,days,by);
  try{if(plan.statements.length)await env.DB!.batch(plan.statements);return plan.id;}catch(error){if(!isWhatsAppQueueConflict(error))throw error;}
 }
 throw new Error('A fila mudou durante a atualização. Tente novamente.');
}
/** Invoked every five minutes. New daily windows open only after 06:00 São Paulo. */
export async function scheduleWhatsApp(env: JobEnv) {
  if (!env.DB || !await whatsappSourceAvailable(env)) return;
  const db = env.DB,
    workspace = env.WORKSPACE_ID || "default",
    now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  const day = dayOf(now.toISOString());
  const marker = await db
    .prepare(
      "SELECT day FROM integration_schedule WHERE workspace_id=? AND name='whatsapp'",
    )
    .bind(workspace)
    .first<{ day: string }>();
  if (hour >= 6 && marker?.day !== day) {
    const clients = await clientsContext(db, workspace);
    const local = await db.prepare("SELECT company FROM z_api_channels WHERE workspace_id=?").bind(workspace).all<{company:string}>();
    for (const company of new Set([...Object.keys(clients.configs ?? {}), ...local.results.map(row => row.company)])) {
      const group = await configuredGroup(db, workspace, company);
      if (clients.archivedClients?.includes(company) || !group) continue;
      const last = await db
        .prepare(
          "SELECT until_at FROM whatsapp_jobs WHERE workspace_id=? AND company=? AND group_key=? AND phase='summary' ORDER BY created_at DESC LIMIT 1",
        )
        .bind(workspace, company, groupKey(group))
        .first<{ until_at: string }>();
      // Overlap re-reads two days for delayed source arrivals; primary keys dedupe messages.
      const days = last
        ? Math.max(
            2,
            Math.ceil((now.getTime() - Date.parse(last.until_at)) / 86400000) +
              2,
          )
        : 30;
      await enqueueSync(env, company, days, "daily");
    }
    await db
      .prepare(
        "INSERT INTO integration_schedule(workspace_id,name,day) VALUES (?,'whatsapp',?) ON CONFLICT(workspace_id,name) DO UPDATE SET day=excluded.day",
      )
      .bind(workspace, day)
      .run();
  }
  await processWhatsApp(env);
}
/** Leases and persisted cursors allow interrupted imports to resume safely. */
export async function processWhatsApp(env: JobEnv) {
  if (!env.DB || !await whatsappSourceAvailable(env)) return;
  const db = env.DB,
    workspace = env.WORKSPACE_ID || "default",
    leaseOwner = crypto.randomUUID();
  const job = await db
    .prepare(
      "UPDATE whatsapp_jobs SET status='running',lease_until=?,lease_owner=? WHERE id=(SELECT id FROM whatsapp_jobs WHERE workspace_id=? AND status IN ('pending','running') AND (phase='import' OR ?=1) AND lease_until<? ORDER BY created_at LIMIT 1) RETURNING *",
    )
    .bind(
      Date.now() + 600_000,
      leaseOwner,
      workspace,
      aiEnabled(env) && aiConfigured(env) ? 1 : 0,
      Date.now(),
    )
    .first<Job>();
  if (!job) return;
  const update = async (sql: string, ...values: (string | number | null)[]) =>
    db
      .prepare(
        `UPDATE whatsapp_jobs SET ${sql},updated_at=? WHERE id=? AND lease_owner=?`,
      )
      .bind(...values, new Date().toISOString(), job.id, leaseOwner)
      .run();
  try {
    const group = await configuredGroup(db, workspace, job.company);
    if (!group || groupKey(group) !== job.group_key) {
      await update("status='cancelled',lease_until=0");
      return;
    }
    for (let pass = 0; pass < 3; pass++) {
      const active = await db
        .prepare(
          "SELECT id FROM whatsapp_jobs WHERE id=? AND lease_owner=? AND status='running'",
        )
        .bind(job.id, leaseOwner)
        .first();
      if (!active) return;
      if (job.phase === "import") {
        // NULL preserves already running imports created before migration 0008.
        const ranges: ImportRange[] = job.import_ranges === null
          ? [{ since: job.since, until: job.until_at }]
          : JSON.parse(job.import_ranges);
        const range = ranges[0];
        if (!range) {
          job.phase = "summary";
          await update("phase='summary'");
          continue;
        }
        const rows = await fetchMessagePage(env, group, {
          since: range.since,
          until: range.until,
          at: job.cursor_at,
          id: job.cursor_id,
        });
        // Ten rows use 80 parameters and reduce D1 query count per invocation.
        for (let i = 0; i < rows.length; i += 10) {
          const chunk = rows.slice(i, i + 10);
          await db
            .prepare(
              `INSERT INTO whatsapp_messages(workspace_id,company,group_key,id,at,day,sender,text) SELECT * FROM (VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?)").join(",")}) WHERE EXISTS (SELECT 1 FROM whatsapp_jobs WHERE id=? AND lease_owner=? AND status='running') ON CONFLICT(workspace_id,company,group_key,id) DO UPDATE SET at=excluded.at,day=excluded.day,sender=excluded.sender,text=excluded.text`,
            )
            .bind(
              ...chunk.flatMap((m) => [
                workspace,
                job.company,
                job.group_key,
                m.id,
                new Date(m.at).toISOString(),
                dayOf(m.at),
                m.from,
                m.text,
              ]),
              job.id,
              leaseOwner,
            )
            .run();
        }
        const last = rows.at(-1);
        job.cursor_at = last?.at ?? job.cursor_at;
        job.cursor_id = last?.id ?? job.cursor_id;
        if (rows.length < 100) {
          ranges.shift();
          job.cursor_at = null;
          job.cursor_id = null;
        }
        job.import_ranges = JSON.stringify(ranges);
        job.phase = ranges.length === 0 ? "summary" : "import";
        await update(
          "cursor_at=?,cursor_id=?,phase=?,imported=imported+?,import_ranges=?",
          job.cursor_at,
          job.cursor_id,
          job.phase,
          rows.length,
          job.import_ranges,
        );
      } else {
        if (!aiEnabled(env) || !aiConfigured(env)) {
          await update(
            "status='pending',lease_until=0,error='Mensagens importadas. Aguardando configuração da IA.'",
          );
          return;
        }
        const cursor = job.summary_cursor
          ? (JSON.parse(job.summary_cursor) as { at: string; id: string })
          : null;
        const rows: {
          id: string;
          at: string;
          day: string;
          sender: string;
          text: string;
        }[] = (
          await db
            .prepare(
              "SELECT id,at,day,sender,text FROM whatsapp_messages WHERE workspace_id=? AND company=? AND group_key=? AND at>=? AND at<=? AND (at>? OR (at=? AND id>?)) ORDER BY at,id LIMIT 100",
            )
            .bind(
              workspace,
              job.company,
              job.group_key,
              job.since,
              job.until_at,
              cursor?.at ?? "",
              cursor?.at ?? "",
              cursor?.id ?? "",
            )
            .all<{
              id: string;
              at: string;
              day: string;
              sender: string;
              text: string;
            }>()
        ).results;
        if (!rows.length) {
          await update("status='complete',lease_until=0,error=NULL");
          return;
        }
        // Each part belongs to a single local day and carries the exact source IDs.
        const part: {
          id: string;
          at: string;
          day: string;
          sender: string;
          text: string;
        }[] = [];
        let chars = 0;
        for (const row of rows) {
          if (row.day !== rows[0].day) break;
          const size = JSON.stringify(row).length;
          if (chars + size > 75000) break;
          part.push(row);
          chars += size;
        }
        if (!part.length)
          throw new Error(
            "Mensagem maior que o limite de análise; revise o conteúdo na base.",
          );
        await generateInsight(db, env, {
          workspace,
          company: job.company,
          kind: "whatsapp",
          sourceId: `${job.group_key}|${part[0].day}|${part[0].id}`,
          title: `WhatsApp · ${group.name || group.id} · ${part[0].day} · ${part.length} mensagens`,
          text: JSON.stringify(part),
          evidence: part.map((m) => m.id),
          job: { id: job.id, owner: leaseOwner },
        });
        const last = part.at(-1)!;
        job.summary_cursor = JSON.stringify({ at: last.at, id: last.id });
        await update("summary_cursor=?,error=NULL", job.summary_cursor);
      }
    }
    await update("status='pending',lease_until=0,error=NULL,attempts=0");
  } catch (error) {
    // Error strings originate from our adapters, never provider response bodies.
    await update(
      "status=?,lease_until=?,attempts=attempts+1,error=?",
      job.attempts >= 2 ? "failed" : "pending",
      Date.now() + 300_000,
      error instanceof Error
        ? error.message
        : "Não foi possível atualizar o grupo.",
    );
  }
}
