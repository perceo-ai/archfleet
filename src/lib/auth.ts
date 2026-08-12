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
  if (cookieVal && cookieVal === expected) return true; // legacy token cookie
  return Boolean(await verifySession(expected, cookieVal));
}

export function sessionCookie(value: string, maxAge = 604800): string {
  return `${AUTH_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
