import { describe, expect, it } from "vitest";
import { validateWorkflow } from "./workflow-validation";
import { seedFleetState } from "./seed";
import type { Workflow } from "./types";

describe("validateWorkflow", () => {
  it("accepts the seed workflow", () => {
    expect(validateWorkflow(seedFleetState().workflows[0])).toEqual([]);
  });

  it("flags missing start/end", () => {
    const wf: Workflow = {
      id: "w",
      name: "W",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [{ id: "a", type: "computer_use_task", name: "A", position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    };
    const errs = validateWorkflow(wf);
    expect(errs).toContain("workflow needs a start node");
    expect(errs).toContain("workflow needs an end node");
  });

  it("flags edges to unknown nodes + unreachable nodes", () => {
    const wf: Workflow = {
      id: "w",
      name: "W",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        { id: "orphan", type: "computer_use_task", name: "Orphan", position: { x: 1, y: 0 }, config: {} },
        { id: "end", type: "end", name: "E", position: { x: 2, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", from: "start", to: "ghost", condition: "always" }],
    };
    const errs = validateWorkflow(wf);
    expect(errs.some((e) => e.includes("unknown 'to' node: ghost"))).toBe(true);
    expect(errs.some((e) => e.includes("unreachable"))).toBe(true);
  });

  it("flags duplicate node ids + missing id/name", () => {
    const errs = validateWorkflow({
      nodes: [
        { id: "x", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        { id: "x", type: "end", name: "E", position: { x: 1, y: 0 }, config: {} },
      ],
    });
    expect(errs).toContain("duplicate node id: x");
    expect(errs).toContain("workflow.id is required");
  });
});
