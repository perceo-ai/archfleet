// Pure conversion between the domain Workflow graph and React Flow's node/edge
// shape. Kept free of React so it is unit tested directly.

import type { Workflow, WorkflowEdge, WorkflowNode } from "@/lib/fleet/types";

export type FlowNode = {
  id: string;
  position: { x: number; y: number };
  data: { wnode: WorkflowNode };
};

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  data: { condition: WorkflowEdge["condition"] };
};

export function workflowToFlow(wf: Workflow): { nodes: FlowNode[]; edges: FlowEdge[] } {
  return {
    nodes: wf.nodes.map((n) => ({ id: n.id, position: n.position, data: { wnode: n } })),
    edges: wf.edges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      data: { condition: e.condition },
    })),
  };
}

export function flowToWorkflow(base: Workflow, nodes: FlowNode[], edges: FlowEdge[]): Workflow {
  return {
    ...base,
    nodes: nodes.map((fn) => ({ ...fn.data.wnode, id: fn.id, position: fn.position })),
    edges: edges.map((fe) => ({
      id: fe.id,
      from: fe.source,
      to: fe.target,
      condition: fe.data?.condition ?? "success",
    })),
  };
}

const NODE_DEFAULTS: Partial<Record<WorkflowNode["type"], { name: string; prompt?: string }>> = {
  agent_planner: {
    name: "Plan next action",
    prompt: "Review the task state and produce the next workflow step or decision.",
  },
  computer_use_task: {
    name: "Use golden VM",
    prompt: "Use the prepared desktop profile to complete this task step. Stop and report if human input is required.",
  },
  browser_task: {
    name: "Browser step",
    prompt: "Run the browser automation step and return structured success or failure.",
  },
  script_task: {
    name: "Desktop script",
    prompt: "Run the desktop script against the current VM session.",
  },
  cli_agent_task: {
    name: "Model reasoning step",
    prompt: "Inspect the current run context and decide the next action.",
  },
  shell_task: {
    name: "Shell step",
    prompt: "Run the required shell command and summarize the result.",
  },
  api_call: {
    name: "API step",
    prompt: "Call the required API and validate the response.",
  },
  otp_email: {
    name: "Read OTP email",
    prompt: "Fetch the latest OTP email and return the code if available.",
  },
  human_takeover: {
    name: "Human takeover",
    prompt: "Pause for manual login, 2FA, captcha, device trust, or review.",
  },
  condition: {
    name: "Model decision",
    prompt: "Return success when the workflow can continue, otherwise return failure with the reason.",
  },
  retry_wait: {
    name: "Retry wait",
    prompt: "Wait before retrying the previous step.",
  },
  artifact: {
    name: "Collect artifact",
    prompt: "Collect and verify the expected output artifact.",
  },
  end: {
    name: "Complete",
  },
};

let counter = 0;
/** Build a new node of a given type at a position. */
export function makeNode(
  type: WorkflowNode["type"],
  position = { x: 120, y: 120 },
): WorkflowNode {
  const id = `node_${type}_${counter++}`;
  const defaults = NODE_DEFAULTS[type] ?? { name: type.replaceAll("_", " ") };
  return {
    id,
    type,
    name: defaults.name,
    position,
    config: defaults.prompt ? { prompt: defaults.prompt } : {},
  };
}
