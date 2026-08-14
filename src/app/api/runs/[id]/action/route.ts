import { getDb, type Db } from "@/lib/fleet/db/db";
import { retryRun, cancelRun, getRun } from "@/lib/fleet/db/runs-repo";
import { getOpenTakeoverForRun, resolveTakeover } from "@/lib/fleet/db/takeovers-repo";
import { getWorkflow, saveWorkflow } from "@/lib/fleet/db/workflows-repo";
import { findNodeByName, insertTakeoverBefore, nodeAfter } from "@/lib/fleet/workflow-edit";
import { seedFleetState } from "@/lib/fleet/seed";
import type { WorkflowRun } from "@/lib/fleet/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function workflowForRun(db: Db, run: WorkflowRun) {
  return (
    getWorkflow(db, run.workflowId) ??
    seedFleetState().workflows.find((w) => w.id === run.workflowId)
  );
}

/** Merge `__resumeFrom` into (or clear it from) the run's stored params. The
 * worker consumes it as the traversal start node on the next attempt. */
function setResumeFrom(db: Db, runId: string, nodeId: string | undefined): void {
  const row = db.prepare("SELECT params_json FROM cuf_runs WHERE id=?").get(runId) as
    | { params_json: string }
    | undefined;
  const params = JSON.parse(row?.params_json || "{}") as Record<string, unknown>;
  if (nodeId) params.__resumeFrom = nodeId;
  else delete params.__resumeFrom;
  db.prepare("UPDATE cuf_runs SET params_json=? WHERE id=?").run(JSON.stringify(params), runId);
}

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

  let ok = false;
  if (action === "retry") {
    setResumeFrom(db, id, undefined);
    ok = retryRun(db, id);
  } else if (action === "retry_from_step") {
    const workflow = run.currentStep ? workflowForRun(db, run) : undefined;
    const node = workflow ? findNodeByName(workflow, run.currentStep) : undefined;
    if (!node) {
      return Response.json({ error: "cannot find the failed step in the workflow" }, { status: 409 });
    }
    setResumeFrom(db, id, node.id);
    ok = retryRun(db, id);
  } else if (action === "resume") {
    // Resuming a run paused at a human_takeover step must not re-run the pause
    // node — continue from its success edge. Pauses raised by the guest mid-task
    // (needs_human) re-run the same step instead, so nothing is skipped.
    const workflow = workflowForRun(db, run);
    const pausedNode = workflow ? findNodeByName(workflow, run.currentStep) : undefined;
    const next =
      workflow && pausedNode?.type === "human_takeover" ? nodeAfter(workflow, pausedNode.id) : pausedNode;
    setResumeFrom(db, id, next?.id);
    ok = retryRun(db, id);
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
