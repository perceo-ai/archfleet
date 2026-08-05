import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { getVm, listVms, saveVm } from "./vms-repo";
import type { FleetVm } from "../types";

function vm(id: string, over: Partial<FleetVm> = {}): FleetVm {
  return {
    id,
    name: id,
    status: "idle",
    labels: ["linux-desktop", "browser"],
    cpu: 0,
    memoryGb: 4,
    diskGb: 25,
    xrdp: { host: "127.0.0.1", port: 13389, username: "agent", credentialSource: "env:AGENT_PASSWORD" },
    ssh: { host: "127.0.0.1", port: 10022, username: "agent" },
    domain: `dom-${id}`,
    warmSnapshot: "golden-warm",
    lastHealthAt: "2026-08-05T00:00:00Z",
    ...over,
  };
}

describe("vms repo", () => {
  it("round-trips a VM with labels, ssh + xrdp + domain", () => {
    const db = openDb(":memory:");
    saveVm(db, vm("a"));
    const got = getVm(db, "a");
    expect(got?.labels).toEqual(["linux-desktop", "browser"]);
    expect(got?.ssh).toEqual({ host: "127.0.0.1", port: 10022, username: "agent" });
    expect(got?.xrdp.port).toBe(13389);
    expect(got?.domain).toBe("dom-a");
    expect(got?.warmSnapshot).toBe("golden-warm");
    db.close();
  });

  it("lists VMs and handles a mock VM without ssh/domain", () => {
    const db = openDb(":memory:");
    saveVm(db, vm("a"));
    saveVm(db, vm("b", { ssh: undefined, domain: undefined, warmSnapshot: undefined }));
    const all = listVms(db);
    expect(all).toHaveLength(2);
    const b = all.find((v) => v.id === "b");
    expect(b?.ssh).toBeUndefined();
    expect(b?.domain).toBeUndefined();
    db.close();
  });
});
