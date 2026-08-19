import { describe, expect, it } from "vitest";
import { failureCountsByNode, runNodeStates } from "./run-node-states";
import type { RunEvent, Workflow, WorkflowRun } from "./types";

const workflow: Workflow = {
  id: "wf",
  name: "wf",
  description: "",
  enabled: true,
  triggerKinds: ["manual"],
  nodes: [
    { id: "n1", name: "Sign in", type: "browser_task", position: { x: 0, y: 0 }, config: {} },
    { id: "n2", name: "Download CSV", type: "computer_use_task", position: { x: 0, y: 1 }, config: {} },
    { id: "n3", name: "Upload", type: "api_call", position: { x: 0, y: 2 }, config: {} },
  ],
  edges: [],
};

function run(status: WorkflowRun["status"], events: string[][], currentStep?: string): WorkflowRun {
  return {
    id: "r1",
    workflowId: "wf",
    workflowName: "wf",
    status,
    startedAt: "t",
    currentStep,
    events: events.map(([level, message], i) => ({
      id: `e${i}`,
      level: level as RunEvent["level"],
      message,
      timestamp: "t",
    })),
  };
}

describe("runNodeStates", () => {
  it("marks nodes the orchestrator reported as succeeded", () => {
    const states = runNodeStates(
      run("running", [["info", 'Node "Sign in" succeeded (done) after 4 steps.']], "Download CSV"),
      workflow,
    );
    expect(states.get("n1")).toBe("ok");
  });

  it("leaves nodes it never mentioned as not reached", () => {
    const states = runNodeStates(run("running", [["info", 'Node "Sign in" succeeded.']]), workflow);
    expect(states.get("n3")).toBeUndefined();
  });

  it("marks the current step live, paused or failed from the run status", () => {
    expect(runNodeStates(run("running", [], "Download CSV"), workflow).get("n2")).toBe("live");
    expect(runNodeStates(run("paused", [], "Download CSV"), workflow).get("n2")).toBe("human");
    expect(runNodeStates(run("failed", [], "Download CSV"), workflow).get("n2")).toBe("fail");
  });

  it("lets a failure outrank an earlier success on the same node", () => {
    const states = runNodeStates(
      run("failed", [
        ["info", 'Node "Download CSV" succeeded (done) after 2 steps.'],
        ["error", 'Node "Download CSV": retries exhausted.'],
      ]),
      workflow,
    );
    expect(states.get("n2")).toBe("fail");
  });

  it("reads a takeover pause off the event log", () => {
    const states = runNodeStates(
      run("running", [["warn", 'Node "Download CSV": paused for human takeover.']]),
      workflow,
    );
    expect(states.get("n2")).toBe("human");
  });

  it("returns nothing without a run or workflow", () => {
    expect(runNodeStates(undefined, workflow).size).toBe(0);
    expect(runNodeStates(run("running", []), undefined).size).toBe(0);
  });
});

describe("failureCountsByNode", () => {
  it("counts failed runs per failing node", () => {
    const counts = failureCountsByNode(
      [
        { status: "failed", currentStep: "Download CSV" },
        { status: "failed", currentStep: "Download CSV" },
        { status: "failed", currentStep: "Sign in" },
        { status: "succeeded", currentStep: "Download CSV" },
        { status: "failed", currentStep: "Not a node" },
      ],
      workflow,
    );
    expect(counts.get("n2")).toBe(2);
    expect(counts.get("n1")).toBe(1);
    expect(counts.size).toBe(2);
  });
});
