import { env } from "cloudflare:workers";
import { authConfig, callbackUrl, cookie, signedState, STATE_COOKIE } from "../../../auth-google";

export async function GET(request: Request) {
  try {
    const config = authConfig(env as unknown as Parameters<typeof authConfig>[0]);
    const url = new URL(request.url);
    const state = await signedState(url.searchParams.get("returnTo") || "/", config.secret);
    const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    google.searchParams.set("client_id", config.clientId);
    google.searchParams.set("redirect_uri", callbackUrl(request, env as unknown as Parameters<typeof authConfig>[0]));
    google.searchParams.set("response_type", "code");
    google.searchParams.set("scope", "openid email profile");
    google.searchParams.set("state", state);
    const headers = new Headers({ Location: google.toString() });
    headers.append("Set-Cookie", cookie(STATE_COOKIE, state, 600, url.protocol === "https:"));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to start Google login." }, { status: 500 });
  }
}
