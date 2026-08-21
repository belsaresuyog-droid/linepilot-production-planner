import { env } from "cloudflare:workers";
import { currentSession, ensureAuthSchema } from "../../../auth-google";

export async function GET(request: Request) {
  if (!env.DB) return Response.json({ user: null });
  await ensureAuthSchema(env.DB);
  return Response.json({ user: await currentSession(request, env.DB) });
}
