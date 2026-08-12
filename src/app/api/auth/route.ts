import { AUTH_COOKIE, sessionCookie, signSession, verifySession } from "@/lib/auth";
import { getDb } from "@/lib/fleet/db/db";
import { countUsers, getUserByUsername, verifyPassword } from "@/lib/fleet/db/users-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEEK_SECONDS = 60 * 60 * 24 * 7;

function authSecret(): string | undefined {
  return process.env.CUF_AUTH_SECRET || process.env.CUF_AUTH_TOKEN;
}

async function cookieFor(user: { id: string; username: string; role: "admin" | "operator" | "viewer" }) {
  const secret = authSecret();
  if (!secret) return undefined;
  return signSession(secret, {
    sub: user.id,
    username: user.username,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + WEEK_SECONDS,
  });
}

// GET /api/auth — current session metadata.
export async function GET(req: Request) {
  const raw = req.headers.get("cookie")?.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))?.[1];
  const session = await verifySession(authSecret(), raw ? decodeURIComponent(raw) : undefined);
  return Response.json({ user: session ? { username: session.username, role: session.role } : null });
}

// POST /api/auth { username,password } or bootstrap { token }.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    token?: string;
  };
  const secret = authSecret();
  if (!secret) return Response.json({ ok: true, note: "auth disabled" });

  if (body.token && body.token === process.env.CUF_AUTH_TOKEN) {
    const cookie = await signSession(secret, {
      sub: "bootstrap",
      username: "bootstrap-admin",
      role: "admin",
      exp: Math.floor(Date.now() / 1000) + WEEK_SECONDS,
    });
    const res = Response.json({ ok: true, user: { username: "bootstrap-admin", role: "admin" } });
    res.headers.set("set-cookie", sessionCookie(cookie, WEEK_SECONDS));
    return res;
  }

  const db = getDb();
  const userCount = countUsers(db);
  const user = body.username ? getUserByUsername(db, body.username) : undefined;
  if (!user || !body.password || !verifyPassword(body.password, user.passwordHash)) {
    return Response.json(
      {
        error:
          userCount === 0
            ? "no users yet; sign in once with the bootstrap token, then create users"
            : "invalid username or password",
      },
      { status: 401 },
    );
  }

  const cookie = await cookieFor(user);
  if (!cookie) return Response.json({ error: "auth secret is not configured" }, { status: 500 });
  const res = Response.json({ ok: true, user: { username: user.username, role: user.role } });
  res.headers.set("set-cookie", sessionCookie(cookie, WEEK_SECONDS));
  return res;
}

export async function DELETE() {
  const res = Response.json({ ok: true });
  res.headers.set("set-cookie", `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
}
