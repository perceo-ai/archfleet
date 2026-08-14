import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeDashboard } from "./HomeDashboard";
import { stubFetch } from "@/test/fetch-stub";

afterEach(() => vi.unstubAllGlobals());

const automation = {
  id: "auto_1",
  name: "Portal login check",
  goal: "Verify login works",
  category: "semantic_test",
  target: "portal.example.test",
  specMarkdown: "",
  workflowId: "wf_1",
  successCriteria: [],
  requiredSecrets: [],
  artifactPolicy: "",
  retryPolicy: "",
  takeoverPolicy: "",
  riskNotes: [],
  status: "active",
  createdAt: "2026-08-12T00:00:00Z",
  updatedAt: "2026-08-12T00:00:00Z",
  health: "healthy",
};

describe("HomeDashboard", () => {
  it("surfaces takeovers, runs, automations, and the fleet strip", async () => {
    stubFetch({
      "/api/automations": [automation, { ...automation, id: "auto_2", name: "Draft one", status: "draft", category: "general" }],
      "/api/runs": [
        { id: "r1", workflowId: "wf_1", workflowName: "Portal login check", status: "running", startedAt: "2026-08-12T01:00:00Z", currentStep: "Log in" },
        { id: "r2", workflowId: "wf_1", workflowName: "Portal login check", status: "failed", startedAt: "2026-08-12T00:30:00Z" },
      ],
      "/api/takeovers?status=open": [
        { id: "tk_1", runId: "r3", reason: "MFA prompt", requestedAction: "Approve on phone", status: "open", openedAt: "2026-08-12T01:00:00Z" },
      ],
      "/api/environments": [],
      "/api/vms": [{ id: "vm1", status: "idle" }],
    });
    render(<HomeDashboard />);
    expect((await screen.findAllByText("Portal login check")).length).toBeGreaterThan(0);
    expect(screen.getByText("Needs your input")).toBeInTheDocument();
    expect(screen.getByText("MFA prompt")).toBeInTheDocument();
    expect(screen.getByText("Running now")).toBeInTheDocument();
    expect(screen.getByText("Recent failures")).toBeInTheDocument();
    expect(screen.getByText("Drafts")).toBeInTheDocument();
    expect(screen.getByText("Semantic tests")).toBeInTheDocument();
    expect(screen.getByText("VMs online")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /New automation/i })).toHaveAttribute("href", "/automations/new");
    // takeover links to its run
    expect(screen.getByRole("link", { name: /MFA prompt/i })).toHaveAttribute("href", "/runs/r3");
  });

  it("renders the empty state without any data", async () => {
    stubFetch({
      "/api/automations": [],
      "/api/runs": [],
      "/api/takeovers?status=open": [],
      "/api/environments": [],
      "/api/vms": [],
    });
    render(<HomeDashboard />);
    expect(await screen.findByText(/No automations yet/i)).toBeInTheDocument();
    expect(screen.getByText("Nothing running.")).toBeInTheDocument();
    expect(screen.queryByText("Needs your input")).not.toBeInTheDocument();
  });
});
