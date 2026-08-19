import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { getRun, pauseRunIfActive, saveRun, setRunStatus } from "./runs-repo";
import type { RunStatus } from "../types";

function dbWithRun(status: RunStatus) {
  const db = openDb(":memory:");
  saveRun(db, {
    id: "r1",
    workflowId: "wf",
    workflowName: "wf",
    status,
    startedAt: "2026-08-12T00:00:00Z",
    events: [],
  });
  return db;
}

describe("pauseRunIfActive", () => {
  it("pauses a run that is still in flight, recording why", () => {
    for (const status of ["running", "queued"] as RunStatus[]) {
      const db = dbWithRun(status);
      expect(pauseRunIfActive(db, "r1", "Which PO?")).toBe(true);
      const run = getRun(db, "r1");
      expect(run?.status).toBe("paused");
      expect(run?.pausedReason).toBe("Which PO?");
      db.close();
    }
  });

  it("refuses to drag a settled run back to paused", () => {
    for (const status of ["succeeded", "failed", "canceled"] as RunStatus[]) {
      const db = dbWithRun(status);
      expect(pauseRunIfActive(db, "r1", "too late")).toBe(false);
      expect(getRun(db, "r1")?.status).toBe(status);
      db.close();
    }
  });

  it("is a no-op on a run that already paused, so the first reason survives", () => {
    const db = dbWithRun("running");
    expect(pauseRunIfActive(db, "r1", "first question")).toBe(true);
    expect(pauseRunIfActive(db, "r1", "second question")).toBe(false);
    expect(getRun(db, "r1")?.pausedReason).toBe("first question");
    db.close();
  });

  it("loses the race the way the ask route depends on", () => {
    // The route reads the run, then pauses. If the worker settles in between,
    // the conditional update must fail so no takeover is opened.
    const db = dbWithRun("running");
    const asSeenByTheRoute = getRun(db, "r1");
    expect(asSeenByTheRoute?.status).toBe("running");
    setRunStatus(db, "r1", "succeeded", "2026-08-12T00:01:00Z");
    expect(pauseRunIfActive(db, "r1", "Which PO?")).toBe(false);
    expect(getRun(db, "r1")?.status).toBe("succeeded");
    db.close();
  });

  it("does nothing for a run that does not exist", () => {
    const db = openDb(":memory:");
    expect(pauseRunIfActive(db, "ghost", "hello")).toBe(false);
    db.close();
  });
});
