import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AutomationDetail } from "./AutomationDetail";
import { stubFetch } from "@/test/fetch-stub";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

const DETAIL = {
  automation: {
    id: "auto_1",
    name: "Portal login check",
    goal: "Verify login",
    category: "semantic_test",
    target: "portal.example.test",
    specMarkdown: "1. Open\n2. Log in",
    workflowId: "wf_1",
    environmentId: "env_default",
    successCriteria: ["Dashboard visible"],
    requiredSecrets: ["portal_password"],
    artifactPolicy: "screenshot",
    retryPolicy: "none",
    takeoverPolicy: "on MFA",
    triggerSuggestion: "before releases",
    riskNotes: [],
    status: "active",
    createdAt: "t",
    updatedAt: "t",
  },
  workflow: {
    id: "wf_1",
    name: "Portal login check",
    description: "",
    enabled: true,
    triggerKinds: ["manual"],
    nodes: [
      { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
      { id: "end", type: "end", name: "End", position: { x: 1, y: 0 }, config: {} },
    ],
    edges: [{ id: "e1", from: "start", to: "end", condition: "always" }],
  },
  environment: { id: "env_default", name: "Default runner desktop", description: "", labels: [], health: "unknown", createdAt: "t", updatedAt: "t" },
  triggers: [{ id: "tr_1", workflowId: "wf_1", type: "schedule", config: {}, enabled: true, cron: "0 9 * * *", createdAt: "t" }],
  runs: [
    { id: "r1", workflowId: "wf_1", workflowName: "Portal login check", status: "succeeded", startedAt: "2026-08-12T00:00:00Z", finishedAt: "2026-08-12T00:01:00Z", resultSummary: "succeeded — done" },
  ],
  health: "healthy",
};

describe("AutomationDetail", () => {
  it("shows the spec editor first with health, triggers, environment", async () => {
    stubFetch({
      "/api/automations/auto_1": DETAIL,
      "/api/environments": [DETAIL.environment],
    });
    render(<AutomationDetail id="auto_1" />);
    expect(await screen.findByRole("heading", { name: "Portal login check" })).toBeInTheDocument();
    expect(screen.getByText("healthy")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/2\. Log in/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Dashboard visible")).toBeInTheDocument();
    expect(screen.getAllByText(/Every day at 9:00/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Run now" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Advanced" })).toBeInTheDocument();
  });

  it("switches to the runs tab with linked history", async () => {
    stubFetch({
      "/api/automations/auto_1": DETAIL,
      "/api/environments": [],
    });
    render(<AutomationDetail id="auto_1" />);
    await screen.findByRole("heading", { name: "Portal login check" });
    fireEvent.click(screen.getByRole("tab", { name: /Runs/ }));
    expect(screen.getByText("succeeded — done")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /succeeded/ })).toHaveAttribute("href", "/runs/r1");
  });
});
