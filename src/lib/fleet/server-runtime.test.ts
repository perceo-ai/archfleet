import { describe, expect, it } from "vitest";
import { seedFleetState } from "./seed";
import { executeManualRun } from "./server-runtime";

describe("executeManualRun (real assembly)", () => {
  it("queues when no domain-bound VM is configured (no infra)", async () => {
    // Seed VMs have no libvirt domain and no CUF_GOLDEN_DOMAIN env is set here,
    // so the daemon has nothing to acquire and never shells out to virsh/ssh.
    const state = seedFleetState();
    let n = 0;
    const run = await executeManualRun(state, state.workflows[0], () => `t${n++}`);
    expect(run.status).toBe("queued");
    expect(run.events.some((e) => e.message.includes("no_matching_vm"))).toBe(true);
  });
});
