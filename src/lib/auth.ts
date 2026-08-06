// Minimal single-operator access control. When CUF_AUTH_TOKEN is set, every
// request must present it (cookie `cuf_auth` or `Authorization: Bearer …`). When
// unset, auth is disabled (local dev). Pure helpers so they're unit tested; the
// middleware wires them to requests.

export const AUTH_COOKIE = "cuf_auth";

/** Paths reachable without auth (login flow + static assets). */
export function isAuthExempt(path: string): boolean {
  return (
    path === "/login" ||
    path.startsWith("/api/auth") ||
    path.startsWith("/_next") ||
    path === "/favicon.ico"
  );
}

/** True if the request is authorized (or auth is disabled). */
export function authOk(
  expected: string | undefined,
  cookieVal?: string,
  authHeader?: string,
): boolean {
  if (!expected) return true; // auth disabled
  const fromHeader = authHeader?.replace(/^Bearer\s+/i, "").trim();
  const provided = cookieVal || fromHeader;
  return !!provided && provided === expected;
}
