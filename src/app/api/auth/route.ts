import { AUTH_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth { token } — set the session cookie when the token matches
// CUF_AUTH_TOKEN. DELETE clears it (logout).
export async function POST(req: Request) {
  const expected = process.env.CUF_AUTH_TOKEN;
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  if (!expected) return Response.json({ ok: true, note: "auth disabled" });
  if (!token || token !== expected) {
    return Response.json({ error: "invalid token" }, { status: 401 });
  }
  const res = Response.json({ ok: true });
  res.headers.set(
    "set-cookie",
    `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
  );
  return res;
}

export async function DELETE() {
  const res = Response.json({ ok: true });
  res.headers.set("set-cookie", `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
}
