import { getServerEnv } from "@/server/context";
import { logoutGoogle } from "@/server/google-login";

export async function POST(request: Request) {
  return logoutGoogle(request, await getServerEnv());
}
