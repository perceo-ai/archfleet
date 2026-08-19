// Resuming a paused run, in one place.
//
// There are three doors into this — the run view's action endpoint, answering a
// takeover, and the MCP tool — and they must behave identically. When they did
// not, answering a question re-ran the whole workflow from the top and paused at
// the same question again.

import type { Db } from "./db/db";
import { getRun, retryRun } from "./db/runs-repo";
import { getWorkflow } from "./db/workflows-repo";
import { findNodeByName, nodeAfter } from "./workflow-edit";
import { seedFleetState } from "./seed";
import type { Workflow, WorkflowRun } from "./types";

export function workflowForRun(db: Db, run: WorkflowRun): Workflow | undefined {
  return (
    getWorkflow(db, run.workflowId) ?? seedFleetState().workflows.find((w) => w.id === run.workflowId)
  );
}

/** Merge `__resumeFrom` into (or clear it from) the run's stored params. The
 * worker consumes it as the traversal start node on the next attempt. */
export function setResumeFrom(db: Db, runId: string, nodeId: string | undefined): void {
  const row = db.prepare("SELECT params_json FROM cuf_runs WHERE id=?").get(runId) as
    | { params_json: string }
    | undefined;
  const params = JSON.parse(row?.params_json || "{}") as Record<string, unknown>;
  if (nodeId) params.__resumeFrom = nodeId;
  else delete params.__resumeFrom;
  db.prepare("UPDATE cuf_runs SET params_json=? WHERE id=?").run(JSON.stringify(params), runId);
}

/** Re-queue a paused run so it carries on *after* the step that paused it.
 *
 * A human_takeover node has been answered, so re-running it would just ask the
 * same question again — continue from its outgoing edge. A pause raised by the
 * guest mid-task (needs_human) re-runs the same step instead, because nothing
 * about it completed.
 *
 * Returns false when the run is not in a state to resume. `retryRun` clears any
 * stored checkpoint, so it must run before the checkpoint is written. */
export function resumeRunAfterPause(db: Db, runId: string): boolean {
  const run = getRun(db, runId);
  if (!run) return false;

  const workflow = workflowForRun(db, run);
  const pausedNode = workflow ? findNodeByName(workflow, run.currentStep) : undefined;
  const next =
    workflow && pausedNode?.type === "human_takeover" ? nodeAfter(workflow, pausedNode.id) : pausedNode;

  if (!retryRun(db, runId)) return false;
  setResumeFrom(db, runId, next?.id);
  return true;
}
