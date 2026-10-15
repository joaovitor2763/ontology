import { getServerEnv } from '@/server/context';
import { mcpResponse } from '@/server/operations/mcp';
async function handle(request: Request) { return mcpResponse(request, await getServerEnv()); }
export { handle as GET, handle as POST, handle as DELETE };
