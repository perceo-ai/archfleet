import { getDb } from "@/lib/fleet/db/db";
import { retryRun, cancelRun, getRun } from "@/lib/fleet/db/runs-repo";
import { getOpenTakeoverForRun, resolveTakeover } from "@/lib/fleet/db/takeovers-repo";
import { saveWorkflow } from "@/lib/fleet/db/workflows-repo";
import { findNodeByName, insertTakeoverBefore } from "@/lib/fleet/workflow-edit";
import { resumeRunAfterPause, setResumeFrom, workflowForRun } from "@/lib/fleet/run-resume";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/runs/:id/action — run recovery + takeover actions.
// Body: { action, operatorNotes? } with action one of:
//   retry            — re-queue from the start (clears any checkpoint)
//   retry_from_step  — re-queue from the step that failed (checkpoint retry)
//   resume           — after a takeover: continue from the step AFTER the pause point
//   add_takeover_point — insert a human-takeover step before the failed step
//   cancel           — stop a queued/running/paused run
// Any re-queue/cancel also settles the run's open takeover (with optional notes).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action, operatorNotes } = (await req.json().catch(() => ({}))) as {
    action?: string;
    operatorNotes?: string;
  };
  const db = getDb();
  const run = getRun(db, id);
  if (!run) return Response.json({ error: "run not found" }, { status: 404 });

  // retryRun always clears any stored checkpoint, so checkpoint-setting actions
  // requeue FIRST and then write `__resumeFrom` — never the other way around.
  let ok = false;
  if (action === "retry") {
    ok = retryRun(db, id);
  } else if (action === "retry_from_step") {
    const workflow = run.currentStep ? workflowForRun(db, run) : undefined;
    const node = workflow ? findNodeByName(workflow, run.currentStep) : undefined;
    if (!node) {
      return Response.json({ error: "cannot find the failed step in the workflow" }, { status: 409 });
    }
    ok = retryRun(db, id);
    if (ok) setResumeFrom(db, id, node.id);
  } else if (action === "resume") {
    ok = resumeRunAfterPause(db, id);
  } else if (action === "add_takeover_point") {
    const workflow = run.currentStep ? workflowForRun(db, run) : undefined;
    const node = workflow ? findNodeByName(workflow, run.currentStep) : undefined;
    const edited = workflow && node ? insertTakeoverBefore(workflow, node.id) : undefined;
    if (!edited) {
      return Response.json({ error: "cannot find the failed step in the workflow" }, { status: 409 });
    }
    saveWorkflow(db, edited);
    return Response.json({ ok: true, workflowId: edited.id });
  } else if (action === "cancel") {
    ok = cancelRun(db, id);
  } else {
    return Response.json(
      { error: "action must be retry, retry_from_step, resume, add_takeover_point or cancel" },
      { status: 400 },
    );
  }

  if (!ok) return Response.json({ error: "run not in a state for this action" }, { status: 409 });
  const takeover = getOpenTakeoverForRun(db, id);
  if (takeover) resolveTakeover(db, takeover.id, { operatorNotes });
  return Response.json(getRun(db, id));
}
