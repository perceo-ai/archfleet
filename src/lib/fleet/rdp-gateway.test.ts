import { describe, expect, it, vi } from "vitest";
import type { FleetVm } from "./types";
import { buildRdpUri, createRdpLaunch, isGuacamoleConfigured, resolveCredential } from "./rdp-gateway";

function vm(): FleetVm {
  return {
    id: "vm1",
    name: "desktop",
    status: "idle",
    labels: ["linux-desktop"],
    cpu: 2,
    memoryGb: 4,
    diskGb: 25,
    xrdp: {
      host: "host.docker.internal",
      port: 13389,
      username: "agent",
      credentialSource: "env:AGENT_PASSWORD",
    },
    lastHealthAt: "",
  };
}

describe("rdp gateway", () => {
  it("resolves env-backed XRDP credentials", () => {
    expect(resolveCredential("env:AGENT_PASSWORD", { AGENT_PASSWORD: "pw" })).toBe("pw");
    expect(resolveCredential("secret:vm", { AGENT_PASSWORD: "pw" })).toBeUndefined();
  });

  it("builds a Guacamole QuickConnect RDP URI", () => {
    expect(buildRdpUri(vm(), "p@ss word")).toBe(
      "rdp://agent:p%40ss%20word@host.docker.internal:13389/?ignore-cert=true&disable-audio=true&security=any",
    );
  });

  it("falls back to .rdp when Guacamole is not configured", async () => {
    await expect(createRdpLaunch(vm(), { env: {}, downloadUrl: "/api/vms/vm1/rdp" })).resolves.toEqual({
      mode: "rdp_file",
      downloadUrl: "/api/vms/vm1/rdp",
      reason: "CUF_GUACAMOLE_URL is not configured",
    });
  });

  it("creates a Guacamole launch URL through the token and quickconnect APIs", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ authToken: "tok" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ identifier: "qc-1" }), { status: 200 }));

    const launch = await createRdpLaunch(vm(), {
      fetchImpl,
      downloadUrl: "/api/vms/vm1/rdp",
      env: {
        CUF_GUACAMOLE_URL: "http://guac/guacamole/",
        CUF_GUACAMOLE_PUBLIC_URL: "http://192.168.68.110:8080/guacamole",
        CUF_GUACAMOLE_USERNAME: "guacadmin",
        CUF_GUACAMOLE_PASSWORD: "adminpw",
        AGENT_PASSWORD: "agentpw",
      },
    });

    expect(isGuacamoleConfigured({
      CUF_GUACAMOLE_URL: "x",
      CUF_GUACAMOLE_USERNAME: "u",
      CUF_GUACAMOLE_PASSWORD: "p",
    })).toBe(true);
    expect(launch).toEqual({
      mode: "guacamole",
      launchUrl: "http://192.168.68.110:8080/guacamole/#/client/qc-1?token=tok",
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://guac/guacamole/api/session/ext/quickconnect/create?token=tok",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
