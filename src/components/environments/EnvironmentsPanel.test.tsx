import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EnvironmentsPanel } from "./EnvironmentsPanel";
import { stubFetch } from "@/test/fetch-stub";

afterEach(() => vi.unstubAllGlobals());

function stub() {
  stubFetch({
    "/api/environments": [
      {
        id: "env_portal",
        name: "Portal — logged in",
        description: "Trusted Chrome session",
        labels: ["profile:portal"],
        profileRef: "portal",
        health: "ready",
        snapshotState: "golden-warm",
        lastUsedAt: "2026-08-12T00:00:00Z",
        setupNotes: "",
        createdAt: "t",
        updatedAt: "t",
      },
    ],
    "/api/vms": [
      {
        id: "vm1",
        name: "vm-01",
        status: "idle",
        labels: ["profile:portal"],
        cpu: 2,
        memoryGb: 4,
        diskGb: 40,
        xrdp: { host: "10.0.0.1", port: 3389, username: "agent", credentialSource: "env" },
        lastHealthAt: "2026-08-12T00:00:00Z",
      },
    ],
    "/api/profile-ops": { operations: [] },
    "/api/profile-status": { profiles: {}, vmCount: 1 },
    "/api/health": { queuedRuns: 0 },
    "/api/secrets": [{ name: "portal_password", scope: "workflow" }],
  });
}

describe("EnvironmentsPanel", () => {
  it("lists environments with health and the preparation flow", async () => {
    stub();
    render(<EnvironmentsPanel />);
    expect(await screen.findByText("Portal — logged in")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.getByText(/profile portal/)).toBeInTheDocument();
    // the embedded profile setup flow is present
    expect(screen.getByText(/LLM Setup Flow/i)).toBeInTheDocument();
  });

  it("folds fleet capacity and secrets in as tabs", async () => {
    stub();
    render(<EnvironmentsPanel />);
    expect(await screen.findByText("Portal — logged in")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Capacity/ }));
    expect(await screen.findByText("vm-01")).toBeInTheDocument();
    expect(screen.getByText("Profile readiness")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Secrets/ }));
    expect(await screen.findByText("portal_password")).toBeInTheDocument();
  });

  it("opens the prepare-an-environment drawer", async () => {
    stub();
    render(<EnvironmentsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Prepare an environment/i }));
    expect(screen.getByLabelText("Environment name")).toBeInTheDocument();
  });
});
