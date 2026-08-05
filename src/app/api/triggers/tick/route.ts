import { getDb } from "@/lib/fleet/db/db";
import { makeTriggerExecute } from "@/lib/fleet/server-runtime";
import { runDueTriggers } from "@/lib/fleet/triggers/triggers-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/triggers/tick — fire all due schedule triggers. Call this on an
// interval from an external scheduler (system cron, /loop, or a Vercel Cron).
export async function POST() {
  const now = new Date().toISOString();
  const fired = await runDueTriggers(getDb(), now, makeTriggerExecute());
  return Response.json({ now, fired });
}
