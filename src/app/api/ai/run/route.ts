import {
  aiConfigured,
  aiEnabled,
  aiGatewayProvider,
  type AiEnv,
} from "@/server/ai/gateway";
import {
  dailySummarySystem,
  meetingExtractionSystem,
  signalClassifierSystem,
  taskAssistantSystem,
  taskAssistantUser,
  weeklyReportSystem,
  type AssistantProfile,
} from "@/server/ai/prompts";
import { insightPermission } from "@/server/insight-context";
import { authenticate } from "@/server/auth";
import { json, problem, workspaceOf } from "@/server/context";
import { apiRoute } from "@/server/route";

type RunBody =
  | {
      kind: "task_assistant";
      profile: AssistantProfile;
      input: Parameters<typeof taskAssistantUser>[0];
    }
  | { kind: "meeting_extract"; notes: string }
  | { kind: "classify_signals"; prompt: string }
  | { kind: "daily_summary"; prompt: string }
  | { kind: "weekly_report"; data: unknown };

const MAX_INPUT = 8000;

/**
 * Single entry point for AI runs. Disabled until AI_ENABLED=true and the
 * gateway is configured; every run is recorded in `ai_runs` without its content.
 */
export function POST(request: Request) {
  return apiRoute(request, async (env) => {
  const ai = env as unknown as AiEnv;
  if (!aiEnabled(ai)) return problem(503, "IA desligada neste workspace.");
  if (!aiConfigured(ai)) return problem(503, "AI Gateway não configurado.");
  const user = await authenticate(request, env);
  if (!user) return problem(401, "Faça login para continuar.");
  let body: RunBody & { company?: string };
  try {
    body = (await request.json()) as RunBody & { company?: string };
  } catch {
    return problem(400, "Corpo inválido.");
  }
  if (!body || typeof body.company !== "string" || !env.DB)
    return problem(400, "Informe o cliente para esta análise.");
  if (
    !(await insightPermission(
      env.DB,
      workspaceOf(env),
      user.email,
      body.company,
      "ia.analisar",
    ))
  )
    return problem(
      403,
      "Seu nível de acesso não permite analisar este cliente.",
    );
  let system = "";
  let userText = "";
  try {
    switch (body.kind) {
      case "task_assistant":
        system = taskAssistantSystem(body.profile);
        userText = taskAssistantUser(body.input);
        break;
      case "meeting_extract":
        system = meetingExtractionSystem;
        userText = `Notas da reunião:\n${body.notes}`;
        break;
      case "classify_signals":
        system = signalClassifierSystem;
        userText = body.prompt;
        break;
      case "daily_summary":
        system = dailySummarySystem;
        userText = body.prompt;
        break;
      case "weekly_report":
        system = weeklyReportSystem;
        userText = JSON.stringify(body.data).slice(0, MAX_INPUT);
        break;
      default:
        return problem(400, "Tipo de execução desconhecido.");
    }
  } catch {
    return problem(400, "Entrada de análise inválida.");
  }
  if (typeof userText !== "string")
    return problem(400, "Entrada de análise inválida.");
  if (userText.length > MAX_INPUT)
    return problem(413, `Entrada maior que ${MAX_INPUT} caracteres.`);
  const provider = aiGatewayProvider(ai);
  const started = Date.now();
  const id = `ai-${crypto.randomUUID()}`;
  try {
    const result = await provider.complete({
      system,
      messages: [{ role: "user", content: userText }],
    });
    await record(env.DB, workspaceOf(env), {
      id,
      kind: body.kind,
      by: user.email,
      model: result.model,
      status: "ok",
      inputChars: userText.length,
      outputChars: result.text.length,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      ms: Date.now() - started,
    });
    return json({
      id,
      text: result.text,
      model: result.model,
      usage: result.usage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na IA.";
    await record(env.DB, workspaceOf(env), {
      id,
      kind: body.kind,
      by: user.email,
      model: provider.model,
      status: "error",
      inputChars: userText.length,
      outputChars: 0,
      ms: Date.now() - started,
      error: message,
    });
    return problem(502, message);
  }
  });
}

async function record(
  db: D1Database | undefined,
  workspace: string,
  run: {
    id: string;
    kind: string;
    by: string;
    model: string;
    status: "ok" | "error";
    inputChars: number;
    outputChars: number;
    inputTokens?: number;
    outputTokens?: number;
    ms: number;
    error?: string;
  },
) {
  if (!db) return;
  try {
    await db
      .prepare(
        "INSERT INTO ai_runs (id, workspace_id, kind, requested_by, model, status, input_chars, output_chars, input_tokens, output_tokens, duration_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        run.id,
        workspace,
        run.kind,
        run.by,
        run.model,
        run.status,
        run.inputChars,
        run.outputChars,
        run.inputTokens ?? null,
        run.outputTokens ?? null,
        run.ms,
        run.error ?? null,
      )
      .run();
  } catch {
    // Recording never blocks the answer.
  }
}
