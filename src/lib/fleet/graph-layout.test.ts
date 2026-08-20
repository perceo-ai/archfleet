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

describe("layoutGraph on a large graph", () => {
  /** A 60-node graph: a spine with branches that rejoin, like a real automation. */
  function bigGraph(spine: number): Workflow {
    const nodes: [string, string][] = [["start", "Start"]];
    const edges: [string, string][] = [];
    let previous = "start";
    for (let i = 1; i <= spine; i++) {
      const id = `n${i}`;
      nodes.push([id, `Step ${i}`]);
      edges.push([previous, id]);
      // every fifth step forks and rejoins
      if (i % 5 === 0) {
        const side = `side${i}`;
        nodes.push([side, `Side ${i}`]);
        edges.push([previous, side]);
        edges.push([side, id]);
      }
      previous = id;
    }
    return wf(nodes, edges);
  }

  it("lays out sixty nodes quickly and keeps every one on the canvas", () => {
    const workflow = bigGraph(50);
    const started = performance.now();
    const layout = layoutGraph(workflow);
    const took = performance.now() - started;

    // trigger + real nodes + done
    expect(layout.nodes).toHaveLength(workflow.nodes.length + 2);
    expect(took).toBeLessThan(250);

    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + 230).toBeLessThanOrEqual(layout.width);
      expect(n.y + NODE_H).toBeLessThanOrEqual(layout.height);
    }
  });

  it("never overlaps two nodes", () => {
    const layout = layoutGraph(bigGraph(30));
    const seen = new Set<string>();
    for (const n of layout.nodes) {
      const cell = `${Math.round(n.x)}:${Math.round(n.y)}`;
      expect(seen.has(cell)).toBe(false);
      seen.add(cell);
    }
  });

  it("puts a forked node beside its spine step, not on top of it", () => {
    const layout = layoutGraph(bigGraph(10));
    const spine = layout.nodes.find((n) => n.id === "n5")!;
    const side = layout.nodes.find((n) => n.id === "side5")!;
    // the side branch starts from n4, so it sits a row above the rejoin
    expect(side.y).toBeLessThan(spine.y);
  });
});
