import { apiRoute } from "@/server/route";
import { fileResponse } from "@/server/operations/files";
async function handle(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return apiRoute(request, (env) => fileResponse(request, env, id));
}
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
