import { getDb } from "@/lib/fleet/db/db";
import { summarizeRunMetrics, type RunMetricsSummary } from "@/lib/fleet/db/run-metrics-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/health — liveness + DB reachability + queue depth, for hosting probes.
// Includes 24h run telemetry (queue wait / execution time) for operator surfaces.
export async function GET() {
  let dbOk = false;
  let queued = 0;
  let metrics: RunMetricsSummary | undefined;
  try {
    const db = getDb();
    db.prepare("SELECT 1").get();
    dbOk = true;
    queued = (db.prepare("SELECT COUNT(*) AS c FROM cuf_runs WHERE status='queued'").get() as { c: number }).c;
    metrics = summarizeRunMetrics(db, {
      sinceIso: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch {
    dbOk = false;
  }
  return Response.json(
    { status: dbOk ? "ok" : "degraded", db: dbOk, queuedRuns: queued, metrics, time: new Date().toISOString() },
    { status: dbOk ? 200 : 503 },
  );
}
