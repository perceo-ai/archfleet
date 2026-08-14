import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { FleetOps } from "./FleetOps";
import { stubFetch } from "@/test/fetch-stub";

afterEach(() => vi.unstubAllGlobals());

describe("FleetOps", () => {
  it("shows VM capacity, statuses, and profile readiness", async () => {
    stubFetch({
      "/api/vms": [
        {
          id: "vm_1",
          name: "cuf-worker-1",
          status: "idle",
          labels: ["linux-desktop", "profile:portal"],
          cpu: 0,
          memoryGb: 0,
          diskGb: 0,
          xrdp: { host: "127.0.0.1", port: 13389, username: "agent", credentialSource: "env" },
          lastHealthAt: "2026-08-12T00:00:00Z",
          domain: "dom-1",
        },
      ],
      "/api/profile-status": {
        profiles: { portal: { ready: true, vms: [{ vmId: "vm_1", state: "running", snapshot: "golden-warm", snapshotPresent: true, ready: true }] } },
        vmCount: 1,
      },
    });
    render(<FleetOps />);
    expect(await screen.findByText("cuf-worker-1")).toBeInTheDocument();
    expect(screen.getByText("VMs configured")).toBeInTheDocument();
    expect(screen.getByText("domain dom-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open desktop" })).toBeInTheDocument();
    expect(await screen.findByText("portal")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
  });
});
