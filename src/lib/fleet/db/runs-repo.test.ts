import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import {
  appendRunArtifact,
  appendRunEvent,
  getRun,
  listRuns,
  saveRun,
  setRunOutcome,
  setRunProgress,
} from "./runs-repo";
import type { WorkflowRun } from "../types";

function run(id: string, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id,
    workflowId: "wf1",
    workflowName: "Portal Login Check",
    status: "succeeded",
    vmId: "vm1",
    startedAt: "2026-08-04T16:10:00.000Z",
    finishedAt: "2026-08-04T16:10:12.000Z",
    events: [
      { id: `${id}_e0`, level: "info", message: "assigned", timestamp: "2026-08-04T16:10:00.000Z" },
      { id: `${id}_e1`, level: "info", message: "done", timestamp: "2026-08-04T16:10:12.000Z" },
    ],
    artifacts: [
      { id: `${id}_a0`, runId: id, nodeId: "task1", type: "file", path: "shot.png", createdAt: "2026-08-04T16:10:11.000Z" },
    ],
    ...overrides,
  };
}

describe("runs repo", () => {
  it("saves and reads back a run with events + artifacts", () => {
    const db = openDb(":memory:");
    saveRun(db, run("r1"));
    const got = getRun(db, "r1");
    expect(got?.status).toBe("succeeded");
    expect(got?.events).toHaveLength(2);
    expect(got?.events[0].message).toBe("assigned"); // seq order preserved
    expect(got?.artifacts).toHaveLength(1);
    expect(got?.artifacts?.[0].path).toBe("shot.png");
    db.close();
  });

  it("returns undefined for a missing run", () => {
    const db = openDb(":memory:");
    expect(getRun(db, "nope")).toBeUndefined();
    db.close();
  });

  it("lists runs newest-first", () => {
    const db = openDb(":memory:");
    saveRun(db, run("r1", { startedAt: "2026-08-04T10:00:00.000Z" }));
    saveRun(db, run("r2", { startedAt: "2026-08-04T12:00:00.000Z" }));
    const ids = listRuns(db).map((r) => r.id);
    expect(ids).toEqual(["r2", "r1"]);
    db.close();
  });

  it("retry re-queues a failed/paused run; cancel stops it", async () => {
    const { retryRun, cancelRun } = await import("./runs-repo");
    const db = openDb(":memory:");
    saveRun(db, run("r1", { status: "paused", finishedAt: "2026-08-05T00:00:00Z" }));
    expect(retryRun(db, "r1")).toBe(true);
    expect(getRun(db, "r1")?.status).toBe("queued");
    // cancel a queued run
    expect(cancelRun(db, "r1")).toBe(true);
    expect(getRun(db, "r1")?.status).toBe("canceled");
    // retry a canceled run works; retrying a succeeded run does not
    expect(retryRun(db, "r1")).toBe(true);
    saveRun(db, run("r2", { status: "succeeded" }));
    expect(retryRun(db, "r2")).toBe(false);
    db.close();
  });

  it("upserts on repeated save (status transition)", () => {
    const db = openDb(":memory:");
    saveRun(db, run("r1", { status: "queued", events: [], artifacts: [] }));
    saveRun(db, run("r1", { status: "succeeded" }));
    expect(getRun(db, "r1")?.status).toBe("succeeded");
    expect(listRuns(db)).toHaveLength(1);
    db.close();
  });

  it("repeated save preserves params_json and attempts", () => {
    const db = openDb(":memory:");
    saveRun(db, run("r1", { status: "queued", events: [], artifacts: [] }));
    db.prepare("UPDATE cuf_runs SET params_json=?, attempts=2 WHERE id='r1'").run('{"user":"a"}');
    saveRun(db, run("r1", { status: "succeeded" }));
    const row = db.prepare("SELECT params_json, attempts FROM cuf_runs WHERE id='r1'").get() as {
      params_json: string;
      attempts: number;
    };
    expect(row).toEqual({ params_json: '{"user":"a"}', attempts: 2 });
    db.close();
  });

  it("round-trips automation linkage and progress fields", () => {
    const db = openDb(":memory:");
    saveRun(
      db,
      run("r1", {
        status: "paused",
        automationId: "auto_1",
        environmentId: "env_1",
        triggerSource: "manual",
        currentStep: "Manual login",
        pausedReason: "Waiting for MFA",
        resultSummary: undefined,
      }),
    );
    const got = getRun(db, "r1");
    expect(got?.automationId).toBe("auto_1");
    expect(got?.environmentId).toBe("env_1");
    expect(got?.triggerSource).toBe("manual");
    expect(got?.currentStep).toBe("Manual login");
    expect(got?.pausedReason).toBe("Waiting for MFA");
    const summary = listRuns(db)[0];
    expect(summary.automationId).toBe("auto_1");
    expect(summary.currentStep).toBe("Manual login");
    db.close();
  });

  it("setRunProgress and setRunOutcome update in place", () => {
    const db = openDb(":memory:");
    saveRun(db, run("r1", { status: "running", events: [], artifacts: [] }));
    setRunProgress(db, "r1", "Open portal");
    expect(getRun(db, "r1")?.currentStep).toBe("Open portal");
    setRunOutcome(db, "r1", { resultSummary: "succeeded — all steps done", pausedReason: null });
    const got = getRun(db, "r1");
    expect(got?.resultSummary).toBe("succeeded — all steps done");
    expect(got?.pausedReason).toBeUndefined();
    db.close();
  });

  it("appends events and artifacts incrementally, idempotent with final save", () => {
    const db = openDb(":memory:");
    saveRun(db, run("r1", { status: "running", events: [], artifacts: [] }));
    appendRunEvent(db, "r1", { id: "r1_e0", level: "info", message: "assigned", timestamp: "2026-08-04T16:10:00.000Z" }, 0);
    appendRunEvent(db, "r1", { id: "r1_e1", level: "info", message: "done", timestamp: "2026-08-04T16:10:12.000Z" }, 1);
    appendRunArtifact(db, { id: "r1_a0", runId: "r1", nodeId: "task1", type: "file", path: "shot.png", createdAt: "2026-08-04T16:10:11.000Z" });
    const live = getRun(db, "r1");
    expect(live?.events.map((e) => e.message)).toEqual(["assigned", "done"]);
    expect(live?.artifacts?.[0].path).toBe("shot.png");
    // Final saveRun re-writes the same ids — no duplicates.
    saveRun(db, run("r1", { status: "succeeded", events: [
      { id: "r1_e0", level: "info", message: "assigned", timestamp: "2026-08-04T16:10:00.000Z" },
      { id: "r1_e1", level: "info", message: "done", timestamp: "2026-08-04T16:10:12.000Z" },
    ], artifacts: [
      { id: "r1_a0", runId: "r1", nodeId: "task1", type: "file", path: "shot.png", createdAt: "2026-08-04T16:10:11.000Z" },
    ] }));
    const final = getRun(db, "r1");
    expect(final?.events).toHaveLength(2);
    expect(final?.artifacts).toHaveLength(1);
    db.close();
  });

  it("filters runs by automation and status", () => {
    const db = openDb(":memory:");
    saveRun(db, run("r1", { automationId: "auto_1", status: "failed", startedAt: "2026-08-04T10:00:00Z" }));
    saveRun(db, run("r2", { automationId: "auto_2", status: "succeeded", startedAt: "2026-08-04T11:00:00Z" }));
    saveRun(db, run("r3", { automationId: "auto_1", status: "running", startedAt: "2026-08-04T12:00:00Z" }));
    expect(listRuns(db, 50, { automationId: "auto_1" }).map((r) => r.id)).toEqual(["r3", "r1"]);
    expect(listRuns(db, 50, { statuses: ["failed", "running"] }).map((r) => r.id)).toEqual(["r3", "r1"]);
    db.close();
  });
});
