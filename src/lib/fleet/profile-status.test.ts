import { describe, expect, it, vi } from "vitest";
import { checkProfileFleet } from "./profile-status";
import type { VirshClient } from "./vm-daemon/virsh";
import type { FleetVm } from "./types";

function vm(id: string, profile: string, snapshot = "golden-warm"): FleetVm {
  return {
    id,
    name: id,
    status: "idle",
    labels: ["browser", `profile:${profile}`],
    cpu: 0,
    memoryGb: 4,
    diskGb: 25,
    xrdp: { host: "127.0.0.1", port: 13389, username: "agent", credentialSource: "env:AGENT_PASSWORD" },
    ssh: { host: "127.0.0.1", port: 10022, username: "agent" },
    lastHealthAt: "",
    domain: id,
    warmSnapshot: snapshot,
  };
}

describe("checkProfileFleet", () => {
  it("reports profile VM readiness and missing snapshots", async () => {
    const client = {
      domainState: vi.fn(async (domain: string) => (domain === "bank-2" ? "shut off" : "running")),
      listSnapshots: vi.fn(async (domain: string) => (domain === "bank-2" ? [] : ["golden-warm"])),
    } as unknown as VirshClient;

    const status = await checkProfileFleet([vm("bank-1", "bank"), vm("bank-2", "bank")], client);

    expect(status.profiles.bank.ready).toBe(false);
    expect(status.profiles.bank.vms[0]).toMatchObject({ domain: "bank-1", ready: true });
    expect(status.profiles.bank.vms[1]).toMatchObject({
      domain: "bank-2",
      ready: false,
      snapshotPresent: false,
    });
  });
});
