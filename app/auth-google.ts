type RuntimeEnv = {
  DB?: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_CALLBACK_URL?: string;
  AUTH_SECRET?: string;
};

const SESSION_COOKIE = "linepilot_session";
const STATE_COOKIE = "linepilot_oauth_state";
const encoder = new TextEncoder();

function toBase64Url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return atob(padded);
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function sha256(value: string) {
  return toBase64Url(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function sessionHash(value: string) {
  return sha256(value);
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function authConfig(runtime: RuntimeEnv) {
  if (!runtime.GOOGLE_CLIENT_ID || !runtime.GOOGLE_CLIENT_SECRET || !runtime.AUTH_SECRET) throw new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and AUTH_SECRET.");
  return { clientId: runtime.GOOGLE_CLIENT_ID, clientSecret: runtime.GOOGLE_CLIENT_SECRET, secret: runtime.AUTH_SECRET };
}

export function callbackUrl(request: Request, runtime: RuntimeEnv) {
  return runtime.GOOGLE_CALLBACK_URL || new URL("/api/auth/google/callback", request.url).toString();
}

export async function signedState(returnTo: string, secret: string) {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ nonce: randomToken(), returnTo: safeReturnTo(returnTo), expires: Date.now() + 10 * 60 * 1000 })));
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifyState(value: string, secret: string) {
  const [payload, signature] = value.split(".");
  if (!payload || !signature || (await hmac(payload, secret)) !== signature) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(payload)) as { returnTo?: string; expires?: number };
    return parsed.expires && parsed.expires > Date.now() ? { returnTo: safeReturnTo(parsed.returnTo || "/") } : null;
  } catch { return null; }
}

export function safeReturnTo(value: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function cookie(name: string, value: string, maxAge: number, secure = true) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax;${maxAge > 0 && secure ? " Secure;" : ""}`;
}

export function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") || "";
  const found = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

export async function ensureAuthSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (session_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL, picture TEXT, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
}

export async function createSession(db: D1Database, user: { id: string; email: string; name: string; picture?: string }) {
  const token = randomToken();
  await db.prepare("INSERT INTO auth_sessions (session_hash, user_id, email, name, picture, expires_at) VALUES (?, ?, ?, ?, ?, ?)").bind(await sha256(token), user.id, user.email, user.name, user.picture || null, Date.now() + 7 * 24 * 60 * 60 * 1000).run();
  return token;
}

export async function currentSession(request: Request, db: D1Database) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await db.prepare("SELECT user_id, email, name, picture, expires_at FROM auth_sessions WHERE session_hash = ?").bind(await sha256(token)).first<{ user_id: string; email: string; name: string; picture: string | null; expires_at: number }>();
  if (!row || row.expires_at <= Date.now()) return null;
  return { id: row.user_id, email: row.email, name: row.name, picture: row.picture };
}

export { SESSION_COOKIE, STATE_COOKIE };
