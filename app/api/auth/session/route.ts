import { env } from "cloudflare:workers";
import { currentSession, ensureAuthSchema, isAdminUser } from "../../../auth-google";

export async function GET(request: Request) {
  if (!env.DB) return Response.json({ user: null });
  await ensureAuthSchema(env.DB);
  const user = await currentSession(request, env.DB);
  return Response.json({ user, isAdmin: user ? await isAdminUser(env.DB, user.email, env as unknown as Parameters<typeof isAdminUser>[2]) : false });
}
