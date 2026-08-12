import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { ensureSeeded } from "./init-db";
import { saveVm, listVms } from "./vms-repo";
import { listWorkflows } from "./workflows-repo";

describe("ensureSeeded", () => {
  it("seeds workflows into an empty db and is idempotent", () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    const first = listWorkflows(db).length;
    expect(first).toBeGreaterThan(0);
    ensureSeeded(db); // second call must not duplicate
    expect(listWorkflows(db)).toHaveLength(first);
    db.close();
  });

  it("does not seed demo VMs and removes old demo VM rows", () => {
    const db = openDb(":memory:");
    saveVm(db, {
      id: "vm_ubuntu_1",
      name: "ubuntu-desktop-01",
      status: "idle",
      labels: ["linux-desktop", "browser"],
      cpu: 0,
      memoryGb: 0,
      diskGb: 0,
      xrdp: { host: "127.0.0.1", port: 3391, username: "agent", credentialSource: "env:AGENT_PASSWORD" },
      lastHealthAt: "t",
    });
    ensureSeeded(db);
    expect(listVms(db).map((vm) => vm.id)).not.toContain("vm_ubuntu_1");
    expect(listVms(db)).toEqual([]);
    db.close();
  });
});
