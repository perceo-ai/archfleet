import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/** The live-run card also names the current step, so scope to the graph node. */
const graphNode = (name: RegExp) =>
  screen.getAllByRole("button", { name }).find((b) => b.classList.contains("gnode"))!;
import { AutomationWorkspace } from "./AutomationWorkspace";
import { stubFetch } from "@/test/fetch-stub";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

const DETAIL = {
  automation: {
    id: "auto_1",
    name: "Weekly invoice download",
    goal: "Pull last week's invoices into Drive",
    category: "report_download",
    target: "portal",
    specMarkdown: "",
    workflowId: "wf_1",
    successCriteria: ["A CSV was downloaded"],
    requiredSecrets: ["portal_password"],
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
    name: "Weekly invoice download",
    description: "",
    enabled: true,
    triggerKinds: ["manual"],
    nodes: [
      { id: "n1", type: "browser_task", name: "Open the portal", position: { x: 0, y: 0 }, config: {} },
      { id: "n2", type: "computer_use_task", name: "Download CSV", position: { x: 0, y: 100 }, config: { prompt: "click download" } },
    ],
    edges: [{ id: "e1", from: "n1", to: "n2", condition: "success" }],
  },
  triggers: [],
  runs: [
    { id: "r1", workflowId: "wf_1", workflowName: "Weekly invoice download", status: "failed", startedAt: "2026-08-12T01:00:00Z", finishedAt: "2026-08-12T01:02:00Z", currentStep: "Download CSV", automationId: "auto_1" },
  ],
  health: "failing",
};

function stub() {
  stubFetch({
    "/api/automations/auto_1": DETAIL,
    "/api/environments": [],
    "/api/runs/r1": {
      id: "r1",
      workflowId: "wf_1",
      workflowName: "Weekly invoice download",
      status: "failed",
      startedAt: "2026-08-12T01:00:00Z",
      currentStep: "Download CSV",
      events: [{ id: "e1", level: "info", message: 'Node "Open the portal" succeeded (done).', timestamp: "t" }],
      artifacts: [],
    },
    "/api/takeovers?status=open": [],
  });
}

describe("AutomationWorkspace", () => {
  it("shows the graph with the trigger and done-means nodes around it", async () => {
    stub();
    render(<AutomationWorkspace id="auto_1" />);

    expect(await screen.findByRole("button", { name: /Open the portal/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Trigger/ })).toBeInTheDocument();
    expect(graphNode(/Download CSV/)).toBeDefined();
    expect(screen.getByRole("button", { name: /Done means/ })).toBeInTheDocument();
    // the goal is a single line above the canvas, not a form
    expect(screen.getByText(/Pull last week's invoices into Drive/)).toBeInTheDocument();
  });

  it("paints the last run's failures onto the node", async () => {
    stub();
    render(<AutomationWorkspace id="auto_1" />);
    expect(await screen.findByText("1 run failed here")).toBeInTheDocument();
  });

  it("opens a node's detail in a modal rather than inline", async () => {
    stub();
    render(<AutomationWorkspace id="auto_1" />);
    await screen.findByRole("button", { name: /Open the portal/ });
    fireEvent.click(graphNode(/Download CSV/));
    expect(await screen.findByDisplayValue("click download")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("opens the success criteria from the done-means node", async () => {
    stub();
    render(<AutomationWorkspace id="auto_1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Done means/ }));
    expect(await screen.findByDisplayValue("A CSV was downloaded")).toBeInTheDocument();
  });

  it("starts empty for a new automation", async () => {
    stubFetch({ "/api/environments": [] });
    render(<AutomationWorkspace />);
    expect(await screen.findByText("Untitled automation")).toBeInTheDocument();
    expect(screen.getByText(/No steps yet/)).toBeInTheDocument();
  });
});
