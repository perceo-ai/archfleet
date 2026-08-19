import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { InboxPage } from "./InboxPage";
import { stubFetch } from "@/test/fetch-stub";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

const automation = {
  goal: "goal",
  target: "",
  specMarkdown: "",
  workflowId: "wf",
  successCriteria: [],
  requiredSecrets: [],
  artifactPolicy: "",
  retryPolicy: "",
  takeoverPolicy: "",
  riskNotes: [],
  createdAt: "t",
  updatedAt: "t",
};

describe("InboxPage", () => {
  it("leads with what needs a human and groups failures by cause", async () => {
    stubFetch({
      "/api/takeovers?status=open": [
        {
          id: "tk1",
          runId: "r9",
          reason: "MFA code needed",
          requestedAction: "Enter the 6-digit code",
          status: "open",
          openedAt: "2026-08-12T00:00:00Z",
          vmId: "vm-04",
          ask: {
            kind: "input",
            question: "Enter the 6-digit code",
            fields: [{ name: "otp", label: "Code", type: "code", secret: true }],
          },
        },
      ],
      "/api/runs": [
        { id: "r1", workflowId: "wf", workflowName: "Invoices", status: "failed", startedAt: "2026-08-12T01:00:00Z", currentStep: "Download CSV", resultSummary: "element not found", automationId: "a1" },
        { id: "r2", workflowId: "wf", workflowName: "Invoices", status: "failed", startedAt: "2026-08-12T02:00:00Z", currentStep: "Download CSV", resultSummary: "element not found", automationId: "a1" },
        { id: "r3", workflowId: "wf", workflowName: "Invoices", status: "running", startedAt: "2026-08-12T03:00:00Z", currentStep: "Sign in", automationId: "a1" },
      ],
      "/api/automations": [
        { ...automation, id: "a1", name: "Invoices", category: "general", status: "active", health: "failing" },
        { ...automation, id: "a2", name: "New draft", category: "general", status: "draft", health: "unknown" },
      ],
      "/api/environments": [],
      "/api/vms": [],
    });

    render(<InboxPage />);

    expect(await screen.findByText("Needs a human")).toBeInTheDocument();
    expect(screen.getByText("MFA code needed")).toBeInTheDocument();
    // whatever the run asked for is rendered inline — here a secret code field
    expect(screen.getByLabelText("Code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send & resume/i })).toBeInTheDocument();

    // two runs, one cause, one row
    expect(screen.getByText("Broken")).toBeInTheDocument();
    expect(screen.getByText("element not found")).toBeInTheDocument();
    expect(screen.getByText("2 runs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry 2" })).toBeInTheDocument();

    expect(screen.getByText("Waiting on your review")).toBeInTheDocument();
    expect(screen.getByText("New draft")).toBeInTheDocument();
    expect(screen.getByText("In flight")).toBeInTheDocument();
  });

  it("says so plainly when the queue is empty", async () => {
    stubFetch({
      "/api/takeovers?status=open": [],
      "/api/runs": [],
      "/api/automations": [
        { ...automation, id: "a1", name: "Invoices", category: "general", status: "active", health: "healthy" },
      ],
      "/api/environments": [],
      "/api/vms": [],
    });
    render(<InboxPage />);
    expect(await screen.findByText(/Nothing needs you/)).toBeInTheDocument();
  });
});
