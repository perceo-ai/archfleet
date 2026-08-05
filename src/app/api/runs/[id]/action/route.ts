import { getDb } from "@/lib/fleet/db/db";
import { retryRun, cancelRun, getRun } from "@/lib/fleet/db/runs-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/runs/:id/action — human-takeover actions. Body: { action: "retry" | "resume" | "cancel" }.
// retry/resume re-queue a failed/paused/canceled run; cancel stops a queued/running/paused run.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const db = getDb();

  let ok = false;
  if (action === "retry" || action === "resume") ok = retryRun(db, id);
  else if (action === "cancel") ok = cancelRun(db, id);
  else return Response.json({ error: "action must be retry, resume or cancel" }, { status: 400 });

  if (!ok) return Response.json({ error: "run not in a state for this action" }, { status: 409 });
  return Response.json(getRun(db, id));
}
