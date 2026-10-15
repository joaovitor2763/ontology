import { getServerEnv } from '@/server/context';
import { apiResponse } from '@/server/operations/http';
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return apiResponse(request, await getServerEnv(), (await context.params).path);
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
