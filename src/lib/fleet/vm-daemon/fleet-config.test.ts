import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realVmsFromEnv } from "./fleet-config";

describe("realVmsFromEnv", () => {
  it("returns no real VMs when no golden domain is configured", () => {
    expect(realVmsFromEnv({})).toEqual([]);
  });

  it("builds a domain-bound VM with distinct ssh + xrdp ports", () => {
    const vms = realVmsFromEnv({
      CUF_GOLDEN_DOMAIN: "cuf-golden",
      CUF_GUEST_SSH_PORT: "10022",
      CUF_GUEST_RDP_PORT: "13389",
      AGENT_USER: "agent",
    });
    expect(vms).toHaveLength(1);
    const vm = vms[0];
    expect(vm.domain).toBe("cuf-golden");
    expect(vm.warmSnapshot).toBe("golden-warm");
    expect(vm.ssh).toEqual({ host: "127.0.0.1", port: 10022, username: "agent" });
    expect(vm.xrdp.port).toBe(13389);
    expect(vm.labels).toEqual(["linux-desktop", "browser"]);
  });

  it("parses custom labels", () => {
    const vms = realVmsFromEnv({ CUF_GOLDEN_DOMAIN: "d", CUF_GOLDEN_LABELS: "browser, gpu ,office" });
    expect(vms[0].labels).toEqual(["browser", "gpu", "office"]);
  });

  it("builds a multi-VM fleet from CUF_FLEET_JSON with distinct ports/domains", () => {
    const vms = realVmsFromEnv({
      CUF_FLEET_JSON: JSON.stringify([
        { domain: "vm-a", sshPort: 10022, rdpPort: 13389, labels: ["browser"] },
        { domain: "vm-b", sshPort: 10023, rdpPort: 13390, labels: "gpu,office", host: "10.0.0.2" },
      ]),
    });
    expect(vms).toHaveLength(2);
    expect(vms[0].domain).toBe("vm-a");
    expect(vms[1].ssh).toEqual({ host: "10.0.0.2", port: 10023, username: "agent" });
    expect(vms[1].labels).toEqual(["gpu", "office"]);
  });

  it("labels manually prepared profile clones for workflow targeting", () => {
    const vms = realVmsFromEnv({
      CUF_FLEET_JSON: JSON.stringify([
        { domain: "cuf-bank-1", profile: "bank", sshPort: 11022, rdpPort: 14389 },
      ]),
    });

    expect(vms[0].name).toBe("bank / cuf-bank-1");
    expect(vms[0].labels).toEqual(["linux-desktop", "browser", "profile:bank"]);
  });

  it("does not duplicate an explicit profile label", () => {
    const vms = realVmsFromEnv({
      CUF_FLEET_JSON: JSON.stringify([
        { domain: "cuf-bank-1", profile: "bank", labels: ["browser", "profile:bank"] },
      ]),
    });

    expect(vms[0].labels).toEqual(["browser", "profile:bank"]);
  });

  it("de-dupes overlapping shorthand + JSON by domain", () => {
    const vms = realVmsFromEnv({
      CUF_GOLDEN_DOMAIN: "cuf-golden",
      CUF_FLEET_JSON: JSON.stringify([{ domain: "cuf-golden" }, { domain: "extra" }]),
    });
    expect(vms.map((v) => v.domain).sort()).toEqual(["cuf-golden", "extra"]);
  });

  it("ignores malformed CUF_FLEET_JSON", () => {
    expect(realVmsFromEnv({ CUF_FLEET_JSON: "not json" })).toEqual([]);
  });

  it("loads a prepared profile fleet from CUF_FLEET_JSON_FILE", () => {
    const dir = mkdtempSync(join(tmpdir(), "archfleet-fleet-"));
    try {
      const file = join(dir, "bank.fleet.json");
      writeFileSync(file, JSON.stringify([{ domain: "cuf-bank-1", profile: "bank", sshPort: 11022 }]));

      const vms = realVmsFromEnv({ CUF_FLEET_JSON_FILE: file });

      expect(vms).toHaveLength(1);
      expect(vms[0].domain).toBe("cuf-bank-1");
      expect(vms[0].labels).toContain("profile:bank");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores a missing CUF_FLEET_JSON_FILE", () => {
    expect(realVmsFromEnv({ CUF_FLEET_JSON_FILE: "/does/not/exist.json" })).toEqual([]);
  });
});
