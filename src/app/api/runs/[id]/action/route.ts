import { getDb } from "@/lib/fleet/db/db";
import { retryRun, cancelRun, getRun } from "@/lib/fleet/db/runs-repo";
import { getOpenTakeoverForRun, resolveTakeover } from "@/lib/fleet/db/takeovers-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/runs/:id/action — human-takeover actions.
// Body: { action: "retry" | "resume" | "cancel", operatorNotes?: string }.
// retry/resume re-queue a failed/paused/canceled run; cancel stops a queued/running/paused run.
// Any action settles the run's open takeover request (with optional operator notes).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action, operatorNotes } = (await req.json().catch(() => ({}))) as {
    action?: string;
    operatorNotes?: string;
  };
  const db = getDb();

  let ok = false;
  if (action === "retry" || action === "resume") ok = retryRun(db, id);
  else if (action === "cancel") ok = cancelRun(db, id);
  else return Response.json({ error: "action must be retry, resume or cancel" }, { status: 400 });

  if (!ok) return Response.json({ error: "run not in a state for this action" }, { status: 409 });
  const takeover = getOpenTakeoverForRun(db, id);
  if (takeover) resolveTakeover(db, takeover.id, { operatorNotes });
  return Response.json(getRun(db, id));
}
