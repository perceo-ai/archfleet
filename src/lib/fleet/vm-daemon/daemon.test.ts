import { describe, expect, it, vi } from "vitest";
import type { FleetVm } from "../types";
import type { DomainState, VirshClient } from "./virsh";
import { createVmDaemon, mapDomainState } from "./daemon";

function vm(id: string, opts: Partial<FleetVm> = {}): FleetVm {
  return {
    id,
    name: id,
    status: "idle",
    labels: ["linux-desktop", "browser"],
    cpu: 10,
    memoryGb: 4,
    diskGb: 25,
    xrdp: { host: "127.0.0.1", port: 13389, username: "agent", credentialSource: "secret:vm_pw" },
    lastHealthAt: "2026-08-04T16:00:00.000Z",
    domain: `dom-${id}`,
    warmSnapshot: "golden-warm",
    ...opts,
  };
}

/** Fake VirshClient with per-domain canned states and recorded reverts. */
function fakeClient(states: Record<string, DomainState> = {}): VirshClient & { reverts: string[][] } {
  const reverts: string[][] = [];
  return {
    reverts,
    isReachable: vi.fn(async () => true),
    listDomains: vi.fn(async () => Object.keys(states)),
    domainState: vi.fn(async (name: string) => states[name] ?? "running"),
    start: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    revertSnapshot: vi.fn(async (name: string, snap: string) => {
      reverts.push([name, snap]);
    }),
    listSnapshots: vi.fn(async () => ["golden-warm"]),
  };
}

describe("mapDomainState", () => {
  it("running + unassigned -> idle, running + assigned -> assigned", () => {
    expect(mapDomainState("running", false)).toBe("idle");
    expect(mapDomainState("running", true)).toBe("assigned");
  });
  it("dead/missing states -> unhealthy", () => {
    expect(mapDomainState("absent", false)).toBe("unhealthy");
    expect(mapDomainState("crashed", false)).toBe("unhealthy");
  });
});

describe("vm daemon acquire", () => {
  it("reverts the warm snapshot and assigns a label-matching VM", async () => {
    const client = fakeClient({ "dom-a": "running" });
    const daemon = createVmDaemon(client, [vm("a")]);
    const res = await daemon.acquire({ requiredLabels: ["browser"], runId: "run_1" });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.vm.id).toBe("a");
      expect(res.vm.status).toBe("assigned");
      expect(res.vm.assignedRunId).toBe("run_1");
    }
    expect(client.reverts).toEqual([["dom-a", "golden-warm"]]);
  });

  it("waits for SSH readiness before assigning a real VM", async () => {
    const client = fakeClient({ "dom-a": "running" });
    const waitForTcp = vi.fn(async () => {});
    const daemon = createVmDaemon(
      client,
      [vm("a", { ssh: { host: "127.0.0.1", port: 10022, username: "agent" } })],
      { waitForTcp, readyTimeoutMs: 1234, readyIntervalMs: 25 },
    );

    const res = await daemon.acquire({ requiredLabels: [], runId: "run_1" });

    expect(res.ok).toBe(true);
    expect(waitForTcp).toHaveBeenCalledWith("127.0.0.1", 10022, 1234, 25);
  });

  it("returns reset_failed when SSH readiness times out", async () => {
    const client = fakeClient({ "dom-a": "running" });
    const daemon = createVmDaemon(
      client,
      [vm("a", { ssh: { host: "127.0.0.1", port: 10022, username: "agent" } })],
      { waitForTcp: vi.fn(async () => { throw new Error("not ready"); }) },
    );

    const res = await daemon.acquire({ requiredLabels: [], runId: "run_1" });

    expect(res).toEqual({ ok: false, reason: "reset_failed", detail: "Error: not ready" });
  });

  it("returns no_matching_vm when labels do not match", async () => {
    const client = fakeClient({ "dom-a": "running" });
    const daemon = createVmDaemon(client, [vm("a", { labels: ["linux-desktop"] })]);
    const res = await daemon.acquire({ requiredLabels: ["gpu"], runId: "run_1" });
    expect(res).toEqual({ ok: false, reason: "no_matching_vm" });
  });

  it("does not hand the same VM to two runs", async () => {
    const client = fakeClient({ "dom-a": "running" });
    const daemon = createVmDaemon(client, [vm("a")]);
    await daemon.acquire({ requiredLabels: [], runId: "run_1" });
    const second = await daemon.acquire({ requiredLabels: [], runId: "run_2" });
    expect(second).toEqual({ ok: false, reason: "no_matching_vm" });
  });

  it("skips an unhealthy candidate and uses the next healthy one", async () => {
    const client = fakeClient({ "dom-a": "crashed", "dom-b": "running" });
    const daemon = createVmDaemon(client, [vm("a"), vm("b")]);
    const res = await daemon.acquire({ requiredLabels: [], runId: "run_1" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.vm.id).toBe("b");
    expect(client.reverts).toEqual([["dom-b", "golden-warm"]]);
  });

  it("ignores mock VMs that have no libvirt domain", async () => {
    const client = fakeClient();
    const daemon = createVmDaemon(client, [vm("a", { domain: undefined })]);
    expect(daemon.managedVms()).toHaveLength(0);
    const res = await daemon.acquire({ requiredLabels: [], runId: "run_1" });
    expect(res).toEqual({ ok: false, reason: "no_matching_vm" });
  });
});

describe("vm daemon release + health", () => {
  it("release frees the VM and reverts to a clean snapshot", async () => {
    const client = fakeClient({ "dom-a": "running" });
    const daemon = createVmDaemon(client, [vm("a")]);
    const res = await daemon.acquire({ requiredLabels: [], runId: "run_1" });
    if (!res.ok) throw new Error("acquire failed");
    await daemon.release(res.vm);
    expect(daemon.isAssigned(res.vm)).toBe(false);
    // one revert on acquire + one on release
    expect(client.reverts).toHaveLength(2);
  });

  it("health reflects assignment state", async () => {
    const client = fakeClient({ "dom-a": "running" });
    const daemon = createVmDaemon(client, [vm("a")]);
    expect(await daemon.health(vm("a"))).toBe("idle");
    await daemon.acquire({ requiredLabels: [], runId: "run_1" });
    expect(await daemon.health(vm("a"))).toBe("assigned");
  });
});
