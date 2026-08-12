import { describe, expect, it } from "vitest";
import { planWorkflow, extractGraph, normalizeWorkflow, PLANNER_SYSTEM } from "./planner";
import type { AgentExec } from "./cli-agent-runner";

const GRAPH = {
  name: "Portal Login",
  nodes: [
    { id: "start", type: "start", name: "Start" },
    { id: "login", type: "computer_use_task", name: "Log in", config: { prompt: "log in", requiredLabels: ["browser"] } },
    { id: "end", type: "end", name: "End" },
  ],
  edges: [
    { from: "start", to: "login", condition: "always" },
    { from: "login", to: "end", condition: "success" },
  ],
};

describe("extractGraph", () => {
  it("reads a graph from structured output", () => {
    expect(extractGraph(GRAPH, "")?.nodes?.length).toBe(3);
  });
  it("reads a graph embedded in stdout", () => {
    expect(extractGraph(undefined, `noise ${JSON.stringify(GRAPH)} tail`)?.name).toBe("Portal Login");
  });
  it("returns undefined when no graph present", () => {
    expect(extractGraph(undefined, "just logs")).toBeUndefined();
  });
});

describe("normalizeWorkflow", () => {
  it("fills ids/positions/config and starts disabled", () => {
    const wf = normalizeWorkflow(GRAPH, "wf1");
    expect(wf.enabled).toBe(false);
    expect(wf.nodes[0].position).toBeDefined();
    expect(wf.edges[0].id).toBeDefined();
  });
});

describe("planWorkflow", () => {
  it("teaches the planner how to emit agent-backed decision nodes", () => {
    expect(PLANNER_SYSTEM).toContain("condition with config.provider");
    expect(PLANNER_SYSTEM).toContain("success/failure");
  });

  it("drafts + validates a workflow from an agent's graph JSON", async () => {
    const exec: AgentExec = async () => ({
      code: 0,
      stdout: `{"type":"result","result":${JSON.stringify(GRAPH)}}`,
      stderr: "",
    });
    const { workflow, errors } = await planWorkflow("log into the portal", exec);
    expect(errors).toEqual([]);
    expect(workflow.nodes.some((n) => n.type === "computer_use_task")).toBe(true);
    expect(workflow.enabled).toBe(false);
  });

  it("returns errors when the agent gives no graph", async () => {
    const exec: AgentExec = async () => ({ code: 0, stdout: "sorry, cannot", stderr: "" });
    const { errors } = await planWorkflow("x", exec);
    expect(errors.length).toBeGreaterThan(0);
  });
});
