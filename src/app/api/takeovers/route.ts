import { getDb } from "@/lib/fleet/db/db";
import { listTakeovers } from "@/lib/fleet/db/takeovers-repo";
import type { TakeoverStatus } from "@/lib/fleet/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/takeovers?status=open — human takeover requests, newest first.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  return Response.json(listTakeovers(getDb(), { status: status as TakeoverStatus | undefined }));
}
