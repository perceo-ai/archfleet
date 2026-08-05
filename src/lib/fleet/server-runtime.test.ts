import { describe, expect, it } from "vitest";
import { seedFleetState } from "./seed";
import { executeManualRun } from "./server-runtime";
import { openDb } from "./db/db";
import { getRun } from "./db/runs-repo";

describe("executeManualRun (real assembly)", () => {
  it("queues when no domain-bound VM is configured, and persists the run", async () => {
    // Seed VMs have no libvirt domain and no CUF_GOLDEN_DOMAIN env is set here,
    // so the daemon has nothing to acquire and never shells out to virsh/ssh.
    const state = seedFleetState();
    const db = openDb(":memory:");
    let n = 0;
    const run = await executeManualRun(state, state.workflows[0], { now: () => `t${n++}`, db });
    expect(run.status).toBe("queued");
    expect(run.events.some((e) => e.message.includes("no_matching_vm"))).toBe(true);
    // persisted
    expect(getRun(db, run.id)?.status).toBe("queued");
    db.close();
  });
});
