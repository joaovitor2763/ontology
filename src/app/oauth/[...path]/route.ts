import { getServerEnv } from "@/server/context";
import { oauthResponse } from "@/server/operations/oauth";
export async function GET(request: Request) { return oauthResponse(request, await getServerEnv()); }
export async function POST(request: Request) { return oauthResponse(request, await getServerEnv()); }
export async function OPTIONS(request: Request) { return oauthResponse(request, await getServerEnv()); }
