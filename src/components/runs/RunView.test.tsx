import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunView } from "./RunView";
import { stubFetch } from "@/test/fetch-stub";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

const AUTOMATION = {
  automation: {
    id: "auto_1",
    name: "Portal login check",
    goal: "",
    category: "semantic_test",
    target: "",
    specMarkdown: "",
    workflowId: "wf_1",
    successCriteria: ["Dashboard visible after login"],
    requiredSecrets: [],
    artifactPolicy: "",
    retryPolicy: "",
    takeoverPolicy: "",
    riskNotes: [],
    status: "active",
    createdAt: "t",
    updatedAt: "t",
  },
  workflow: {
    id: "wf_1",
    name: "Portal login check",
    description: "",
    enabled: false,
    triggerKinds: ["manual"],
    nodes: [],
    edges: [],
  },
};

function baseRun(overrides: Record<string, unknown>) {
  return {
    id: "r1",
    workflowId: "wf_1",
    workflowName: "Portal login check",
    vmId: "vm1",
    startedAt: "2026-08-12T01:00:00Z",
    events: [
      { id: "e1", level: "info", message: "Assigned to vm1", timestamp: "t" },
      { id: "e2", level: "warn", message: "paused for human takeover", timestamp: "t" },
    ],
    artifacts: [],
    automationId: "auto_1",
    ...overrides,
  };
}

function stubRun(run: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  stubFetch({
    "/api/runs/r1": run,
    "/api/evidence?runId=r1": [],
    "/api/takeovers?status=open": [],
    "/api/automations/auto_1": AUTOMATION,
    "/api/vms/vm1/takeover": { mode: "guacamole", launchUrl: "/guacamole/#/client/qc-1?token=t" },
    ...extra,
  });
}

describe("RunView", () => {
  it("running: live watch controls", async () => {
    stubRun(baseRun({ status: "running", currentStep: "Log into portal" }));
    render(<RunView id="r1" />);
    expect(await screen.findByRole("heading", { name: "Portal login check" })).toBeInTheDocument();
    expect(screen.getByText(/step: Log into portal/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Watch live desktop/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel/i })).toBeInTheDocument();
    expect(await screen.findByTitle("Runner desktop")).toHaveAttribute("src", "/guacamole/#/client/qc-1?token=t");
    expect(screen.getByText(/Assigned to vm1/)).toBeInTheDocument();
  });

  it("paused: takeover panel with reason, notes, resume", async () => {
    stubRun(
      baseRun({ status: "paused", currentStep: "Manual MFA", pausedReason: "Approve the MFA prompt" }),
      {
        "/api/takeovers?status=open": [
          { id: "tk_1", runId: "r1", reason: 'Paused at "Manual MFA"', requestedAction: "Approve the MFA prompt", status: "open", openedAt: "2026-08-12T01:01:00Z" },
        ],
      },
    );
    render(<RunView id="r1" />);
    expect(await screen.findByText("A human needs to take over")).toBeInTheDocument();
    expect(screen.getByText("Approve the MFA prompt")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Operator notes/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Done — resume run/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open desktop to take over/i })).toBeInTheDocument();
  });

  it("completed: criteria review + evidence + rerun", async () => {
    stubRun(
      baseRun({
        status: "succeeded",
        finishedAt: "2026-08-12T01:05:00Z",
        resultSummary: "succeeded — Released vm1.",
        artifacts: [{ id: "a1", runId: "r1", type: "file", path: "/data/artifacts/r1/shot.png", createdAt: "t" }],
      }),
    );
    render(<RunView id="r1" />);
    expect((await screen.findAllByText("Success criteria")).length).toBeGreaterThan(1);
    expect(screen.getAllByText("Dashboard visible after login").length).toBeGreaterThan(1);
    expect(screen.getByRole("button", { name: /Mark passed: Dashboard visible after login/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rerun" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Run copilot" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Review changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save and rerun" })).toBeInTheDocument();
    expect(screen.getByAltText("shot.png")).toHaveAttribute("src", "/api/runs/r1/artifacts/shot.png");
  });

  it("failed: failure point + recovery actions", async () => {
    stubRun(
      baseRun({
        status: "failed",
        finishedAt: "2026-08-12T01:05:00Z",
        currentStep: "Log into portal",
        resultSummary: "failed — transport error",
      }),
    );
    render(<RunView id="r1" />);
    expect(await screen.findByText(/Failed at "Log into portal"/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry run/i })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Edit automation/i })).toHaveAttribute("href", "/automations/auto_1");
    expect(screen.getByRole("link", { name: /Recover environment/i })).toHaveAttribute("href", "/environments");
  });
});
