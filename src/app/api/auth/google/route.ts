import { getServerEnv } from "@/server/context";
import { startGoogleLogin } from "@/server/google-login";

export async function GET(request: Request) {
  return startGoogleLogin(request, await getServerEnv());
}
