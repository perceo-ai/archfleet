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
    nodes: [
      { id: "n1", type: "browser_task", name: "Log into portal", position: { x: 0, y: 0 }, config: {} },
      { id: "n2", type: "computer_use_task", name: "Manual MFA", position: { x: 0, y: 100 }, config: {} },
      { id: "n3", type: "api_call", name: "File the result", position: { x: 0, y: 200 }, config: {} },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2", condition: "success" },
      { id: "e2", from: "n2", to: "n3", condition: "success" },
    ],
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
      { id: "e1", level: "info", message: 'Node "Log into portal" succeeded (done) after 3 steps.', timestamp: "t" },
      { id: "e2", level: "warn", message: 'Node "Manual MFA": paused for human takeover.', timestamp: "t" },
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
  it("running: live watch controls and the live desktop", async () => {
    stubRun(baseRun({ status: "running", currentStep: "Log into portal" }));
    render(<RunView id="r1" />);
    expect(await screen.findByRole("heading", { name: /Portal login check/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Watch live/i })).toBeInTheDocument();
    expect(await screen.findByTitle("Runner desktop")).toHaveAttribute(
      "src",
      "/guacamole/#/client/qc-1?token=t",
    );
    // Stop lives on the desktop frame, not duplicated in the header.
    expect(screen.getByRole("button", { name: /Stop/i })).toHaveClass("btn-danger");
  });

  it("paints the run onto the graph path", async () => {
    stubRun(baseRun({ status: "paused", currentStep: "Manual MFA" }));
    render(<RunView id="r1" />);
    expect(await screen.findByText("Path through the graph")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 nodes completed")).toBeInTheDocument();
    expect(screen.getByText("not reached")).toBeInTheDocument();
  });

  it("paused: renders whatever the run asked for — here, just an acknowledgement", async () => {
    stubRun(
      baseRun({ status: "paused", currentStep: "Manual MFA", pausedReason: "Approve the prompt" }),
      {
        "/api/takeovers?status=open": [
          {
            id: "tk_1",
            runId: "r1",
            reason: 'Paused at "Manual MFA"',
            requestedAction: "Approve the prompt on the phone, then resume",
            status: "open",
            openedAt: "2026-08-12T01:01:00Z",
            ask: { kind: "acknowledge", question: "Approve the prompt on the phone, then resume" },
          },
        ],
      },
    );
    render(<RunView id="r1" />);
    expect(await screen.findByText('Paused at "Manual MFA"')).toBeInTheDocument();
    expect(screen.getByText("Approve the prompt on the phone, then resume")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Operator notes/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Done — resume/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open the desktop/i })).toBeInTheDocument();
  });

  it("paused: renders an input ask as fields, whatever they are", async () => {
    stubRun(baseRun({ status: "paused", currentStep: "File the invoice" }), {
      "/api/takeovers?status=open": [
        {
          id: "tk_2",
          runId: "r1",
          reason: 'Paused at "File the invoice"',
          requestedAction: "Which PO number should this be filed under?",
          status: "open",
          openedAt: "2026-08-12T01:01:00Z",
          ask: {
            kind: "input",
            question: "Which PO number should this be filed under?",
            detail: "The invoice header has no PO and the vendor has three open ones.",
            fields: [
              { name: "po", label: "PO number", type: "text", required: true },
              { name: "note", label: "Note", type: "textarea", required: false },
            ],
          },
        },
      ],
    });
    render(<RunView id="r1" />);
    expect(await screen.findByText("Which PO number should this be filed under?")).toBeInTheDocument();
    expect(screen.getByText(/three open ones/)).toBeInTheDocument();
    expect(screen.getByLabelText("PO number")).toBeInTheDocument();
    expect(screen.getByLabelText("Note")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send & resume/i })).toBeInTheDocument();
  });

  it("paused: renders an approval ask as its two decisions", async () => {
    stubRun(baseRun({ status: "paused", currentStep: "Submit payment" }), {
      "/api/takeovers?status=open": [
        {
          id: "tk_3",
          runId: "r1",
          reason: 'Paused at "Submit payment"',
          requestedAction: "Send $2,480 to Acme Supplies?",
          status: "open",
          openedAt: "2026-08-12T01:01:00Z",
          ask: {
            kind: "approval",
            question: "Send $2,480 to Acme Supplies?",
            options: [
              { value: "approved", label: "Approve", tone: "ok" },
              { value: "rejected", label: "Reject", tone: "danger" },
            ],
          },
        },
      ],
    });
    render(<RunView id="r1" />);
    expect(await screen.findByText("Send $2,480 to Acme Supplies?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toHaveClass("btn-danger");
  });

  it("completed: criteria review, evidence and rerun", async () => {
    stubRun(
      baseRun({
        status: "succeeded",
        finishedAt: "2026-08-12T01:05:00Z",
        resultSummary: "succeeded — Released vm1.",
        artifacts: [
          { id: "a1", runId: "r1", type: "file", path: "/data/artifacts/r1/shot.png", createdAt: "t" },
        ],
      }),
    );
    render(<RunView id="r1" />);
    expect(await screen.findByText("Done means")).toBeInTheDocument();
    expect(screen.getByText("Dashboard visible after login")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Mark passed: Dashboard visible after login/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rerun" })).toBeInTheDocument();
    expect(screen.getAllByAltText("shot.png")[0]).toHaveAttribute(
      "src",
      "/api/runs/r1/artifacts/shot.png",
    );
  });

  it("failed: failure point, diagnosis and recovery actions", async () => {
    stubRun(
      baseRun({
        status: "failed",
        finishedAt: "2026-08-12T01:05:00Z",
        currentStep: "Log into portal",
        resultSummary: "failed — transport error",
      }),
    );
    render(<RunView id="r1" />);
    expect(await screen.findByText(/Failed at “Log into portal”/)).toBeInTheDocument();
    expect(screen.getByText("failed — transport error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry run/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry from the failed step/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add a takeover point here/i })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /open the automation/i })).toHaveAttribute(
      "href",
      "/automations/auto_1",
    );
  });
});
