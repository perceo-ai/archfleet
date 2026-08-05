import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { getRun, listRuns, saveRun } from "./runs-repo";
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

  it("upserts on repeated save (status transition)", () => {
    const db = openDb(":memory:");
    saveRun(db, run("r1", { status: "queued", events: [], artifacts: [] }));
    saveRun(db, run("r1", { status: "succeeded" }));
    expect(getRun(db, "r1")?.status).toBe("succeeded");
    expect(listRuns(db)).toHaveLength(1);
    db.close();
  });
});
