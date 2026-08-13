import { getDb } from "@/lib/fleet/db/db";
import { getTakeover, resolveTakeover } from "@/lib/fleet/db/takeovers-repo";
import { cancelRun, retryRun } from "@/lib/fleet/db/runs-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/takeovers/:id/resolve — the operator finished (or abandoned) the manual
// step. Body: { operatorNotes?, action?: "resume" | "cancel" }. "resume" re-queues
// the paused run; "cancel" stops it; omitted = just close the takeover.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const takeover = getTakeover(db, id);
  if (!takeover) return Response.json({ error: "takeover not found" }, { status: 404 });
  const { operatorNotes, action } = (await req.json().catch(() => ({}))) as {
    operatorNotes?: string;
    action?: "resume" | "cancel";
  };
  const ok = resolveTakeover(db, id, { operatorNotes });
  if (!ok) return Response.json({ error: "takeover already resolved" }, { status: 409 });
  if (action === "resume") retryRun(db, takeover.runId);
  else if (action === "cancel") cancelRun(db, takeover.runId);
  return Response.json(getTakeover(db, id));
}
