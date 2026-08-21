import { env } from "cloudflare:workers";
import { authConfig, callbackUrl, cookie, createSession, ensureAuthSchema, readCookie, safeReturnTo, STATE_COOKIE, verifyState, SESSION_COOKIE } from "../../../../auth-google";

export async function GET(request: Request) {
  try {
    const runtime = env as unknown as Parameters<typeof authConfig>[0];
    const config = authConfig(runtime);
    const url = new URL(request.url);
    const state = url.searchParams.get("state") || "";
    const expectedState = readCookie(request, STATE_COOKIE);
    const verified = expectedState && state === expectedState ? await verifyState(state, config.secret) : null;
    if (!verified) return Response.json({ error: "Google login state expired or was invalid." }, { status: 400 });
    const code = url.searchParams.get("code");
    if (!code) return Response.json({ error: url.searchParams.get("error_description") || "Google did not return an authorization code." }, { status: 400 });
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: callbackUrl(request, runtime), grant_type: "authorization_code" }) });
    const tokenPayload = await tokenResponse.json() as { access_token?: string; error?: string };
    if (!tokenResponse.ok || !tokenPayload.access_token) return Response.json({ error: tokenPayload.error || "Google token exchange failed." }, { status: 502 });
    const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokenPayload.access_token}` } });
    const user = await userResponse.json() as { sub?: string; email?: string; name?: string; picture?: string };
    if (!userResponse.ok || !user.sub || !user.email) return Response.json({ error: "Google did not return a valid user profile." }, { status: 502 });
    if (!env.DB) throw new Error("Production planning database is unavailable.");
    await ensureAuthSchema(env.DB);
    const session = await createSession(env.DB, { id: user.sub, email: user.email, name: user.name || user.email, picture: user.picture });
    const headers = new Headers({ Location: safeReturnTo(verified.returnTo) });
    headers.append("Set-Cookie", cookie(SESSION_COOKIE, session, 7 * 24 * 60 * 60, url.protocol === "https:"));
    headers.append("Set-Cookie", cookie(STATE_COOKIE, "", 0, url.protocol === "https:"));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to complete Google login." }, { status: 500 });
  }
}
