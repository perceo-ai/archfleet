import { AUTH_COOKIE, verifySession } from "@/lib/auth";
import { getDb } from "@/lib/fleet/db/db";
import { createUser, deleteUser, listUsers } from "@/lib/fleet/db/users-repo";

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

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  return Response.json(listUsers(getDb()));
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    displayName?: string;
    role?: string;
  };
  try {
    const user = createUser(getDb(), {
      username: body.username ?? "",
      password: body.password ?? "",
      displayName: body.displayName,
      role: body.role,
    });
    return Response.json(user, { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  try {
    return Response.json({ ok: deleteUser(getDb(), id) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
