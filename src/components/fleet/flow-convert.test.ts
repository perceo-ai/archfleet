import { describe, expect, it } from "vitest";
import { workflowToFlow, flowToWorkflow, makeNode } from "./flow-convert";
import { seedFleetState } from "@/lib/fleet/seed";

describe("flow-convert", () => {
  it("round-trips a workflow through flow shape without loss", () => {
    const wf = seedFleetState().workflows[0];
    const { nodes, edges } = workflowToFlow(wf);
    const back = flowToWorkflow(wf, nodes, edges);
    expect(back.nodes).toHaveLength(wf.nodes.length);
    expect(back.edges).toHaveLength(wf.edges.length);
    expect(back.nodes[1].config).toEqual(wf.nodes[1].config);
    expect(back.edges[0].condition).toBe(wf.edges[0].condition);
  });

  it("reflects moved nodes + new edges back into the workflow", () => {
    const wf = seedFleetState().workflows[0];
    const { nodes, edges } = workflowToFlow(wf);
    nodes[0].position = { x: 999, y: 5 };
    const newEdge = { id: "e_new", source: nodes[0].id, target: nodes[1].id, data: { condition: "always" as const } };
    const back = flowToWorkflow(wf, nodes, [...edges, newEdge]);
    expect(back.nodes[0].position).toEqual({ x: 999, y: 5 });
    expect(back.edges.some((e) => e.id === "e_new" && e.condition === "always")).toBe(true);
  });

  it("makeNode builds a typed node with useful defaults + unique id", () => {
    const a = makeNode("computer_use_task");
    const b = makeNode("computer_use_task");
    expect(a.type).toBe("computer_use_task");
    expect(a.name).toBe("Use Runner VM");
    expect(a.config.prompt).toContain("golden profile");
    expect(a.id).not.toBe(b.id);
  });
});
