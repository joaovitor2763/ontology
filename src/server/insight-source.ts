import { getDoc } from "./db.ts";
import type { Meeting } from "../modules/engagement/domain/models.ts";

/** Called only after insight read authorization, always scoped to workspace + client. */
export async function insightSource(db: D1Database, files: R2Bucket | undefined, workspace: string, company: string, id: string) {
  const row = await db.prepare("SELECT source_kind,source_id,source_text,evidence FROM ai_suggestions WHERE id=? AND workspace_id=? AND company=?")
    .bind(id, workspace, company).first<{ source_kind: string; source_id: string; source_text: string | null; evidence: string }>();
  if (!row) return null;
  const refs = JSON.parse(row.evidence) as string[];
  const documentId = row.source_kind === "meeting" ? refs.find((ref) => ref.startsWith("up-")) : undefined;
  const label = row.source_kind === "whatsapp" ? "Mensagens usadas na análise" : documentId ? "Transcrição usada na análise" : "Notas usadas na análise";
  let text = row.source_text;
  let notice = "Conteúdo preservado no momento da análise.";
  if (text == null && documentId) {
    const file = await db.prepare("SELECT r2_key,size FROM files WHERE workspace_id=? AND id=? AND (company=? OR company IS NULL) AND status='ready'")
      .bind(workspace,documentId,company).first<{r2_key:string;size:number}>();
    const object = file && files && file.size <= 300_000 ? await files.get(file.r2_key) : null;
    text = object ? await object.text() : null;
    notice = "Arquivo original referenciado por esta análise.";
  } else if (text == null && row.source_kind === "whatsapp") {
    const group = row.source_id.split("|").slice(0, -2).join("|");
    const messages = await db.prepare("SELECT id,at,sender,text FROM whatsapp_messages WHERE workspace_id=? AND company=? AND group_key=? AND id IN (SELECT value FROM json_each(?)) ORDER BY at,id")
      .bind(workspace, company, group, row.evidence).all();
    text = messages.results.length ? JSON.stringify(messages.results) : null;
    notice = "Mensagens referenciadas disponíveis na base importada.";
  } else if (text == null) {
    const state = (await getDoc(db, workspace, "ontology.engagement.v2"))?.value as { notes?: Record<string, string>; extraMeetings?: Meeting[]; meetingEdits?: Record<string, Meeting> } | undefined;
    const meeting = state?.meetingEdits?.[row.source_id] ?? state?.extraMeetings?.find((m) => m.id === row.source_id && m.company === company);
    text = state?.notes?.[row.source_id] || meeting?.summary || null;
    notice = "Análise antiga sem cópia da fonte. Este é o texto atual da reunião e pode ter mudado.";
  }
  if (text && row.source_kind === "whatsapp") {
    try {
      const messages = JSON.parse(text) as { at: string; sender: string; text: string }[];
      text = messages.map((m) => `[${m.at}] ${m.sender}: ${m.text}`).join("\n\n");
    } catch { /* Keep the original text when its source is not a message array. */ }
  }
  return { label, text, notice, meetingId: row.source_kind === "meeting" ? row.source_id : undefined, documentId };
}
