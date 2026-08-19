export const AUTH_COOKIE = "cuf_auth";

export type AuthRole = "admin" | "operator" | "viewer";

export type AuthSession = {
  sub: string;
  username: string;
  role: AuthRole;
  exp: number;
};

/** Paths reachable without auth (login flow + static assets). */
export function isAuthExempt(path: string): boolean {
  return (
    path === "/login" ||
    path.startsWith("/api/auth") ||
    path.startsWith("/_next") ||
    path === "/favicon.ico"
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeJson(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as T;
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToBase64Url(new Uint8Array(sig));
}

export async function signSession(secret: string, session: AuthSession): Promise<string> {
  const payload = encodeJson(session);
  return `v1.${payload}.${await hmac(secret, payload)}`;
}

export async function verifySession(
  secret: string | undefined,
  cookieVal?: string,
): Promise<AuthSession | undefined> {
  if (!secret || !cookieVal?.startsWith("v1.")) return undefined;
  const [, payload, sig] = cookieVal.split(".");
  if (!payload || !sig) return undefined;
  if ((await hmac(secret, payload)) !== sig) return undefined;
  const session = decodeJson<AuthSession>(payload);
  if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) return undefined;
  return session;
}

/** True if the request is authorized (or auth is disabled). */
export async function authOk(
  expected: string | undefined,
  cookieVal?: string,
  authHeader?: string,
): Promise<boolean> {
  if (!expected) return true; // auth disabled
  const fromHeader = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (fromHeader && fromHeader === expected) return true;
  if (fromHeader && (await verifySession(expected, fromHeader))) return true;
  if (cookieVal && cookieVal === expected) return true; // legacy token cookie
  return Boolean(await verifySession(expected, cookieVal));
}

/** The signing secret, or undefined when auth is switched off entirely. */
export function authSecretFromEnv(): string | undefined {
  return process.env.CUF_AUTH_SECRET || process.env.CUF_AUTH_TOKEN;
}

/** The caller's session, from an API bearer token or the browser cookie. */
export async function sessionFromRequest(req: Request): Promise<AuthSession | undefined> {
  const secret = authSecretFromEnv();
  if (!secret) return undefined;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const fromHeader = bearer ? await verifySession(secret, bearer) : undefined;
  if (fromHeader) return fromHeader;
  const raw = req.headers.get("cookie")?.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))?.[1];
  return verifySession(secret, raw ? decodeURIComponent(raw) : undefined);
}

/** Gate a route on the caller's role. Returns a Response to send when the call
 * is not allowed, or undefined to proceed.
 *
 * `whenDisabled` decides what happens with no secret configured: "allow" keeps
 * the single-user/dev posture the proxy already has, "deny" keeps a surface
 * locked even then. */
export async function requireRole(
  req: Request,
  allowed: AuthRole[],
  whenDisabled: "allow" | "deny" = "allow",
): Promise<Response | undefined> {
  if (!authSecretFromEnv()) {
    return whenDisabled === "allow"
      ? undefined
      : Response.json({ error: "authentication is not configured" }, { status: 403 });
  }
  const session = await sessionFromRequest(req);
  if (!session) return Response.json({ error: "sign in required" }, { status: 401 });
  if (!allowed.includes(session.role)) {
    return Response.json(
      { error: `${allowed.join(" or ")} required — you are ${session.role}` },
      { status: 403 },
    );
  }
  return undefined;
}

export function sessionCookie(value: string, maxAge = 604800): string {
  return `${AUTH_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function createApiBearerToken(
  secret: string,
  input: { name: string; role: AuthRole; ttlSeconds?: number },
): Promise<{ token: string; expiresAt: string }> {
  const ttl = input.ttlSeconds ?? 60 * 60 * 24 * 90;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const name = input.name.trim() || "api-token";
  return {
    token: await signSession(secret, {
      sub: `api:${name}:${crypto.randomUUID()}`,
      username: `token:${name}`,
      role: input.role,
      exp,
    }),
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}
