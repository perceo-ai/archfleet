import { AUTH_COOKIE, createApiBearerToken, verifySession, type AuthRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authSecret(): string | undefined {
  return process.env.CUF_AUTH_SECRET || process.env.CUF_AUTH_TOKEN;
}

async function requireAdmin(req: Request): Promise<Response | undefined> {
  const raw = req.headers.get("cookie")?.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))?.[1];
  const session = await verifySession(authSecret(), raw ? decodeURIComponent(raw) : undefined);
  if (session?.role === "admin") return undefined;
  return Response.json({ error: "admin required" }, { status: 403 });
}

function roleOf(value: unknown): AuthRole {
  return value === "admin" || value === "viewer" ? value : "operator";
}

// POST /api/tokens — create a signed bearer token, shown once.
export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const secret = authSecret();
  if (!secret) return Response.json({ error: "auth secret is not configured" }, { status: 500 });
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    role?: string;
    ttlDays?: number;
  };
  const ttlDays = Math.max(1, Math.min(365, Number(body.ttlDays ?? 90)));
  return Response.json(
    await createApiBearerToken(secret, {
      name: body.name ?? "api-token",
      role: roleOf(body.role),
      ttlSeconds: ttlDays * 24 * 60 * 60,
    }),
    { status: 201 },
  );
}
