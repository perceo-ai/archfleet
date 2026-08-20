import { describe, expect, it } from "vitest";
import { openDb } from "./db/db";
import { saveRun, getRun } from "./db/runs-repo";
import { saveWorkflow } from "./db/workflows-repo";
import { resumeRunAfterPause, setResumeFrom } from "./run-resume";
import type { Workflow } from "./types";

const workflow: Workflow = {
  id: "wf",
  name: "wf",
  description: "",
  enabled: true,
  triggerKinds: ["manual"],
  nodes: [
    { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
    { id: "ask", type: "human_takeover", name: "Ask a human", position: { x: 0, y: 1 }, config: {} },
    { id: "after", type: "shell_task", name: "After the ask", position: { x: 0, y: 2 }, config: {} },
    { id: "guest", type: "computer_use_task", name: "Do the thing", position: { x: 0, y: 3 }, config: {} },
    { id: "end", type: "end", name: "Done", position: { x: 0, y: 4 }, config: {} },
  ],
  edges: [
    { id: "e1", from: "start", to: "ask", condition: "success" },
    { id: "e2", from: "ask", to: "after", condition: "success" },
    { id: "e3", from: "after", to: "guest", condition: "success" },
    { id: "e4", from: "guest", to: "end", condition: "success" },
  ],
};

function pausedAt(step: string) {
  const db = openDb(":memory:");
  saveWorkflow(db, workflow);
  saveRun(db, {
    id: "r1",
    workflowId: "wf",
    workflowName: "wf",
    status: "paused",
    startedAt: "2026-08-12T00:00:00Z",
    currentStep: step,
    events: [],
  });
  return db;
}

const checkpoint = (db: ReturnType<typeof openDb>) =>
  JSON.parse(
    (db.prepare("SELECT params_json FROM cuf_runs WHERE id=?").get("r1") as { params_json: string })
      .params_json || "{}",
  ).__resumeFrom;

describe("resumeRunAfterPause", () => {
  it("continues after an answered question, instead of asking it again", () => {
    // The bug this exists for: a bare re-queue re-ran the takeover node, so
    // answering put the same question straight back in the inbox.
    const db = pausedAt("Ask a human");
    expect(resumeRunAfterPause(db, "r1")).toBe(true);
    expect(getRun(db, "r1")?.status).toBe("queued");
    expect(checkpoint(db)).toBe("after");
    db.close();
  });

  it("re-runs the same step when the guest paused mid-task", () => {
    // Nothing about that step completed, so skipping it would lose work.
    const db = pausedAt("Do the thing");
    expect(resumeRunAfterPause(db, "r1")).toBe(true);
    expect(checkpoint(db)).toBe("guest");
    db.close();
  });

  it("writes the checkpoint after re-queuing, never before", () => {
    // retryRun clears any stored checkpoint; the wrong order silently restarts.
    const db = pausedAt("Ask a human");
    setResumeFrom(db, "r1", "stale-node");
    resumeRunAfterPause(db, "r1");
    expect(checkpoint(db)).toBe("after");
    db.close();
  });

  it("refuses a run that is not paused", () => {
    const db = pausedAt("Ask a human");
    db.prepare("UPDATE cuf_runs SET status='succeeded' WHERE id=?").run("r1");
    expect(resumeRunAfterPause(db, "r1")).toBe(false);
    db.close();
  });

  it("still re-queues when the paused step is no longer in the workflow", () => {
    const db = pausedAt("A step that was deleted");
    expect(resumeRunAfterPause(db, "r1")).toBe(true);
    expect(getRun(db, "r1")?.status).toBe("queued");
    expect(checkpoint(db)).toBeUndefined(); // start from the top
    db.close();
  });

  it("does nothing for an unknown run", () => {
    const db = openDb(":memory:");
    expect(resumeRunAfterPause(db, "ghost")).toBe(false);
    db.close();
  });
});
