import { env } from "cloudflare:workers";
import { currentSession, ensureAuthSchema, isAdminUser } from "../../auth-google";

async function requireAdmin(request: Request) {
  if (!env.DB) throw new Error("Production planning database is unavailable.");
  await ensureAuthSchema(env.DB);
  const session = await currentSession(request, env.DB);
  if (!session || !(await isAdminUser(env.DB, session.email, env as unknown as Parameters<typeof isAdminUser>[2]))) return null;
  return session;
}

export async function GET(request: Request) {
  try {
    if (!await requireAdmin(request)) return Response.json({ error: "Administrator access required." }, { status: 403 });
    const result = await env.DB!.prepare("SELECT email, name, role, active, created_at FROM auth_users ORDER BY name").all();
    return Response.json({ users: result.results ?? [] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load users." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!await requireAdmin(request)) return Response.json({ error: "Administrator access required." }, { status: 403 });
    const body = await request.json() as { name?: string; email?: string; role?: string };
    const name = body.name?.trim();
    const email = body.email?.trim().toLowerCase();
    if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Valid name and email are required." }, { status: 400 });
    const role = body.role === "admin" ? "admin" : "user";
    await env.DB!.prepare(`INSERT INTO auth_users (email, name, role, active) VALUES (?, ?, ?, 1)
      ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = excluded.role, active = 1, updated_at = CURRENT_TIMESTAMP`)
      .bind(email, name, role).run();
    return Response.json({ saved: true, user: { email, name, role, active: 1 } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save user." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireAdmin(request);
    if (!session) return Response.json({ error: "Administrator access required." }, { status: 403 });
    const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase();
    if (!email || email === session.email.toLowerCase()) return Response.json({ error: "You cannot remove your own account." }, { status: 400 });
    await env.DB!.prepare("DELETE FROM auth_users WHERE email = ?").bind(email).run();
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to remove user." }, { status: 500 });
  }
}
