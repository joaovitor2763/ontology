/** OpenAI Responses through the existing Cloudflare gateway; credentials stay server-side. */
export type AiMessage = { role: "user" | "assistant"; content: string };
export type AiRequest = {
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
  temperature?: number;
};
export type AiUsage = { inputTokens?: number; outputTokens?: number };
export type AiResult = { text: string; model: string; usage: AiUsage };
export interface AiProvider {
  readonly model: string;
  complete(request: AiRequest): Promise<AiResult>;
}
export type AiEnv = {
  AI_ENABLED?: string;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  AI_GATEWAY_TOKEN?: string;
  AI_GATEWAY_KEY_ALIAS?: string;
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
};
export function aiEnabled(env: AiEnv) {
  return env.AI_ENABLED === "true";
}
export function aiConfigured(env: AiEnv) {
  return Boolean(
    env.AI_GATEWAY_ACCOUNT_ID &&
    env.AI_GATEWAY_ID &&
    (env.AI_GATEWAY_TOKEN || env.OPENAI_API_KEY),
  );
}
export function aiStatus(env: AiEnv) {
  return {
    enabled: aiEnabled(env),
    configured: aiConfigured(env),
    provider: env.AI_PROVIDER || "openai",
    model: env.AI_MODEL || "gpt-5.6-luna",
    gateway: env.AI_GATEWAY_ID || null,
  };
}
export function aiGatewayProvider(env: AiEnv): AiProvider {
  const model = env.AI_MODEL || "gpt-5.6-luna";
  return {
    model,
    async complete(request) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "cf-aig-skip-cache": "true",
        "cf-aig-collect-log": "false",
      };
      if (env.AI_GATEWAY_TOKEN)
        headers["cf-aig-authorization"] = `Bearer ${env.AI_GATEWAY_TOKEN}`;
      if (env.AI_GATEWAY_KEY_ALIAS)
        headers["cf-aig-byok-alias"] = env.AI_GATEWAY_KEY_ALIAS;
      if (env.OPENAI_API_KEY)
        headers.authorization = `Bearer ${env.OPENAI_API_KEY}`;
      const response = await fetch(
        `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/openai/responses`,
        {
          method: "POST",
          headers,
          signal: AbortSignal.timeout(90_000),
          body: JSON.stringify({
            model,
            instructions: request.system,
            input: request.messages,
            max_output_tokens: request.maxTokens ?? 4000,
            reasoning: { effort: "low" },
            store: false,
          }),
        },
      );
      // Provider errors may echo input or credentials: never return their body to a client/log.
      if (!response.ok)
        throw new Error(
          `Não foi possível executar a análise (AI Gateway ${response.status}).`,
        );
      const body = (await response.json()) as {
        status?: string;
        model?: string;
        output?: {
          type?: string;
          content?: { type: string; text?: string }[];
        }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      if (body.status !== "completed")
        throw new Error("A análise não foi concluída. Tente um período menor.");
      const text = (body.output ?? [])
        .filter((p) => p.type === "message")
        .flatMap((p) => p.content ?? [])
        .filter((p) => p.type === "output_text")
        .map((p) => p.text ?? "")
        .join("\n")
        .trim();
      if (!text) throw new Error("A IA não devolveu uma análise válida.");
      return {
        text,
        model: body.model ?? model,
        usage: {
          inputTokens: body.usage?.input_tokens,
          outputTokens: body.usage?.output_tokens,
        },
      };
    },
  };
}
