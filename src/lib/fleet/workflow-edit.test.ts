import { describe, expect, it } from "vitest";
import { findNodeByName, insertTakeoverBefore, nodeAfter } from "./workflow-edit";
import type { Workflow } from "./types";

function workflow(): Workflow {
  return {
    id: "wf1",
    name: "Portal Login Check",
    description: "",
    enabled: true,
    triggerKinds: ["manual"],
    nodes: [
      { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
      { id: "task1", type: "computer_use_task", name: "Log into portal", position: { x: 1, y: 0 }, config: {} },
      { id: "end", type: "end", name: "End", position: { x: 2, y: 0 }, config: {} },
    ],
    edges: [
      { id: "e1", from: "start", to: "task1", condition: "always" },
      { id: "e2", from: "task1", to: "end", condition: "success" },
    ],
  };
}

describe("workflow-edit", () => {
  it("finds nodes by display name and the node after a step", () => {
    const wf = workflow();
    expect(findNodeByName(wf, "Log into portal")?.id).toBe("task1");
    expect(findNodeByName(wf, "nope")).toBeUndefined();
    expect(nodeAfter(wf, "task1")?.id).toBe("end");
    expect(nodeAfter(wf, "end")).toBeUndefined();
  });

  it("inserts a takeover node and rewires incoming edges", () => {
    const wf = insertTakeoverBefore(workflow(), "task1")!;
    const takeover = wf.nodes.find((n) => n.type === "human_takeover")!;
    expect(takeover.name).toContain("Log into portal");
    // start now feeds the takeover, and the takeover feeds the original task.
    expect(wf.edges.find((e) => e.from === "start")?.to).toBe(takeover.id);
    expect(wf.edges.find((e) => e.from === takeover.id)?.to).toBe("task1");
  });

  it("is a no-op when a takeover already guards the target, undefined for missing targets", () => {
    const once = insertTakeoverBefore(workflow(), "task1")!;
    const twice = insertTakeoverBefore(once, "task1")!;
    expect(twice.nodes.filter((n) => n.type === "human_takeover")).toHaveLength(1);
    expect(insertTakeoverBefore(workflow(), "ghost")).toBeUndefined();
  });
});
