import { problem } from "@/server/context";
import { googleGuard } from "@/server/google-route";

/** Scheduling must persist the client-scoped meeting intent before sending invitations. */
export async function POST(request: Request) {
  const ctx = await googleGuard(request);
  if ("error" in ctx) return ctx.error;
  return problem(410, "Use a operação de criação de reunião com o cliente e os participantes para enviar convites.");
}
