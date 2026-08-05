import { getDb } from "@/lib/fleet/db/db";
import { processPendingRuns } from "@/lib/fleet/server-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Long-running: allow up to 5 min per drain (Vercel default fn timeout).
export const maxDuration = 300;

// POST /api/runs/process — execute queued runs. Call from an external scheduler
// when self-hosting without the always-on worker loop (e.g. a platform cron).
export async function POST() {
  const processed = await processPendingRuns(getDb());
  return Response.json({ processed });
}