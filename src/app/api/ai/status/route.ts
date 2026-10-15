import { aiStatus } from "@/server/ai/gateway";
import { getServerEnv, json } from "@/server/context";

/** Whether AI is configured and enabled for this workspace. Never returns secrets. */
export async function GET() {
  const env = await getServerEnv();
  return json(aiStatus(env as Parameters<typeof aiStatus>[0]));
}
