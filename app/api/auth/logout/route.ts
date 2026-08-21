import { env } from "cloudflare:workers";
import { cookie, ensureAuthSchema, readCookie, sessionHash, SESSION_COOKIE } from "../../../auth-google";

export async function GET(request: Request) {
  if (env.DB) {
    await ensureAuthSchema(env.DB);
    const session = readCookie(request, SESSION_COOKIE);
    if (session) await env.DB.prepare("DELETE FROM auth_sessions WHERE session_hash = ?").bind(await sessionHash(session)).run();
  }
  const headers = new Headers({ Location: "/" });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}
