// Agent Planner: turn a plain-language task into a draft workflow graph by asking
// a CLI agent (claude/codex) to emit graph JSON, then normalizing + validating it.
// The agent call is injected (AgentExec), so this is unit tested with a fake.

import { runCliAgent, type AgentExec } from "./cli-agent-runner";
import { validateWorkflow } from "./workflow-validation";
import type { AgentProvider, Workflow, WorkflowEdge, WorkflowNode } from "./types";

export const PLANNER_SYSTEM = `You design automation workflows for a computer-use fleet.
Given a task, output ONLY a JSON object (no prose) of the form:
{"name": string, "nodes": [{"id","type","name","config":{"prompt"?,"requiredLabels"?,"provider"?}}], "edges": [{"from","to","condition"}]}
Node types: start, computer_use_task, cli_agent_task, shell_task, condition, human_takeover, retry_wait, end.
Rules: exactly one start and one end; every node reachable from start; edge condition is "success"|"failure"|"always".`;

type RawGraph = {
  name?: string;
  nodes?: Array<{
    id?: string;
    type?: string;
    name?: string;
    config?: WorkflowNode["config"];
    position?: { x: number; y: number };
  }>;
  edges?: Array<{ id?: string; from?: string; to?: string; condition?: string }>;
};

/** Pull a graph object out of the agent result (structured output or JSON in stdout). */
export function extractGraph(structuredOutput: unknown, stdout: string): RawGraph | undefined {
  const hasNodes = (v: unknown): v is RawGraph =>
    !!v && typeof v === "object" && Array.isArray((v as RawGraph).nodes);
  if (hasNodes(structuredOutput)) return structuredOutput;
  if (typeof structuredOutput === "string") {
    try {
      const p = JSON.parse(structuredOutput);
      if (hasNodes(p)) return p;
    } catch {
      /* fall through */
    }
  }
  // Last resort: the widest {...} span in stdout.
  const first = stdout.indexOf("{");
  const last = stdout.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      const p = JSON.parse(stdout.slice(first, last + 1));
      if (hasNodes(p)) return p;
    } catch {
      /* nothing */
    }
  }
  return undefined;
}

/** Fill in ids/positions/config so a loosely-specified graph is a valid Workflow. */
export function normalizeWorkflow(graph: RawGraph, id: string): Workflow {
  const nodes: WorkflowNode[] = (graph.nodes ?? []).map((n, i) => ({
    id: n.id ?? `n${i}`,
    type: (n.type as WorkflowNode["type"]) ?? "cli_agent_task",
    name: n.name ?? n.id ?? `Node ${i}`,
    position: n.position ?? { x: i, y: 0 },
    config: n.config ?? {},
  }));
  const edges: WorkflowEdge[] = (graph.edges ?? []).map((e, i) => ({
    id: e.id ?? `e${i}`,
    from: e.from ?? "",
    to: e.to ?? "",
    condition: (e.condition as WorkflowEdge["condition"]) ?? "success",
  }));
  return {
    id,
    name: graph.name ?? "Drafted workflow",
    description: "Drafted by the agent planner.",
    enabled: false, // drafts start disabled; the user reviews + enables
    triggerKinds: ["manual"],
    nodes,
    edges,
  };
}

export type PlanResult = { workflow: Workflow; errors: string[] };

export async function planWorkflow(
  task: string,
  agentExec: AgentExec,
  opts: { id?: string; provider?: AgentProvider } = {},
): Promise<PlanResult> {
  const id = opts.id ?? `wf_draft_${task.slice(0, 16).replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
  const result = await runCliAgent(
    {
      provider: opts.provider ?? "claude-code",
      prompt: `${PLANNER_SYSTEM}\n\nTask:\n${task}`,
      secrets: {},
      allowApiFallback: false,
    },
    agentExec,
  );
  const graph = extractGraph(result.structuredOutput, result.stdout);
  if (!graph) {
    return {
      workflow: normalizeWorkflow({ name: task, nodes: [], edges: [] }, id),
      errors: ["planner did not return a graph"],
    };
  }
  const workflow = normalizeWorkflow(graph, id);
  return { workflow, errors: validateWorkflow(workflow) };
}
