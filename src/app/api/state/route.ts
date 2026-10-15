import { getServerEnv, getWaitUntil } from "@/server/context";
import { readStateBatch } from "@/server/operations/state-batch";

export async function GET(request: Request) {
  const [env, waitUntil] = await Promise.all([getServerEnv(), getWaitUntil()]);
  return readStateBatch(request, env, { waitUntil });
}
