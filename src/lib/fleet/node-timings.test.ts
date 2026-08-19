import { describe, expect, it } from "vitest";
import { formatDuration, nodeDurations } from "./node-timings";
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
  ],
  edges: [],
};

function run(events: [string, string, string][]): WorkflowRun {
  return {
    id: "r1",
    workflowId: "wf",
    workflowName: "wf",
    status: "succeeded",
    startedAt: "2026-08-12T00:00:00Z",
    events: events.map(([level, message, timestamp], i) => ({
      id: `e${i}`,
      level: level as RunEvent["level"],
      message,
      timestamp,
    })),
  };
}

describe("nodeDurations", () => {
  it("measures the gap between a node's start and end events", () => {
    const timings = nodeDurations(
      run([
        ["info", 'Running browser node "Sign in" on vm-01.', "2026-08-12T00:00:00Z"],
        ["info", 'Node "Sign in" succeeded (done) after 3 steps.', "2026-08-12T00:00:11Z"],
      ]),
      workflow,
    );
    expect(timings.get("n1")).toBe(11_000);
  });

  it("measures failed nodes too", () => {
    const timings = nodeDurations(
      run([
        ["info", 'Running desktop node "Download CSV" on vm-01.', "2026-08-12T00:00:00Z"],
        ["warn", 'Node "Download CSV" failed (not_found) after 2 steps.', "2026-08-12T00:00:12Z"],
      ]),
      workflow,
    );
    expect(timings.get("n2")).toBe(12_000);
  });

  it("omits nodes that never finished, and unknown node names", () => {
    const timings = nodeDurations(
      run([
        ["info", 'Running desktop node "Download CSV" on vm-01.', "2026-08-12T00:00:00Z"],
        ["info", 'Node "Ghost step" succeeded (done).', "2026-08-12T00:00:05Z"],
      ]),
      workflow,
    );
    expect(timings.size).toBe(0);
  });

  it("returns nothing without a run or workflow", () => {
    expect(nodeDurations(undefined, workflow).size).toBe(0);
    expect(nodeDurations(run([]), undefined).size).toBe(0);
  });
});

describe("formatDuration", () => {
  it("stays compact", () => {
    expect(formatDuration(4_000)).toBe("4s");
    expect(formatDuration(72_000)).toBe("1m 12s");
  });
});
