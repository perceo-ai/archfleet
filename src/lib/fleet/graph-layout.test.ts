import { describe, expect, it } from "vitest";
import { DONE_NODE_ID, NODE_H, TRIGGER_NODE_ID, layoutGraph } from "./graph-layout";
import type { Workflow } from "./types";

function wf(nodes: [string, string][], edges: [string, string][]): Workflow {
  return {
    id: "wf",
    name: "wf",
    description: "",
    enabled: true,
    triggerKinds: ["manual"],
    nodes: nodes.map(([id, name]) => ({
      id,
      name,
      type: "computer_use_task",
      position: { x: 0, y: 0 },
      config: {},
    })),
    edges: edges.map(([from, to]) => ({ id: `${from}->${to}`, from, to, condition: "success" })),
  };
}

describe("layoutGraph", () => {
  it("brackets the workflow with a trigger and a done-means node", () => {
    const layout = layoutGraph(wf([["a", "A"], ["b", "B"]], [["a", "b"]]));
    expect(layout.nodes[0].id).toBe(TRIGGER_NODE_ID);
    expect(layout.nodes.at(-1)!.id).toBe(DONE_NODE_ID);
    // trigger feeds the entry node, the exit node feeds "done"
    expect(layout.edges).toContainEqual(
      expect.objectContaining({ from: TRIGGER_NODE_ID, to: "a" }),
    );
    expect(layout.edges).toContainEqual(expect.objectContaining({ from: "b", to: DONE_NODE_ID }));
  });

  it("stacks a chain top to bottom, one row per depth", () => {
    const layout = layoutGraph(wf([["a", "A"], ["b", "B"], ["c", "C"]], [["a", "b"], ["b", "c"]]));
    const y = (id: string) => layout.nodes.find((n) => n.id === id)!.y;
    expect(y("a")).toBeLessThan(y("b"));
    expect(y("b")).toBeLessThan(y("c"));
    expect(y("b") - y("a")).toBeGreaterThan(NODE_H);
  });

  it("puts a branch side by side and its rejoin below both", () => {
    const layout = layoutGraph(
      wf(
        [["a", "A"], ["b", "B"], ["c", "C"], ["d", "D"]],
        [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]],
      ),
    );
    const at = (id: string) => layout.nodes.find((n) => n.id === id)!;
    expect(at("b").y).toBe(at("c").y);
    expect(at("b").x).not.toBe(at("c").x);
    expect(at("d").y).toBeGreaterThan(at("b").y);
  });

  it("terminates on a cycle instead of hanging", () => {
    const layout = layoutGraph(wf([["a", "A"], ["b", "B"]], [["a", "b"], ["b", "a"]]));
    expect(layout.nodes).toHaveLength(4); // trigger + 2 + done
  });

  it("handles an empty workflow", () => {
    const layout = layoutGraph(undefined);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.width).toBeGreaterThan(0);
  });
});
