import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { EnvironmentsPanel } from "./EnvironmentsPanel";
import { stubFetch } from "@/test/fetch-stub";

afterEach(() => vi.unstubAllGlobals());

describe("EnvironmentsPanel", () => {
  it("lists environments with health and shows the setup flow", async () => {
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
      "/api/profile-ops": { operations: [] },
      "/api/secrets": [],
    });
    render(<EnvironmentsPanel />);
    expect(await screen.findByRole("heading", { name: "Portal — logged in" })).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.getByText("profile: portal")).toBeInTheDocument();
    expect(screen.getByLabelText("Environment name")).toBeInTheDocument();
    // the embedded profile setup flow is present
    expect(screen.getByText(/LLM Setup Flow/i)).toBeInTheDocument();
  });
});
