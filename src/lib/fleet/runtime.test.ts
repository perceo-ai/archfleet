import { describe, expect, it } from "vitest";
import { seedFleetState } from "./seed";
import { createManualRun, getRunTimeline } from "./runtime";

describe("createManualRun", () => {
  it("assigns a matching idle VM and redacts secrets in log events", () => {
    const state = seedFleetState();
    const run = createManualRun({
      workflow: state.workflows[0],
      vms: state.vms,
      params: state.params,
      secrets: state.secrets,
    });

    expect(run.status).toBe("succeeded");
    expect(run.vmId).toBe("vm_ubuntu_1");
    expect(getRunTimeline(run).some((event) => event.message.includes("swordfish"))).toBe(false);
    expect(
      getRunTimeline(run).some((event) =>
        event.message.includes("[REDACTED:portal_password]"),
      ),
    ).toBe(true);
  });
});
