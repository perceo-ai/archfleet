import { getDb } from "@/lib/fleet/db/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/health — liveness + DB reachability + queue depth, for hosting probes.
export async function GET() {
  let dbOk = false;
  let queued = 0;
  try {
    const db = getDb();
    db.prepare("SELECT 1").get();
    dbOk = true;
    queued = (db.prepare("SELECT COUNT(*) AS c FROM cuf_runs WHERE status='queued'").get() as { c: number }).c;
  } catch {
    dbOk = false;
  }
  return Response.json(
    { status: dbOk ? "ok" : "degraded", db: dbOk, queuedRuns: queued, time: new Date().toISOString() },
    { status: dbOk ? 200 : 503 },
  );
}
