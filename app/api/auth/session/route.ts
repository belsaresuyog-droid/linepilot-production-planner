import { env } from "cloudflare:workers";
import { currentSession, ensureAuthSchema, isAdminUser, userRole } from "../../../auth-google";

export async function GET(request: Request) {
  if (!env.DB) return Response.json({ user: null });
  await ensureAuthSchema(env.DB);
  const user = await currentSession(request, env.DB);
  const runtime = env as unknown as Parameters<typeof isAdminUser>[2];
  return Response.json({ user, isAdmin: user ? await isAdminUser(env.DB, user.email, runtime) : false, role: user ? await userRole(env.DB, user.email, runtime) : null });
}
