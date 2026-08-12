import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetSidebar } from "./FleetSidebar";
import type { FleetVm } from "@/lib/fleet/types";

const vm: FleetVm = {
  id: "vm1",
  name: "desktop",
  status: "idle",
  labels: ["linux-desktop", "browser"],
  cpu: 2,
  memoryGb: 4,
  diskGb: 25,
  xrdp: { host: "host.docker.internal", port: 13389, username: "agent", credentialSource: "env:AGENT_PASSWORD" },
  lastHealthAt: "",
};

describe("FleetSidebar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a browser desktop session through the takeover API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ mode: "guacamole", launchUrl: "http://guac/#/client/qc-1?token=tok" }),
      })),
    );
    const open = vi.fn();
    vi.stubGlobal("open", open);

    render(<FleetSidebar vms={[vm]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open desktop" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/vms/vm1/takeover", { method: "POST" }));
    expect(open).toHaveBeenCalledWith("http://guac/#/client/qc-1?token=tok", "_blank", "noopener,noreferrer");
  });
});
