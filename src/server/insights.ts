import {
  aiConfigured,
  aiEnabled,
  aiGatewayProvider,
  type AiEnv,
} from "./ai/gateway.ts";
import {
  insightSystem,
  parseInsight,
  type Insight,
} from "../modules/engagement/domain/insights.ts";
export type InsightGenerationResult = {
  id: string;
  reused: boolean;
  status: Insight["status"];
};
export async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export class InsightSourceChangedError extends Error {
  sourceHash: string;
  constructor(sourceHash: string) {
    super("O conteúdo mudou desde a análise anterior. Gerar uma nova análise com a fonte atual?");
    this.sourceHash = sourceHash;
  }
}
export const normalizedInsightText = (text: string) => text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").trim();
/** Dedupe includes exact source content. Accepted/dismissed results are never reset. */
export async function generateInsight(
  db: D1Database,
  env: AiEnv,
  input: {
    workspace: string;
    company: string;
    kind: "whatsapp" | "meeting";
    sourceId: string;
    title: string;
    text: string;
    evidence: string[];
    confirmedHash?: string;
    job?: { id: string; owner: string };
  },
  persist?: (statements:D1PreparedStatement[],result:InsightGenerationResult)=>Promise<void>,
): Promise<InsightGenerationResult> {
  if (!aiEnabled(env) || !aiConfigured(env))
    throw new Error("IA ainda não configurada neste ambiente.");
  if (!input.text.trim() || input.text.length > 80_000)
    throw new Error(
      "Use um trecho de até 80 mil caracteres para esta análise.",
    );
  const hash = await digest(normalizedInsightText(input.text));
  const exactHash = await digest(input.text);
  const findExisting = () => db
    .prepare(
      "SELECT id,status FROM ai_suggestions WHERE workspace_id=? AND company=? AND source_kind=? AND source_id=? AND source_hash IN (?,?)",
    )
    .bind(input.workspace, input.company, input.kind, input.sourceId, hash, exactHash)
    .first<{ id: string; status: Insight["status"] }>();
  const existing = await findExisting();
  if (existing) return { id: existing.id, reused: true, status: existing.status };
  if (input.kind === "meeting" && input.confirmedHash !== hash) {
    const prior = await db.prepare("SELECT id FROM ai_suggestions WHERE workspace_id=? AND company=? AND source_kind='meeting' AND source_id=? LIMIT 1")
      .bind(input.workspace, input.company, input.sourceId).first();
    if (prior) throw new InsightSourceChangedError(hash);
  }
  const id = `insight-${await digest([input.workspace, input.company, input.kind, input.sourceId, hash].join("\n"))}`;
  const leaseUntil = Date.now() + 180000;
  const lock = await db
    .prepare(
      "INSERT INTO ai_generation_locks(id,expires_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at WHERE ai_generation_locks.expires_at<? RETURNING id",
    )
    .bind(id, leaseUntil, Date.now())
    .first();
  if (!lock)
    throw new Error(
      "Esta análise já está em andamento. Aguarde alguns instantes.",
    );
  try {
    const completed = await findExisting();
    if (completed) return { id: completed.id, reused: true, status: completed.status };
    const started = Date.now();
    const result = await aiGatewayProvider(env).complete({
      system: insightSystem,
      messages: [{ role: "user", content: input.text }],
      maxTokens: 6000,
    });
    const body = JSON.stringify(parseInsight(result.text));
    const suggestion = db
      .prepare(
        `INSERT OR IGNORE INTO ai_suggestions (id,workspace_id,company,source_kind,source_id,source_hash,title,body,evidence,model,created_at,source_text) SELECT ?,?,?,?,?,?,?,?,?,?,?,? ${input.job ? "WHERE EXISTS (SELECT 1 FROM whatsapp_jobs WHERE id=? AND lease_owner=? AND status='running')" : ""}`,
      )
      .bind(
        id,
        input.workspace,
        input.company,
        input.kind,
        input.sourceId,
        hash,
        input.title,
        body,
        JSON.stringify(input.evidence),
        result.model,
        new Date().toISOString(),
        input.text,
        ...(input.job ? [input.job.id, input.job.owner] : []),
      );
    const run = db
      .prepare(
        "INSERT INTO ai_runs(id,workspace_id,kind,model,status,input_chars,output_chars,input_tokens,output_tokens,duration_ms) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        input.workspace,
        input.kind,
        result.model,
        "ok",
        input.text.length,
        result.text.length,
        result.usage.inputTokens ?? null,
        result.usage.outputTokens ?? null,
        Date.now() - started,
      );
    if(persist)await persist([suggestion,run],{id,reused:false,status:"pending"});
    else await db.batch([suggestion,run]);
    return { id, reused: false, status: "pending" };
  } finally {
    await db
      .prepare("DELETE FROM ai_generation_locks WHERE id=? AND expires_at=?")
      .bind(id, leaseUntil)
      .run();
  }
}
