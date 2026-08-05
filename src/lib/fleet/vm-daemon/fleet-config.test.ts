import { describe, expect, it } from "vitest";
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
});
