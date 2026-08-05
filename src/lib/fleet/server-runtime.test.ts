import { describe, expect, it } from "vitest";
import { seedFleetState } from "./seed";
import { executeManualRun, enqueueManualRun, processPendingRuns } from "./server-runtime";
import { openDb } from "./db/db";
import { getRun, listRuns } from "./db/runs-repo";
import { ensureSeeded } from "./db/init-db";

describe("executeManualRun (sync, real assembly)", () => {
  it("queues when no domain-bound VM is configured, and persists the run", async () => {
    const state = seedFleetState();
    const db = openDb(":memory:");
    let n = 0;
    const run = await executeManualRun(state, state.workflows[0], { now: () => `t${n++}`, db });
    expect(run.status).toBe("queued");
    expect(run.events.some((e) => e.message.includes("no_matching_vm"))).toBe(true);
    expect(getRun(db, run.id)?.status).toBe("queued");
    db.close();
  });
});

describe("async run queue", () => {
  it("enqueue persists a queued run immediately without executing", () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    let n = 0;
    const run = enqueueManualRun(undefined, { db, now: () => `t${n++}` });
    expect(run.status).toBe("queued");
    expect(getRun(db, run.id)?.status).toBe("queued");
    db.close();
  });

  it("processPendingRuns claims + executes queued runs (no VM -> stays queued/failed, terminal)", async () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    enqueueManualRun(undefined, { db });
    enqueueManualRun(undefined, { db });
    const processed = await processPendingRuns(db, 5);
    expect(processed).toBe(2);
    // no more queued left to claim after processing
    const again = await processPendingRuns(db, 5);
    expect(again).toBe(0);
    // both runs reached a terminal-ish persisted state
    expect(listRuns(db)).toHaveLength(2);
    db.close();
  });
});